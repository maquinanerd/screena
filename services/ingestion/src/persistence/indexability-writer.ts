/**
 * indexability-writer.ts — PRODUTOR de `page_indexability_decisions`.
 * Coberto por `tsconfig.runtime.json`.
 *
 * Le os fatos de cada entidade de catalogo, aplica a politica pura
 * (`@screena/seo` -> `decideCatalogIndexability`) e persiste a decisao VIGENTE.
 *
 * DUAS FASES, NAO UMA. Ate a introducao do freio, este produtor lia e gravava no
 * MESMO laco. Agora ele PLANEJA tudo primeiro (fase 1, sem escrita nenhuma),
 * mede o tamanho da mudanca e so entao grava (fase 2). Isso e o que permite
 * recusar a execucao INTEIRA — e nao "as ultimas 40 mil, depois que as
 * primeiras 10 mil ja sairam do sitemap".
 *
 * FREIO DE MUDANCA EM MASSA. `catalog index-decisions --apply` roda de hora em
 * hora sem humano nenhum. Sem freio, mudar a politica pura em `@screena/seo` (ou
 * subir `CATALOG_POLICY_VERSION` junto com regra nova) reindexaria o catalogo
 * inteiro no primeiro ciclo depois do deploy — exatamente a "indexacao em massa"
 * que a secao 6 do CLAUDE.md manda submeter a revisao humana. O produtor conta
 * quantas entidades ENTRAM ou SAEM do sitemap (`@screena/seo` ->
 * `evaluateMassChangeBrake`) e, passando do teto sem `confirmMassChange`,
 * grava ZERO linhas e devolve o censo.
 *
 * O freio mede EFEITO, nao rotulo: o sitemap trata ausencia de decisao como
 * "dentro", entao `null -> index` nao e flip e o crescimento normal do catalogo
 * passa livre. Ver o cabecalho de `packages/seo/src/catalog-mass-change.ts`.
 *
 * SEM CHURN: quando a decisao nova e igual a persistida (mesmo veredito, mesma
 * razao, mesma versao de politica), NADA e gravado. Uma execucao diaria sobre um
 * catalogo estavel deve produzir zero escritas — se produzir uma linha por
 * entidade por execucao, a tabela vira log de execucao em vez de registro de
 * decisao.
 *
 * SUPERSEDE em transacao: a decisao anterior e despromovida (`is_current=false`)
 * e a nova aponta para ela via `supersedes_id`, na MESMA transacao — o historico
 * fica encadeado e nunca ha janela com duas vigentes.
 *
 * DUAS VIGENTES: o BANCO recusa. `page_indexability_decisions_current_unique`
 * (unique parcial em `(entity_type, entity_id, language_code) WHERE is_current`)
 * e criado por `20260715120000_data_governance_hardening`. Este cabecalho ja
 * afirmou o contrario — a busca de origem procurou `UNIQUE` e `is_current` na
 * MESMA linha do SQL, e o `WHERE is_current = true` esta na linha seguinte. Ver
 * `docs/backend/catalog-operations.md` secao 3. O `flock` do ciclo evita
 * desperdicio de cota; quem garante uma unica vigente e o PostgreSQL.
 *
 * NAO LIGA INDEXACAO: escrever `decision='index'` registra o que a politica diz.
 * A chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  censusMassChange,
  classifyIndexFlip,
  decideCatalogIndexability,
  decisionChanged,
  evaluateMassChangeBrake,
  type CatalogDecisionEntityType,
  type CatalogIndexabilityDecision,
  type IndexFlip,
  type MassChangeThresholds,
  type MassChangeVerdict,
  type PlannedTransition,
} from '@screena/seo'

/** Tipos processados por padrao (os que tem slug proprio). */
export const DECIDABLE_ENTITY_TYPES: readonly CatalogDecisionEntityType[] = [
  'movie',
  'tv',
  'person',
]

/** Uma mudanca planejada, com o que a fase 2 precisa para gravar. */
interface PlannedWrite extends PlannedTransition {
  readonly entityType: CatalogDecisionEntityType
  readonly entityId: bigint
  readonly url: string
  readonly decision: CatalogIndexabilityDecision
}

/** Resumo por decisao e por razao. */
export interface IndexabilityRunSummary {
  readonly language: string
  readonly dryRun: boolean
  readonly evaluated: number
  readonly written: number
  readonly unchanged: number
  /** Mudancas PLANEJADAS (gravadas ou nao — o freio pode ter recusado todas). */
  readonly planned: number
  readonly byDecision: Readonly<Record<string, number>>
  readonly byReason: Readonly<Record<string, number>>
  /**
   * Veredito do freio de mudanca em massa. `blocked=true` implica
   * `written === 0`: a execucao inteira e recusada, nunca metade dela.
   */
  readonly massChange: MassChangeVerdict
  /** Censo dos FLIPS por razao (por que a entidade entrou/saiu do sitemap). */
  readonly flipsByReason: Readonly<Record<string, number>>
  /** Censo dos FLIPS por tipo de entidade. */
  readonly flipsByEntityType: Readonly<Record<string, number>>
  /** Amostra das mudancas, para revisao antes de aplicar. */
  readonly changes: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly from: string | null
    readonly to: string
    readonly reason: string
    /** A entidade entra/sai do sitemap com esta mudanca? */
    readonly flip: IndexFlip
  }[]
}

/** Fato cru lido do banco para UMA entidade. */
interface EntityFactRow {
  readonly entity_id: bigint
  readonly has_slug: boolean
  readonly has_title: boolean
  readonly has_translation: boolean
  readonly credits: number
  readonly url: string | null
  readonly cur_decision: string | null
  readonly cur_reason: string | null
  readonly cur_policy: string | null
}

/** Rota publica de cada tipo (usada para preencher `url`, que e NOT NULL). */
function routeFor(entityType: CatalogDecisionEntityType, slug: string): string {
  switch (entityType) {
    case 'movie':
      return `/pt/filmes/${slug}/`
    case 'tv':
      return `/pt/series/${slug}/`
    case 'person':
      return `/pt/pessoas/${slug}/`
    default:
      return `/pt/${slug}/`
  }
}

/**
 * Le os fatos de indexabilidade de um tipo de entidade.
 *
 * Uma consulta por tipo, com LEFT JOIN na decisao vigente — evita N+1 e permite
 * decidir "mudou?" sem uma segunda ida ao banco por entidade.
 */
async function readFacts(
  prisma: PrismaClient,
  entityType: CatalogDecisionEntityType,
  language: string,
  limit: number,
): Promise<{ rows: EntityFactRow[]; slugs: Map<string, string> }> {
  const table = entityType === 'movie' ? 'movies' : entityType === 'tv' ? 'tv_shows' : 'people'
  const titleCol =
    entityType === 'movie' ? 'title_original' : entityType === 'tv' ? 'name_original' : 'name'

  // Creditos em obra publicavel: so faz sentido para pessoa; para os demais o
  // valor e irrelevante e a subconsulta nem roda.
  const creditsExpr =
    entityType === 'person'
      ? `(SELECT COUNT(*)::int FROM cast_members cm
            JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
              AND ws.language_code = $1 AND ws.is_canonical
           WHERE cm.person_id = e.id AND cm.entity_type IN ('movie','tv'))
       + (SELECT COUNT(*)::int FROM crew_members rm
            JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
              AND ws.language_code = $1 AND ws.is_canonical
           WHERE rm.person_id = e.id AND rm.entity_type IN ('movie','tv'))`
      : '0'

  const sql = `
    SELECT e.id AS entity_id,
           (s.slug IS NOT NULL) AS has_slug,
           (BTRIM(COALESCE(e.${titleCol}, '')) <> '') AS has_title,
           (t.entity_id IS NOT NULL) AS has_translation,
           ${creditsExpr} AS credits,
           s.slug AS url,
           d.decision::text AS cur_decision,
           d.reason AS cur_reason,
           d.policy_version AS cur_policy
      FROM ${table} e
      LEFT JOIN slugs s
        ON s.entity_type = '${entityType}' AND s.entity_id = e.id
       AND s.language_code = $1 AND s.is_canonical
      LEFT JOIN entity_translations t
        ON t.entity_type = '${entityType}' AND t.entity_id = e.id AND t.language_code = $1
      LEFT JOIN page_indexability_decisions d
        ON d.entity_type = '${entityType}' AND d.entity_id = e.id
       AND d.language_code = $1 AND d.is_current
     ORDER BY e.id
     LIMIT ${Math.max(1, Math.floor(limit))}`

  const rows = await prisma.$queryRawUnsafe<EntityFactRow[]>(sql, language)
  const slugs = new Map<string, string>()
  for (const r of rows) if (r.url !== null) slugs.set(String(r.entity_id), r.url)
  return { rows, slugs }
}

/**
 * Roda o produtor sobre TODOS os tipos pedidos, numa unica execucao.
 *
 * "Todos numa execucao" nao e detalhe de implementacao: o censo do freio e
 * GLOBAL. 300 filmes e 300 series saindo do sitemap sao 600 flips, nao dois
 * lotes de 300 — contar por tipo deixaria a mudanca inteira passar.
 *
 * `dryRun` calcula tudo e nao grava — e o modo que permite revisar quantas
 * entidades mudariam de estado ANTES de mexer numa tabela que o sitemap le.
 *
 * `confirmMassChange` e o opt-in HUMANO do freio: sem ele, uma execucao cujos
 * flips passem do teto grava zero linhas (ver `massChange.blocked` no resumo).
 * O ciclo horario nao-atendido nunca passa essa flag — e por isso que ele nao
 * consegue reindexar o catalogo sozinho.
 */
export async function produceIndexabilityDecisions(
  prisma: PrismaClient,
  options: {
    readonly language: string
    readonly entityTypes?: readonly CatalogDecisionEntityType[]
    readonly limit?: number
    readonly dryRun: boolean
    readonly now: () => Date
    /** Opt-in explicito para mudanca em massa. Default: false. */
    readonly confirmMassChange?: boolean
    /** Tetos do freio. Omitidos = `DEFAULT_MASS_CHANGE_THRESHOLDS`. */
    readonly massChangeThresholds?: Partial<MassChangeThresholds>
  },
): Promise<IndexabilityRunSummary> {
  const types = options.entityTypes ?? DECIDABLE_ENTITY_TYPES
  const limit = options.limit ?? 100_000
  const byDecision: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  const plan: PlannedWrite[] = []
  let evaluated = 0
  let unchanged = 0

  // ---- FASE 1: planeja. Nenhuma escrita acontece neste laco. ----
  for (const entityType of types) {
    const { rows, slugs } = await readFacts(prisma, entityType, options.language, limit)

    for (const row of rows) {
      evaluated += 1
      const decision: CatalogIndexabilityDecision = decideCatalogIndexability({
        entityType,
        language: options.language,
        hasCanonicalSlug: row.has_slug,
        hasTitle: row.has_title,
        hasTranslation: row.has_translation,
        ...(entityType === 'person' ? { publishableCreditCount: Number(row.credits) } : {}),
      })

      byDecision[decision.decision] = (byDecision[decision.decision] ?? 0) + 1
      byReason[decision.reason] = (byReason[decision.reason] ?? 0) + 1

      const previous =
        row.cur_decision === null
          ? null
          : {
              decision: row.cur_decision,
              reason: row.cur_reason,
              policyVersion: row.cur_policy,
            }

      if (!decisionChanged(decision, previous)) {
        unchanged += 1
        continue
      }

      const slug = slugs.get(String(row.entity_id)) ?? String(row.entity_id)
      plan.push({
        entityType,
        entityId: row.entity_id,
        url: routeFor(entityType, slug),
        decision,
        previousDecision: row.cur_decision,
        nextDecision: decision.decision,
        nextReason: decision.reason,
      })
    }
  }

  // ---- Mede o tamanho da mudanca ANTES de gravar qualquer coisa. ----
  const census = censusMassChange(plan, evaluated)
  const massChange = evaluateMassChangeBrake({
    census,
    ...(options.massChangeThresholds !== undefined
      ? { thresholds: options.massChangeThresholds }
      : {}),
    confirmed: options.confirmMassChange === true,
  })

  const summary = (written: number): IndexabilityRunSummary => ({
    language: options.language,
    dryRun: options.dryRun,
    evaluated,
    written,
    unchanged,
    planned: plan.length,
    byDecision: Object.freeze(byDecision),
    byReason: Object.freeze(byReason),
    massChange,
    flipsByReason: census.byReason,
    flipsByEntityType: census.byEntityType,
    changes: plan.slice(0, 50).map((p) => ({
      entityType: p.entityType,
      entityId: String(p.entityId),
      from: p.previousDecision,
      to: p.nextDecision,
      reason: p.nextReason,
      flip: classifyIndexFlip(p.previousDecision, p.nextDecision),
    })),
  })

  // ---- FASE 2: grava, se o freio deixar. ----
  // `blocked` recusa a execucao INTEIRA: zero linhas. Aplicar "a parte segura"
  // deixaria o catalogo num estado que nenhuma politica descreve.
  if (massChange.blocked || options.dryRun) return summary(0)

  let written = 0
  for (const item of plan) {
    const decidedAt = options.now()

    // Despromove a anterior e insere a nova apontando para ela, na MESMA
    // transacao: nunca ha janela com duas vigentes nem historico orfao.
    await prisma.$transaction(async (tx) => {
      const current = await tx.pageIndexabilityDecision.findFirst({
        where: {
          entityType: item.entityType as never,
          entityId: item.entityId,
          languageCode: options.language,
          isCurrent: true,
        },
        select: { id: true },
      })
      if (current !== null) {
        await tx.pageIndexabilityDecision.update({
          where: { id: current.id },
          data: { isCurrent: false },
        })
      }
      await tx.pageIndexabilityDecision.create({
        data: {
          entityType: item.entityType as never,
          entityId: item.entityId,
          languageCode: options.language,
          url: item.url,
          decision: item.decision.decision as never,
          reason: item.decision.reason,
          isCurrent: true,
          supersedesId: current?.id ?? null,
          policyVersion: item.decision.policyVersion,
          decisionOrigin: item.decision.origin,
          decidedAt,
        },
      })
    })
    written += 1
  }

  return summary(written)
}
