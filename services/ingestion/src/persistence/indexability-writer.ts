/**
 * indexability-writer.ts — PRODUTOR de `page_indexability_decisions`.
 * Coberto por `tsconfig.runtime.json`.
 *
 * Le os fatos de cada entidade de catalogo, aplica a politica pura
 * (`@screena/seo` -> `decideCatalogIndexability`) e persiste a decisao VIGENTE.
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
 * LIMITACAO CONHECIDA: nao existe unique parcial em `(entity_type, entity_id,
 * language_code) WHERE is_current` no banco — o comentario do schema afirma que
 * existe, mas a migration nao cria. Portanto DOIS produtores concorrentes
 * poderiam criar duas linhas vigentes. O produtor e um job offline unico; nao
 * rode duas instancias. Criar o indice exigiria migration, fora do escopo desta
 * entrega.
 *
 * NAO LIGA INDEXACAO: escrever `decision='index'` registra o que a politica diz.
 * A chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  decideCatalogIndexability,
  decisionChanged,
  type CatalogDecisionEntityType,
  type CatalogIndexabilityDecision,
} from '@screena/seo'

/** Tipos processados por padrao (os que tem slug proprio). */
export const DECIDABLE_ENTITY_TYPES: readonly CatalogDecisionEntityType[] = [
  'movie',
  'tv',
  'person',
]

/** Resumo por decisao e por razao. */
export interface IndexabilityRunSummary {
  readonly language: string
  readonly dryRun: boolean
  readonly evaluated: number
  readonly written: number
  readonly unchanged: number
  readonly byDecision: Readonly<Record<string, number>>
  readonly byReason: Readonly<Record<string, number>>
  /** Amostra das mudancas, para revisao antes de aplicar. */
  readonly changes: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly from: string | null
    readonly to: string
    readonly reason: string
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
 * Roda o produtor para um tipo de entidade.
 *
 * `dryRun` calcula tudo e nao grava — e o modo que permite revisar quantas
 * entidades mudariam de estado ANTES de mexer numa tabela que o sitemap le.
 */
export async function produceIndexabilityDecisions(
  prisma: PrismaClient,
  options: {
    readonly language: string
    readonly entityTypes?: readonly CatalogDecisionEntityType[]
    readonly limit?: number
    readonly dryRun: boolean
    readonly now: () => Date
  },
): Promise<IndexabilityRunSummary> {
  const types = options.entityTypes ?? DECIDABLE_ENTITY_TYPES
  const limit = options.limit ?? 100_000
  const byDecision: Record<string, number> = {}
  const byReason: Record<string, number> = {}
  const changes: IndexabilityRunSummary['changes'] = []
  let evaluated = 0
  let written = 0
  let unchanged = 0

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

      ;(changes as { entityType: string; entityId: string; from: string | null; to: string; reason: string }[]).push({
        entityType,
        entityId: String(row.entity_id),
        from: row.cur_decision,
        to: decision.decision,
        reason: decision.reason,
      })

      if (options.dryRun) continue

      const slug = slugs.get(String(row.entity_id)) ?? String(row.entity_id)
      const url = routeFor(entityType, slug)
      const decidedAt = options.now()

      // Despromove a anterior e insere a nova apontando para ela, na MESMA
      // transacao: nunca ha janela com duas vigentes nem historico orfao.
      await prisma.$transaction(async (tx) => {
        const current = await tx.pageIndexabilityDecision.findFirst({
          where: {
            entityType: entityType as never,
            entityId: row.entity_id,
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
            entityType: entityType as never,
            entityId: row.entity_id,
            languageCode: options.language,
            url,
            decision: decision.decision as never,
            reason: decision.reason,
            isCurrent: true,
            supersedesId: current?.id ?? null,
            policyVersion: decision.policyVersion,
            decisionOrigin: decision.origin,
            decidedAt,
          },
        })
      })
      written += 1
    }
  }

  return {
    language: options.language,
    dryRun: options.dryRun,
    evaluated,
    written,
    unchanged,
    byDecision: Object.freeze(byDecision),
    byReason: Object.freeze(byReason),
    changes: changes.slice(0, 50),
  }
}
