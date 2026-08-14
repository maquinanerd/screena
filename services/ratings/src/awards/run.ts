/**
 * run.ts — Orquestracao PURA da promocao de premiacao: `api_cache` -> dominio.
 *
 * Depende so de portas e de um relogio injetado. Nenhum Prisma, nenhum `fetch`,
 * nenhuma chamada a OMDb. Testavel com fakes.
 *
 * GARANTIAS
 *  - ZERO REDE. O dado ja esta guardado; promove-lo nao gasta cota.
 *  - `--apply` (`options.apply`) e o unico caminho que escreve. Sem ele o run
 *    percorre tudo e RELATA, sem tocar o banco.
 *  - IDEMPOTENTE. O upsert e por `(entity_type, entity_id, provider_api)`;
 *    linha ja identica nao e reescrita.
 *  - Titulo SEM premio nao vira registro. `"N/A"` e ausencia declarada pela
 *    fonte, e ausencia nao e linha — mas o motivo vai para o relatorio. Dos 51
 *    payloads medidos em producao, 41 tem valor real; os outros 10 aparecem
 *    nomeados no relatorio, nunca somem em silencio.
 *  - CREDITO NA ESCRITA. Licenca, atribuicao e `display_allowed` sao resolvidos
 *    aqui, no momento da gravacao — o credito e fato da licenca, conhecido
 *    agora, e nao decisao de um revisor depois.
 *  - A licenca e resolvida UMA VEZ por execucao (ela e a mesma para o catalogo
 *    inteiro) e o motivo da recusa aparece UMA vez, nao 41.
 */

import { parseOmdbAwards } from '@screena/schemas'

import type { EntityLookupPort, SyncLogPort, SyncStatus } from '../ports.js'
import type { AwardsCacheSourcePort, AwardsCreditPort, EntityAwardsPort } from './ports.js'
import type {
  AwardsCreditResolution,
  AwardsRejection,
  AwardsRejectionReason,
  EntityAwardRow,
  RatingsEntityType,
} from './types.js'

/** Endpoint logico registrado em `api_sync_logs`. Nao e uma URL: nao ha rede. */
export const AWARDS_PROMOTION_ENDPOINT = 'local:api_cache/omdb/awards'

/** Teto defensivo de payloads lidos por execucao. */
export const DEFAULT_AWARDS_LIMIT = 200

export interface AwardsRunOptions {
  readonly apply: boolean
  readonly limit: number | null
  readonly providerApi: string
  /** Restringe a promocao a um tipo; `null` = filme e serie. */
  readonly entityType: RatingsEntityType | null
}

export interface AwardsRunDeps {
  readonly cache: AwardsCacheSourcePort
  readonly credit: AwardsCreditPort
  readonly entities: EntityLookupPort
  readonly awards: EntityAwardsPort
  readonly syncLog: SyncLogPort
  readonly now: () => Date
}

export interface AwardsRunCounters {
  readonly payloadsRead: number
  readonly recognized: number
  readonly written: number
  readonly created: number
  readonly updated: number
  readonly unchanged: number
  /** Linhas gravadas ja exibiveis. Zero enquanto nao houver licenca. */
  readonly displayable: number
}

/** Resultado de UM payload. */
export interface AwardsItemResult {
  readonly requestKey: string
  readonly imdbId: string | null
  readonly entityType: RatingsEntityType | null
  readonly entityId: string | null
  readonly recognized: boolean
  readonly awardsRaw: string | null
  readonly written: boolean
  readonly displayAllowed: boolean
  readonly rejection: AwardsRejection | null
}

export interface AwardsRunResult {
  readonly status: SyncStatus
  readonly applied: boolean
  readonly creditResolution: AwardsCreditResolution
  readonly items: readonly AwardsItemResult[]
  readonly counters: AwardsRunCounters
  readonly rejections: readonly AwardsRejection[]
  readonly durationMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** `Response: "False"` chega com HTTP 200 — nunca e sucesso. */
function isFailureResponse(payload: Record<string, unknown>): boolean {
  const raw = payload['Response']
  if (raw === undefined) return false
  if (typeof raw === 'boolean') return !raw
  if (typeof raw === 'string') return raw.trim().toLowerCase() !== 'true'
  return true
}

const IMDB_ID = /^tt\d+$/

function reject(reason: AwardsRejectionReason, detail: string): AwardsRejection {
  return { reason, detail }
}

/** Frase do motivo pelo qual a licenca nao entregou credito. */
export function describeCreditResolution(resolution: AwardsCreditResolution): string {
  switch (resolution.kind) {
    case 'credit':
      return `credito resolvido: fonte "${resolution.credit.sourceKey}"`
    case 'ambiguous':
      return (
        `AMBIGUA: ha ${resolution.sourceKeys.length} licencas de premiacao vigentes ` +
        `(${resolution.sourceKeys.join(', ')}). Escolher uma seria sortear de quem e o credito. ` +
        'Aposente as que sobram em services/legal e reaplique.'
      )
    case 'no-license':
      return (
        'SEM LICENCA de premiacao vigente: a fonte editorial do campo Awards da OMDb ainda ' +
        'nao foi decidida (ver docs/legal/omdb-awards-source-provenance.md). ' +
        'As linhas sao gravadas para auditoria com display_allowed=false e a faixa nao acende.'
      )
  }
}

/**
 * Promove os literais `Awards` de `api_cache` para `entity_awards`.
 *
 * NUNCA lanca por causa de um payload: uma recusa e registrada e o ciclo segue.
 */
export async function runAwardsPromotion(
  options: AwardsRunOptions,
  deps: AwardsRunDeps,
): Promise<AwardsRunResult> {
  const startedAt = deps.now().getTime()
  const limit = options.limit ?? DEFAULT_AWARDS_LIMIT

  // UMA vez por execucao: a licenca de premiacao e a mesma para todo o catalogo.
  const creditResolution = await deps.credit.resolve()
  const credit = creditResolution.kind === 'credit' ? creditResolution.credit : null

  const rejections: AwardsRejection[] = []
  if (credit === null) {
    // O motivo aparece UMA vez, nao uma por titulo. Ele nao aborta o ciclo:
    // guardar o fato sem exibi-lo continua sendo o comportamento correto.
    rejections.push(reject('no-license', describeCreditResolution(creditResolution)))
  }

  const cached = await deps.cache.list(limit)
  const items: AwardsItemResult[] = []
  let recognized = 0
  let created = 0
  let updated = 0
  let unchanged = 0
  let displayable = 0

  for (const entry of cached) {
    const base = {
      requestKey: entry.requestKey,
      imdbId: null as string | null,
      entityType: null as RatingsEntityType | null,
      entityId: null as string | null,
      recognized: false,
      awardsRaw: null as string | null,
      written: false,
      displayAllowed: false,
    }

    if (!isRecord(entry.payload) || isFailureResponse(entry.payload)) {
      const rejection = reject(
        'payload-unusable',
        `${entry.requestKey}: payload nao e objeto ou a OMDb respondeu Response=False.`,
      )
      rejections.push(rejection)
      items.push({ ...base, rejection })
      continue
    }

    const rawImdbId = entry.payload['imdbID']
    const imdbId =
      typeof rawImdbId === 'string' && IMDB_ID.test(rawImdbId.trim()) ? rawImdbId.trim() : null
    if (imdbId === null) {
      const rejection = reject(
        'no-imdb-id',
        `${entry.requestKey}: payload sem "imdbID" valido; titulo indeterminavel.`,
      )
      rejections.push(rejection)
      items.push({ ...base, rejection })
      continue
    }

    // O reconhecimento vem ANTES da resolucao de entidade: uma frase que nao
    // entendemos e uma recusa sobre o DADO, e o operador precisa dela mesmo que
    // o titulo nem exista localmente.
    const parsed = parseOmdbAwards(entry.payload['Awards'])
    if (!parsed.recognized) {
      const reason: AwardsRejectionReason =
        parsed.reason === 'absent'
          ? 'awards-absent'
          : parsed.reason === 'not_available'
            ? 'awards-not-available'
            : 'awards-unrecognized'
      const rejection = reject(
        reason,
        parsed.reason === 'unrecognized_format'
          ? // O literal BRUTO e o ponto: e com ele que o reconhecedor sera
            // estendido depois, com evidencia em vez de palpite.
            `${imdbId}: formato nao reconhecido — literal bruto: ${JSON.stringify(parsed.raw)}`
          : parsed.reason === 'not_available'
            ? `${imdbId}: a OMDb respondeu "N/A" — titulo sem premio conhecido. Nao vira registro.`
            : `${imdbId}: campo "Awards" ausente ou vazio. Nao vira registro.`,
      )
      rejections.push(rejection)
      items.push({ ...base, imdbId, rejection })
      continue
    }

    recognized += 1
    const awardsRaw = (entry.payload['Awards'] as string).trim()

    // Resolve a entidade local. So por identificador — nunca por titulo/ano.
    const types: readonly RatingsEntityType[] =
      options.entityType !== null ? [options.entityType] : ['movie', 'tv']
    let entityType: RatingsEntityType | null = null
    let entityId: string | null = null
    for (const candidate of types) {
      const found = await deps.entities.findByImdbId(candidate, imdbId)
      if (found !== null) {
        entityType = candidate
        entityId = found.entityId
        break
      }
    }

    if (entityType === null || entityId === null) {
      const rejection = reject(
        'entity-not-found',
        `${imdbId}: nenhuma entidade local (${types.join('/')}) com este IMDb id.`,
      )
      rejections.push(rejection)
      items.push({ ...base, imdbId, recognized: true, awardsRaw, rejection })
      continue
    }

    const highlight = parsed.awards.highlight
    const row: EntityAwardRow = {
      entityType,
      entityId,
      awardsRaw,
      outcome: highlight?.outcome ?? null,
      highlightCount: highlight?.count ?? null,
      awardName: highlight?.awardName ?? null,
      wins: parsed.awards.tally.wins,
      nominations: parsed.awards.tally.nominations,
      providerApi: options.providerApi,
      providerPayloadHash: entry.payloadHash,
      fetchedAt: entry.fetchedAt,
      // Tudo abaixo vem da LICENCA. Sem licenca resolvida a linha nasce
      // fail-closed: sem fonte nomeada, sem credito, sem exibicao.
      sourceKey: credit?.sourceKey ?? null,
      attributionText: credit?.attributionText ?? null,
      attributionUrl: credit?.attributionUrl ?? null,
      requiresAttribution: credit?.requiresAttribution ?? true,
      requiresLinkback: credit?.requiresLinkback ?? true,
      licenseStatus: credit?.licenseStatus ?? 'unknown',
      displayAllowed: resolveAwardsDisplay(credit),
      dataUsageDecisionId: credit?.usageDecisionId ?? null,
    }

    if (!options.apply) {
      items.push({
        ...base,
        imdbId,
        entityType,
        entityId,
        recognized: true,
        awardsRaw,
        displayAllowed: row.displayAllowed,
        rejection: null,
      })
      continue
    }

    try {
      const outcome = await deps.awards.upsert(row)
      if (outcome.created) created += 1
      else if (outcome.changed) updated += 1
      else unchanged += 1
      if (outcome.displayAllowed) displayable += 1

      items.push({
        ...base,
        imdbId,
        entityType,
        entityId,
        recognized: true,
        awardsRaw,
        written: outcome.created || outcome.changed,
        displayAllowed: outcome.displayAllowed,
        rejection: null,
      })
    } catch (error) {
      // RECUSA DO BANCO NUNCA E MUDA. O trigger pode barrar uma linha que a
      // camada pura aprovou; a causa e impressa e conta como falha do ciclo.
      const message = error instanceof Error ? error.message : String(error)
      const rejection = reject('write-refused', `${imdbId}: o banco recusou a escrita — ${message}`)
      rejections.push(rejection)
      items.push({ ...base, imdbId, entityType, entityId, recognized: true, awardsRaw, rejection })
    }
  }

  const written = created + updated
  const durationMs = deps.now().getTime() - startedAt

  const refusedWrites = rejections.filter((r) => r.reason === 'write-refused').length
  let status: SyncStatus
  if (cached.length === 0) status = 'empty'
  else if (refusedWrites > 0 && written === 0 && options.apply) status = 'failed'
  else if (rejections.length > 0) status = 'partial'
  else status = 'success'

  await deps.syncLog.write({
    endpoint: AWARDS_PROMOTION_ENDPOINT,
    status,
    itemsProcessed: cached.length,
    itemsCreated: created,
    itemsUpdated: updated,
    durationMs,
    // ZERO: nenhuma requisicao externa foi feita. O numero e a prova disso.
    quotaCost: 0,
    payloadHash: null,
  })

  return {
    status,
    applied: options.apply,
    creditResolution,
    items,
    counters: {
      payloadsRead: cached.length,
      recognized,
      written,
      created,
      updated,
      unchanged,
      displayable,
    },
    rejections,
    durationMs,
  }
}

/**
 * A linha pode nascer exibivel?
 *
 * Espelha, para premiacao, o que `resolveDisplayAllowed` faz para nota — mas
 * SEM `score_allowed` e SEM `score_type`: premio nao tem numero de nota nem
 * natureza critica/publico. A trava final continua sendo o trigger
 * `entity_awards_display_guard_trg`; se os dois discordarem, o banco vence e a
 * escrita falha barulhenta.
 */
export function resolveAwardsDisplay(
  credit: {
    readonly licenseStatus: string
    readonly licenseDisplayAllowed: boolean
    readonly requiresAttribution: boolean
    readonly requiresLinkback: boolean
    readonly attributionText: string | null
    readonly attributionUrl: string | null
    readonly usageDecisionId: string | null
  } | null,
): boolean {
  if (credit === null) return false
  if (!['official', 'licensed', 'third_party'].includes(credit.licenseStatus)) return false
  if (!credit.licenseDisplayAllowed) return false
  if (credit.requiresAttribution && (credit.attributionText ?? '').trim() === '') return false
  if (credit.requiresLinkback && (credit.attributionUrl ?? '').trim() === '') return false
  // Link de credito nao-HTTPS numa pagina HTTPS nao abre — e credito que nao
  // abre deixa de ser credito.
  const url = (credit.attributionUrl ?? '').trim()
  if (url !== '' && !url.startsWith('https://')) return false
  if ((credit.usageDecisionId ?? '').trim() === '') return false
  return true
}
