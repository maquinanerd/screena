/**
 * sync-queue.ts — Montagem IDEMPOTENTE da fila de sync a partir dos ids
 * descobertos (ja filtrados de adult). Modulo PURO.
 *
 * A fila diz APENAS "o que existe para sincronizar", com prioridade por
 * popularidade. O sync raw (buscar detalhe + gravar `tmdb_raw`) e P0-00d — aqui
 * nada de rede/DB nem `append_to_response`.
 */

import { classifyAdult } from './adult-filter.js'
import type { IdExportRecord, TmdbDiscoveryKind } from './id-exports.js'

/** Item da fila de sync: tipo + id TMDB + popularidade (para priorizar). */
export interface QueueItem {
  readonly kind: TmdbDiscoveryKind
  readonly tmdbId: number
  readonly popularity: number | null
}

/** Uma fonte de descoberta: um tipo + seus registros ja filtrados (sem adult). */
export interface DiscoverySource {
  readonly kind: TmdbDiscoveryKind
  readonly records: readonly IdExportRecord[]
}

/** Ordem estavel de tipos, para desempate deterministico na fila. */
const KIND_ORDER: readonly TmdbDiscoveryKind[] = [
  'movie',
  'tv',
  'person',
  'collection',
  'network',
  'company',
  'keyword',
]

function popularityOf(record: IdExportRecord): number | null {
  return typeof record.popularity === 'number' && Number.isFinite(record.popularity)
    ? record.popularity
    : null
}

/**
 * Monta a fila a partir das fontes:
 *  - dedup por `(kind, tmdbId)` (o mesmo id pode existir em tipos diferentes),
 *    mantendo a MAIOR popularidade em caso de repeticao (determinismo — nao
 *    depende da ordem de entrada);
 *  - ordenacao DETERMINISTICA: tipo (KIND_ORDER) -> popularidade desc (nulls por
 *    ultimo) -> tmdbId asc.
 *
 * Idempotente: a mesma entrada (em qualquer ordem) produz exatamente a mesma
 * fila (rodar a descoberta duas vezes gera o mesmo NDJSON).
 *
 * Defesa em profundidade: alem de ignorar ids invalidos, re-aplica a
 * classificacao value-based de adult (`classifyAdult`) e NUNCA enfileira
 * `adult === true` nem valor malformado — mesmo que um chamador esqueca de
 * passar registros ja filtrados. A regra por-tipo de "adult ausente" fica no
 * `filterAdult` upstream; esta e a rede secundaria.
 */
export function buildSyncQueue(sources: readonly DiscoverySource[]): QueueItem[] {
  const byKey = new Map<string, QueueItem>()

  for (const source of sources) {
    for (const record of source.records) {
      if (!Number.isInteger(record.id) || record.id <= 0) continue
      if (classifyAdult(record.adult) !== 'safe') continue

      const key = `${source.kind}:${record.id}`
      const popularity = popularityOf(record)
      const existing = byKey.get(key)
      if (existing === undefined) {
        byKey.set(key, { kind: source.kind, tmdbId: record.id, popularity })
        continue
      }
      // Dedup deterministico: mantem a maior popularidade (independe da ordem).
      const existingPop = existing.popularity ?? Number.NEGATIVE_INFINITY
      const nextPop = popularity ?? Number.NEGATIVE_INFINITY
      if (nextPop > existingPop) {
        byKey.set(key, { kind: source.kind, tmdbId: record.id, popularity })
      }
    }
  }

  const items = [...byKey.values()]
  items.sort((a, b) => {
    const kindDiff = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
    if (kindDiff !== 0) return kindDiff
    const pa = a.popularity ?? Number.NEGATIVE_INFINITY
    const pb = b.popularity ?? Number.NEGATIVE_INFINITY
    if (pa !== pb) return pb - pa // popularidade desc (mais populares primeiro)
    return a.tmdbId - b.tmdbId // id asc (determinismo total)
  })
  return items
}
