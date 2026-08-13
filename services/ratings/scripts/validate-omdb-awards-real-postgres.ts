/**
 * validate-omdb-awards-real-postgres.ts — Prova de ponta a ponta da promocao de
 * premiacao contra PostgreSQL REAL, com o trigger de governanca ATIVO.
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. NAO faz parte do
 * produto: nunca roda no render, no build de app, nem em producao.
 *
 * O QUE ELA PROVA — e por que teste puro nao bastava:
 *
 *   `resolveAwardsDisplay` (testado a parte, em memoria) e a camada 1. A
 *   AUTORIDADE e o trigger `entity_awards_display_guard_trg`, que roda no banco
 *   e vale para psql, seed e script. As duas podem DIVERGIR.
 *
 *   1. SEM licenca de premiacao (o estado REAL de hoje), o fato e gravado para
 *      auditoria com `display_allowed = false` — e o motivo e reportado.
 *   2. COM uma licenca de premiacao, a MESMA linha passa pelo trigger e sai
 *      `display_allowed = true`, com o credito daquela fonte.
 *   3. CONTROLES NEGATIVOS, cada um exigindo a MENSAGEM ESPECIFICA do check que
 *      exercita: sem fonte nomeada, sem atribuicao, e com uma decisao de
 *      `rating_display` tentando acender a faixa de premios.
 *   4. CONTROLE POSITIVO DO CONTROLE NEGATIVO: o MESMO UPDATE, integro, passa —
 *      senao um erro de SQL qualquer deixaria os negativos verdes.
 *
 * A FONTE USADA AQUI E FICTICIA, E ISSO E DELIBERADO. A fonte editorial real do
 * campo `Awards` da OMDb NAO foi determinada (ver
 * docs/legal/omdb-awards-source-provenance.md). O validador prova o MECANISMO —
 * que a cadeia licenca -> decisao -> credito -> trigger funciona — sem afirmar
 * de quem e o credito. Nomear o IMDb aqui seria decidir a questao num script de
 * teste.
 *
 * Motor: `embedded-postgres` (PostgreSQL 16 real, binario portatil, EFEMERO).
 *
 * ENCODING: o cluster sobe no encoding DEFAULT, de proposito. Forcar
 * `--encoding=UTF8` quebra quando os binarios vivem sob caminho acentuado (o
 * checkout deste repo e um).
 *
 * Seguranca: ZERO rede; nenhum `DATABASE_URL` persistido em disco; Postgres
 * derrubado e diretorio removido no `finally`.
 *
 * Uso: pnpm --filter @screena/ratings validate:awards
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { awardsAuthorizationEntry, CINERIE_TERRITORY } from '@screena/legal'
import EmbeddedPostgres from 'embedded-postgres'

import { runAwardsPromotion } from '../src/awards/run.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const dbSchema = path.join(dbDir, 'prisma', 'schema.prisma')
const dbRequire = createRequire(path.join(dbDir, 'package.json'))

/** IMDb id do titulo do cenario. */
const IMDB_ID = 'tt1375666'
/** A frase MEDIDA em producao para este titulo. */
const AWARDS_RAW = 'Won 4 Oscars. 160 wins & 220 nominations total'

/**
 * Fonte FICTICIA do cenario. Nao e o IMDb, nao e a OMDb, nao e ninguem: e um
 * rotulo de validacao. Ver o cabecalho.
 */
const FICTIONAL_SOURCE = 'validador-fonte-de-premiacao'

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

function lit(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`
}

interface StoredAward {
  readonly awards_raw: string
  readonly outcome: string | null
  readonly highlight_count: number | null
  readonly award_name: string | null
  readonly wins: number | null
  readonly nominations: number | null
  readonly source_key: string | null
  readonly attribution_text: string | null
  readonly attribution_url: string | null
  readonly display_allowed: boolean
  readonly license_status: string
}

async function runChecks(prisma: PrismaLike): Promise<void> {
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T>(sql)
  const x = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql)

  const { createPrismaAwardsCacheSource } = await import(
    '../src/persistence/awards-cache-source.js'
  )
  const { createPrismaAwardsCreditLookup } = await import(
    '../src/persistence/awards-credit-lookup.js'
  )
  const { createPrismaEntityAwards } = await import('../src/persistence/awards-store.js')
  const { createPrismaEntityLookup } = await import('../src/persistence/entity-lookup.js')
  const { createPrismaSyncLog } = await import('../src/persistence/sync-log.js')

  // ------------------------------------------------------------- 3. cenario
  const movie = (
    await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, imdb_id, title_original, updated_at)
       VALUES (27205, ${lit(IMDB_ID)}, 'Inception', now()) RETURNING id`,
    )
  )[0]!
  const entityId = movie.id.toString()

  // O payload vai para `api_cache` exatamente como o sync o deixaria. A
  // promocao le DAQUI — nao ha rede em lugar nenhum deste caminho.
  await x(
    `INSERT INTO api_cache (provider_api, endpoint, request_key, params_hash, payload, payload_hash, fetched_at)
     VALUES (${lit(OMDB_PROVIDER_API)}, '/', ${lit(`i=${IMDB_ID}`)}, 'params-hash',
             ${lit(JSON.stringify({ Response: 'True', imdbID: IMDB_ID, Awards: AWARDS_RAW }))}::jsonb,
             'payload-hash', now())`,
  )
  record(3, 'payload OMDb com o campo Awards guardado em api_cache', true, AWARDS_RAW)

  const deps = (credits: ReturnType<typeof createPrismaAwardsCreditLookup>) => ({
    cache: createPrismaAwardsCacheSource(prisma as never, OMDB_PROVIDER_API),
    credit: credits,
    entities: createPrismaEntityLookup(prisma as never),
    awards: createPrismaEntityAwards(prisma as never),
    syncLog: createPrismaSyncLog(prisma as never, OMDB_PROVIDER_API),
    now: () => new Date(),
  })
  const OPTIONS = { apply: true, limit: null, providerApi: OMDB_PROVIDER_API, entityType: null } as const

  const stored = async (): Promise<StoredAward | undefined> =>
    (
      await q<StoredAward>(
        `SELECT awards_raw, outcome, highlight_count, award_name, wins, nominations,
                source_key, attribution_text, attribution_url, display_allowed,
                license_status::text AS license_status
           FROM entity_awards
          WHERE entity_type='movie' AND entity_id=${entityId}`,
      )
    )[0]

  // ------------- 4. ESTADO REAL DE HOJE: sem licenca, guarda e nao exibe -----
  const first = await runAwardsPromotion(
    OPTIONS,
    deps(createPrismaAwardsCreditLookup(prisma as never)),
  )
  const row = await stored()
  record(
    4,
    'SEM licenca de premiacao: a linha e gravada (bruto + parseado) para auditoria',
    row !== undefined &&
      row.awards_raw === AWARDS_RAW &&
      row.outcome === 'won' &&
      row.highlight_count === 4 &&
      row.award_name === 'Oscars' &&
      row.wins === 160 &&
      row.nominations === 220,
    row === undefined
      ? 'nenhuma linha gravada'
      : `raw ok · outcome=${row.outcome} count=${row.highlight_count} nome="${row.award_name}" wins=${row.wins} nom=${row.nominations}`,
  )
  record(
    5,
    'SEM licenca: display_allowed=false, sem fonte nomeada e sem credito (invariante 6)',
    row !== undefined &&
      row.display_allowed === false &&
      row.source_key === null &&
      row.attribution_text === null &&
      row.license_status === 'unknown',
    `display=${String(row?.display_allowed)} source=${String(row?.source_key)} licenca=${String(row?.license_status)}`,
  )
  record(
    6,
    'SEM licenca: o motivo e REPORTADO (nada falha em silencio) e cota gasta = 0',
    first.rejections.some((r) => r.reason === 'no-license'),
    `recusas=${first.rejections.map((r) => r.reason).join(',')}`,
  )

  // O nome do premio nao pode ter sido tocado no caminho ate o banco.
  record(
    7,
    'o NOME do premio chega ao banco VERBATIM ("Oscars", nunca traduzido)',
    row?.award_name === 'Oscars',
    `award_name=${JSON.stringify(row?.award_name ?? null)}`,
  )

  // ------- 5. COM licenca (hipotetica), a mesma linha acende pelo trigger ----
  const entry = awardsAuthorizationEntry({
    sourceKey: FICTIONAL_SOURCE,
    attributionText: 'Premiacao fornecida por Fonte de Validacao',
    policyVersion: 'validador/premiacao/2026-08-v1',
    requiresLinkback: true,
    notes: 'Licenca FICTICIA criada pelo validador. Nao representa decisao nenhuma.',
  })
  const licenseRows = await q<{ id: bigint }>(
    `INSERT INTO source_licenses (
       source_key, content_type, rating_source_key, provider_key, territory_code,
       license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed,
       requires_attribution, requires_linkback, attribution_text, terms_url,
       decided_by, decided_at, is_current, decision_origin, policy_version, notes, updated_at
     ) VALUES (
       ${lit(entry.license.sourceKey)}, ${lit(entry.license.contentType)}::"SourceLicenseContentType",
       NULL, ${lit(entry.license.providerKey)}, ${lit(CINERIE_TERRITORY)},
       ${lit(entry.license.licenseStatus)}::"LicenseStatus", ${entry.license.displayAllowed},
       ${entry.license.logoAllowed}, ${entry.license.scoreAllowed}, ${entry.license.reviewQuoteAllowed},
       ${entry.license.requiresAttribution}, ${entry.license.requiresLinkback},
       ${lit(entry.license.attributionText)}, 'https://exemplo.invalid/premios',
       'validador@cinerie', now(), true, 'validator', ${lit(entry.license.policyVersion)},
       ${lit(entry.license.notes)}, now()
     ) RETURNING id`,
  )
  const licenseId = licenseRows[0]!.id.toString()
  for (const decision of entry.decisions) {
    await x(
      `INSERT INTO data_usage_decisions (
         source_license_id, use_case, territory, stage,
         display_allowed, storage_allowed, derivative_allowed,
         attribution_required, linkback_required,
         valid_from, policy_version, decided_by, reason, is_current, updated_at
       ) VALUES (
         ${licenseId}, ${lit(decision.useCase)}, ${lit(decision.territory)},
         ${lit(decision.stage)}::"DataUsageStage",
         ${decision.displayAllowed}, ${decision.storageAllowed}, ${decision.derivativeAllowed},
         ${decision.attributionRequired}, ${decision.linkbackRequired},
         now() - interval '1 day', ${lit(decision.policyVersion)}, 'validador@cinerie',
         'Cenario de validacao da promocao de premiacao.', true, now()
       )`,
    )
  }
  record(8, 'licenca de premiacao (FICTICIA) + decisao awards_display aplicadas', true, 'ok')

  // Lookup NOVO: o cache e por execucao, e a licenca acabou de nascer.
  const second = await runAwardsPromotion(
    OPTIONS,
    deps(createPrismaAwardsCreditLookup(prisma as never)),
  )
  const lit2 = await stored()
  record(
    9,
    'COM licenca: a MESMA linha passa pelo trigger e sai display_allowed=true',
    lit2?.display_allowed === true,
    `display=${String(lit2?.display_allowed)} · recusas=${second.rejections.map((r) => r.reason).join(',') || 'nenhuma'}`,
  )
  record(
    10,
    'COM licenca: o credito gravado e o da licenca (texto + linkback), nunca do provedor tecnico',
    lit2?.source_key === FICTIONAL_SOURCE &&
      lit2?.attribution_text === 'Premiacao fornecida por Fonte de Validacao' &&
      lit2?.attribution_url === 'https://exemplo.invalid/premios',
    `source=${String(lit2?.source_key)} texto=${JSON.stringify(lit2?.attribution_text ?? null)}`,
  )
  record(
    11,
    'IDEMPOTENTE: reexecutar nao cria linha nova',
    (await q<{ n: bigint }>(`SELECT count(*) AS n FROM entity_awards`))[0]!.n.toString() === '1',
    'uma linha para o titulo',
  )

  // ------------------------ 6. CONTROLES NEGATIVOS (o trigger) --------------
  //
  // ATENCAO — a armadilha que ja fez validador passar pelo motivo errado neste
  // repositorio: o guard checa `approved_payload_hash` ANTES do resto. Um
  // UPDATE que mexe numa coluna sem recomputar o fingerprint morre no check de
  // HASH e nunca chega ao check que se queria exercitar. Por isso todo UPDATE
  // abaixo RECOMPUTA o fingerprint com os valores novos, e a assercao exige a
  // MENSAGEM ESPECIFICA.
  //
  // Dentro do SET, `a."col"` le o valor ANTIGO; por isso as colunas alteradas
  // entram como literal no fingerprint, e so as intocadas vem de `a."..."`.
  const refusalMessage = async (sql: string): Promise<string | null> => {
    try {
      await x(sql)
      return null
    } catch (error) {
      return (error as Error).message.replace(/\s+/g, ' ')
    }
  }

  const fingerprint = (over: {
    sourceKey?: string
    requiresAttribution?: string
    attributionText?: string
    attributionUrl?: string
  }): string =>
    `entity_award_payload_fingerprint_v1(
        a."entity_type", a."entity_id", a."provider_api", a."awards_raw",
        a."outcome", a."highlight_count", a."award_name", a."wins", a."nominations",
        ${over.sourceKey ?? 'a."source_key"'}, a."license_status",
        ${over.requiresAttribution ?? 'a."requires_attribution"'}, a."requires_linkback",
        ${over.attributionText ?? 'a."attribution_text"'},
        ${over.attributionUrl ?? 'a."attribution_url"'})`

  const WHERE = `WHERE a."entity_type"='movie' AND a."entity_id"=${entityId}`

  const noSource = await refusalMessage(
    `UPDATE entity_awards a
        SET source_key = NULL, display_allowed = true,
            approved_payload_hash = ${fingerprint({ sourceKey: 'NULL' })}
      ${WHERE}`,
  )
  record(
    12,
    'CONTROLE NEGATIVO (a): sem FONTE nomeada o trigger recusa (o gate da decisao pendente)',
    noSource !== null && noSource.includes('source_key obrigatorio'),
    noSource === null ? 'o UPDATE passou — o trigger NAO barrou' : `mensagem: ${noSource.slice(0, 130)}`,
  )

  const noAttribution = await refusalMessage(
    `UPDATE entity_awards a
        SET attribution_text = NULL, requires_attribution = true, display_allowed = true,
            approved_payload_hash = ${fingerprint({ attributionText: 'NULL', requiresAttribution: 'true' })}
      ${WHERE}`,
  )
  record(
    13,
    'CONTROLE NEGATIVO (b): sem ATRIBUICAO o trigger recusa (com hash valido)',
    noAttribution !== null && noAttribution.includes('attribution_text exigido ausente'),
    noAttribution === null
      ? 'o UPDATE passou — o trigger NAO barrou'
      : `mensagem: ${noAttribution.slice(0, 130)}`,
  )

  // (c) Uma decisao de RATING nao pode acender a faixa de PREMIOS.
  const ratingDecision = await q<{ id: bigint }>(
    `SELECT d."id" FROM data_usage_decisions d WHERE d."use_case"='rating_display' AND d."is_current" LIMIT 1`,
  )
  if (ratingDecision.length === 0) {
    // Nao ha decisao de rating no seed: cria uma sobre a MESMA licenca, so para
    // provar que o use_case errado e recusado.
    await x(
      `INSERT INTO data_usage_decisions (
         source_license_id, use_case, territory, stage, display_allowed, storage_allowed,
         derivative_allowed, attribution_required, linkback_required, valid_from,
         policy_version, decided_by, reason, is_current, updated_at
       ) VALUES (
         ${licenseId}, 'rating_display', ${lit(CINERIE_TERRITORY)}, 'approved_for_display',
         true, true, false, true, true, now() - interval '1 day',
         'validador/premiacao/2026-08-v1', 'validador@cinerie',
         'Decisao de RATING usada como controle negativo da faixa de premios.', true, now()
       )`,
    )
  }
  const ratingDecisionId = (
    await q<{ id: bigint }>(
      `SELECT d."id" FROM data_usage_decisions d WHERE d."use_case"='rating_display' AND d."is_current" ORDER BY d."id" DESC LIMIT 1`,
    )
  )[0]!.id.toString()

  const wrongUseCase = await refusalMessage(
    `UPDATE entity_awards a
        SET data_usage_decision_id = ${ratingDecisionId}, display_allowed = true,
            approved_payload_hash = ${fingerprint({})}
      ${WHERE}`,
  )
  record(
    14,
    'CONTROLE NEGATIVO (c): decisao de rating_display NAO acende a faixa de premios',
    wrongUseCase !== null && wrongUseCase.includes('so awards_display autoriza'),
    wrongUseCase === null
      ? 'o UPDATE passou — o trigger NAO barrou'
      : `mensagem: ${wrongUseCase.slice(0, 130)}`,
  )

  // (d) CONTROLE POSITIVO DO CONTROLE NEGATIVO: o MESMO UPDATE, integro, PASSA.
  // Sem isto, (a)/(b)/(c) poderiam estar verdes por qualquer erro de SQL.
  const intactOk = await refusalMessage(
    `UPDATE entity_awards a
        SET display_allowed = true,
            approved_payload_hash = ${fingerprint({})}
      ${WHERE}`,
  )
  record(
    15,
    'CONTROLE POSITIVO: o MESMO UPDATE, integro, PASSA (o gate e a governanca, nao o SQL)',
    intactOk === null,
    intactOk === null ? 'UPDATE aceito' : `recusado: ${intactOk.slice(0, 130)}`,
  )

  // ---------------- 7. mudanca revoga: frase nova nao herda aprovacao -------
  await x(
    `UPDATE api_cache SET payload = ${lit(
      JSON.stringify({ Response: 'True', imdbID: IMDB_ID, Awards: 'Won 5 Oscars. 161 wins & 221 nominations total' }),
    )}::jsonb WHERE request_key = ${lit(`i=${IMDB_ID}`)}`,
  )
  await runAwardsPromotion(OPTIONS, deps(createPrismaAwardsCreditLookup(prisma as never)))
  const changed = await stored()
  record(
    16,
    'MUDANCA REVOGA e REAPROVA: a frase nova entra e o hash e recomputado sobre ela',
    changed?.awards_raw === 'Won 5 Oscars. 161 wins & 221 nominations total' &&
      changed?.highlight_count === 5 &&
      changed?.display_allowed === true,
    `raw=${JSON.stringify(changed?.awards_raw ?? null)} display=${String(changed?.display_allowed)}`,
  )
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-awards-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
  })
  const dbName = 'cinerie_awards_validation'
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

    console.log('--- prisma migrate deploy (inclui entity_awards + trigger) ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(1, 'migrate deploy aplica sem erro (a migration nova inclusive)', true, 'ok')

    console.log('--- prisma db seed (idiomas/paises/fontes/providers) ---')
    execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', dbSchema], {
      env,
      stdio: 'inherit',
      cwd: dbDir,
    })
    record(2, 'db:seed roda sem erro (inclui o provider "omdb")', true, 'ok')

    console.log('\n--- promocao de premiacao contra banco real (trigger ativo) ---')
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
    'Resultado: PASSOU. Sem licenca o fato e guardado e NAO aparece; com licenca a mesma ' +
      'linha acende com o credito da fonte; sem fonte, sem atribuicao ou com decisao de ' +
      'outro use_case, o trigger recusa.',
  )
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
