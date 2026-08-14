/**
 * validate-omdb-ratings-real-postgres.ts — Prova de ponta a ponta do adapter
 * OMDb contra PostgreSQL REAL, com os triggers de governanca ATIVOS.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * O QUE ELA PROVA — e por que teste puro nao bastava:
 *
 *   `resolveDisplayAllowed` (testado a parte, em memoria) e a camada 1. A
 *   AUTORIDADE e o trigger `external_ratings_display_guard_trg`, que roda no
 *   banco e vale para psql, seed e script. As duas podem DIVERGIR — e uma
 *   divergencia significa nota que a politica libera e o banco recusa (ou pior,
 *   o contrario). So um banco real com o trigger ligado fecha essa lacuna.
 *
 *   1. Uma nota de CADA fonte (IMDb, Rotten Tomatoes, Metacritic) entra, passa
 *      pelo trigger e sai com `display_allowed = true`.
 *   2. Cada uma sai com o credito da SUA fonte — nunca o de outra, nunca o do
 *      fornecedor tecnico.
 *   3. IMDb sai COM linkback; Rotten Tomatoes e Metacritic saem SEM (a dispensa
 *      nominal de 2026-08-12), e ainda assim exibem.
 *   4. CONTROLE NEGATIVO: uma nota sem atribuicao NAO passa — o trigger recusa.
 *   5. `provider_api` e `rating_source` nunca colapsam (invariante 2).
 *
 * O caminho exercitado e o de PRODUCAO: o mapper real (`mapOmdbPayload`), a
 * licenca real (`STATIC_AUTHORIZATION`), o lookup real
 * (`createPrismaRatingCreditLookup`) e o store real
 * (`createPrismaExternalRatings`). Nada e reimplementado aqui.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO),
 * mesmo padrao dos demais `validate:*-real-postgres`.
 *
 * ENCODING: o cluster sobe no encoding DEFAULT, de proposito. Forcar
 * `--encoding=UTF8` quebra quando os binarios vivem sob caminho acentuado
 * (o checkout deste repo e um). Este cenario e 100% ASCII — rotulos de fonte,
 * textos de credito e URLs — entao o default serve. Ingestao de payload REAL do
 * TMDB (turco/cirilico/grego) e outra historia e exige UTF8.
 *
 * Seguranca:
 *  - ZERO rede: nenhuma chamada a OMDb. O payload vem da fixture versionada.
 *  - Nenhum `DATABASE_URL` persistido em disco/.env; sempre mascarado no log.
 *  - Postgres derrubado e diretorio removido no `finally`.
 *
 * Uso: pnpm --filter @screena/ratings validate:omdb
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { STATIC_AUTHORIZATION } from '@screena/legal'
import { computeRatingStaleAfter } from '@screena/schemas'
import EmbeddedPostgres from 'embedded-postgres'

import { mapOmdbPayload } from '../src/omdb/mapping.js'
import {
  assertFixtureIntact,
  OMDB_GUARDIANS_PAYLOAD,
} from '../src/omdb/__tests__/fixture.js'
import type { ExternalRatingRow } from '../src/omdb/types.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

/**
 * IMDb id do titulo do cenario. O territorio de exibicao (BR) nao aparece como
 * constante aqui de proposito: ele vem das DECISOES do proprio
 * `authorization-spec`, e duplica-lo criaria uma segunda fonte de verdade.
 */
const IMDB_ID = 'tt3896198'

interface CheckResult {
  readonly n: number
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    bin: string | Record<string, string>
  }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

type PrismaLike = {
  $executeRawUnsafe: (sql: string, ...args: unknown[]) => Promise<number>
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T[]>
}

/** Escapa string para literal SQL simples. */
function lit(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`
}

/**
 * Materializa as licencas + decisoes do SPEC REAL no banco.
 *
 * Isto e o que o `pnpm legal sources apply ... --confirm` faz em producao (a
 * linha completa esta em `services/legal/README.md`). Reproduzi-lo
 * aqui a partir de `STATIC_AUTHORIZATION` (e nao de valores digitados a mao) e
 * o que faz o cenario provar o SPEC, e nao uma copia dele: se alguem mudar a
 * licenca no spec, este validador muda de comportamento junto.
 *
 * SUPERSEDE, nunca UPDATE: o `db:seed` ja deixa uma licenca-semente vigente e
 * conservadora (`unknown`, nada exibivel) por fonte, e o indice unico PARCIAL
 * `source_licenses_current_unique` impede uma SEGUNDA linha vigente no mesmo
 * grupo. Entao a semente e rebaixada (`is_current = false`) e a nova linha
 * aponta para ela em `supersedes_id` — historico preservado, exatamente como o
 * registry faz. Sobrescrever a semente seria mais curto e apagaria a trilha.
 */
async function seedAuthorization(prisma: PrismaLike): Promise<void> {
  const ratingEntries = STATIC_AUTHORIZATION.filter(
    (entry) => entry.license.contentType === 'rating',
  )

  for (const entry of ratingEntries) {
    const license = entry.license

    // Rebaixa a vigente do MESMO grupo natural (source_key, content_type,
    // provider, territorio) — a mesma chave do indice unico parcial.
    const previous = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `UPDATE source_licenses SET is_current = false, updated_at = now()
        WHERE source_key = ${lit(license.sourceKey)}
          AND content_type = 'rating'
          AND provider_key IS NULL
          AND territory_code IS NULL
          AND is_current
        RETURNING id`,
    )
    const supersedesId = previous[0]?.id ?? null

    // As decisoes da licenca antiga saem de cena junto (o read path ja ignora
    // decisao cuja licenca nao e vigente; isto so deixa o estado limpo).
    if (supersedesId !== null) {
      await prisma.$executeRawUnsafe(
        `UPDATE data_usage_decisions SET is_current = false, updated_at = now()
          WHERE source_license_id = ${supersedesId.toString()} AND is_current`,
      )
    }

    const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
      `INSERT INTO source_licenses (
         source_key, content_type, rating_source_key, provider_key, territory_code,
         license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed,
         requires_attribution, requires_linkback, attribution_text,
         decided_by, decided_at, is_current, supersedes_id, decision_origin, policy_version, notes, updated_at
       ) VALUES (
         ${lit(license.sourceKey)}, 'rating', ${lit(license.ratingSourceKey)}, NULL, NULL,
         ${lit(license.licenseStatus)}::"LicenseStatus", ${license.displayAllowed}, ${license.logoAllowed},
         ${license.scoreAllowed}, ${license.reviewQuoteAllowed},
         ${license.requiresAttribution}, ${license.requiresLinkback}, ${lit(license.attributionText)},
         'validador@cinerie', now(), true, ${supersedesId === null ? 'NULL' : supersedesId.toString()},
         'validator', ${lit(license.policyVersion)}, ${lit(license.notes)}, now()
       ) RETURNING id`,
    )
    const licenseId = rows[0]!.id

    for (const decision of entry.decisions) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO data_usage_decisions (
           source_license_id, use_case, territory, stage,
           display_allowed, storage_allowed, derivative_allowed,
           attribution_required, linkback_required,
           valid_from, policy_version, decided_by, reason, is_current, updated_at
         ) VALUES (
           ${licenseId.toString()}, ${lit(decision.useCase)}, ${lit(decision.territory)},
           ${lit(decision.stage)}::"DataUsageStage",
           ${decision.displayAllowed}, ${decision.storageAllowed}, ${decision.derivativeAllowed},
           ${decision.attributionRequired}, ${decision.linkbackRequired},
           now() - interval '1 day', ${lit(decision.policyVersion)}, 'validador@cinerie',
           'Cenario de validacao do adapter OMDb.', true, now()
         )`,
      )
    }
  }
}

interface StoredRating {
  readonly rating_source: string
  readonly metric: string
  readonly rating_value: string
  readonly rating_scale: number
  readonly score_type: string | null
  readonly provider_api: string
  readonly display_allowed: boolean
  readonly license_status: string
  readonly attribution_text: string | null
  readonly attribution_url: string | null
  readonly reviewed_by: string | null
}

async function runChecks(prisma: PrismaLike): Promise<void> {
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T>(sql)
  const x = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql)

  // --------------------------------------------------- 1. licencas do SPEC
  await seedAuthorization(prisma)
  record(3, 'licencas e decisoes do authorization-spec aplicadas', true, 'ok')

  // ----------------------------------------------------------- 2. entidade
  const movie = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, updated_at)
       VALUES (283995, ${lit(IMDB_ID)}, 'Guardians of the Galaxy Vol. 2', now()) RETURNING id`,
    )
  )[0]!
  const entityId = movie.id.toString()

  // ----------------------------------- 3. o MAPPER REAL sobre o payload real
  assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)
  const mapping = mapOmdbPayload(OMDB_GUARDIANS_PAYLOAD, OMDB_PROVIDER_API)
  record(
    4,
    'mapper reconhece TRES fontes editoriais no payload real',
    mapping.ratings.length === 3 && mapping.rejections.length === 0,
    `fontes=${mapping.ratings.map((r) => r.ratingSource).join(',')} recusas=${mapping.rejections.length}`,
  )

  // -------------------------- 4. o STORE REAL grava e a politica decide acender
  const { createPrismaExternalRatings } = await import(
    '../src/persistence/external-ratings-store.js'
  )
  const { createPrismaRatingCreditLookup } = await import(
    '../src/persistence/rating-credit-lookup.js'
  )

  const refusals: string[] = []
  const store = createPrismaExternalRatings(prisma as never, {
    credits: createPrismaRatingCreditLookup(prisma as never),
    log: (message) => refusals.push(message),
  })

  const fetchedAt = new Date()
  for (const draft of mapping.ratings) {
    const row: ExternalRatingRow = {
      ...draft,
      entityType: 'movie',
      entityId,
      providerApi: OMDB_PROVIDER_API,
      providerPayloadHash: 'hash-de-validacao',
      fetchedAt,
      staleAfter: computeRatingStaleAfter(draft.ratingSource, fetchedAt),
    }
    await store.upsert(row)
  }

  const stored = await q<StoredRating>(
    `SELECT rating_source, metric, rating_value::text AS rating_value, rating_scale, score_type::text AS score_type,
            provider_api, display_allowed, license_status::text AS license_status,
            attribution_text, attribution_url, reviewed_by
       FROM external_ratings
      WHERE entity_type = 'movie' AND entity_id = ${entityId}
      ORDER BY rating_source`,
  )
  const bySource = new Map(stored.map((row) => [row.rating_source, row]))

  record(
    5,
    'as tres notas foram persistidas (uma linha por fonte)',
    stored.length === 3,
    `linhas=${stored.length}: ${stored.map((r) => `${r.rating_source}/${r.metric}`).join(' ')}`,
  )

  // ---- 5. cada fonte ACENDE, passando pelo trigger, com o credito CERTO ----
  for (const [source, expectedText] of [
    ['imdb', 'Nota fornecida por IMDb'],
    ['rotten_tomatoes', 'Nota fornecida por Rotten Tomatoes'],
    ['metacritic', 'Nota fornecida por Metacritic'],
  ] as const) {
    const row = bySource.get(source)
    record(
      6,
      `${source}: display_allowed=true (passou pelo trigger do banco)`,
      row?.display_allowed === true,
      `display=${String(row?.display_allowed)} license=${String(row?.license_status)} refusals=${refusals.length}`,
    )
    record(
      7,
      `${source}: credito e da PROPRIA fonte, nunca de outra nem do provider`,
      row?.attribution_text === expectedText,
      `attribution_text=${JSON.stringify(row?.attribution_text)}`,
    )
    record(
      8,
      `${source}: provider_api="omdb" e distinto de rating_source (invariante 2)`,
      row?.provider_api === OMDB_PROVIDER_API && row?.rating_source !== row?.provider_api,
      `provider_api=${String(row?.provider_api)} rating_source=${String(row?.rating_source)}`,
    )
    record(
      9,
      `${source}: revisor carimbado pela POLITICA (prefixo automation:)`,
      typeof row?.reviewed_by === 'string' && row.reviewed_by.startsWith('automation:'),
      `reviewed_by=${JSON.stringify(row?.reviewed_by)}`,
    )
  }

  // ---------------------------------------- 6. linkback: IMDb sim, RT/MC nao
  record(
    10,
    'IMDb exibe COM linkback (URL derivada do imdbID do payload)',
    bySource.get('imdb')?.attribution_url === `https://www.imdb.com/title/${IMDB_ID}/`,
    `attribution_url=${JSON.stringify(bySource.get('imdb')?.attribution_url)}`,
  )
  record(
    11,
    'Rotten Tomatoes exibe SEM link (dispensa nominal de 2026-08-12)',
    bySource.get('rotten_tomatoes')?.display_allowed === true &&
      bySource.get('rotten_tomatoes')?.attribution_url === null,
    `display=${String(bySource.get('rotten_tomatoes')?.display_allowed)} url=${JSON.stringify(bySource.get('rotten_tomatoes')?.attribution_url)}`,
  )
  record(
    12,
    'Metacritic exibe SEM link (dispensa nominal de 2026-08-12)',
    bySource.get('metacritic')?.display_allowed === true &&
      bySource.get('metacritic')?.attribution_url === null,
    `display=${String(bySource.get('metacritic')?.display_allowed)} url=${JSON.stringify(bySource.get('metacritic')?.attribution_url)}`,
  )

  // ------------------------------- 7. escalas preservadas, nada reescalado
  record(
    13,
    'cada nota ficou na escala da SUA fonte (7.6/10, 85/100, 67/100)',
    Number(bySource.get('imdb')?.rating_value) === 7.6 &&
      bySource.get('imdb')?.rating_scale === 10 &&
      Number(bySource.get('rotten_tomatoes')?.rating_value) === 85 &&
      bySource.get('rotten_tomatoes')?.rating_scale === 100 &&
      Number(bySource.get('metacritic')?.rating_value) === 67 &&
      bySource.get('metacritic')?.rating_scale === 100,
    stored.map((r) => `${r.rating_source}=${r.rating_value}/${r.rating_scale}`).join(' '),
  )
  record(
    14,
    'natureza classificada: IMDb=audience, RT e Metacritic=critics',
    bySource.get('imdb')?.score_type === 'audience' &&
      bySource.get('rotten_tomatoes')?.score_type === 'critics' &&
      bySource.get('metacritic')?.score_type === 'critics',
    stored.map((r) => `${r.rating_source}=${String(r.score_type)}`).join(' '),
  )

  // ================= 8. CONTROLE NEGATIVO: sem atribuicao, NAO passa =========
  //
  // Dois angulos, porque sao travas diferentes:
  //   (a) a POLITICA recusa antes de gastar o write (camada 1);
  //   (b) o TRIGGER recusa mesmo por SQL bruto (a autoridade).
  // Se so (a) fosse testado, um bug na politica passaria despercebido; se so
  // (b), nao saberiamos se o worker chega a tentar.

  // (a) licenca do Metacritic perde o texto de credito -> a nota nao acende.
  await x(
    `UPDATE source_licenses SET attribution_text = NULL
      WHERE rating_source_key = 'metacritic' AND content_type = 'rating' AND is_current`,
  )
  const otherMovie = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, updated_at)
       VALUES (283996, 'tt9999999', 'Sem Credito', now()) RETURNING id`,
    )
  )[0]!

  const refusalsBefore = refusals.length
  const freshStore = createPrismaExternalRatings(prisma as never, {
    credits: createPrismaRatingCreditLookup(prisma as never), // cache limpo
    log: (message) => refusals.push(message),
  })
  const mcDraft = mapping.ratings.find((r) => r.ratingSource === 'metacritic')!
  await freshStore.upsert({
    ...mcDraft,
    entityType: 'movie',
    entityId: otherMovie.id.toString(),
    providerApi: OMDB_PROVIDER_API,
    providerPayloadHash: 'hash-de-validacao',
    fetchedAt,
    staleAfter: null,
  })

  const orphan = (
    await q<{ display_allowed: boolean; attribution_text: string | null }>(
      `SELECT display_allowed, attribution_text FROM external_ratings
        WHERE entity_type='movie' AND entity_id=${otherMovie.id.toString()} AND rating_source='metacritic'`,
    )
  )[0]
  record(
    15,
    'CONTROLE NEGATIVO (a): sem attribution_text, a nota NAO acende',
    orphan !== undefined && orphan.display_allowed === false,
    `display=${String(orphan?.display_allowed)}`,
  )
  record(
    16,
    'CONTROLE NEGATIVO (a): a recusa foi LOGADA (nada falha em silencio)',
    refusals.length > refusalsBefore &&
      refusals[refusals.length - 1]!.includes('missing-attribution'),
    `ultimo log=${JSON.stringify(refusals[refusals.length - 1] ?? null)}`,
  )

  // (b) e (c): o TRIGGER recusa por SQL bruto.
  //
  // ATENCAO — e aqui que a primeira versao deste validador passava pelo MOTIVO
  // ERRADO. O guard checa `approved_payload_hash` ANTES da atribuicao. Um
  // UPDATE que mexe em `attribution_text` sem recomputar o fingerprint morre no
  // check de HASH e nunca chega ao check de atribuicao — o teste fica verde
  // provando outra coisa. Por isso os dois casos abaixo RECOMPUTAM o
  // fingerprint com os valores novos, e a assercao exige a MENSAGEM ESPECIFICA
  // do check que se quer exercitar.
  //
  // Dentro do SET, `r."col"` le o valor ANTIGO; por isso as colunas que este
  // UPDATE altera entram como literal no fingerprint, e so as intocadas vem de
  // `r."..."` (mesma licao do `external-ratings-store.ts`).
  const refusalMessage = async (sql: string): Promise<string | null> => {
    try {
      await x(sql)
      return null
    } catch (error) {
      return (error as Error).message.replace(/\s+/g, ' ')
    }
  }

  const noAttribution = await refusalMessage(
    `UPDATE external_ratings r
        SET attribution_text = NULL,
            requires_attribution = true,
            display_allowed = true,
            approved_payload_hash = external_rating_payload_fingerprint_v1(
              r."entity_type", r."entity_id", r."rating_source", r."metric",
              r."score_type", r."rating_label", r."rating_value", r."rating_scale",
              r."rating_count", r."rating_url", r."provider_api",
              r."license_status", true, r."requires_linkback", NULL, r."attribution_url")
      WHERE r."entity_type"='movie' AND r."entity_id"=${entityId} AND r."rating_source"='imdb'`,
  )
  record(
    17,
    'CONTROLE NEGATIVO (b): o TRIGGER recusa exibir sem atribuicao (com hash valido)',
    noAttribution !== null && noAttribution.includes('attribution_text exigido ausente'),
    noAttribution === null
      ? 'o UPDATE passou — o trigger NAO barrou'
      : `mensagem: ${noAttribution.slice(0, 130)}`,
  )

  const noLinkback = await refusalMessage(
    `UPDATE external_ratings r
        SET attribution_url = NULL,
            requires_linkback = true,
            display_allowed = true,
            approved_payload_hash = external_rating_payload_fingerprint_v1(
              r."entity_type", r."entity_id", r."rating_source", r."metric",
              r."score_type", r."rating_label", r."rating_value", r."rating_scale",
              r."rating_count", r."rating_url", r."provider_api",
              r."license_status", r."requires_attribution", true, r."attribution_text", NULL)
      WHERE r."entity_type"='movie' AND r."entity_id"=${entityId} AND r."rating_source"='rotten_tomatoes'`,
  )
  record(
    18,
    'CONTROLE NEGATIVO (c): com requires_linkback=true e url nula, o trigger recusa',
    noLinkback !== null && noLinkback.includes('attribution_url (linkback) exigido ausente'),
    noLinkback === null
      ? 'o UPDATE passou — o trigger NAO barrou'
      : `mensagem: ${noLinkback.slice(0, 130)}`,
  )

  // (d) CONTROLE POSITIVO do proprio controle negativo: o MESMO UPDATE, com
  // linkback dispensado (o caso real de RT), PASSA. Sem isto, (c) poderia estar
  // verde por qualquer erro de SQL — e nao por causa do gate.
  const dispensedOk = await refusalMessage(
    `UPDATE external_ratings r
        SET attribution_url = NULL,
            requires_linkback = false,
            display_allowed = true,
            approved_payload_hash = external_rating_payload_fingerprint_v1(
              r."entity_type", r."entity_id", r."rating_source", r."metric",
              r."score_type", r."rating_label", r."rating_value", r."rating_scale",
              r."rating_count", r."rating_url", r."provider_api",
              r."license_status", r."requires_attribution", false, r."attribution_text", NULL)
      WHERE r."entity_type"='movie' AND r."entity_id"=${entityId} AND r."rating_source"='metacritic'`,
  )
  record(
    19,
    'CONTROLE POSITIVO: o MESMO UPDATE com linkback dispensado PASSA (o gate e o linkback, nao o SQL)',
    dispensedOk === null,
    dispensedOk === null ? 'UPDATE aceito' : `recusado: ${dispensedOk.slice(0, 130)}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-omdb-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_omdb_validation'
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/${dbName}?schema=public`
  const maskedUrl = `postgresql://postgres:****@127.0.0.1:${port}/${dbName}?schema=public`
  console.log(`\n=== Postgres efemero (embedded) :${port} | ${maskedUrl} ===\n`)

  let started = false
  let disconnect: (() => Promise<void>) | undefined
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase(dbName)

    process.env.DATABASE_URL = url
    const env = { ...process.env, DATABASE_URL: url }

    console.log('--- prisma migrate deploy (schema existente; sem migration nova) ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(1, 'migrate deploy aplica sem erro', true, 'ok')

    console.log('--- prisma db seed (idiomas/paises/fontes/providers) ---')
    execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(2, 'db:seed roda sem erro (inclui o provider "omdb")', true, 'ok')

    console.log('\n--- adapter OMDb contra banco real (triggers ativos) ---')
    const dbServer = (await import('@screena/db/server')) as {
      getPrismaClient: () => PrismaLike
      disconnectPrisma: () => Promise<void>
    }
    disconnect = dbServer.disconnectPrisma

    await runChecks(dbServer.getPrismaClient())
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0] ?? 'erro')
  } finally {
    if (disconnect) await disconnect()
    if (started) await pg.stop()
    delete process.env.DATABASE_URL
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch (e) {
      console.warn(
        `Aviso: dir temporario nao removido agora (${(e as Error).message.split('\n')[0]}); sera limpo pelo SO.`,
      )
    }
    console.log('\n=== Postgres efemero derrubado e dir temporario liberado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log(
    'Resultado: PASSOU. As tres fontes da OMDb entram, passam pelo trigger e exibem com o ' +
      'credito da fonte certa; sem atribuicao, nao passam.',
  )
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
