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
 * Aqui nao ha rede, banco nem relogio: o chamador entrega o texto do export ja
 * baixado e recebe o desfecho. O IO (montar a URL do dia, baixar, logar) fica no
 * adapter.
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
 *  2. o campo `adult` e classificado FAIL-CLOSED por linha (`filterAdult`), e
 *     `buildSyncQueue` reaplica `classifyAdult` como rede secundaria.
 */

import { filterAdult } from './adult-filter.js'
import { parseIdExport } from './id-exports.js'
import { buildSyncQueue } from './sync-queue.js'
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

/** Entrada da descoberta pura. */
export interface ExportDiscoveryInput {
  /** Texto do export ja baixado e descomprimido (JSONL). */
  readonly text: string
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

/**
 * Descobre ids a partir do texto de um Daily ID Export.
 *
 * Ordem do pipeline (a ordem importa): parse -> filtro anti-adulto -> dedup +
 * ordenacao por popularidade -> corte pelo `limit`. O corte e SEMPRE o ultimo
 * passo: cortar antes de ordenar seria o defeito que este modulo existe para
 * impedir.
 *
 * Deterministico: o mesmo texto produz exatamente a mesma lista, na mesma ordem
 * (`buildSyncQueue` ordena por popularidade desc com desempate por `tmdbId`
 * asc — ordem TOTAL, sem empate residual).
 */
export function discoverIdsFromExportText(input: ExportDiscoveryInput): ExportDiscoveryOutcome {
  const records = parseIdExport(input.text)
  const filtered = filterAdult(records, { adultFieldRequired: input.hasAdultField })

  // Dedup + ordenacao ANTES do corte.
  const queue = buildSyncQueue([{ kind: input.kind, records: filtered.kept }])
  // O que `buildSyncQueue` removeu alem do que `filterAdult` ja havia descartado
  // e id repetido dentro do proprio export.
  const duplicate = filtered.kept.length - queue.length
  const ordered = input.limit === null ? queue : queue.slice(0, input.limit)

  return {
    discovered: records.length,
    accepted: ordered.length,
    // Adulto explicito e valor malformado somam: os dois sao o filtro protegendo
    // a fila, e o total e o numero que o operador precisa vigiar.
    rejectedAdult: filtered.adultDropped + filtered.unsafeDropped,
    duplicate,
    ids: ordered.map((item) => item.tmdbId),
  }
}
