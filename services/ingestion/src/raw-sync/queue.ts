/**
 * queue.ts — Leitura e selecao do piloto a partir da fila NDJSON (P0-00c).
 * Modulo PURO (sem IO): o CLI faz o streaming do arquivo e alimenta o seletor.
 *
 * A fila e o artefato de `bin/discover-ids.ts` (`.data/discovery-queue-*.ndjson`,
 * gitignored), 1 `QueueItem` por linha, JA ordenada por tipo (movie, tv, person,
 * ...) e popularidade desc. O seletor faz scan INTEIRO da fila para contar
 * `unsupportedSkipped` de forma honesta, mantendo memoria LIMITADA (guarda so os
 * itens suportados selecionados, ate o limite por tipo, + contadores).
 */

import type { QueueItem } from '../discovery/sync-queue.js'
import type { TmdbDiscoveryKind } from '../discovery/id-exports.js'
import { isSupportedRawKind, SUPPORTED_RAW_KINDS } from './supported-kinds.js'
import type { PilotLimits, PilotSelection, SupportedRawKind } from './types.js'

/** Tipos validos da fila (para validar a linha NDJSON defensivamente). */
const DISCOVERY_KINDS: ReadonlySet<string> = new Set<TmdbDiscoveryKind>([
  'movie',
  'tv',
  'person',
  'collection',
  'network',
  'company',
  'keyword',
])

/**
 * Faz parse de UMA linha NDJSON da fila. Devolve o `QueueItem` ou `null` para
 * linha vazia/branca, JSON invalido, ou objeto sem `{ kind valido, tmdbId > 0 }`.
 * NUNCA lanca — a fila pode ter milhoes de linhas; uma linha ruim nao aborta.
 */
export function parseRawQueueLine(line: string): QueueItem | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as { kind?: unknown; tmdbId?: unknown; popularity?: unknown }
  if (typeof obj.kind !== 'string' || !DISCOVERY_KINDS.has(obj.kind)) return null
  if (typeof obj.tmdbId !== 'number' || !Number.isInteger(obj.tmdbId) || obj.tmdbId <= 0) return null

  const popularity =
    typeof obj.popularity === 'number' && Number.isFinite(obj.popularity) ? obj.popularity : null

  return { kind: obj.kind as TmdbDiscoveryKind, tmdbId: obj.tmdbId, popularity }
}

/** Limite configurado para um tipo suportado. */
function limitFor(limits: PilotLimits, kind: SupportedRawKind): number {
  return limits[kind]
}

/**
 * Seletor incremental do piloto (memoria limitada). O CLI chama `offer` por
 * linha (scan inteiro) e `result()` no fim. Suportados entram em `selected` ate
 * o limite do tipo; o excedente do tipo suportado NAO e contado como unsupported
 * (e apenas fora do piloto). Nao-suportados sao SEMPRE contados.
 */
export interface PilotSelector {
  offer(item: QueueItem): void
  result(): PilotSelection
}

/** Cria um seletor incremental para os limites dados. */
export function createPilotSelector(limits: PilotLimits): PilotSelector {
  const selected: QueueItem[] = []
  const perKindSelected: Record<SupportedRawKind, number> = { movie: 0, tv: 0, person: 0 }
  const unsupportedByKind: Record<string, number> = {}
  let unsupportedSkipped = 0
  let scanned = 0

  return {
    offer(item: QueueItem): void {
      scanned += 1
      if (isSupportedRawKind(item.kind)) {
        if (perKindSelected[item.kind] < limitFor(limits, item.kind)) {
          selected.push(item)
          perKindSelected[item.kind] += 1
        }
        return
      }
      unsupportedSkipped += 1
      unsupportedByKind[item.kind] = (unsupportedByKind[item.kind] ?? 0) + 1
    },
    result(): PilotSelection {
      return {
        selected,
        perKindSelected: { ...perKindSelected },
        unsupportedSkipped,
        unsupportedByKind: { ...unsupportedByKind },
        scanned,
      }
    },
  }
}

/**
 * Conveniencia para testes: seleciona a partir de um array em memoria
 * (equivalente a alimentar o seletor item a item). Em producao, o CLI usa o
 * seletor incremental via streaming.
 */
export function selectPilotItems(
  items: readonly QueueItem[],
  limits: PilotLimits,
): PilotSelection {
  const selector = createPilotSelector(limits)
  for (const item of items) selector.offer(item)
  return selector.result()
}

/** Limites default do piloto (100/100/100). */
export const DEFAULT_PILOT_LIMITS: PilotLimits = { movie: 100, tv: 100, person: 100 }

/** Soma dos limites (teto de `selected`). Util para relatorio/validacao. */
export function totalLimit(limits: PilotLimits): number {
  return SUPPORTED_RAW_KINDS.reduce((sum, kind) => sum + limitFor(limits, kind), 0)
}
