/**
 * cost-ceiling.ts — Teto de CUSTO do espelho. Modulo PURO.
 *
 * O teto de "20% de disco livre" NAO se aplica: o disco do Postgres do
 * EasyPanel e EMPRESTADO e nada do TMDB pode crescer nele. Os 152 GB que
 * `df -h` mostra nao sao nossos e nao entram em nenhuma conta de capacidade.
 * O que limita o espelho e DINHEIRO, e dinheiro se mede em bytes no object
 * store e linhas no catalogo — nao em espaco livre de uma particao alheia.
 *
 * REGRA DE PARADA: ultrapassou o orcamento, o worker PARA e NAO retoma sozinho.
 * Retomar automaticamente e como o custo vira surpresa no fim do mes. Religar e
 * decisao humana, tomada olhando a fatura.
 *
 * O alvo e manter o bruto dentro do free tier de 10 GB pelo maior tempo
 * possivel; por isso ha um patamar de AVISO antes do de parada, e ele e
 * declarado como fracao do teto, nao como numero solto.
 */

/** Free tier de armazenamento do object store, em bytes (10 GB, base 1000). */
export const FREE_TIER_BYTES = 10_000_000_000

/** Fracao do teto a partir da qual o ciclo avisa (mas ainda roda). */
export const DEFAULT_WARN_FRACTION = 0.8

/** Orcamento configurado de um ciclo. */
export interface CostBudget {
  /** Teto de bytes no object store. `null` = sem teto (so mede e reporta). */
  readonly objectBytesLimit: number | null
  /** Teto de bytes ocupados pelo catalogo no Postgres. `null` = sem teto. */
  readonly catalogBytesLimit: number | null
  /** Fracao do teto que dispara AVISO (0..1). */
  readonly warnFraction: number
}

/** Medicao de um ciclo. Sempre medida, nunca estimada. */
export interface CostMeasurement {
  /** Bytes atualmente no object store. */
  readonly objectBytes: number
  /** Bytes atualmente ocupados pelo catalogo no Postgres. */
  readonly catalogBytes: number
  /** Objetos contados no store (para bytes/objeto). */
  readonly objectCount: number
}

/** Desfecho de uma dimensao do orcamento. */
export type CostDimensionState = 'unlimited' | 'ok' | 'warn' | 'exceeded'

/** Avaliacao de uma dimensao. */
export interface CostDimension {
  readonly name: 'object_store' | 'catalog'
  readonly bytes: number
  readonly limit: number | null
  readonly state: CostDimensionState
  /** Fracao do teto consumida; `null` quando nao ha teto. */
  readonly usedFraction: number | null
}

/** Avaliacao completa do orcamento. */
export interface CostVerdict {
  readonly dimensions: readonly CostDimension[]
  /** true quando ALGUMA dimensao estourou: o worker DEVE parar. */
  readonly mustStop: boolean
  /** true quando alguma dimensao entrou na faixa de aviso. */
  readonly shouldWarn: boolean
  /** Motivos legiveis. Vazio nunca significa "nao verifiquei". */
  readonly reasons: readonly string[]
  /** Bytes medios por objeto; `null` quando nao ha objeto. */
  readonly avgBytesPerObject: number | null
}

/** Orcamento default: free tier no object store, catalogo sem teto proprio. */
export const DEFAULT_COST_BUDGET: CostBudget = {
  objectBytesLimit: FREE_TIER_BYTES,
  catalogBytesLimit: null,
  warnFraction: DEFAULT_WARN_FRACTION,
}

function evaluateDimension(
  name: CostDimension['name'],
  bytes: number,
  limit: number | null,
  warnFraction: number,
): CostDimension {
  if (limit === null || limit <= 0) {
    return { name, bytes, limit, state: 'unlimited', usedFraction: null }
  }
  const usedFraction = bytes / limit
  // Comparacao com `>=`: gastar exatamente o teto ja e o teto.
  const state: CostDimensionState =
    bytes >= limit ? 'exceeded' : usedFraction >= warnFraction ? 'warn' : 'ok'
  return { name, bytes, limit, state, usedFraction }
}

/** Formata bytes em unidade legivel (base 1000, como o provedor cobra). */
function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`
}

/**
 * Avalia o orcamento. Puro: nao le disco, nao chama rede, nao decide sozinho —
 * devolve o veredito para quem orquestra agir.
 */
export function evaluateCostBudget(
  measurement: CostMeasurement,
  budget: CostBudget = DEFAULT_COST_BUDGET,
): CostVerdict {
  const warnFraction =
    Number.isFinite(budget.warnFraction) && budget.warnFraction > 0 && budget.warnFraction < 1
      ? budget.warnFraction
      : DEFAULT_WARN_FRACTION

  const dimensions: CostDimension[] = [
    evaluateDimension('object_store', measurement.objectBytes, budget.objectBytesLimit, warnFraction),
    evaluateDimension('catalog', measurement.catalogBytes, budget.catalogBytesLimit, warnFraction),
  ]

  const reasons: string[] = []
  for (const dimension of dimensions) {
    if (dimension.limit === null) continue
    if (dimension.state === 'exceeded') {
      reasons.push(
        `${dimension.name}: ${formatBytes(dimension.bytes)} atinge o teto de ` +
          `${formatBytes(dimension.limit)} — ciclo interrompido, religar e decisao humana`,
      )
    } else if (dimension.state === 'warn') {
      reasons.push(
        `${dimension.name}: ${formatBytes(dimension.bytes)} de ${formatBytes(dimension.limit)} ` +
          `(${Math.round((dimension.usedFraction ?? 0) * 100)}% do teto)`,
      )
    }
  }

  return {
    dimensions,
    mustStop: dimensions.some((d) => d.state === 'exceeded'),
    shouldWarn: dimensions.some((d) => d.state === 'warn'),
    reasons,
    avgBytesPerObject:
      measurement.objectCount > 0 ? measurement.objectBytes / measurement.objectCount : null,
  }
}

/**
 * Quantas entidades ainda cabem no orcamento, dado o custo medio observado.
 *
 * Serve para o ciclo decidir o tamanho do proximo lote em vez de descobrir o
 * estouro no meio dele. `null` quando nao ha teto ou nao ha media observada —
 * nunca um numero inventado.
 */
export function remainingEntityHeadroom(
  verdict: CostVerdict,
  avgBytesPerEntity: number | null = verdict.avgBytesPerObject,
): number | null {
  const objectStore = verdict.dimensions.find((d) => d.name === 'object_store')
  if (objectStore?.limit == null) return null
  if (avgBytesPerEntity === null || avgBytesPerEntity <= 0) return null
  return Math.max(0, Math.floor((objectStore.limit - objectStore.bytes) / avgBytesPerEntity))
}

/** Renderiza o veredito para log/relatorio. Sempre imprime, mesmo quando `ok`. */
export function renderCostVerdict(verdict: CostVerdict): string {
  const lines = ['ORCAMENTO DE CUSTO']
  for (const dimension of verdict.dimensions) {
    const limit = dimension.limit === null ? 'sem teto' : formatBytes(dimension.limit)
    const pct =
      dimension.usedFraction === null ? '' : ` (${Math.round(dimension.usedFraction * 100)}%)`
    lines.push(
      `  ${dimension.name.padEnd(13)} ${formatBytes(dimension.bytes)} / ${limit}${pct}  [${dimension.state}]`,
    )
  }
  if (verdict.avgBytesPerObject !== null) {
    lines.push(`  media por objeto ${formatBytes(verdict.avgBytesPerObject)}`)
  }
  for (const reason of verdict.reasons) lines.push(`  ! ${reason}`)
  if (verdict.mustStop) {
    lines.push('  PARADO. O worker nao retoma sozinho — religar e decisao humana.')
  }
  return lines.join('\n')
}
