/**
 * export-stream.ts — Baixa um Daily ID Export em STREAMING e entrega as linhas
 * em lotes. E o adapter de IO da descoberta: o unico modulo de `discovery/`
 * que toca a rede (o nucleo puro esta em `export-discovery.ts`).
 *
 * POR QUE STREAMING (medido em 29/10/2026)
 * ----------------------------------------
 * Os dois bins (`catalog-worker-service.ts` e `catalog.ts`) baixavam o arquivo
 * num Buffer, chamavam `gunzipSync` e `toString('utf8')`. No export de pessoas
 * sao 78 MB comprimidos e 362 milhoes de caracteres descomprimidos: a
 * descompressao e a conversao rodam na thread principal, e o texto inteiro fica
 * vivo enquanto o parse acontece. Aqui o gunzip e o `zlib` ASSINCRONO (roda no
 * threadpool e devolve a thread a cada pedaco) e nenhum pedaco do arquivo vive
 * mais que o lote que o contem.
 *
 * GZIP PELOS BYTES, NAO PELO CABECALHO
 * ------------------------------------
 * Os exports sao `.json.gz` servidos como corpo binario, SEM
 * `content-encoding: gzip` — o `fetch` nao descomprime. Se um dia vier com o
 * cabecalho, o `fetch` descomprime e o corpo chega como JSONL puro. Decidir pelo
 * numero magico (`1f 8b`) cobre os dois casos; decidir errado faria toda linha
 * virar JSON invalido e a descoberta reportar "0 ids" com SUCESSO.
 *
 * Arquivo publico: sem token TMDB, sem custo de cota (regra de ingestao).
 */

import { Readable, pipeline } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { createGunzip } from 'node:zlib'

/** Opcoes do download. */
export interface StreamExportLinesOptions {
  /** Shutdown ou timeout do job: cancela o download e a descompressao. */
  readonly signal?: AbortSignal
  /** Injetavel para teste. Default: o `fetch` global. */
  readonly fetchImpl?: typeof fetch
}

const isGzipMagic = (head: Buffer): boolean =>
  head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b

/**
 * Le pedacos ate ter os 2 bytes do numero magico e devolve um stream que
 * reentrega TUDO (cabeca + resto), sem copiar o corpo.
 */
async function withPeekedHead(
  body: Readable,
): Promise<{ readonly head: Buffer; readonly bytes: Readable }> {
  const chunks = body[Symbol.asyncIterator]()
  let head = Buffer.alloc(0)
  while (head.length < 2) {
    const next = await chunks.next()
    if (next.done === true) break
    head = Buffer.concat([head, Buffer.from(next.value as Uint8Array)])
  }
  const replay = async function* (): AsyncGenerator<Buffer> {
    try {
      if (head.length > 0) yield head
      for (let next = await chunks.next(); next.done !== true; next = await chunks.next()) {
        yield Buffer.from(next.value as Uint8Array)
      }
    } finally {
      // Consumidor parou antes do fim (abort, erro no parse): fecha o corpo.
      await chunks.return?.()
    }
  }
  return { head, bytes: Readable.from(replay(), { objectMode: false }) }
}

/**
 * Baixa o export e entrega as linhas (JSONL ja descomprimido) em lotes, na
 * ordem do arquivo. Um lote por pedaco descomprimido — dezenas a centenas de
 * linhas. A ultima linha sem `\n` final tambem e entregue.
 */
export async function* streamExportLines(
  url: string,
  options: StreamExportLinesOptions = {},
): AsyncGenerator<readonly string[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const response = await fetchImpl(url, { signal: options.signal })
  if (!response.ok) throw new Error(`export HTTP ${response.status}`)
  if (response.body === null) throw new Error('export sem corpo')

  // O mesmo cast de `bin/discover-ids.ts`: o ReadableStream do fetch (tipos DOM)
  // e o de `node:stream/web` divergem so no tipo — em runtime e o mesmo objeto.
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  const { head, bytes } = await withPeekedHead(body)
  // `pipeline` destroi os dois lados no primeiro erro (gzip corrompido, rede
  // caida): a iteracao abaixo rejeita com ele em vez de terminar "com sucesso".
  const decoded = isGzipMagic(head) ? pipeline(bytes, createGunzip(), () => {}) : bytes

  const decoder = new StringDecoder('utf8')
  let carry = ''
  for await (const chunk of decoded) {
    const lines = (carry + decoder.write(chunk as Buffer)).split('\n')
    carry = lines.pop() ?? ''
    if (lines.length > 0) yield lines
  }
  const tail = carry + decoder.end()
  if (tail.length > 0) yield [tail]
}
