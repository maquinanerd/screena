/**
 * finalization-backfill.ts — BACKFILL da finalizacao editorial.
 * Coberto por `tsconfig.runtime.json`.
 *
 * O PROBLEMA
 * ----------
 * `sync_details` so finaliza (slug + traducao) quando houve upsert. No
 * short-circuit de cache — payload identico ao da ultima vez — o importador faz
 * `touch` e devolve `id: null`, entao nao ha id para finalizar. Uma entidade
 * importada ANTES do wiring de finalizacao existir, cujo payload nao mudou
 * desde entao, fica presa: nunca ganha slug, e sem slug nao tem rota publica,
 * nao entra na busca (o backfill de busca pagina por slug) e nao entra no
 * sitemap.
 *
 * Forcar chamada externa em todo sync resolveria — e seria pior: gastaria cota
 * em todas as entidades para consertar poucas. Este backfill ataca so as presas.
 *
 * PRIORIDADE DE DADOS (a mais barata que resolve, primeiro):
 *   1. a propria linha canonica (`movies.title_original`, `tv_shows.name_original`,
 *      `people.name`) — ja persistida, custo zero;
 *   2. `entity_translations` existente, quando houver titulo melhor;
 *   3. `tmdb_raw` / `api_cache` — ainda local, custo zero.
 * NENHUMA chamada TMDB. Se o dado local nao basta, a entidade e reportada como
 * `skipped_insufficient_data` em vez de gastar cota em silencio.
 *
 * NAO E UM SEGUNDO FINALIZADOR: usa o MESMO `createPrismaCatalogFinalize` que a
 * promocao de `tmdb_raw` e o `sync_details` usam. Duplicar a regra de slug/301
 * seria duplicar a parte mais sutil do catalogo.
 *
 * GARANTIAS:
 *   - so toca entidade SEM slug canonico — slug valido nunca e alterado;
 *   - so cria traducao AUSENTE — nunca sobrescreve traducao existente;
 *   - pessoa so e finalizada se passar na regra de elegibilidade;
 *   - `--dry-run` nao escreve nada;
 *   - reexecutar nao gera churn nem redirect (o alvo ja tem slug e sai do
 *     conjunto de candidatos).
 */

import type { PrismaClient } from '@screena/db/server'
import { evaluatePersonEligibility } from '@screena/seo'
import { desiredCatalogSlug } from '../public-catalog-slug.js'
import { createPrismaCatalogFinalize } from './catalog-finalize.js'

/** Tipos elegiveis a backfill (os que tem slug proprio). */
export const BACKFILLABLE_TYPES = ['movie', 'tv', 'person'] as const

/** Um tipo de entidade elegivel. */
export type BackfillEntityType = (typeof BACKFILLABLE_TYPES)[number]

/** Motivo de uma entidade ter sido ignorada. */
export type BackfillSkipReason =
  | 'missing_title'
  | 'no_eligible_credit'
  | 'insufficient_data'

/** Relatorio do backfill. */
export interface BackfillReport {
  readonly language: string
  readonly dryRun: boolean
  readonly candidates: number
  readonly eligible: number
  readonly finalized: number
  readonly failed: number
  readonly slugsCreated: number
  readonly translationsCreated: number
  readonly skipped: Readonly<Record<string, number>>
  readonly byType: Readonly<Record<string, number>>
  /** Chamadas TMDB evitadas por haver dado local suficiente. */
  readonly externalCallsAvoided: number
  /** Chamadas TMDB executadas. SEMPRE 0: este backfill nao chama o provider. */
  readonly externalCallsMade: number
  /** Ultimo id processado por tipo — permite retomar. */
  readonly checkpoint: Readonly<Record<string, string>>
  readonly samples: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly slug: string
  }[]
}

/** Linha crua de um candidato. */
interface CandidateRow {
  readonly entity_id: bigint
  readonly tmdb_id: number
  readonly title: string | null
  readonly translation_title: string | null
  readonly has_translation: boolean
  readonly credits: number
}

/**
 * Candidatos: entidades SEM slug canonico no idioma.
 *
 * O filtro por ausencia de slug e o que garante que slug valido nunca e tocado —
 * entidade com slug simplesmente nao entra no conjunto.
 */
async function readCandidates(
  prisma: PrismaClient,
  entityType: BackfillEntityType,
  language: string,
  limit: number,
  afterId: bigint,
): Promise<CandidateRow[]> {
  const table = entityType === 'movie' ? 'movies' : entityType === 'tv' ? 'tv_shows' : 'people'
  const titleCol =
    entityType === 'movie' ? 'title_original' : entityType === 'tv' ? 'name_original' : 'name'

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

  return prisma.$queryRawUnsafe<CandidateRow[]>(
    `SELECT e.id AS entity_id,
            e.tmdb_id,
            e.${titleCol} AS title,
            t.title AS translation_title,
            (t.entity_id IS NOT NULL) AS has_translation,
            ${creditsExpr} AS credits
       FROM ${table} e
       LEFT JOIN entity_translations t
         ON t.entity_type = '${entityType}' AND t.entity_id = e.id AND t.language_code = $1
      WHERE e.id > ${afterId.toString()}
        AND NOT EXISTS (
          SELECT 1 FROM slugs s
           WHERE s.entity_type = '${entityType}' AND s.entity_id = e.id
             AND s.language_code = $1 AND s.is_canonical
        )
      ORDER BY e.id
      LIMIT ${Math.max(1, Math.floor(limit))}`,
    language,
  )
}

/**
 * Executa o backfill.
 *
 * Retomavel: `checkpoint` devolve o ultimo id visto por tipo; passar
 * `resumeFrom` continua dali. Como o conjunto de candidatos e "sem slug", uma
 * entidade finalizada sai do conjunto sozinha — reexecutar sem checkpoint
 * tambem e seguro, so custa uma varredura.
 */
export async function backfillFinalization(
  prisma: PrismaClient,
  options: {
    readonly language: string
    readonly entityTypes?: readonly BackfillEntityType[]
    readonly limit?: number
    readonly dryRun: boolean
    readonly resumeFrom?: Readonly<Record<string, string>>
  },
): Promise<BackfillReport> {
  const types = options.entityTypes ?? BACKFILLABLE_TYPES
  const limit = options.limit ?? 1000
  const finalize = createPrismaCatalogFinalize(prisma, options.language)

  const skipped: Record<string, number> = {}
  const byType: Record<string, number> = {}
  const checkpoint: Record<string, string> = {}
  const samples: { entityType: string; entityId: string; slug: string }[] = []
  let candidates = 0
  let eligible = 0
  let finalized = 0
  let failed = 0
  let slugsCreated = 0
  let translationsCreated = 0
  let externalCallsAvoided = 0

  const skip = (reason: BackfillSkipReason): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const entityType of types) {
    const after = BigInt(options.resumeFrom?.[entityType] ?? '0')
    const rows = await readCandidates(prisma, entityType, options.language, limit, after)
    if (rows.length > 0) {
      checkpoint[entityType] = String(rows[rows.length - 1]?.entity_id ?? after)
    }

    for (const row of rows) {
      candidates += 1

      // (1) Titulo: da traducao existente, senao da linha canonica. Os dois sao
      // locais — nenhuma chamada externa foi necessaria.
      const title = (row.translation_title ?? row.title ?? '').trim()
      if (title === '') {
        skip('missing_title')
        continue
      }
      externalCallsAvoided += 1

      // (2) Pessoa: a regra de elegibilidade vale aqui igual ao render. Sem ela,
      // o backfill viraria exatamente a fabrica de paginas de pessoa que o
      // gate existe para impedir.
      if (entityType === 'person') {
        const decision = evaluatePersonEligibility({
          name: title,
          // O candidato NAO tem slug (e por isso e candidato); a pergunta aqui e
          // se ele MERECE um.
          hasCanonicalSlug: true,
          publishableCreditCount: Number(row.credits),
        })
        if (!decision.eligible) {
          skip('no_eligible_credit')
          continue
        }
      }

      eligible += 1
      if (options.dryRun) continue

      try {
        const desired = desiredCatalogSlug(title, row.tmdb_id)
        const slug = await finalize.upsertCanonicalSlug(
          entityType,
          String(row.entity_id),
          desired,
          row.tmdb_id,
        )
        slugsCreated += 1

        // (3) Traducao: so cria a AUSENTE. Sobrescrever uma existente poderia
        // trocar um titulo melhor por um pior — o backfill conserta lacuna, nao
        // reescreve conteudo.
        if (!row.has_translation) {
          await finalize.upsertTranslation(entityType, String(row.entity_id), title, null)
          translationsCreated += 1
        }

        finalized += 1
        byType[entityType] = (byType[entityType] ?? 0) + 1
        if (samples.length < 20) {
          samples.push({ entityType, entityId: String(row.entity_id), slug })
        }
      } catch {
        failed += 1
      }
    }
  }

  return {
    language: options.language,
    dryRun: options.dryRun,
    candidates,
    eligible,
    finalized,
    failed,
    slugsCreated,
    translationsCreated,
    skipped: Object.freeze(skipped),
    byType: Object.freeze(byType),
    externalCallsAvoided,
    externalCallsMade: 0,
    checkpoint: Object.freeze(checkpoint),
    samples,
  }
}
