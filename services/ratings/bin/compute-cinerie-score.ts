#!/usr/bin/env node
/**
 * bin/compute-cinerie-score.ts — Calcula o Cinerie Score OFFLINE e persiste o
 * histórico em `cinerie_score_calculations`.
 *
 * ZERO REDE. Lê PostgreSQL (decisão vigente + notas exibíveis + sinal do TMDB
 * já ingerido), roda o engine puro e grava o histórico versionado. Nenhuma
 * chamada externa; nenhum byte de cota. Por isso NÃO gera linha em
 * `api_sync_logs` — não há sync de upstream a auditar; a auditoria deste
 * processo é a própria tabela de cálculos (entity, version, inputs_hash
 * únicos).
 *
 * REGISTRAR NÃO É LIGAR, e este worker respeita os dois elos:
 *  - sem decisão `cinerie_score_display` VIGENTE (o proprietário aplica via
 *    `legal sources apply`), ele explica e NÃO escreve nada;
 *  - com decisão, o número calculado só vai à TELA pelo presenter, que exige
 *    >= 2 fontes contadas (piso de exibição). O worker persiste o histórico —
 *    inclusive cálculos de 1 fonte, que são auditáveis e não exibíveis.
 *
 * Dry-run é o DEFAULT: sem `--apply` ele calcula e RELATA, sem escrever.
 *
 * Uso (a partir da raiz do repo). NAO use `--` solto: no pnpm 9.15.4 deste
 * repositório o separador chega LITERAL e o parser o recusa.
 *
 *   corepack pnpm --filter @screena/ratings score:compute
 *   corepack pnpm --filter @screena/ratings score:compute --apply
 *   corepack pnpm --filter @screena/ratings score:compute --type=movie --limit=200 --apply
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { disconnectPrisma, getPrismaClient } from '@screena/db/server'
import {
  MINIMUM_COUNTED_SOURCES,
  PRODUCTION_FORMULA_REGISTRY,
  computeCinerieScore,
  type CinerieScoreOutcome,
} from '@screena/cinerie-score'

import {
  buildEntityInputs,
  projectScoreDecision,
  type DisplayableRatingRow,
  type EntityTmdbRow,
  type ScoreDecisionRow,
} from '../src/score/compute-run.js'
import { parseScoreArgs } from '../src/score/args.js'

/**
 * O parser mudou-se para `src/score/args.ts` — ver o cabecalho de la para o
 * defeito que isso fecha. Ele vivia aqui, e como este arquivo chama `main()`
 * no topo do modulo, testa-lo exigiria conectar o Prisma. Por isso nunca teve
 * teste, e por isso o defeito sobreviveu quatro dias em producao.
 */

function loadRepoEnv(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const envPath = path.resolve(dir, '..', '..', '..', '.env')
  if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
    process.loadEnvFile(envPath)
  }
}

const DECISION_SQL = `
  SELECT d.id::text AS id, d.use_case, d.stage::text AS stage, d.display_allowed,
         d.derivative_allowed, d.is_current, d.valid_from, d.valid_until, d.policy_version
    FROM data_usage_decisions d
    JOIN source_licenses l ON l.id = d.source_license_id
   WHERE d.use_case = 'cinerie_score_display' AND d.is_current = true AND l.is_current = true`

const TMDB_INTERNAL_DECISION_SQL = `
  SELECT d.id::text AS id
    FROM data_usage_decisions d
    JOIN source_licenses l ON l.id = d.source_license_id
   WHERE l.source_key = 'tmdb' AND l.content_type = 'other'
     AND d.use_case = 'internal_analytics' AND d.is_current = true AND l.is_current = true
   ORDER BY d.id DESC
   LIMIT 1`

async function main(): Promise<void> {
  loadRepoEnv()

  const parsed = parseScoreArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`Argumentos invalidos: ${parsed.error}`)
    process.exitCode = 1
    return
  }
  const args = parsed.args

  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.error('DATABASE_URL ausente — nada a ler.')
    process.exitCode = 1
    return
  }

  const prisma = getPrismaClient()
  const now = new Date()
  try {
    const decisionRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(DECISION_SQL)
    const decision = projectScoreDecision(
      decisionRows.map(
        (r): ScoreDecisionRow => ({
          id: String(r.id),
          useCase: r.use_case as string,
          stage: r.stage as string,
          displayAllowed: r.display_allowed as boolean,
          derivativeAllowed: r.derivative_allowed as boolean,
          isCurrent: r.is_current as boolean,
          validFrom: r.valid_from as Date,
          validUntil: (r.valid_until as Date | null) ?? null,
          policyVersion: (r.policy_version as string | null) ?? null,
        }),
      ),
    )

    if (decision === null) {
      console.log(
        'Sem decisao VIGENTE de cinerie_score_display: nada calculado, nada escrito. ' +
          'A decisao e emitida pelo `legal sources apply` (autorizacao do proprietario, ' +
          '2026-08-20 — docs/legal/owner-authorization-2026-08-20.md).',
      )
      return
    }

    const tmdbDecision = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      TMDB_INTERNAL_DECISION_SQL,
    )
    const tmdbDecisionId = tmdbDecision[0]?.id ?? null

    const entityTypes: ReadonlyArray<'movie' | 'tv'> =
      args.type === 'all' ? ['movie', 'tv'] : [args.type]

    let totalCalculated = 0
    let totalDisplayable = 0
    let totalBlocked = 0
    let totalWritten = 0
    let totalDuplicates = 0
    const skippedReasons = new Map<string, number>()

    for (const entityType of entityTypes) {
      const table = entityType === 'movie' ? 'movies' : 'tv_shows'
      const limitClause = args.limit === null ? '' : ` LIMIT ${args.limit}`

      const ratingRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT entity_id::text AS entity_id, rating_source, rating_value::float8 AS rating_value,
                rating_scale, rating_count, score_type::text AS score_type,
                data_usage_decision_id::text AS data_usage_decision_id
           FROM external_ratings
          WHERE entity_type = '${entityType}' AND display_allowed = true`,
      )
      const tmdbRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id::text AS entity_id, vote_average_tmdb::float8 AS vote_average_tmdb,
                vote_count_tmdb
           FROM ${table}
          WHERE vote_average_tmdb IS NOT NULL
          ORDER BY id${limitClause}`,
      )

      const { inputs, skipped } = buildEntityInputs(
        ratingRows.map(
          (r): DisplayableRatingRow => ({
            entityId: String(r.entity_id),
            ratingSource: r.rating_source as string,
            ratingValue: r.rating_value as number,
            ratingScale: Number(r.rating_scale),
            ratingCount: r.rating_count === null ? null : Number(r.rating_count),
            scoreType: (r.score_type as string | null) ?? null,
            dataUsageDecisionId: (r.data_usage_decision_id as string | null) ?? null,
          }),
        ),
        tmdbRows.map(
          (r): EntityTmdbRow => ({
            entityId: String(r.entity_id),
            voteAverageTmdb: r.vote_average_tmdb as number | null,
            voteCountTmdb: r.vote_count_tmdb === null ? null : Number(r.vote_count_tmdb),
          }),
        ),
        tmdbDecisionId,
      )
      for (const item of skipped) {
        skippedReasons.set(item.reason, (skippedReasons.get(item.reason) ?? 0) + 1)
      }

      const limited = args.limit === null ? inputs : inputs.slice(0, args.limit)
      for (const input of limited) {
        const outcome: CinerieScoreOutcome = computeCinerieScore(
          { entityId: input.entityId, ratings: input.ratings },
          { registry: PRODUCTION_FORMULA_REGISTRY, decision, now },
        )

        if (outcome.status !== 'calculated') {
          totalBlocked += 1
          continue
        }
        totalCalculated += 1
        // O piso de EXIBICAO (>= 2 fontes contadas) e do presenter; aqui so se
        // conta quantos titulos o alcancam, para o relato.
        if (outcome.result.explanation.length >= MINIMUM_COUNTED_SOURCES) totalDisplayable += 1

        if (!args.apply) continue

        // O unique (entity_type, entity_id, version, inputs_hash) faz o
        // recalculo identico nao poluir o historico: conflito = ja registrado.
        const written = await prisma.$executeRawUnsafe(
          `INSERT INTO cinerie_score_calculations
             (entity_type, entity_id, status, value, scale, version, inputs_hash,
              explanation, blocked_reason, calculated_at, created_at)
           VALUES ($1::"EntityType", $2::bigint, 'calculated', $3, $4, $5, $6, $7::jsonb, NULL, $8, now())
           ON CONFLICT (entity_type, entity_id, version, inputs_hash) DO NOTHING`,
          entityType,
          input.entityId,
          outcome.result.value,
          outcome.result.scale,
          outcome.result.version,
          outcome.result.inputsHash,
          JSON.stringify(outcome.result.explanation),
          new Date(outcome.result.calculatedAt),
        )
        if (written > 0) totalWritten += 1
        else totalDuplicates += 1
      }
    }

    console.log(
      `cinerie score · ${args.apply ? '--apply (escrita real)' : 'DRY-RUN (nada escrito)'} · rede: nenhuma`,
    )
    console.log(
      `decisao: vigente (policy ${decision.policyVersion}; formula aprovada ${decision.approvedFormulaVersion || '<fora do mapa>'})`,
    )
    console.log(
      `calculados=${totalCalculated} exibiveis(piso>=2 fontes)=${totalDisplayable} ` +
        `bloqueados=${totalBlocked} gravados=${totalWritten} ja-registrados=${totalDuplicates}`,
    )
    // Nada some em silencio: cada recusa de montagem aparece com contagem.
    for (const [reason, count] of skippedReasons) {
      console.log(`  pulado (${count}): ${reason}`)
    }
    if (!args.apply && totalCalculated > 0) {
      console.log(`\nDry-run: repita com --apply para gravar o historico.`)
    }
  } finally {
    await disconnectPrisma()
  }
}

main().catch((error: unknown) => {
  console.error('Falha no calculo do Cinerie Score:', error instanceof Error ? error.message : error)
  process.exitCode = 1
})
