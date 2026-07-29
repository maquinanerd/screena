/**
 * s3-signature.ts — Assinatura AWS SigV4 para storage S3-compatible. PURO*.
 *
 * (*) usa `node:crypto` para HMAC/SHA-256; nao faz rede, nao le `process.env` e
 * nao le o relogio — o instante da assinatura e INJETADO, senao seria
 * impossivel testar a assinatura contra um vetor conhecido.
 *
 * Escrito a mao, sem SDK, pela mesma razao do cliente Brevo neste repositorio:
 * o `@aws-sdk/client-s3` traz dezenas de pacotes transitivos para usarmos
 * exatamente um verbo (PUT de objeto). SigV4 tem umas cem linhas e nao muda.
 *
 * Compativel com Cloudflare R2, MinIO e S3 propriamente dito.
 */

import { createHash, createHmac } from 'node:crypto'

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'

function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * Codificacao de caminho do S3: cada segmento e percent-encoded, mas a barra
 * SEPARADORA permanece. `encodeURIComponent` sozinho escaparia as barras e o
 * objeto iria parar numa chave com `%2F` no nome.
 */
export function encodeS3Path(objectPath: string): string {
  return objectPath
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')
}

/** `20260729T013000Z` e `20260729`, o formato exigido pelo SigV4. */
export function amzDateParts(nowIso: string): { amzDate: string; dateStamp: string } {
  const compact = new Date(nowIso).toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: compact, dateStamp: compact.slice(0, 8) }
}

export interface SignedRequest {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
}

export interface SignRequestInput {
  readonly method: string
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly key: string
  readonly forcePathStyle: boolean
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly nowIso: string
  readonly payload: Uint8Array
  readonly extraHeaders?: Record<string, string>
}

/**
 * Assina uma requisicao S3.
 *
 * Sempre com `x-amz-content-sha256` do corpo REAL (nunca `UNSIGNED-PAYLOAD`):
 * assim o proprio storage recusa um corpo alterado em transito, e nao dependemos
 * so do TLS para integridade.
 */
export function signS3Request(input: SignRequestInput): SignedRequest {
  const { amzDate, dateStamp } = amzDateParts(input.nowIso)
  const endpoint = new URL(input.endpoint)

  const host = input.forcePathStyle ? endpoint.host : `${input.bucket}.${endpoint.host}`
  const basePath = endpoint.pathname.replace(/\/+$/, '')
  const objectPath = input.forcePathStyle
    ? `${basePath}/${input.bucket}/${input.key}`
    : `${basePath}/${input.key}`
  const canonicalUri = encodeS3Path(objectPath.startsWith('/') ? objectPath : `/${objectPath}`)

  const payloadHash = sha256Hex(input.payload)
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(
      Object.entries(input.extraHeaders ?? {}).map(([name, value]) => [
        name.toLowerCase(),
        value.trim(),
      ]),
    ),
  }

  const signedHeaderNames = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${headers[name] ?? ''}\n`)
    .join('')
  const signedHeaders = signedHeaderNames.join(';')

  const canonicalRequest = [
    input.method,
    canonicalUri,
    '', // sem query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), SERVICE),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  return {
    url: `${endpoint.protocol}//${host}${canonicalUri}`,
    method: input.method,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}
