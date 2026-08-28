/**
 * run.ts — Orquestracao PURA da promocao de midia. Sem Prisma, sem rede.
 *
 * ============================================================================
 * A ORDEM DAS TRES BARREIRAS, E POR QUE ELA E ESSA
 * ============================================================================
 *   1. LICENCA    — o alvo pode ir ao ar? Sem isso nada mais importa, e
 *                   consultar candidatas seria trabalho jogado fora.
 *   2. GUARDRAIL  — por linha, o que a tela aceitaria.
 *   3. FREIO      — o volume cabe numa execucao sem assinatura humana?
 *
 * O freio vem por ULTIMO porque precisa do numero que so as duas primeiras
 * produzem. E ele roda TAMBEM em dry-run: o dry-run e a pre-checagem do apply, e
 * sair verde ali diria "pode aplicar" justamente para a execucao que nao pode.
 *
 * ============================================================================
 * DRY-RUN LE EXATAMENTE O QUE O APPLY LERIA
 * ============================================================================
 * Nao ha caminho curto para o dry-run. Mesma consulta de licenca, mesmas
 * candidatas, mesmos guardrails, mesmo freio. A UNICA diferenca e a chamada de
 * mutacao no fim. Um dry-run que pula etapas nao e ensaio, e outro programa.
 */

import { evaluateMassChangeBrake, type MassChangeThresholds, type MassChangeVerdict, type PromotionCensus } from './brake.js'
import { evaluatePromotion, evaluateRevocation, type GuardrailOptions } from './guardrails.js'
import {
  authorizeMediaPromotion,
  type MediaLicenseRow,
  type MediaPromotionAuthorization,
} from './license.js'
import { EXIT_CODES } from '../cli/exit.js'
import type { PromotionCandidate, PromotionTarget } from './types.js'

/** Endpoint logico das linhas de auditoria em `api_sync_logs`. */
export const PROMOTE_LOG_ENDPOINT = 'promote:tmdb_media'
export const REVOKE_LOG_ENDPOINT = 'revoke:tmdb_media'

/** Escopo opcional da execucao. Estreita, nunca amplia. */
export interface PromotionScope {
  readonly target: PromotionTarget
  /** `movie` | `tv` | `person` | `null` (todos os do alvo). */
  readonly entityType: string | null
  /** Um `tmdb_id` especifico, para ensaio numa entidade so. */
  readonly tmdbId: number | null
  /** Teto de linhas trazidas. `null` = sem teto (o freio cuida do volume). */
  readonly limit: number | null
}

/** Uma linha que o banco RECUSOU, com a causa. Nunca uma falha muda. */
export interface StoreRefusal {
  readonly id: string
  readonly message: string
}

/** Resultado de uma mutacao. */
export interface StoreMutationOutcome {
  readonly updated: number
  readonly refusals?: readonly StoreRefusal[]
}

/**
 * Porta de acesso ao PostgreSQL. O adapter Prisma vive em
 * `../persistence/media-promotion-store.ts`.
 *
 * `promote` recebe o `licenseStatus` A GRAVAR — derivado da licenca vigente pelo
 * gate, nunca escolhido pelo adapter. Um adapter que decidisse o status
 * duplicaria a decisao de licenca no lugar onde ninguem procura por ela.
 */
export interface MediaPromotionStorePort {
  /** Linhas de `source_licenses` do alvo (historico incluso; `is_current` decide). */
  readLicenses(target: PromotionTarget): Promise<readonly MediaLicenseRow[]>
  /** Total de linhas do alvo no banco — o DENOMINADOR do freio. */
  countTarget(target: PromotionTarget): Promise<number>
  /** Candidatas dentro do escopo. */
  listCandidates(scope: PromotionScope): Promise<readonly PromotionCandidate[]>
  promote(
    target: PromotionTarget,
    ids: readonly string[],
    licenseStatus: string,
  ): Promise<StoreMutationOutcome>
  revoke(target: PromotionTarget, ids: readonly string[]): Promise<StoreMutationOutcome>
}

/** Log tecnico (`api_sync_logs`). */
export interface SyncLogPort {
  write(input: {
    readonly endpoint: string
    readonly status: 'success' | 'partial' | 'failed' | 'empty'
    readonly itemsProcessed?: number
    readonly itemsUpdated?: number
    readonly durationMs?: number
    readonly quotaCost?: number
  }): Promise<void>
}

/** Uma candidata com a decisao anexada. */
export interface EvaluatedCandidate {
  readonly candidate: PromotionCandidate
  readonly eligible: boolean
  readonly reason: string | null
}

/** Desfecho de uma execucao. */
export type PromotionOutcome =
  /** A licenca nao autoriza. Nada foi lido alem dela, nada foi escrito. */
  | 'license-denied'
  /** O freio travou. Tudo foi calculado; ZERO linhas escritas. */
  | 'mass-change-blocked'
  /** Dry-run concluido (nada escrito, por definicao). */
  | 'dry-run'
  /** Mutacao aplicada. */
  | 'applied'
  /** Nao havia nada elegivel. */
  | 'nothing-to-do'

/** Resultado completo, pronto para o relatorio. */
export interface PromotionResult {
  readonly mode: 'promote' | 'revoke'
  readonly target: PromotionTarget
  readonly confirm: boolean
  readonly outcome: PromotionOutcome
  readonly authorization: MediaPromotionAuthorization
  readonly evaluated: readonly EvaluatedCandidate[]
  readonly eligibleIds: readonly string[]
  readonly census: PromotionCensus
  /** `null` quando a licenca negou (o freio nem chega a rodar). */
  readonly brake: MassChangeVerdict | null
  /** Linhas realmente mutadas. Sempre 0 fora de `applied`. */
  readonly updated: number
  readonly refusals: readonly StoreRefusal[]
}

/** Conta preservando a ordem de primeira aparicao. */
function tally<T>(items: readonly T[], key: (item: T) => string | null): Array<{ k: string; count: number }> {
  const order: string[] = []
  const counts = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (k === null) continue
    const current = counts.get(k)
    if (current === undefined) {
      order.push(k)
      counts.set(k, 1)
    } else {
      counts.set(k, current + 1)
    }
  }
  return order.map((k) => ({ k, count: counts.get(k) ?? 0 }))
}

/** Monta o censo a partir das avaliacoes. */
export function censusPromotion(
  target: PromotionTarget,
  totalInTarget: number,
  evaluated: readonly EvaluatedCandidate[],
): PromotionCensus {
  const eligible = evaluated.filter((entry) => entry.eligible)

  let yes = 0
  let no = 0
  let unknown = 0
  for (const entry of eligible) {
    if (entry.candidate.kind !== 'video') continue
    if (entry.candidate.official === true) yes += 1
    else if (entry.candidate.official === false) no += 1
    else unknown += 1
  }

  return {
    target,
    totalInTarget,
    inspected: evaluated.length,
    changing: eligible.length,
    byReason: tally(evaluated, (entry) => (entry.eligible ? null : entry.reason)).map((row) => ({
      reason: row.k,
      count: row.count,
    })),
    byType: tally(eligible, (entry) =>
      entry.candidate.kind === 'video'
        ? (entry.candidate.videoType ?? '(sem tipo)')
        : entry.candidate.imageType,
    ).map((row) => ({ type: row.k, count: row.count })),
    byEntityType: tally(eligible, (entry) => entry.candidate.entityType).map((row) => ({
      entityType: row.k,
      count: row.count,
    })),
    official: { yes, no, unknown },
  }
}

/** Dependencias da execucao. */
export interface RunDeps {
  readonly store: MediaPromotionStorePort
  readonly syncLog: SyncLogPort
  readonly now: () => Date
}

/** Entrada da execucao. */
export interface RunInput {
  readonly scope: PromotionScope
  readonly confirm: boolean
  readonly revoke: boolean
  readonly confirmMassChange: boolean
  readonly guardrails: GuardrailOptions
  readonly thresholds?: Partial<MassChangeThresholds>
}

/**
 * Executa (ou ensaia) a promocao/reversao.
 *
 * Nunca lanca por decisao de negocio: licenca negada, freio travado e "nada a
 * fazer" sao DESFECHOS, com censo e explicacao. Excecao aqui e so falha real de
 * infraestrutura — e ela sobe.
 */
export async function runMediaPromotion(
  input: RunInput,
  deps: RunDeps,
): Promise<PromotionResult> {
  const started = deps.now().getTime()
  const { target } = input.scope

  // ---- BARREIRA 1: licenca. ------------------------------------------------
  // Revogar nao precisa de permissao (ver `evaluateRevocation`): uma licenca que
  // caiu nao pode impedir de APAGAR o que ela deixou de autorizar.
  const licenses = input.revoke ? [] : await deps.store.readLicenses(target)
  const authorization = input.revoke
    ? ({
        authorized: true,
        reason: 'reversao nao consulta licenca: apagar e sempre permitido',
        licenseStatus: null,
        policyVersion: null,
        __brand: 'MediaPromotionAuthorization',
      } as MediaPromotionAuthorization)
    : authorizeMediaPromotion(target, licenses)

  const totalInTarget = await deps.store.countTarget(target)

  if (!authorization.authorized) {
    const census = censusPromotion(target, totalInTarget, [])
    return {
      mode: 'promote',
      target,
      confirm: input.confirm,
      outcome: 'license-denied',
      authorization,
      evaluated: [],
      eligibleIds: [],
      census,
      brake: null,
      updated: 0,
      refusals: [],
    }
  }

  // ---- BARREIRA 2: guardrails por linha. -----------------------------------
  const candidates = await deps.store.listCandidates(input.scope)
  const evaluated: EvaluatedCandidate[] = candidates.map((candidate) => {
    const decision = input.revoke
      ? evaluateRevocation(candidate)
      : evaluatePromotion(candidate, input.guardrails)
    return { candidate, eligible: decision.eligible, reason: decision.reason }
  })
  const eligibleIds = evaluated.filter((e) => e.eligible).map((e) => e.candidate.id)
  const census = censusPromotion(target, totalInTarget, evaluated)

  // ---- BARREIRA 3: freio de volume. ----------------------------------------
  const brake = evaluateMassChangeBrake({
    census,
    thresholds: input.thresholds,
    confirmed: input.confirmMassChange,
  })

  const base = {
    mode: input.revoke ? ('revoke' as const) : ('promote' as const),
    target,
    confirm: input.confirm,
    authorization,
    evaluated,
    eligibleIds,
    census,
    brake,
  }

  if (brake.blocked) {
    return { ...base, outcome: 'mass-change-blocked', updated: 0, refusals: [] }
  }
  if (eligibleIds.length === 0) {
    return { ...base, outcome: 'nothing-to-do', updated: 0, refusals: [] }
  }
  if (!input.confirm) {
    return { ...base, outcome: 'dry-run', updated: 0, refusals: [] }
  }

  // ---- MUTACAO. ------------------------------------------------------------
  // `licenseStatus` vem do gate. O `?? ''` nunca ocorre em promocao (o gate so
  // autoriza com status); existe para o tipo, e o store recusaria vazio.
  const outcome = input.revoke
    ? await deps.store.revoke(target, eligibleIds)
    : await deps.store.promote(target, eligibleIds, authorization.licenseStatus ?? '')

  const refusals = outcome.refusals ?? []

  // Todo sync/mutacao gera log (regra de ingestao). `quotaCost: 0` e a prova de
  // que nenhuma requisicao externa foi feita — esta ferramenta nao tem rede.
  await deps.syncLog.write({
    endpoint: input.revoke ? REVOKE_LOG_ENDPOINT : PROMOTE_LOG_ENDPOINT,
    status:
      refusals.length > 0
        ? outcome.updated > 0
          ? 'partial'
          : 'failed'
        : outcome.updated > 0
          ? 'success'
          : 'empty',
    itemsProcessed: eligibleIds.length,
    itemsUpdated: outcome.updated,
    durationMs: Math.max(0, deps.now().getTime() - started),
    quotaCost: 0,
  })

  return { ...base, outcome: 'applied', updated: outcome.updated, refusals }
}

/**
 * O exit code de uma execucao com N alvos.
 *
 * PURO, e mora aqui e nao no `bin`, pelo motivo que o `compute-cinerie-score`
 * ja pagou: um `bin` que chama `main()` no topo do modulo nao pode ser
 * importado por teste sem abrir o Prisma — e por isso o parser dele passou
 * quatro dias com um defeito em producao sem nenhum teste possivel.
 *
 * O PIOR desfecho vence, e a ordem nao e arbitraria: um `--target=all` em que o
 * video acendeu e a foto de pessoa foi barrada pela licenca NAO pode sair 0 —
 * quem chama leria "acabou" para um servico feito pela metade. A prioridade e
 * ok < failed < mass-change < blocked, do menos ao mais "precisa de humano".
 */
export function combinedExitCode(resultados: readonly PromotionResult[]): number {
  const ORDEM: readonly number[] = [
    EXIT_CODES.ok,
    EXIT_CODES.failed,
    EXIT_CODES.massChangeBlocked,
    EXIT_CODES.blocked,
  ]
  let code: number = EXIT_CODES.ok
  const pior = (candidato: number): void => {
    if (ORDEM.indexOf(candidato) > ORDEM.indexOf(code)) code = candidato
  }
  for (const result of resultados) {
    switch (result.outcome) {
      case 'license-denied':
        pior(EXIT_CODES.blocked)
        break
      case 'mass-change-blocked':
        // Code PROPRIO (5), nunca `failed`: quem chama precisa distinguir "o
        // comando quebrou" de "o comando se recusou de proposito e espera um
        // humano".
        pior(EXIT_CODES.massChangeBlocked)
        break
      case 'applied':
        if (result.refusals.length > 0) pior(EXIT_CODES.failed)
        break
      default:
        break
    }
  }
  return code
}
