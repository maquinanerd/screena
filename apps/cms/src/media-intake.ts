/**
 * media-intake.ts — NUCLEO PURO da ingestao de midia editorial por maquina.
 *
 * Mesmo padrao de `draft-intake.ts`: toda a decisao vive aqui, sem IO. O
 * endpoint (`endpoints/editorial-media.ts`) so le o corpo, consulta o banco,
 * grava e responde.
 *
 * POR QUE ESTA ROTA EXISTE. Ate aqui a midia so entrava pelo painel, com um
 * humano arrastando o arquivo. O MNScr produz a materia inteira menos a foto — e
 * materia sem foto perde espaco em lista e em compartilhamento. Esta e a ultima
 * peca do caminho automatico.
 *
 * DECISAO DO OPERADOR (2026-08-06): imagem de robo e PUBLICA sempre. A
 * proveniencia (`credit`, `sourceName`, `sourceUrl`, `rightsHolder`) existe para
 * ATENDER RECLAMACAO — saber de onde veio e tirar do ar em minutos —, nao para
 * bloquear publicacao.
 *
 * A consequencia dessa decisao e o desenho deste modulo: se a proveniencia nao
 * bloqueia na SAIDA, ela tem de ser obrigatoria na ENTRADA. E o unico momento em
 * que existe um emissor escutando. Recusar aqui, com `422` e a lista de campos
 * faltando, e o oposto de recusar na entrega — onde a imagem simplesmente nao
 * aparece e ninguem fica sabendo.
 */

/* ------------------------------------------------------------------ */
/* Limites                                                             */
/* ------------------------------------------------------------------ */

/**
 * Teto do CORPO da requisicao.
 *
 * Sao dois limites diferentes de proposito: este protege a memoria do processo
 * (o corpo inteiro e lido como string antes de decodificar), e
 * `MAX_MEDIA_BYTES` e a politica de midia. Base64 infla 4/3, e ainda ha os
 * campos de texto — por isso o teto do corpo e maior que o da imagem.
 */
export const MAX_MEDIA_REQUEST_BYTES = 21 * 1024 * 1024

/** Teto dos bytes DECODIFICADOS. Espelha `MAX_DELIVERABLE_BYTES` da entrega. */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024

/**
 * MIME aceitos na INGESTAO. Subconjunto do `upload.mimeTypes` da collection.
 *
 * AVIF fica de fora, e nao por esquecimento: a entrega aceita AVIF porque um
 * humano decidiu por aquele arquivo no painel. Aqui quem envia e uma maquina, e
 * as dimensoes do AVIF vivem numa caixa de deslocamento variavel que este modulo
 * nao le — aceitar seria abrir mao do gate de pixels em silencio.
 */
export const INGESTIBLE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type IngestibleMime = (typeof INGESTIBLE_MIME_TYPES)[number]

export const EXTENSION_BY_MIME: Record<IngestibleMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Comprimento maximo dos campos de texto. Nao ha texto longo neste contrato. */
const MAX_TEXT_LENGTH = 500
const MAX_URL_LENGTH = 2000

/* ------------------------------------------------------------------ */
/* Assinatura de bytes                                                 */
/* ------------------------------------------------------------------ */

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false
  return prefix.every((byte, index) => bytes[index] === byte)
}

/**
 * Le `length` bytes como ASCII.
 *
 * `clamp` decide o que fazer quando o buffer e menor que a janela pedida, e a
 * diferenca NAO e cosmetica:
 *
 *  - assinatura de formato (`RIFF`/`WEBP`/`ftyp`) exige a janela INTEIRA — um
 *    buffer curto demais simplesmente nao e daquele formato, e devolver o
 *    prefixo faria um arquivo truncado casar por acidente;
 *  - varredura de formato PERIGOSO precisa do prefixo disponivel. Um SVG cabe em
 *    44 bytes. Exigir 512 devolvia string vazia, o SVG escapava da deteccao e
 *    caia no ramo generico como `bytes_mismatch` — recusado, mas com o motivo
 *    errado, que e justamente o que faz o emissor reenviar o mesmo arquivo.
 */
function ascii(bytes: Uint8Array, offset: number, length: number, clamp = false): string {
  const end = clamp ? Math.min(bytes.length, offset + length) : offset + length
  if (!clamp && bytes.length < end) return ''
  let out = ''
  for (let i = offset; i < end; i += 1) out += String.fromCharCode(bytes[i] ?? 0)
  return out
}

/**
 * Que formato os BYTES dizem ser?
 *
 * O `contentType` declarado nunca decide — ele serve so para PEGAR MENTIRA: se
 * divergir da assinatura, os bytes sao recusados. Extensao de arquivo nao entra
 * na conta em momento nenhum.
 */
export function sniffIngestibleMime(bytes: Uint8Array): IngestibleMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Formato perigoso conhecido, para dar um motivo PRECISO na recusa.
 *
 * "SVG recusado" ensina o emissor a corrigir; "formato desconhecido" faz ele
 * reenviar o mesmo arquivo.
 */
export function detectDangerousFormat(bytes: Uint8Array): string | null {
  const head = ascii(bytes, 0, 512, true).trimStart().toLowerCase()
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'svg_or_xml'
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (startsWith(bytes, [0x4d, 0x5a])) return 'executable'
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'executable'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'archive'
  return null
}

/* ------------------------------------------------------------------ */
/* Contrato de entrada                                                 */
/* ------------------------------------------------------------------ */

export interface MediaIngestAuth {
  readonly authenticated: boolean
  readonly hasMediaIngestScope: boolean
  readonly accountId: string | null
}

/** Campos aceitos no corpo. Qualquer outro e ignorado (nao e erro). */
export interface MediaIngestCommand {
  readonly articleId: string
  readonly sourceUrl: string
  readonly sourceName: string
  readonly rightsHolder: string
  readonly credit: string
  readonly alt: string
  readonly caption: string | null
  readonly contentType: IngestibleMime
  readonly bytes: Uint8Array
}

export type MediaIngestRejectionCode =
  | 'unauthenticated'
  | 'forbidden_scope'
  | 'invalid_json'
  | 'payload_too_large'
  | 'validation_failed'
  | 'mime_not_allowed'
  | 'bytes_mismatch'
  | 'dangerous_format'
  | 'image_too_large'
  | 'article_not_found'

export interface MediaIngestRejection {
  readonly code: MediaIngestRejectionCode
  readonly status: number
  readonly issues: readonly string[]
}

export type MediaIngestDecision =
  | { readonly ok: true; readonly command: MediaIngestCommand }
  | { readonly ok: false; readonly rejection: MediaIngestRejection }

function reject(
  code: MediaIngestRejectionCode,
  status: number,
  issues: readonly string[] = [],
): MediaIngestDecision {
  return { ok: false, rejection: { code, status, issues } }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * `sourceUrl` precisa ser http(s) absoluta e ficar guardavel.
 *
 * Ela nunca e BUSCADA — o worker de projecao ignora URL por contrato, e este
 * endpoint recebe os bytes no corpo. Ela e prova de origem, e so isso. Validar
 * a forma evita guardar lixo que nao serve para responder reclamacao.
 */
function isStorableSourceUrl(value: string): boolean {
  if (value.length > MAX_URL_LENGTH) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:' || url.protocol === 'http:'
}

/** Decodifica base64 estrito. Devolve `null` para entrada malformada. */
export function decodeBase64(value: string): Uint8Array | null {
  const compact = value.replace(/\s+/g, '')
  if (compact === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null
  if (compact.length % 4 !== 0) return null
  try {
    const buffer = Buffer.from(compact, 'base64')
    // `Buffer.from` e permissivo; o round-trip pega o que a regex deixou passar.
    if (buffer.toString('base64').replace(/=+$/, '') !== compact.replace(/=+$/, '')) return null
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

/**
 * Decide se este pedido de ingestao pode virar midia.
 *
 * Ordem deliberada: identidade -> tamanho do corpo -> forma -> bytes. Cada
 * degrau e mais caro que o anterior, e nenhum e pulado quando o anterior passa.
 */
export function intakeEditorialMedia(input: {
  readonly auth: MediaIngestAuth
  readonly rawBodyBytes: number
  readonly body: unknown
}): MediaIngestDecision {
  const { auth } = input

  // AUTENTICADO e IDENTIDADE UTILIZAVEL sao perguntas diferentes: o Payload pode
  // reconhecer a credencial enquanto a conta esta INATIVA. 401 e "quem e voce?";
  // 403 e "sei quem voce e, e voce nao pode".
  if (!auth.authenticated) return reject('unauthenticated', 401)
  if (!auth.hasMediaIngestScope) return reject('forbidden_scope', 403)

  if (input.rawBodyBytes > MAX_MEDIA_REQUEST_BYTES) {
    return reject('payload_too_large', 413, [
      `corpo com ${String(input.rawBodyBytes)} bytes; teto ${String(MAX_MEDIA_REQUEST_BYTES)}`,
    ])
  }

  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return reject('invalid_json', 400, ['corpo precisa ser um objeto JSON'])
  }

  const raw = input.body as Record<string, unknown>
  const issues: string[] = []

  const articleId = text(raw.articleId)
  if (articleId === null) issues.push('articleId ausente')
  else if (!/^\d+$/.test(articleId)) issues.push('articleId precisa ser numerico')

  // PROVENIENCIA OBRIGATORIA. Ver o cabecalho: como a licenca nao bloqueia a
  // saida, ela precisa ser exigida aqui, onde ha alguem para ouvir a recusa.
  const sourceUrl = text(raw.sourceUrl)
  if (sourceUrl === null) issues.push('sourceUrl ausente')
  else if (!isStorableSourceUrl(sourceUrl)) issues.push('sourceUrl precisa ser http(s) absoluta')

  const provenance: Array<readonly [string, string | null]> = [
    ['sourceName', text(raw.sourceName)],
    ['rightsHolder', text(raw.rightsHolder)],
    // `credit` nao e cosmetico: `requiresAttribution` nasce `true` e a entrega
    // recusa com `attribution_missing` se ele estiver vazio. Sem exigir aqui, a
    // foto entraria no acervo e sumiria na hora de servir.
    ['credit', text(raw.credit)],
    // `alt` e `required` na collection `media`; sem ele a criacao falharia no
    // banco, com erro de driver em vez de mensagem util.
    ['alt', text(raw.alt)],
  ]
  for (const [field, value] of provenance) {
    if (value === null) issues.push(`${field} ausente`)
    else if (value.length > MAX_TEXT_LENGTH) issues.push(`${field} acima de ${String(MAX_TEXT_LENGTH)} caracteres`)
  }

  const caption = text(raw.caption)
  if (caption !== null && caption.length > MAX_TEXT_LENGTH) {
    issues.push(`caption acima de ${String(MAX_TEXT_LENGTH)} caracteres`)
  }

  const declaredType = text(raw.contentType)
  if (declaredType === null) issues.push('contentType ausente')

  const contentBase64 = typeof raw.contentBase64 === 'string' ? raw.contentBase64 : null
  if (contentBase64 === null || contentBase64.trim() === '') issues.push('contentBase64 ausente')

  if (issues.length > 0) return reject('validation_failed', 422, issues)

  if (!(INGESTIBLE_MIME_TYPES as readonly string[]).includes(declaredType as string)) {
    return reject('mime_not_allowed', 415, [
      `contentType ${String(declaredType)}; aceitos: ${INGESTIBLE_MIME_TYPES.join(', ')}`,
    ])
  }

  const bytes = decodeBase64(contentBase64 as string)
  if (bytes === null) return reject('validation_failed', 422, ['contentBase64 nao e base64 valido'])
  if (bytes.length === 0) return reject('validation_failed', 422, ['contentBase64 decodificou vazio'])

  if (bytes.length > MAX_MEDIA_BYTES) {
    return reject('image_too_large', 413, [
      `imagem com ${String(bytes.length)} bytes; teto ${String(MAX_MEDIA_BYTES)}`,
    ])
  }

  // Formato perigoso ANTES de "mime nao bate": recusar um SVG dizendo
  // "assinatura diverge" nao ensina nada a quem enviou.
  const dangerous = detectDangerousFormat(bytes)
  if (dangerous !== null) {
    return reject('dangerous_format', 415, [`formato recusado: ${dangerous}`])
  }

  const actual = sniffIngestibleMime(bytes)
  if (actual === null) {
    return reject('bytes_mismatch', 415, ['assinatura de bytes nao corresponde a imagem aceita'])
  }
  if (actual !== declaredType) {
    return reject('bytes_mismatch', 415, [
      `contentType declarado ${String(declaredType)}, assinatura diz ${actual}`,
    ])
  }

  return {
    ok: true,
    command: {
      articleId: articleId as string,
      sourceUrl: sourceUrl as string,
      sourceName: text(raw.sourceName) as string,
      rightsHolder: text(raw.rightsHolder) as string,
      credit: text(raw.credit) as string,
      alt: text(raw.alt) as string,
      caption,
      contentType: actual,
      bytes,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Idempotencia                                                        */
/* ------------------------------------------------------------------ */

/** O que o banco ja tem para o par (artigo, sourceUrl). */
export interface ExistingIngestedMedia {
  readonly mediaId: string
  readonly contentHash: string | null
}

export type MediaIngestOutcome = 'created' | 'unchanged' | 'replaced'

/**
 * A chave de idempotencia e (`artigo`, `sourceUrl`), nao o hash do conteudo.
 *
 * O motivo e o reenvio: o MNScr reprocessa a mesma materia quando a revisao
 * muda, e reenvia a mesma foto. Com chave por CONTEUDO, a mesma imagem usada em
 * duas materias diferentes colidiria e a segunda materia ficaria apontando para
 * a midia da primeira — inclusive herdando um `alt` escrito para outro texto.
 * Com chave por (artigo, url), cada materia tem a sua entrada, e o reenvio
 * encontra a propria.
 *
 * Quando o hash MUDA para a mesma url — a fonte trocou a foto no mesmo endereco
 * — o desfecho e `replaced`: um upload novo, com a entrada antiga preservada.
 * Sobrescrever o arquivo em silencio apagaria a imagem que ja pode estar
 * publicada e servida por caminho derivado do conteudo.
 */
export function decideMediaIngestOutcome(
  existing: ExistingIngestedMedia | null,
  incomingContentHash: string,
): MediaIngestOutcome {
  if (existing === null) return 'created'
  if (existing.contentHash === incomingContentHash) return 'unchanged'
  return 'replaced'
}
