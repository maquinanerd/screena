/**
 * export-discovery.ts — Nucleo PURO da descoberta por Daily ID Exports.
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * A logica (parse -> filtro anti-adulto -> dedup -> ORDEM -> corte) morava
 * dentro de `persistence/catalog-services.ts`, atras do wiring do Prisma e do
 * client TMDB. Nao era exportada e nao tinha teste: a ORDEM da fila — a decisao
 * que define o que o site mostra nos primeiros dias de um espelho — era
 * exatamente a parte sem cobertura.
 *
 * Aqui nao ha rede, banco nem relogio: o chamador entrega as linhas do export ja
 * descomprimido e recebe o desfecho. O IO (montar a URL do dia, baixar,
 * descomprimir, logar) fica no adapter (`export-stream.ts`).
 *
 * ORDEM: POPULARIDADE DECRESCENTE, NUNCA ORDEM DE ARQUIVO
 * -------------------------------------------------------
 * O export vem em ordem de `id`, que e aproximadamente a ordem de cadastro no
 * TMDB. Como `--limit N` e um CORTE DE PREFIXO, cortar a ordem de arquivo
 * sincroniza os N ids mais ANTIGOS do catalogo — curta obscuro de 1913 —
 * enquanto os titulos que o publico procura hoje esperam o fim da fila.
 *
 * O campo `popularity` ja vem em cada linha do export (verificado no export de
 * 2026-08-10: presente em movie, tv e person), entao ordenar por popularidade
 * nao custa uma chamada de API nem um byte de cota. E so nao descartar um campo
 * que ja chegou.
 *
 * DUAS CAMADAS ANTI-ADULTO (regra de ingestao) — as duas continuam valendo:
 *  1. arquivos `adult_*` nunca sao baixados (fica em `id-exports.ts`);
 *  2. o campo `adult` e classificado FAIL-CLOSED por linha (`classifyAdult`,
 *     dentro do sampler), ANTES de a linha concorrer a um lugar na fila.
 *
 * NUNCA O ARQUIVO INTEIRO NA MEMORIA (medido em 29/10/2026)
 * ---------------------------------------------------------
 * Ate aqui o adapter baixava o `.json.gz` num Buffer, descomprimia com
 * `gunzipSync`, fazia `toString` e este modulo partia o texto, parseava TODAS as
 * linhas, filtrava, deduplicava num Map de chave string e ordenava o universo
 * para devolver 2.000 ids. No export de pessoas de 28/10/2026 (5.016.908 linhas,
 * 362.777.514 caracteres), junto com os de filmes e series, isso foi um trecho
 * SINCRONO unico de 13 a 16,5 s numa maquina de mesa e 3,0 GB de RSS de pico
 * (2,1 GB de heap) — e, durante o trecho, nem `/healthz` responde nem o
 * heartbeat do job anda. Na mesma janela, em producao, o `screen-catalog-worker`
 * renascia ~5 vezes por madrugada e os tres `discover_ids` iam para dead-letter
 * com `worker_heartbeat_timeout`. Medicao e ressalvas em
 * `docs/operations/descoberta-diaria-segura-o-worker-2026-10-29.md`.
 *
 * Agora o caminho da fila e `discoverIdsFromExportBatches`: as linhas chegam em
 * lotes conforme o gunzip ASSINCRONO as produz, cada linha vai direto ao sampler
 * de top-N (memoria O(N) + o conjunto de ids vistos), e o event loop e
 * devolvido a cada `EXPORT_LINES_PER_YIELD` linhas mesmo que a fonte nunca
 * espere IO.
 */

import { createTopRecordSampler } from './export-sample.js'
import { parseIdExportLine } from './id-exports.js'
import type { TmdbDiscoveryKind } from './id-exports.js'

/** Desfecho de uma descoberta por export (mesma forma de `DiscoverIdsOutcome`). */
export interface ExportDiscoveryOutcome {
  /** Linhas lidas do arquivo, antes de qualquer filtro. */
  readonly discovered: number
  /** Ids que sobreviveram a filtro, dedup e corte. */
  readonly accepted: number
  /** Descartados por `adult === true` ou por valor malformado (fail-closed). */
  readonly rejectedAdult: number
  /** Ids repetidos dentro do proprio export. */
  readonly duplicate: number
  /** Ids aceitos, JA ORDENADOS por popularidade decrescente. */
  readonly ids: readonly number[]
}

/** O que a descoberta precisa saber do export, alem das linhas. */
export interface ExportDiscoveryOptions {
  /** Tipo de entidade do arquivo. */
  readonly kind: TmdbDiscoveryKind
  /**
   * Se este export DEVERIA trazer `adult` por linha (movie/person). Quando
   * `true`, a AUSENCIA do campo e anomalia e o registro cai como unsafe — nunca
   * presumido seguro.
   */
  readonly hasAdultField: boolean
  /** Teto de ids. `null` = sem teto (o universo inteiro daquele tipo). */
  readonly limit: number | null
}

/** Entrada da descoberta pura sobre o texto inteiro (testes e chamadores pequenos). */
export interface ExportDiscoveryInput extends ExportDiscoveryOptions {
  /** Texto do export ja baixado e descomprimido (JSONL). */
  readonly text: string
}

/** Entrada da descoberta em streaming — o caminho da fila. */
export interface ExportBatchDiscoveryInput extends ExportDiscoveryOptions {
  /** Linhas do export ja descomprimido, em lotes, na ordem do arquivo. */
  readonly batches: AsyncIterable<readonly string[]>
  /** Shutdown ou timeout do job: interrompe entre dois lotes. */
  readonly signal?: AbortSignal
}

/**
 * Linhas processadas entre duas devolucoes do event loop.
 *
 * Parse + sampler custam ~1-3 us por linha; 10.000 linhas ficam na casa das
 * dezenas de ms mesmo numa CPU disputada — muito abaixo do timeout de 5 s do
 * HEALTHCHECK e do intervalo de 15 s do heartbeat do job.
 */
export const EXPORT_LINES_PER_YIELD = 10_000

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

interface DiscoveryAccumulator {
  addLine(line: string): void
  finish(): ExportDiscoveryOutcome
}

/**
 * Ordem do pipeline (a ordem importa): parse -> filtro anti-adulto -> dedup +
 * ordenacao por popularidade -> corte pelo `limit`. O corte e SEMPRE o ultimo
 * passo: o sampler so decide depois da ultima linha, e cortar antes de ordenar
 * seria o defeito que este modulo existe para impedir.
 *
 * Deterministico: as mesmas linhas produzem exatamente a mesma lista, na mesma
 * ordem (popularidade desc com desempate por `tmdbId` asc — ordem TOTAL, sem
 * empate residual; id repetido mantem a maior popularidade).
 */
function createDiscoveryAccumulator(options: ExportDiscoveryOptions): DiscoveryAccumulator {
  // `limit: 0` e teto ZERO na fila (contrato de sempre: nada e enfileirado). O
  // sampler le 0 como "sem teto" — e guardaria o universo inteiro so para
  // devolver nada. Pede 1 e descarta.
  const sampler = createTopRecordSampler({
    limit: options.limit === 0 ? 1 : options.limit,
    adultFieldRequired: options.hasAdultField,
  })
  let discovered = 0

  return {
    addLine(line: string): void {
      const record = parseIdExportLine(line)
      if (record === null) return
      discovered += 1
      sampler.offer(record)
    },
    finish(): ExportDiscoveryOutcome {
      const sample = sampler.finish()
      const ids = options.limit === 0 ? [] : sample.kept.map((record) => record.id)
      return {
        discovered,
        accepted: ids.length,
        // Adulto explicito e valor malformado somam: os dois sao o filtro
        // protegendo a fila, e o total e o numero que o operador precisa vigiar.
        rejectedAdult: sample.counts.adultDropped + sample.counts.unsafeDropped,
        duplicate: sample.counts.duplicate,
        ids,
      }
    },
  }
}

/** Descobre ids a partir do texto inteiro de um Daily ID Export. */
export function discoverIdsFromExportText(input: ExportDiscoveryInput): ExportDiscoveryOutcome {
  const accumulator = createDiscoveryAccumulator(input)
  for (const line of input.text.split('\n')) accumulator.addLine(line)
  return accumulator.finish()
}

/**
 * Descobre ids a partir das linhas de um Daily ID Export, em lotes.
 *
 * Mesmo desfecho de `discoverIdsFromExportText` sobre as mesmas linhas, sem
 * nunca segurar o event loop por mais de `EXPORT_LINES_PER_YIELD` linhas: o
 * worker continua respondendo `/healthz` e renovando o heartbeat do job
 * enquanto o export de pessoas (5 milhoes de linhas) passa.
 */
export async function discoverIdsFromExportBatches(
  input: ExportBatchDiscoveryInput,
): Promise<ExportDiscoveryOutcome> {
  const accumulator = createDiscoveryAccumulator(input)
  let sinceYield = 0
  for await (const batch of input.batches) {
    // A devolucao conta LINHAS, nao lotes: um lote enorme (fonte que entregue
    // o arquivo de uma vez) seria de novo um trecho sincrono sem fim.
    for (const line of batch) {
      accumulator.addLine(line)
      sinceYield += 1
      if (sinceYield === EXPORT_LINES_PER_YIELD) {
        sinceYield = 0
        await yieldToEventLoop()
        input.signal?.throwIfAborted()
      }
    }
  }
  input.signal?.throwIfAborted()
  return accumulator.finish()
}
