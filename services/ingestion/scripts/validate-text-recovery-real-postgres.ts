/**
 * validate-text-recovery-real-postgres.ts — A RECUPERACAO DE TEXTO MUDA O
 * VEREDITO, e o TETO DO CENSO deixou de mentir. Contra PostgreSQL 16 efemero.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * ============================================================================
 * O QUE SO UM BANCO REAL PROVA
 * ============================================================================
 * O extrator puro tem teste unitario (`localized-text-extraction.test.ts`) e ele
 * prova que a sinopse SAI do payload. Nao prova nada do que vem depois — e e
 * depois que este projeto costuma se enganar:
 *
 *   1. que o backfill ACHA o payload guardado. A consulta casa `api_cache` por
 *      `endpoint`, atravessa `jsonb`, e nenhum fake reproduz um `jsonb_agg` com
 *      filtro dentro de subconsulta correlacionada;
 *   2. que ele GRAVA — e que o `ON CONFLICT ... DO UPDATE ... WHERE` recusa
 *      sobrescrever texto existente. Um `SELECT` antes do `INSERT` "provaria" o
 *      mesmo em teste e perderia a corrida em producao;
 *   3. que a segunda execucao grava ZERO. Idempotencia afirmada em comentario ja
 *      custou dezenas de milhares de erros de chave duplicada por minuto neste
 *      banco;
 *   4. que o VEREDITO muda: o mesmo titulo sai de `no_synopsis` e entra em
 *      `eligible`, rodando a politica de verdade sobre as colunas de verdade.
 *      Preencher a coluna sem mudar o veredito seria trabalho sem efeito — e
 *      "N titulos processados" e exatamente o tipo de sucesso em proxy que esta
 *      leva existe para fechar;
 *   5. que a CASCATA anda: recuperar UMA serie devolve ao indice as temporadas e
 *      os episodios que estavam em `parent_not_publishable`. No censo de
 *      producao de 2026-08-28 essa cascata sao 116.004 paginas — 37,8% do corte;
 *   6. que o CENSO nao para mais no teto. Com 100.001 filmes no banco — um a
 *      mais que o antigo default de `100_000` — o produtor tem de reportar
 *      100.001, e uma execucao com `--limit 100000` tem de se declarar
 *      TRUNCADA. Este e o controle negativo do Item A: o teto antigo, agora
 *      explicito, ainda produz o numero errado — mas agora ele vem rotulado.
 *
 * Uso: pnpm --filter @screena/ingestion validate:text-recovery
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { produceIndexabilityDecisions } from '../src/persistence/indexability-writer.js'
import {
  backfillMissingText,
  writeBiographyIfEmpty,
  writeSynopsisIfEmpty,
} from '../src/persistence/text-backfill.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const ingestionDir = path.resolve(scriptDir, '..')
const dbDir = path.resolve(ingestionDir, '..', '..', 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

const LANGUAGE = 'pt-BR'
/** Um a MAIS que o antigo default de `100_000`. O "um" e a medida inteira. */
const FILMES_EM_MASSA = 100_001

let passed = 0
let total = 0
function record(name: string, ok: boolean, detail: string): void {
  total += 1
  if (ok) passed += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${total}. ${name} — ${detail}`)
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
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  if (rel === undefined) throw new Error('binario do prisma nao encontrado')
  return path.join(path.dirname(pkgPath), rel)
}

/**
 * Escape hatch para cluster JA de pe em loopback. Copiado de
 * `validate-indexability-producer-real-postgres.ts`: no checkout acentuado o
 * `initdb --encoding=UTF8` morre, e este e o caminho que funciona.
 *
 * Variavel PROPRIA, nunca `DATABASE_URL` — o `.env` deste checkout aponta para
 * PRODUCAO, e este validador INSERE e APAGA.
 */
function externalDatabaseUrl(): string | null {
  const raw = process.env.CINERIE_VALIDATOR_DATABASE_URL
  if (raw === undefined || raw.trim().length === 0) return null
  const host = new URL(raw).hostname
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error(
      `CINERIE_VALIDATOR_DATABASE_URL precisa apontar para loopback (recebeu host "${host}"). ` +
        'Este validador APAGA e INSERE dados; ele nunca fala com banco remoto.',
    )
  }
  return raw
}

/** Uma entrada do bloco `translations` do TMDB, como JSON. */
function traducao(iso639: string, iso3166: string, data: Record<string, string>): unknown {
  return { iso_639_1: iso639, iso_3166_1: iso3166, name: `${iso639}-${iso3166}`, data }
}

/** Payload de detalhe como o TMDB responde `?language=pt-BR` sem traducao pt-BR. */
function payloadFilme(tmdbId: number, traducoes: readonly unknown[]): unknown {
  return {
    id: tmdbId,
    title: `Filme ${tmdbId}`,
    original_title: `Movie ${tmdbId}`,
    overview: '',
    translations: { translations: [...traducoes] },
  }
}

function payloadSerie(tmdbId: number, traducoes: readonly unknown[]): unknown {
  return {
    id: tmdbId,
    name: `Serie ${tmdbId}`,
    original_name: `Show ${tmdbId}`,
    overview: '',
    translations: { translations: [...traducoes] },
  }
}

const SINOPSE_RECUPERAVEL = 'Sinopse em portugues do Brasil, guardada no bloco translations.'
const SINOPSE_EUROPEIA = 'Sinopse em portugues europeu, que ninguem autorizou a exibir.'
const BIO_RECUPERAVEL = 'Biografia em portugues do Brasil, guardada no bloco translations.'

/**
 * Fixtures do CENARIO PEQUENO (checks 1..N).
 *
 *   movie 101   sem sinopse · payload em `api_cache` COM pt-BR      -> recupera
 *   movie 102   sem sinopse · payload SO com en                     -> nao recupera
 *   movie 103   sem sinopse · payload SO com pt-PT                  -> mede (Item E)
 *   movie 104   sem sinopse · NENHUM payload guardado               -> no_stored_payload
 *   movie 105   JA TEM sinopse · payload com pt-BR diferente        -> nao sobrescreve
 *   movie 106   sem sinopse · payload so em `tmdb_raw` (sem cache)  -> recupera
 *   tv   301    sem sinopse · payload com pt-BR                     -> recupera (CASCATA)
 *   season 401  da serie 301, com sinopse e 1 episodio
 *   episode 501 da season 401, COM sinopse
 *   person 201  credito + foto + bio VAZIA · payload com pt-BR      -> preenche a bio
 */
async function seedPequeno(prisma: PrismaClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql)
  const json = (v: unknown) => JSON.stringify(v).replace(/'/g, "''")

  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`)
  await run(`INSERT INTO api_providers (key, name, kind)
             VALUES ('tmdb','TMDB','data') ON CONFLICT (key) DO NOTHING`)

  await run(`INSERT INTO movies (id, tmdb_id, title_original, poster_path, updated_at) VALUES
             (101, 80101, 'Filme Recuperavel', '/p101.jpg', now()),
             (102, 80102, 'Filme So Em Ingles', '/p102.jpg', now()),
             (103, 80103, 'Filme So Em Portugues Europeu', '/p103.jpg', now()),
             (104, 80104, 'Filme Sem Payload', '/p104.jpg', now()),
             (105, 80105, 'Filme Que Ja Tem Sinopse', '/p105.jpg', now()),
             (106, 80106, 'Filme So No Tmdb Raw', '/p106.jpg', now())`)
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, poster_path, updated_at) VALUES
             (301, 80301, 'Serie Recuperavel', '/p301.jpg', now())`)
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, name, overview, poster_path, updated_at) VALUES
             (401, 301, 1, 'Temporada 1', 'Sinopse da temporada.', '/s401.jpg', now())`)
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, overview, still_path, updated_at) VALUES
             (501, 401, 301, 1, 'Episodio 1', 'Sinopse do episodio.', '/e501.jpg', now())`)
  await run(`INSERT INTO people (id, tmdb_id, name, profile_path, biography, updated_at) VALUES
             (201, 80201, 'Pessoa Sem Bio', '/f201.jpg', NULL, now())`)
  await run(`INSERT INTO cast_members (entity_type, entity_id, person_id, billing_order, character, updated_at)
             VALUES ('movie', 101, 201, 1, 'Protagonista', now())`)

  // Ids explicitos NAO avancam o `bigserial`: sem isto, o INSERT em massa mais
  // abaixo colide em `id=101`. Erro do fixture, nao do codigo sob teste — mas
  // um que custa uma execucao inteira do validador para descobrir.
  await run(`SELECT setval(pg_get_serial_sequence('movies','id'), 1000)`)
  await run(`SELECT setval(pg_get_serial_sequence('entity_translations','id'),
                           (SELECT COALESCE(MAX(id), 0) + 1 FROM entity_translations))`)

  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-recuperavel', true, now()),
             ('movie', 102, 'pt-BR', 'filme-so-em-ingles', true, now()),
             ('movie', 103, 'pt-BR', 'filme-so-pt-pt', true, now()),
             ('movie', 104, 'pt-BR', 'filme-sem-payload', true, now()),
             ('movie', 105, 'pt-BR', 'filme-com-sinopse', true, now()),
             ('movie', 106, 'pt-BR', 'filme-so-no-raw', true, now()),
             ('tv', 301, 'pt-BR', 'serie-recuperavel', true, now()),
             ('person', 201, 'pt-BR', 'pessoa-sem-bio', true, now())`)

  // Traducoes SEM summary: a linha existe (senao a politica para em
  // `missing_translation` e o teste mediria outro gate), o texto e que falta.
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'Filme Recuperavel', NULL, now()),
             ('movie', 102, 'pt-BR', 'Filme So Em Ingles', NULL, now()),
             ('movie', 103, 'pt-BR', 'Filme So Em Portugues Europeu', NULL, now()),
             ('movie', 104, 'pt-BR', 'Filme Sem Payload', NULL, now()),
             ('movie', 105, 'pt-BR', 'Filme Que Ja Tem Sinopse', 'Sinopse que ja estava la.', now()),
             ('movie', 106, 'pt-BR', 'Filme So No Tmdb Raw', NULL, now()),
             ('tv', 301, 'pt-BR', 'Serie Recuperavel', NULL, now()),
             ('person', 201, 'pt-BR', 'Pessoa Sem Bio', NULL, now())`)

  const cache = (endpoint: string, payload: unknown, chave: string) =>
    run(`INSERT INTO api_cache (provider_api, endpoint, request_key, params_hash, payload, payload_hash, fetched_at)
         VALUES ('tmdb', '${endpoint}', '${endpoint}?append_to_response=external_ids,credits',
                 '${chave}', '${json(payload)}'::jsonb, '${chave}', now())`)

  const PT_BR_FILME = traducao('pt', 'BR', { title: 'Filme', overview: SINOPSE_RECUPERAVEL })
  const EN_US_FILME = traducao('en', 'US', { title: 'Movie', overview: 'An English synopsis.' })
  const PT_PT_FILME = traducao('pt', 'PT', { title: 'Filme', overview: SINOPSE_EUROPEIA })

  await cache('/movie/80101', payloadFilme(80101, [EN_US_FILME, PT_BR_FILME]), 'h80101')
  await cache('/movie/80102', payloadFilme(80102, [EN_US_FILME]), 'h80102')
  await cache('/movie/80103', payloadFilme(80103, [EN_US_FILME, PT_PT_FILME]), 'h80103')
  // 104: nenhum payload, de proposito.
  await cache(
    '/movie/80105',
    payloadFilme(80105, [traducao('pt', 'BR', { overview: 'Texto NOVO que nao deve entrar.' })]),
    'h80105',
  )
  await cache('/tv/80301', payloadSerie(80301, [EN_US_FILME, PT_BR_FILME]), 'h80301')
  await cache(
    '/person/80201',
    {
      id: 80201,
      name: 'Pessoa Sem Bio',
      biography: '',
      translations: {
        translations: [
          traducao('en', 'US', { biography: 'An English biography.' }),
          traducao('pt', 'BR', { biography: BIO_RECUPERAVEL }),
        ],
      },
    },
    'h80201',
  )

  // 106 SO em `tmdb_raw` — prova a segunda origem de payload.
  await run(`INSERT INTO tmdb_raw (entity_type, tmdb_id, base_language, payload, payload_hash, fetched_at, updated_at)
             VALUES ('movie', 80106, 'pt-BR', '${json(payloadFilme(80106, [PT_BR_FILME]))}'::jsonb, 'r80106', now(), now())`)
}

/** Conta linhas de uma consulta escalar. */
async function escalar(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(sql)
  return Number(rows[0]?.n ?? 0)
}

/** Texto de uma traducao (ou null). */
async function sinopseDe(
  prisma: PrismaClient,
  entityType: string,
  entityId: number,
): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<{ summary: string | null }[]>(
    `SELECT summary FROM entity_translations
      WHERE entity_type = '${entityType}'::"EntityType" AND entity_id = ${entityId}
        AND language_code = '${LANGUAGE}'`,
  )
  return rows[0]?.summary ?? null
}

/** Veredito vigente de uma entidade (ou null). */
async function veredito(
  prisma: PrismaClient,
  entityType: string,
  entityId: number,
): Promise<{ decision: string; reason: string | null } | null> {
  const rows = await prisma.$queryRawUnsafe<{ decision: string; reason: string | null }[]>(
    `SELECT decision::text AS decision, reason FROM page_indexability_decisions
      WHERE entity_type = '${entityType}'::"EntityType" AND entity_id = ${entityId}
        AND language_code = '${LANGUAGE}' AND is_current`,
  )
  return rows[0] ?? null
}

/** Roda o produtor com o freio afrouxado (aqui se mede o CENSO, nao o freio). */
async function produzir(
  prisma: PrismaClient,
  opts: {
    dryRun: boolean
    limit?: number
    types?: readonly ('movie' | 'tv' | 'season' | 'episode' | 'person')[]
  },
) {
  return produceIndexabilityDecisions(prisma, {
    language: LANGUAGE,
    ...(opts.types !== undefined ? { entityTypes: opts.types } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    dryRun: opts.dryRun,
    now: () => new Date(),
    confirmMassChange: true,
    massChangeThresholds: { maxFlips: 1_000_000, maxFlipRatio: 1 },
  })
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await seedPequeno(prisma)

    // ---- (A) LINHA DE BASE: o veredito ANTES da recuperacao ---------------
    await produzir(prisma, { dryRun: false, types: ['movie', 'tv', 'season', 'episode', 'person'] })
    const antesFilme = await veredito(prisma, 'movie', 101)
    const antesSerie = await veredito(prisma, 'tv', 301)
    const antesTemporada = await veredito(prisma, 'season', 401)
    const antesEpisodio = await veredito(prisma, 'episode', 501)

    record(
      'LINHA DE BASE: o filme 101 esta noindex por `no_synopsis`',
      antesFilme?.decision === 'noindex' && antesFilme.reason === 'no_synopsis',
      `movie#101 -> ${antesFilme?.decision}/${antesFilme?.reason}`,
    )
    record(
      'LINHA DE BASE: a serie 301 esta noindex por `no_synopsis`',
      antesSerie?.decision === 'noindex' && antesSerie.reason === 'no_synopsis',
      `tv#301 -> ${antesSerie?.decision}/${antesSerie?.reason}`,
    )
    record(
      'LINHA DE BASE (CASCATA): temporada e episodio caem por `parent_not_publishable`',
      antesTemporada?.reason === 'parent_not_publishable' &&
        antesEpisodio?.reason === 'parent_not_publishable',
      `season#401 -> ${antesTemporada?.reason} · episode#501 -> ${antesEpisodio?.reason}`,
    )
    // CONTROLE POSITIVO: sem ele, um fixture quebrado deixaria tudo `noindex` e
    // toda mudanca medida abaixo seria vacua.
    record(
      'CONTROLE POSITIVO: o filme 105, que JA tem sinopse, esta `index`',
      (await veredito(prisma, 'movie', 105))?.decision === 'index',
      `movie#105 -> ${(await veredito(prisma, 'movie', 105))?.decision}`,
    )

    // ---- (B) O BACKFILL EM DRY-RUN nao escreve ---------------------------
    const seco = await backfillMissingText(prisma, { language: LANGUAGE, dryRun: true })
    record(
      '--dry-run do backfill nao grava nada (e ainda assim MEDE)',
      seco.written === 0 && seco.recovered > 0 && (await sinopseDe(prisma, 'movie', 101)) === null,
      `recuperaveis=${seco.recovered} · gravados=${seco.written} · summary(101)=${await sinopseDe(prisma, 'movie', 101)}`,
    )
    record(
      'o backfill declara ZERO chamadas ao TMDB',
      seco.externalCallsMade === 0,
      `externalCallsMade=${seco.externalCallsMade}`,
    )

    // ---- (C) O BACKFILL APLICADO -----------------------------------------
    const aplicado = await backfillMissingText(prisma, { language: LANGUAGE, dryRun: false })

    record(
      'FILME: a sinopse sai do bloco `translations` e chega em entity_translations',
      (await sinopseDe(prisma, 'movie', 101)) === SINOPSE_RECUPERAVEL,
      `summary(101)=${String(await sinopseDe(prisma, 'movie', 101)).slice(0, 60)}`,
    )
    record(
      'SERIE: idem (a serie e o maior balde do censo real)',
      (await sinopseDe(prisma, 'tv', 301)) === SINOPSE_RECUPERAVEL,
      `summary(301)=${String(await sinopseDe(prisma, 'tv', 301)).slice(0, 60)}`,
    )
    record(
      'payload guardado SO em `tmdb_raw` tambem e lido',
      (await sinopseDe(prisma, 'movie', 106)) === SINOPSE_RECUPERAVEL &&
        aplicado.byPayloadSource.tmdb_raw === 1,
      `summary(106)=${String(await sinopseDe(prisma, 'movie', 106)).slice(0, 40)} · byPayloadSource=${JSON.stringify(aplicado.byPayloadSource)}`,
    )
    record(
      'PESSOA: a biografia sai do bloco e chega em people.biography',
      (await escalar(
        prisma,
        `SELECT COUNT(*)::int AS n FROM people WHERE id = 201 AND biography = '${BIO_RECUPERAVEL.replace(/'/g, "''")}'`,
      )) === 1,
      'people#201.biography preenchida',
    )
    record(
      'so `en` no bloco -> NAO recupera (nao ha fallback de idioma)',
      (await sinopseDe(prisma, 'movie', 102)) === null,
      `summary(102)=${await sinopseDe(prisma, 'movie', 102)}`,
    )
    record(
      'so `pt-PT` -> NAO recupera, mas E MEDIDO (Item E)',
      (await sinopseDe(prisma, 'movie', 103)) === null &&
        aplicado.recoverableOnlyWithPtPt === 1 &&
        aplicado.ptPtSamples[0]?.text === SINOPSE_EUROPEIA,
      `summary(103)=${await sinopseDe(prisma, 'movie', 103)} · soPtPt=${aplicado.recoverableOnlyWithPtPt}`,
    )
    record(
      'sem payload guardado -> classificado `no_stored_payload`, nao inventado',
      (await sinopseDe(prisma, 'movie', 104)) === null &&
        (aplicado.skipped.no_stored_payload ?? 0) === 1,
      `skipped=${JSON.stringify(aplicado.skipped)}`,
    )
    record(
      'NAO SOBRESCREVE: o filme 105 mantem a sinopse que ja tinha',
      (await sinopseDe(prisma, 'movie', 105)) === 'Sinopse que ja estava la.',
      `summary(105)=${await sinopseDe(prisma, 'movie', 105)}`,
    )
    // ATENCAO — o check acima passa por VACUIDADE se lido sozinho: o filme 105
    // nunca entrou no conjunto de candidatos (ele JA tem sinopse), entao a
    // instrucao com `ON CONFLICT` nao chegou a rodar sobre ele. O que o guard
    // protege e a CORRIDA, e ela so se prova chamando a escrita diretamente.
    const recusada = await writeSynopsisIfEmpty(
      prisma,
      'movie',
      105n,
      LANGUAGE,
      'Titulo',
      'TEXTO QUE NAO PODE ENTRAR',
    )
    record(
      'ON CONFLICT ... WHERE: a escrita sobre texto EXISTENTE e recusada pelo PostgreSQL',
      recusada === 0 && (await sinopseDe(prisma, 'movie', 105)) === 'Sinopse que ja estava la.',
      `linhas afetadas=${recusada} · summary(105)=${await sinopseDe(prisma, 'movie', 105)}`,
    )
    // CONTROLE POSITIVO do guard: sobre linha com summary VAZIO ele escreve.
    // Sem esta linha, uma funcao quebrada devolveria 0 sempre e "provaria" o
    // check acima pelo motivo errado.
    const aceita = await writeSynopsisIfEmpty(
      prisma,
      'movie',
      102n,
      LANGUAGE,
      'Titulo',
      'TEXTO DE CONTROLE',
    )
    record(
      'CONTROLE POSITIVO do guard: sobre summary VAZIO a mesma escrita passa',
      aceita === 1 && (await sinopseDe(prisma, 'movie', 102)) === 'TEXTO DE CONTROLE',
      `linhas afetadas=${aceita}`,
    )
    // E o ramo de INSERT puro: entidade SEM linha de traducao nenhuma.
    await prisma.$executeRawUnsafe(
      `INSERT INTO movies (id, tmdb_id, title_original, poster_path, updated_at)
       VALUES (107, 80107, 'Filme Sem Linha De Traducao', '/p107.jpg', now())`,
    )
    const inserida = await writeSynopsisIfEmpty(
      prisma,
      'movie',
      107n,
      LANGUAGE,
      'Filme Sem Linha De Traducao',
      'TEXTO INSERIDO DO ZERO',
    )
    record(
      'o ramo de INSERT (sem linha de traducao) cria a linha com titulo e sinopse',
      inserida === 1 && (await sinopseDe(prisma, 'movie', 107)) === 'TEXTO INSERIDO DO ZERO',
      `linhas afetadas=${inserida}`,
    )
    const bioRecusada = await writeBiographyIfEmpty(prisma, 201n, 'BIO QUE NAO PODE ENTRAR')
    record(
      'o guard da BIOGRAFIA tambem recusa (a linha ja tem texto apos o backfill)',
      bioRecusada === 0,
      `linhas afetadas=${bioRecusada}`,
    )
    // Desfaz os textos de controle para nao contaminar os checks de veredito.
    await prisma.$executeRawUnsafe(
      `UPDATE entity_translations SET summary = NULL
        WHERE entity_type = 'movie'::"EntityType" AND entity_id IN (102, 107)`,
    )
    record(
      'a proveniencia e registrada (veio do BLOCO, nao do campo de topo)',
      aplicado.bySource.translations === aplicado.recovered && aplicado.bySource.detail === 0,
      `bySource=${JSON.stringify(aplicado.bySource)}`,
    )

    // ---- (D) IDEMPOTENCIA POR ON CONFLICT --------------------------------
    const segunda = await backfillMissingText(prisma, { language: LANGUAGE, dryRun: false })
    record(
      'a SEGUNDA execucao nao grava nada, e o conjunto de candidatos ENCOLHEU',
      segunda.written === 0 && segunda.candidates < aplicado.candidates,
      `written=${segunda.written} · candidatos ${aplicado.candidates} -> ${segunda.candidates}` +
        ` · recusadas=${segunda.refusedExistingText}`,
    )
    record(
      'e o texto no banco continua o mesmo (nao houve churn)',
      (await sinopseDe(prisma, 'movie', 101)) === SINOPSE_RECUPERAVEL,
      'summary(101) inalterada',
    )

    // ---- (E) O VEREDITO MUDA (F.3) ---------------------------------------
    await produzir(prisma, { dryRun: false, types: ['movie', 'tv', 'season', 'episode', 'person'] })
    const depoisFilme = await veredito(prisma, 'movie', 101)
    record(
      'F.3 — o filme 101 sai de `no_synopsis` e entra em `index`/`eligible`',
      depoisFilme?.decision === 'index' && depoisFilme.reason === 'eligible',
      `movie#101: ${antesFilme?.reason} -> ${depoisFilme?.decision}/${depoisFilme?.reason}`,
    )
    record(
      'o filme 102 (so ingles) CONTINUA noindex — a mudanca nao foi generalizada',
      (await veredito(prisma, 'movie', 102))?.reason === 'no_synopsis',
      `movie#102 -> ${(await veredito(prisma, 'movie', 102))?.reason}`,
    )

    // ---- (F) A CASCATA (F.4) ---------------------------------------------
    const depoisSerie = await veredito(prisma, 'tv', 301)
    const depoisTemporada = await veredito(prisma, 'season', 401)
    const depoisEpisodio = await veredito(prisma, 'episode', 501)
    record(
      'F.4 — recuperar a SERIE devolve a temporada ao indice (cascata)',
      depoisSerie?.decision === 'index' && depoisTemporada?.decision === 'index',
      `tv#301 -> ${depoisSerie?.decision} · season#401: ${antesTemporada?.reason} -> ${depoisTemporada?.decision}/${depoisTemporada?.reason}`,
    )
    record(
      'F.4 — e o EPISODIO junto (e aqui que moram 116.004 paginas em producao)',
      depoisEpisodio?.decision === 'index',
      `episode#501: ${antesEpisodio?.reason} -> ${depoisEpisodio?.decision}/${depoisEpisodio?.reason}`,
    )

    // ---- (G) A BIOGRAFIA NAO BASTA: a licenca continua sendo o gate -------
    // Isto NAO e um defeito deste backfill — e o limite dele, e precisa estar
    // provado para ninguem contar 32.087 paginas recuperadas que nao mudaram.
    const pessoaDepois = await veredito(prisma, 'person', 201)
    record(
      'PESSOA: bio preenchida e MESMO ASSIM `no_biography` — a licenca e o gate',
      pessoaDepois?.decision === 'noindex' && pessoaDepois.reason === 'no_biography',
      `person#201 -> ${pessoaDepois?.decision}/${pessoaDepois?.reason} (biography_source_status segue 'unknown')`,
    )
    record(
      'CONTROLE: liberando a licenca a MESMA pessoa passa a indexar',
      await (async () => {
        await prisma.$executeRawUnsafe(
          `UPDATE people SET biography_source_status = 'third_party' WHERE id = 201`,
        )
        await produzir(prisma, { dryRun: false, types: ['person'] })
        return (await veredito(prisma, 'person', 201))?.decision === 'index'
      })(),
      'com `third_party` o texto recuperado passa a contar',
    )

    // ---- (H) O TETO DO CENSO (A.6) ---------------------------------------
    console.log(`\n--- semeando ${FILMES_EM_MASSA} filmes para medir o teto do censo ---`)
    await prisma.$executeRawUnsafe(
      `INSERT INTO movies (tmdb_id, title_original, poster_path, updated_at)
       SELECT 900000 + i, 'Filme Em Massa ' || i, '/m.jpg', now()
         FROM generate_series(1, ${FILMES_EM_MASSA - 7}) AS i`,
    )
    const filmesNoBanco = await escalar(prisma, `SELECT COUNT(*)::int AS n FROM movies`)
    record(
      `CONTROLE POSITIVO: ha ${FILMES_EM_MASSA} filmes no banco (um a mais que o teto antigo)`,
      filmesNoBanco === FILMES_EM_MASSA,
      `movies=${filmesNoBanco}`,
    )

    const censoCompleto = await produzir(prisma, { dryRun: true, types: ['movie'] })
    record(
      'A.3/A.4 — sem teto, o censo soma o TOTAL REAL (nao para no primeiro lote)',
      censoCompleto.byEntityType.movie?.evaluated === FILMES_EM_MASSA,
      `evaluated=${String(censoCompleto.byEntityType.movie?.evaluated)} (esperado ${FILMES_EM_MASSA})`,
    )
    record(
      'A.2 — e ele se declara COMPLETO (`truncatedTypes` vazio)',
      censoCompleto.truncatedTypes.length === 0 &&
        censoCompleto.byEntityType.movie?.truncated === false,
      `truncatedTypes=${JSON.stringify(censoCompleto.truncatedTypes)} · truncated=${String(censoCompleto.byEntityType.movie?.truncated)}`,
    )

    // CONTROLE NEGATIVO DO ITEM A: o teto antigo, agora EXPLICITO. Ele continua
    // produzindo o numero errado — e essa e a prova de que o defeito era real.
    // A diferenca e que agora o numero vem ROTULADO como piso.
    const censoTruncado = await produzir(prisma, { dryRun: true, types: ['movie'], limit: 100_000 })
    record(
      'CONTROLE NEGATIVO — com --limit 100000 (o default antigo) o censo perde a ultima linha',
      censoTruncado.byEntityType.movie?.evaluated === 100_000,
      `evaluated=${String(censoTruncado.byEntityType.movie?.evaluated)} · no banco ha ${FILMES_EM_MASSA}`,
    )
    record(
      'A.2 — e AGORA ele se declara TRUNCADO em vez de passar por medicao',
      censoTruncado.truncatedTypes.includes('movie') &&
        censoTruncado.byEntityType.movie?.truncated === true,
      `truncatedTypes=${JSON.stringify(censoTruncado.truncatedTypes)}`,
    )
    // O CASO DE FRONTEIRA. `--limit` IGUAL ao numero de linhas leu o tipo
    // INTEIRO — reportar isso como truncado faria o operador desconfiar de um
    // censo completo. E a diferenca entre "bateu no teto" e "deixou linha para
    // tras", que so uma sonda de uma linha a mais consegue distinguir.
    const censoNoLimite = await produzir(prisma, {
      dryRun: true,
      types: ['movie'],
      limit: FILMES_EM_MASSA,
    })
    record(
      '--limit IGUAL ao total NAO e truncamento (o tipo foi lido inteiro)',
      censoNoLimite.byEntityType.movie?.evaluated === FILMES_EM_MASSA &&
        censoNoLimite.truncatedTypes.length === 0,
      `evaluated=${String(censoNoLimite.byEntityType.movie?.evaluated)} · truncatedTypes=${JSON.stringify(censoNoLimite.truncatedTypes)}`,
    )
    record(
      'o DENOMINADOR do freio muda junto (era o efeito invisivel do teto)',
      censoTruncado.massChange.evaluated === 100_000 &&
        censoCompleto.massChange.evaluated === FILMES_EM_MASSA,
      `freio truncado=${censoTruncado.massChange.evaluated} · completo=${censoCompleto.massChange.evaluated}`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const external = externalDatabaseUrl()
  if (external !== null) {
    console.log('[info] usando CINERIE_VALIDATOR_DATABASE_URL (cluster externo, loopback).')
    try {
      execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
        env: { ...process.env, DATABASE_URL: external },
        stdio: 'inherit',
        cwd: dbDir,
      })
      record('migrate deploy aplica do zero', true, 'ok')
      await runChecks(external)
    } catch (error) {
      record(
        'execucao sem excecao',
        false,
        error instanceof Error ? error.message.split('\n').join(' ').slice(0, 300) : String(error),
      )
      if (error instanceof Error && error.stack) console.error(error.stack)
    }
    console.log(`\nRESUMO: ${passed}/${total} checks OK`)
    process.exitCode = passed === total ? 0 : 1
    return
  }

  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-text-recovery-pg-'))
  // SEM `initdbFlags`: o cluster default sobe no checkout acentuado; quem morre
  // ali e `--encoding=UTF8`. Os fixtures deste validador sao ASCII de proposito,
  // entao a codificacao do cluster nao entra na medida.
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_text_recovery`
  let started = false

  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_text_recovery')

    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
      cwd: dbDir,
    })
    record('migrate deploy aplica do zero', true, 'ok')

    await runChecks(url)
  } catch (error) {
    record(
      'execucao sem excecao',
      false,
      error instanceof Error ? error.message.split('\n').join(' ').slice(0, 300) : String(error),
    )
    if (error instanceof Error && error.stack) console.error(error.stack)
  } finally {
    if (started) {
      try {
        await pg.stop()
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 })
    } catch {
      /* o SO limpa */
    }
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK`)
  process.exitCode = passed === total ? 0 : 1
}

void main()
