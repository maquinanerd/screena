/**
 * validate-stores-real-postgres.ts — Teste de INTEGRACAO dos stores REAIS de
 * streaming contra PostgreSQL 16 efemero (Prompt 2, 2a revisao de banco, §3.3).
 *
 * Nao testa SQL sintetico: exercita os adapters Prisma de verdade
 * (`createPrismaWatchStore`, `createPrismaReviewStore`) sobre um banco com a
 * migration da Fase 2 aplicada — o mesmo trigger permanente e as mesmas funcoes
 * de identidade/payload que a producao usaria.
 *
 * Ferramenta DESCARTAVEL (nunca em produto/render/prod). Motor: embedded-postgres
 * (PostgreSQL 16 real, efemero). Sem segredo; instancia derrubada no finally.
 *
 * Uso: pnpm --filter @screena/streaming validate:stores
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'
import { PrismaClient } from '@prisma/client'

import { STREAMING_AVAILABILITY_ATTRIBUTION_URL } from '@screena/streaming-availability-client'

import { STREAMING_AUTO_REVIEWER, createPrismaWatchStore } from '../src/persistence/watch-store.js'
import { createPrismaWatchCreditLookup } from '../src/persistence/watch-credit-lookup.js'
import { createPrismaReviewStore } from '../src/persistence/watch-review-store.js'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..', '..')
const dbDir = path.join(repoRoot, 'packages', 'db')
const schemaPath = path.join(dbDir, 'prisma', 'schema.prisma')

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = []
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}. ${name} — ${detail}`)
}

/**
 * Reserva um numero de porta livre e DEVOLVE A PORTA JA DESOCUPADA.
 *
 * O `close` ANTES do `resolve` nao e higiene — e a correcao de um defeito. A
 * versao anterior resolvia dentro do callback do `listen` e so entao chamava
 * `close()`: quem recebia a porta podia tentar bindar antes de o socket de
 * sondagem ter saido, e o Postgres efemero colidia com o proprio script.
 * `unref()` nao ajuda — tira o handle da contagem do event loop, mas a porta
 * continua ocupada.
 *
 * Mesmo defeito ja corrigido em `apps/cms/src/__tests__/harness.ts` e em
 * `services/news-ingestion/src/__tests__/screen-db-harness.ts`; aqui ele havia
 * sobrevivido porque este script e de execucao manual e nao passa pela CI. O
 * `host` explicito importa: sem ele, `listen(0)` binda em `::` cobrindo o par
 * IPv4+IPv6, e no runner Linux o Postgres falha em `::1` E em `127.0.0.1`.
 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0

      // Porta 0 aqui significa que o endereco nao veio como esperado. Devolver
      // esse zero adiante faria o Postgres escolher uma porta que o script nao
      // conhece, e a falha apareceria longe da causa.
      if (port <= 0) {
        srv.close(() => {
          reject(new Error('nao foi possivel reservar uma porta TCP valida'))
        })
        return
      }

      srv.close((error) => {
        if (error !== undefined) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
}

/** Uma oferta de sync (formato WatchOfferRow), com defaults sensatos. */
function offer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entityType: 'movie',
    entityId: '', // preenchido no main com o movieId real
    countryCode: 'BR',
    providerKey: 'netflix',
    providerName: 'Netflix',
    offerType: 'subscription',
    deepLink: 'https://netflix/x',
    // Explicitos (e nao `undefined` por omissao): estes tres entram na CHAVE DE
    // IDENTIDADE da oferta. Deixa-los ausentes faz o adapter interpolar
    // `undefined` no `watch_offer_identity_key_v1`, e o alvo do UPDATE deixaria
    // de ser deterministico.
    externalOfferId: null,
    webUrl: null,
    package: null,
    price: null,
    currency: null,
    quality: 'hd',
    availableFrom: null,
    availableUntil: null,
    ...overrides,
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'screena-stores-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/screena_stores?schema=public`
  console.log(`\n=== stores integration — Postgres efemero :${port} ===\n`)

  let started = false
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('screena_stores')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })

    // Referencia minima + um filme real (a FK de entities exige entidade real).
    await prisma.$executeRawUnsafe(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default) VALUES ('pt-BR','Portugues','Portuguese',true,true)`)
    await prisma.$executeRawUnsafe(`INSERT INTO countries (code, name_pt, name_en) VALUES ('BR','Brasil','Brazil')`)
    // provider_api virou FK real para api_providers (Backend B): fornecedor
    // fantasma nao entra mais. O sync grava 'streaming_availability'.
    await prisma.$executeRawUnsafe(`INSERT INTO api_providers (key, name, kind) VALUES ('streaming_availability','Streaming Availability (RapidAPI)','streaming')`)
    const movie = await prisma.$queryRawUnsafe<Array<{ id: bigint }>>(`INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (800001,'Store Movie',now()) RETURNING id`)
    const movieId = movie[0]!.id.toString()

    // Cadeia de governanca do Backend B para a Netflix (o unico provedor com
    // alias mapeado neste cenario). A oferta 'max' fica DELIBERADAMENTE sem
    // alias, para provar que oferta de provedor nao-canonico nao promove.
    // Convencao: source_licenses.source_key = watch_providers.slug quando
    // content_type='watch_availability'.
    await prisma.$executeRawUnsafe(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('netflix','Netflix','https://www.netflix.com/', now())`)
    await prisma.$executeRawUnsafe(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id,'streaming_availability','netflix','Netflix', now() FROM watch_providers WHERE slug='netflix'`)
    await prisma.$executeRawUnsafe(`INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at) VALUES ('netflix','watch_availability','streaming_availability','BR','official',true,true,true,'Movie of the Night',true,'ana@screen',now(),'validation/v1',now())`)
    await prisma.$executeRawUnsafe(`INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at) SELECT id,'watch_offer_display','BR','approved_for_display',true,true,true,true,'validation/v1','ana@screen','cenario de validacao dos stores', now() FROM source_licenses WHERE source_key='netflix' AND content_type='watch_availability'`)

    const watchStore = createPrismaWatchStore(prisma as never)
    const reviewStore = createPrismaReviewStore(prisma as never)
    const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql)
    const fetched1 = new Date('2026-07-15T10:00:00.000Z')
    const stale1 = new Date('2026-07-16T10:00:00.000Z')

    // 1. sync inicial cria ofertas com display_allowed=false.
    const r1 = await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId }), offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' })],
      fetchedAt: fetched1, staleAfter: stale1,
    } as never)
    const afterSync1 = (await q<{ c: number; d: number }>(`SELECT count(*)::int AS c, count(*) FILTER (WHERE display_allowed)::int AS d FROM watch_availability WHERE entity_id=${movieId}`))[0]!
    record(1, 'sync inicial cria ofertas com display_allowed=false', afterSync1.c === 2 && afterSync1.d === 0, `linhas=${afterSync1.c}, display=${afterSync1.d}, created=${r1.created}`)

    // 2. segundo sync IDENTICO nao duplica (mesma identidade).
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId }), offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' })],
      fetchedAt: new Date('2026-07-15T11:00:00.000Z'), staleAfter: stale1,
    } as never)
    const afterSync2 = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM watch_availability WHERE entity_id=${movieId}`))[0]!.c)
    record(2, 'segundo sync identico nao duplica (upsert por identidade)', afterSync2 === 2, `linhas=${afterSync2}`)

    // Descobre o id da oferta Netflix (governanca sera setada nela).
    const netflixId = (await q<{ id: bigint }>(`SELECT id FROM watch_availability WHERE entity_id=${movieId} AND provider_key='netflix'`))[0]!.id.toString()

    // 3. promocao SEM revisor lanca (identidade humana obrigatoria).
    let noReviewerThrew = false
    try { await reviewStore.promote([netflixId], '   ') } catch { noReviewerThrew = true }
    record(3, 'promocao sem revisor humano lanca (reviewed_by obrigatorio)', noReviewerThrew, `threw=${noReviewerThrew}`)

    // 4. promocao de oferta INCOMPLETA (sem licenca/atribuicao) nao promove (fail-closed).
    const incomplete = await reviewStore.promote([netflixId], 'ana@screen')
    const netflixDisplayA = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${netflixId}`))[0]!.display_allowed
    record(4, 'promocao de oferta sem licenca/atribuicao e fail-closed (nao promove)', incomplete.updated === 0 && netflixDisplayA === false, `updated=${incomplete.updated}, display=${netflixDisplayA}`)

    // Governanca minima (passo humano simulado): licenca + atribuicao.
    await prisma.$executeRawUnsafe(`UPDATE watch_availability SET license_status='official', attribution_text='Movie of the Night', attribution_url='https://motn/x', requires_attribution=true, requires_linkback=true WHERE id=${netflixId}`)

    // 5. promocao GOVERNADA: display=true + reviewed_by + approved_payload_hash.
    const promoted = await reviewStore.promote([netflixId], 'ana@screen')
    const netflixRow = (await q<{ display_allowed: boolean; reviewed_by: string | null; approved_payload_hash: string | null }>(`SELECT display_allowed, reviewed_by, approved_payload_hash FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(5, 'promocao governada liga display + grava reviewed_by + approved_payload_hash', promoted.updated === 1 && netflixRow.display_allowed === true && netflixRow.reviewed_by === 'ana@screen' && netflixRow.approved_payload_hash !== null, `updated=${promoted.updated}, display=${netflixRow.display_allowed}, revisor=${netflixRow.reviewed_by}`)

    // 6. sync com PAYLOAD alterado (nova qualidade) na MESMA oferta -> revoga
    //    a aprovacao (subscription nao pode ter preco; qualidade e payload valido).
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [
        offer({ entityId: movieId, quality: '4k' }), // Netflix, quality mudou -> payload mudou
        offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' }),
      ],
      fetchedAt: new Date('2026-07-15T12:00:00.000Z'), staleAfter: stale1,
    } as never)
    const netflixAfterChange = (await q<{ display_allowed: boolean; quality: string | null }>(`SELECT display_allowed, quality FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(6, 'mudanca de payload (qualidade) revoga a aprovacao no sync (display volta false)', netflixAfterChange.display_allowed === false && netflixAfterChange.quality === '4k', `display=${netflixAfterChange.display_allowed}, quality=${netflixAfterChange.quality}`)

    // 7. oferta que SUMIU do snapshot -> revogada + stale, NAO apagada.
    await watchStore.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [offer({ entityId: movieId, quality: '4k' })], // so Netflix; Max sumiu
      fetchedAt: new Date('2026-07-15T13:00:00.000Z'), staleAfter: stale1,
    } as never)
    const maxRow = (await q<{ c: number; display_allowed: boolean; stale_after: Date | null }>(`SELECT count(*)::int AS c, bool_or(display_allowed) AS display_allowed, max(stale_after) AS stale_after FROM watch_availability WHERE entity_id=${movieId} AND provider_key='max'`))[0]!
    record(7, 'oferta sumida do snapshot: revogada + stale, NAO apagada', maxRow.c === 1 && maxRow.display_allowed === false && maxRow.stale_after !== null, `linhas=${maxRow.c}, display=${maxRow.display_allowed}, stale=${maxRow.stale_after !== null}`)

    // 8. o BANCO rejeita display_allowed=true com hash invalido (trigger permanente).
    let dbRejected = false
    try { await prisma.$executeRawUnsafe(`UPDATE watch_availability SET display_allowed=true, approved_payload_hash='HASH_FALSO', reviewed_at=now(), reviewed_by='x' WHERE id=${netflixId}`) } catch { dbRejected = true }
    record(8, 'banco rejeita display_allowed=true com hash invalido (trigger permanente)', dbRejected, `rejected=${dbRejected}`)

    // --- Backend B ---

    // 9. a promocao resolve o provedor CANONICO pelo alias e anexa a decisao de
    //    uso vigente. Repromove a Netflix (foi revogada no check 6 pela mudanca
    //    de payload) e confere os dois elos novos.
    const repromoted = await reviewStore.promote([netflixId], 'ana@screen')
    const netflixGov = (await q<{ display_allowed: boolean; watch_provider_id: bigint | null; data_usage_decision_id: bigint | null }>(
      `SELECT display_allowed, watch_provider_id, data_usage_decision_id FROM watch_availability WHERE id=${netflixId}`,
    ))[0]!
    record(9, 'promocao resolve provedor canonico (alias) e anexa DataUsageDecision vigente',
      repromoted.updated === 1 && netflixGov.display_allowed === true
        && netflixGov.watch_provider_id !== null && netflixGov.data_usage_decision_id !== null,
      `updated=${repromoted.updated}, display=${netflixGov.display_allowed}, provider=${netflixGov.watch_provider_id !== null}, decisao=${netflixGov.data_usage_decision_id !== null}`)

    // 10. oferta de provedor SEM alias mapeado nao promove (fail-closed). A 'max'
    //     nunca recebeu alias: mesmo com licenca/atribuicao completas ela nao pode
    //     virar publica, porque a vitrine so nomeia provedor canonico conhecido.
    const maxId = (await q<{ id: bigint }>(`SELECT id FROM watch_availability WHERE entity_id=${movieId} AND provider_key='max'`))[0]!.id.toString()
    await prisma.$executeRawUnsafe(`UPDATE watch_availability SET license_status='official', attribution_text='Movie of the Night', attribution_url='https://motn/x' WHERE id=${maxId}`)
    const maxPromotion = await reviewStore.promote([maxId], 'ana@screen')
    const maxDisplay = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${maxId}`))[0]!.display_allowed
    record(10, 'oferta de provedor sem alias canonico nao promove (fail-closed)',
      maxPromotion.updated === 0 && maxDisplay === false,
      `updated=${maxPromotion.updated}, display=${maxDisplay}`)

    // 11. REGRESSAO: mudanca de web_url revoga graciosamente, sem derrubar o sync.
    //     O calculo de revogacao usava o web_url ANTIGO enquanto o SET gravava o
    //     NOVO: o fingerprint batia com o hash aprovado, display ficava true, e o
    //     TRIGGER — que recomputa com os valores novos — abortava o sync inteiro
    //     com excecao. Este check falha (throw) se a regressao voltar.
    let webUrlSyncThrew = false
    try {
      await watchStore.replaceSnapshot({
        entityType: 'movie', entityId: movieId, countryCode: 'BR',
        offers: [offer({ entityId: movieId, quality: '4k', webUrl: 'https://netflix/watch/novo' })],
        fetchedAt: new Date('2026-07-15T14:00:00.000Z'), staleAfter: stale1,
      } as never)
    } catch { webUrlSyncThrew = true }
    const afterWebUrl = (await q<{ display_allowed: boolean; web_url: string | null }>(`SELECT display_allowed, web_url FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(11, 'mudanca de web_url revoga a aprovacao no sync (sem derrubar o run)',
      !webUrlSyncThrew && afterWebUrl.display_allowed === false && afterWebUrl.web_url === 'https://netflix/watch/novo',
      `threw=${webUrlSyncThrew}, display=${afterWebUrl.display_allowed}, web_url=${afterWebUrl.web_url}`)

    // --- Exibicao automatica COM credito (hidratacao licenca -> oferta) ---
    //
    // Ate aqui, TODO o caminho de exibicao de streaming dependia de um humano
    // rodando `pnpm streaming promote`. E esse caminho nunca escreveu
    // `license_status`/`attribution_text` — como o sync tambem nao escrevia, a
    // oferta ficava presa em `license_status='unknown'` e o trigger recusava.
    // Os checks abaixo provam a hidratacao no BANCO REAL, contra o trigger real.

    const autoLogs: string[] = []
    const watchStoreAuto = createPrismaWatchStore(prisma as never, {
      credits: createPrismaWatchCreditLookup(prisma as never),
      log: (message: string) => autoLogs.push(message),
    } as never)

    // Zera o estado de licenca da Netflix para provar que a HIDRATACAO e que
    // preenche — e nao um resquicio do passo humano simulado no check 4.
    await prisma.$executeRawUnsafe(
      `UPDATE watch_availability SET license_status='unknown', attribution_text=NULL, attribution_url=NULL, reviewed_by=NULL, reviewed_at=NULL, approved_payload_hash=NULL, watch_provider_id=NULL, data_usage_decision_id=NULL WHERE id=${netflixId}`,
    )

    // 12. sync COM credits: a oferta sai exibida, creditada e carimbada pela
    //     politica (nunca por um nome de pessoa).
    let autoSyncThrew = false
    try {
      await watchStoreAuto.replaceSnapshot({
        entityType: 'movie', entityId: movieId, countryCode: 'BR',
        offers: [
          offer({ entityId: movieId, quality: '4k', webUrl: 'https://netflix/watch/novo' }),
          // Reaparece no snapshot so para provar que provedor SEM alias continua
          // fail-closed mesmo com a hidratacao ligada (check 15).
          offer({ entityId: movieId, providerKey: 'max', providerName: 'Max' }),
        ],
        fetchedAt: new Date('2026-07-15T15:00:00.000Z'), staleAfter: stale1,
      } as never)
    } catch { autoSyncThrew = true }

    const auto = (await q<{
      display_allowed: boolean; reviewed_by: string | null; license_status: string
      attribution_text: string | null; attribution_url: string | null
      watch_provider_id: bigint | null; data_usage_decision_id: bigint | null
    }>(`SELECT display_allowed, reviewed_by, license_status::text AS license_status, attribution_text, attribution_url, watch_provider_id, data_usage_decision_id FROM watch_availability WHERE id=${netflixId}`))[0]!
    record(12, 'sync com credits hidrata licenca/atribuicao e acende a oferta (reviewed_by automation:)',
      !autoSyncThrew && auto.display_allowed === true
        && auto.reviewed_by === STREAMING_AUTO_REVIEWER
        && auto.reviewed_by.startsWith('automation:')
        && auto.license_status === 'official'
        && auto.attribution_text === 'Movie of the Night'
        && auto.attribution_url === STREAMING_AVAILABILITY_ATTRIBUTION_URL
        && auto.watch_provider_id !== null && auto.data_usage_decision_id !== null,
      `threw=${autoSyncThrew}, display=${auto.display_allowed}, revisor=${auto.reviewed_by}, licenca=${auto.license_status}, credito=${auto.attribution_text}, linkback=${auto.attribution_url}`)

    // 13. o hash aprovado foi computado sobre os valores NOVOS de licenca.
    //     Se o UPDATE tivesse lido `w."license_status"` (valor ANTIGO) dentro do
    //     SET, o trigger — que recomputa com os novos — teria abortado a
    //     statement e o check 12 ja falharia. Este check e a prova DIRETA: o
    //     hash gravado bate com o fingerprint recomputado da linha atual.
    const hashOk = (await q<{ ok: boolean | null }>(
      `SELECT approved_payload_hash = watch_offer_payload_fingerprint_v1(
         provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type,
         provider_key, provider_name, package, quality, price, currency, deep_link, web_url,
         available_from, available_until, license_status, requires_attribution,
         requires_linkback, attribution_text, attribution_url) AS ok
       FROM watch_availability WHERE id=${netflixId}`,
    ))[0]!.ok
    record(13, 'approved_payload_hash foi computado sobre os valores NOVOS de licenca',
      hashOk === true, `hash_bate=${hashOk}`)

    // 14. provedor SEM alias canonico continua fail-closed, e o motivo e
    //     DIFERENTE de "sem licenca" (o operador precisa cadastrar o alias).
    const maxAfterAuto = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${maxId}`))[0]!.display_allowed
    const maxLogged = autoLogs.some((l) => l.includes('sem alias canonico') && l.includes('max'))
    record(14, 'oferta de provedor sem alias nao acende e o motivo e logado (nao ha descarte mudo)',
      maxAfterAuto === false && maxLogged,
      `display=${maxAfterAuto}, logado=${maxLogged}`)

    // 15. SEM ATRIBUICAO NAO PASSA. Provedor com alias, licenca vigente,
    //     decisao aprovada — e `attribution_text` NULL com
    //     `requires_attribution=true`. A oferta NAO pode acender.
    await prisma.$executeRawUnsafe(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('star-plus','Star+','https://www.starplus.com/', now())`)
    await prisma.$executeRawUnsafe(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id,'streaming_availability','star','Star+', now() FROM watch_providers WHERE slug='star-plus'`)
    await prisma.$executeRawUnsafe(`INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at) VALUES ('star-plus','watch_availability','streaming_availability','BR','third_party',true,true,true,NULL,true,'ana@screen',now(),'validation/v1',now())`)
    await prisma.$executeRawUnsafe(`INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at) SELECT id,'watch_offer_display','BR','approved_for_display',true,true,true,true,'validation/v1','ana@screen','cenario sem atribuicao', now() FROM source_licenses WHERE source_key='star-plus' AND content_type='watch_availability'`)

    autoLogs.length = 0
    await watchStoreAuto.replaceSnapshot({
      entityType: 'movie', entityId: movieId, countryCode: 'BR',
      offers: [
        offer({ entityId: movieId, quality: '4k', webUrl: 'https://netflix/watch/novo' }),
        offer({ entityId: movieId, providerKey: 'star', providerName: 'Star+', deepLink: 'https://starplus/x' }),
      ],
      fetchedAt: new Date('2026-07-15T16:00:00.000Z'), staleAfter: stale1,
    } as never)
    const starRow = (await q<{ display_allowed: boolean; attribution_text: string | null }>(`SELECT display_allowed, attribution_text FROM watch_availability WHERE entity_id=${movieId} AND provider_key='star'`))[0]!
    const starLogged = autoLogs.some((l) => l.includes('missing-attribution'))
    record(15, 'licenca que EXIGE atribuicao e nao tem texto de credito NAO acende a oferta',
      starRow.display_allowed === false && starRow.attribution_text === null && starLogged,
      `display=${starRow.display_allowed}, credito=${starRow.attribution_text}, motivo_logado=${starLogged}`)

    // 16. o ciclo seguinte, com payload identico, MANTEM a oferta exibida. Sem
    //     isto a exibicao seria um piscar: acende num sync e apaga no proximo.
    const netflixStable = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${netflixId}`))[0]!.display_allowed
    record(16, 'sync seguinte com payload identico mantem a oferta exibida (nao pisca)',
      netflixStable === true, `display=${netflixStable}`)
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    await prisma.$disconnect()
    if (started) {
      try { await pg.stop() } catch { /* best-effort */ }
    }
    await safeRm(dataDir)
    console.log('\n=== stores integration: Postgres efemero derrubado ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO (stores integration): ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Stores reais governanca-compativeis em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
