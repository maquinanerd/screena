/**
 * validate-external-intelligence-product.ts — Prova, em PostgreSQL 16 REAL, os
 * 18 itens da secao 13 da Macrofase Backend B.
 *
 * Nao testa SQL sintetico nem mocks: aplica a migration de verdade e exercita os
 * triggers, as funcoes de fingerprint, os stores reais e os guardrails puros
 * sobre o mesmo banco que a producao teria.
 *
 * Disciplina que atravessa o arquivo: toda trava e provada nos DOIS SENTIDOS —
 * o caminho proibido e barrado E o caminho correto passa. Um check que so prova
 * "barrou" nao distingue "a trava funciona" de "nada funciona".
 *
 * FERRAMENTA DE DESENVOLVIMENTO (dev tool) DESCARTAVEL. Nunca em
 * produto/render/producao. Motor: embedded-postgres (PostgreSQL 16 real,
 * efemero), devDependency-only.
 *
 * Seguranca: nenhum segredo real; `DATABASE_URL` so em memoria e sempre
 * mascarado no log; a instancia e derrubada no `finally`.
 *
 * Fluxo: sobe PG efemero -> prisma migrate deploy -> db seed -> monta a cadeia
 * de governanca -> roda os checks -> derruba tudo.
 *
 * Uso (a partir da raiz): pnpm validate:external-intelligence-product
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

import { RATING_STALE_POLICY } from '@screena/config'
import { PRODUCTION_FORMULA_REGISTRY, computeCinerieScore } from '@screena/cinerie-score'

// Internos do worker por caminho RELATIVO: nao ha alias `@screena/ratings`, e
// criar um so para o validador seria inventar API publica onde nao ha. Mesmo
// desenho do validate-stores-real-postgres.ts (streaming): o script vive no
// workspace que tem as devDeps (embedded-postgres/prisma), para resolver por
// node_modules proprio.
import { evaluateRatingPromotionEligibility } from '../src/promotion/guardrails.js'
import { createPrismaRatingsReviewStore } from '../src/persistence/ratings-review-store.js'

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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      resolve(typeof addr === 'object' && addr ? addr.port : 0)
      srv.close()
    })
  })
}

function prismaBin(): string {
  const pkgPath = require.resolve('prisma/package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { bin: string | Record<string, string> }
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma
  return path.join(path.dirname(pkgPath), rel)
}

/** Windows segura o diretorio do PG por alguns ms; EBUSY nunca derruba a suite. */
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

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url })
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql)
  const exec = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql)

  /** O INSERT/UPDATE proibido passou? Entao a trava NAO existe. */
  async function expectViolation(n: number, name: string, sql: string): Promise<void> {
    try {
      await exec(sql)
      record(n, name, false, 'STATEMENT PROIBIDO FOI ACEITO (a trava nao barrou)')
    } catch (e) {
      record(n, name, true, `barrado: ${(e as Error).message.split('\n')[0].slice(0, 100)}`)
    }
  }

  try {
    // ---------- montagem do cenario ----------
    // languages/countries/rating_sources/api_providers ja vem do db:seed (Fase 1).
    // Aqui so entra o que e especifico do cenario de Backend B.
    const movie = await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (900001,'Filme Backend B',now()) RETURNING id`,
    )
    const movieId = Number(movie[0]!.id)

    // Licenca de rating do IMDb: existe, permite exibir, exige atribuicao+linkback.
    const imdbLicense = await q<{ id: bigint }>(
      `INSERT INTO source_licenses (source_key, content_type, rating_source_key, provider_key, license_status, display_allowed, score_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
       VALUES ('imdb','rating','imdb','imdb236','licensed',true,true,true,true,'Nota fornecida por IMDb',true,'ana@cinerie',now(),'validation/v1',now()) RETURNING id`,
    )
    const imdbLicenseId = Number(imdbLicense[0]!.id)

    // Licenca do Metacritic: NAO confirmada (unknown). Serve para provar que uma
    // decisao nao consegue lavar uma licenca que nao permite.
    const mcLicense = await q<{ id: bigint }>(
      `INSERT INTO source_licenses (source_key, content_type, rating_source_key, provider_key, license_status, display_allowed, is_current, decided_by, decided_at, policy_version, updated_at)
       VALUES ('metacritic','rating','metacritic','imdb236','unknown',false,true,'ana@cinerie',now(),'validation/v1',now()) RETURNING id`,
    )
    const mcLicenseId = Number(mcLicense[0]!.id)

    // ---------- 1. provider != source ----------
    await expectViolation(
      1,
      'invariante 2: provider_api = rating_source e barrado no BANCO',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, 'imdb', now())`,
    )
    await expectViolation(
      2,
      'invariante 2: provider_api que E o id de outra fonte editorial e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, 'metacritic', now())`,
    )

    // ---------- 2. escalas ----------
    await expectViolation(
      3,
      'invariante 1: imdb com escala 100 e barrado (a escala pertence a fonte)',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 84, 100, 'imdb236', now())`,
    )
    await expectViolation(
      4,
      'valor fora da escala e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 11, 10, 'imdb236', now())`,
    )

    // ---------- 3. cross-label ----------
    await expectViolation(
      5,
      'invariante 1: Tomatometer atribuido ao IMDb e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'Tomatometer', 'user_rating', 8.4, 10, 'imdb236', now())`,
    )

    // ---------- 4. critics/audience ----------
    await expectViolation(
      6,
      'critics/audience: Tomatometer com score_type=audience e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'rotten_tomatoes', 'Tomatometer', 'tomatometer', 'audience', 92, 100, 'imdb236', now())`,
    )

    // ---------- 5. votos ----------
    await expectViolation(
      7,
      'votos negativos sao barrados (null = desconhecido e legitimo; -1 nao)',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, rating_count, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, -1, 'imdb236', now())`,
    )

    // A nota valida de referencia. Nasce display_allowed=false.
    const rating = await q<{ id: bigint }>(
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, rating_count, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 'audience', 8.4, 10, 12000, 'https://www.imdb.com/title/tt1/', 'imdb236', 'licensed', true, true, 'Nota fornecida por IMDb', 'https://www.imdb.com/title/tt1/', now(), now()) RETURNING id`,
    )
    const ratingId = Number(rating[0]!.id)
    const born = await q<{ display_allowed: boolean }>(
      `SELECT display_allowed FROM external_ratings WHERE id=${ratingId}`,
    )
    record(8, 'nota valida entra e nasce display_allowed=false (default seguro)', born[0]!.display_allowed === false, `display=${born[0]!.display_allowed}`)

    // ---------- 6. licenca: decisao nao pode conceder alem da licenca-mae ----------
    await expectViolation(
      9,
      'decisao nao pode conceder display sobre licenca unknown (sem porta dos fundos)',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${mcLicenseId}, 'rating_display', 'approved_for_display', true, true, 'v1', 'ana@cinerie', 'tentativa de lavar licenca', now())`,
    )
    await expectViolation(
      10,
      'escada de permissao: display sem storage e barrado por CHECK',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'x', 'approved_for_display', true, false, 'v1', 'ana@cinerie', 'motivo', now())`,
    )
    await expectViolation(
      11,
      'estagio: display_allowed sem approved_for_display e barrado por CHECK',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'y', 'license_pending', true, true, 'v1', 'ana@cinerie', 'motivo', now())`,
    )
    await expectViolation(
      12,
      'revogada nao permite nada (CHECK)',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'z', 'revoked', false, true, 'v1', 'ana@cinerie', 'motivo', now())`,
    )

    // A decisao VALIDA de rating_display do IMDb.
    const decision = await q<{ id: bigint }>(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'rating_display', 'BR', 'approved_for_display', true, true, false, true, true, 'validation/v1', 'ana@cinerie', 'sample controlado de validacao', now()) RETURNING id`,
    )
    const decisionId = Number(decision[0]!.id)
    record(13, 'decisao valida dentro do teto da licenca e aceita', decisionId > 0, `id=${decisionId}`)

    // ---------- 7. promotion (via STORE REAL, nao SQL sintetico) ----------
    const store = createPrismaRatingsReviewStore(prisma as never)
    const candidates = await store.findByIds([String(ratingId)])
    const candidate = candidates[0]!
    record(
      14,
      'read store resolve a DataUsageDecision vigente da fonte',
      candidate.usageDecisionId === String(decisionId),
      `decisao=${candidate.usageDecisionId}`,
    )

    const eligibility = evaluateRatingPromotionEligibility(candidate, { now: new Date() })
    record(15, 'guardrails puros aprovam a nota governada', eligibility.eligible, `reason=${eligibility.reason ?? 'null'}`)

    let noReviewerThrew = false
    try { await store.promote([String(ratingId)], '   ') } catch { noReviewerThrew = true }
    record(16, 'promocao sem revisor humano lanca (reviewed_by obrigatorio)', noReviewerThrew, `threw=${noReviewerThrew}`)

    const promoted = await store.promote([String(ratingId)], 'ana@cinerie')
    const afterPromote = await q<{ display_allowed: boolean; reviewed_by: string | null; approved_payload_hash: string | null; data_usage_decision_id: bigint | null }>(
      `SELECT display_allowed, reviewed_by, approved_payload_hash, data_usage_decision_id FROM external_ratings WHERE id=${ratingId}`,
    )
    const row = afterPromote[0]!
    record(
      17,
      'promocao governada liga display + grava revisor + hash + decisao',
      promoted.updated === 1 && row.display_allowed === true && row.reviewed_by === 'ana@cinerie'
        && row.approved_payload_hash !== null && row.data_usage_decision_id !== null,
      `updated=${promoted.updated}, display=${row.display_allowed}, revisor=${row.reviewed_by}, hash=${row.approved_payload_hash !== null}`,
    )

    // ---------- 8. attribution / linkback ----------
    await expectViolation(
      18,
      'attribution exigida: apagar attribution_text derruba a exibicao',
      `UPDATE external_ratings SET attribution_text=NULL WHERE id=${ratingId}`,
    )
    await expectViolation(
      19,
      'linkback exigido: apagar attribution_url derruba a exibicao',
      `UPDATE external_ratings SET attribution_url=NULL WHERE id=${ratingId}`,
    )

    // ---------- 9. MUDANCA REVOGA ----------
    await expectViolation(
      20,
      'mudanca revoga: alterar a nota sem novo hash e barrado pelo trigger',
      `UPDATE external_ratings SET rating_value=8.5 WHERE id=${ratingId}`,
    )
    const hashBefore = row.approved_payload_hash
    const fp = await q<{ fp: string }>(
      `SELECT external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, 8.5, rating_scale, rating_count, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) AS fp FROM external_ratings WHERE id=${ratingId}`,
    )
    record(
      21,
      'o fingerprint MUDA quando a nota muda (base do "mudanca revoga")',
      fp[0]!.fp !== hashBefore,
      `hash antigo != novo = ${fp[0]!.fp !== hashBefore}`,
    )

    // ---------- 10. hash errado ----------
    await expectViolation(
      22,
      'hash aprovado forjado e barrado',
      `UPDATE external_ratings SET approved_payload_hash='HASH_FALSO' WHERE id=${ratingId}`,
    )

    // ---------- 11. revocation ----------
    const revoked = await store.revoke([String(ratingId)])
    const afterRevoke = await q<{ display_allowed: boolean; approved_payload_hash: string | null; reviewed_by: string | null }>(
      `SELECT display_allowed, approved_payload_hash, reviewed_by FROM external_ratings WHERE id=${ratingId}`,
    )
    record(
      23,
      'revogacao desliga display E limpa a aprovacao inteira',
      revoked.updated === 1 && afterRevoke[0]!.display_allowed === false
        && afterRevoke[0]!.approved_payload_hash === null && afterRevoke[0]!.reviewed_by === null,
      `updated=${revoked.updated}, display=${afterRevoke[0]!.display_allowed}, hash limpo=${afterRevoke[0]!.approved_payload_hash === null}`,
    )

    // ---------- 12. decisao revogada derruba a exibicao ----------
    await store.promote([String(ratingId)], 'ana@cinerie')
    await exec(`UPDATE data_usage_decisions SET is_current=false WHERE id=${decisionId}`)
    await expectViolation(
      24,
      'decisao nao-vigente: qualquer reescrita da nota exibida e barrada',
      `UPDATE external_ratings SET rating_count=13000, approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, rating_value, rating_scale, 13000, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) WHERE id=${ratingId}`,
    )
    await exec(`UPDATE data_usage_decisions SET is_current=true WHERE id=${decisionId}`)

    // ---------- 13. historico da decisao ----------
    await expectViolation(
      25,
      'supersedes cross-group e barrado pelo guard',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, storage_allowed, policy_version, decided_by, reason, supersedes_id, is_current, updated_at)
       VALUES (${mcLicenseId}, 'rating_display', 'approved_for_internal_use', true, 'v1', 'ana@cinerie', 'motivo', ${decisionId}, false, now())`,
    )
    await exec(`UPDATE data_usage_decisions SET is_current=false WHERE id=${decisionId}`)
    const successor = await q<{ id: bigint }>(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, supersedes_id, updated_at)
       VALUES (${imdbLicenseId}, 'rating_display', 'BR', 'approved_for_display', true, true, true, true, 'validation/v2', 'ana@cinerie', 'renovacao', ${decisionId}, now()) RETURNING id`,
    )
    const currentCount = await q<{ c: number }>(
      `SELECT count(*)::int AS c FROM data_usage_decisions WHERE source_license_id=${imdbLicenseId} AND use_case='rating_display' AND is_current`,
    )
    record(
      26,
      'historico: 1 vigente + supersede preserva a anterior',
      Number(currentCount[0]!.c) === 1 && Number(successor[0]!.id) > decisionId,
      `vigentes=${currentCount[0]!.c}`,
    )
    await expectViolation(
      27,
      'duas decisoes vigentes para (licenca, uso, territorio) sao barradas',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'rating_display', 'BR', 'approved_for_internal_use', true, 'v3', 'ana@cinerie', 'concorrente', now())`,
    )

    // ---------- 14. streaming BR + provedor canonico ----------
    await exec(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('netflix','Netflix','https://www.netflix.com/', now())`)
    await exec(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id,'streaming_availability','netflix','Netflix', now() FROM watch_providers WHERE slug='netflix'`)
    await expectViolation(
      28,
      'watch_providers: slug com maiuscula/espaco e barrado (CHECK de formato)',
      `INSERT INTO watch_providers (slug, canonical_name, updated_at) VALUES ('Prime Video','Prime Video', now())`,
    )
    await expectViolation(
      29,
      'watch_providers: homepage nao-HTTPS e barrada',
      `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('max','Max','http://max.com/', now())`,
    )
    await expectViolation(
      30,
      'alias: mesma (provider_api, external_key) para dois provedores e barrado',
      `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
       SELECT id,'streaming_availability','netflix','Outro', now() FROM watch_providers WHERE slug='netflix'`,
    )
    await expectViolation(
      31,
      'provider_api fantasma e barrado pela FK nova',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'X', 'subscription', 'nao_existe', now())`,
    )

    const watchLicense = await q<{ id: bigint }>(
      `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
       VALUES ('netflix','watch_availability','streaming_availability','BR','official',true,true,true,'Movie of the Night',true,'ana@cinerie',now(),'validation/v1',now()) RETURNING id`,
    )
    const watchDecision = await q<{ id: bigint }>(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at)
       VALUES (${Number(watchLicense[0]!.id)}, 'watch_offer_display', 'BR', 'approved_for_display', true, true, true, true, 'validation/v1', 'ana@cinerie', 'sample controlado', now()) RETURNING id`,
    )
    const watchDecisionId = Number(watchDecision[0]!.id)

    const offer = await q<{ id: bigint }>(
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_key, provider_name, offer_type, deep_link, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, reviewed_by, reviewed_at, watch_provider_id, data_usage_decision_id, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'netflix', 'Netflix', 'subscription', 'https://www.netflix.com/title/1', 'streaming_availability', 'official', true, true, 'Movie of the Night', 'https://motn.test/', 'ana@cinerie', now(), (SELECT id FROM watch_providers WHERE slug='netflix'), ${watchDecisionId}, now()) RETURNING id`,
    )
    const offerId = Number(offer[0]!.id)
    await exec(
      `UPDATE watch_availability SET display_allowed=true, approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) WHERE id=${offerId}`,
    )
    const offerRow = await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM watch_availability WHERE id=${offerId}`)
    record(32, 'oferta BR com provedor canonico + decisao e exibivel', offerRow[0]!.display_allowed === true, `display=${offerRow[0]!.display_allowed}`)

    await expectViolation(
      33,
      'oferta sem provedor canonico nao exibe (mesmo com licenca completa)',
      `UPDATE watch_availability SET watch_provider_id=NULL WHERE id=${offerId}`,
    )

    // ---------- 15. links / preco / moeda ----------
    await expectViolation(
      34,
      'preco sem moeda e barrado (CHECK)',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'Netflix', 'rent', 14.90, 'streaming_availability', now())`,
    )
    await expectViolation(
      35,
      'preco em modalidade nao-transacional e barrado (CHECK)',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'Netflix', 'subscription', 39.90, 'BRL', 'streaming_availability', now())`,
    )

    // ---------- 16. cinerie score: BLOQUEADO sem decisao ----------
    const blocked = computeCinerieScore(
      { entityId: String(movieId), ratings: [{ source: 'imdb', type: 'audience', value: 8.4, best: 10, count: 12000, licenseDecisionId: String(decisionId) }] },
      { registry: PRODUCTION_FORMULA_REGISTRY, decision: null, now: new Date() },
    )
    record(
      36,
      'cinerie score: sem decisao aprovada => BLOCKED_BY_DECISION (nunca um numero)',
      blocked.status === 'blocked_by_decision',
      `status=${blocked.status}`,
    )
    record(
      37,
      'cinerie score: registro de formulas de PRODUCAO esta vazio (nada aprovado)',
      PRODUCTION_FORMULA_REGISTRY.versions.length === 0,
      `versoes=${PRODUCTION_FORMULA_REGISTRY.versions.length}`,
    )
    await expectViolation(
      38,
      'cinerie score: screen_score_display=true sem decisao vigente e barrado',
      `UPDATE movies SET screen_score=4.2, screen_score_scale=5, screen_score_display=true WHERE id=${movieId}`,
    )
    if (blocked.status !== 'blocked_by_decision') throw new Error('esperado bloqueio')
    await exec(
      `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, version, inputs_hash, blocked_reason, calculated_at)
       VALUES ('movie', ${movieId}, 'blocked_by_decision', '${blocked.version}', '${blocked.inputsHash}', '${blocked.blockedReason.replace(/'/g, "''")}', now())`,
    )
    const calcCount = await q<{ c: number }>(`SELECT count(*)::int AS c FROM cinerie_score_calculations WHERE entity_id=${movieId}`)
    record(39, 'cinerie score: o bloqueio e PERSISTIDO no historico (auditavel)', Number(calcCount[0]!.c) === 1, `linhas=${calcCount[0]!.c}`)
    await expectViolation(
      40,
      'cinerie score: linha "bloqueada" carregando valor e barrada (CHECK)',
      `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, value, scale, version, inputs_hash, blocked_reason, calculated_at)
       VALUES ('movie', ${movieId}, 'blocked_by_decision', 4.2, 5, 'x', 'y', 'motivo', now())`,
    )
    await expectViolation(
      41,
      'cinerie score: linha "calculada" sem valor e barrada (CHECK)',
      `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, version, inputs_hash, calculated_at)
       VALUES ('movie', ${movieId}, 'calculated', 'x', 'y', now())`,
    )

    // Com decisao de derivacao vigente, o banco LIBERA (prova do outro sentido:
    // a trava e da governanca, nao um "sempre nao" disfarcado).
    await exec(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, derivative_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'cinerie_score_display', 'approved_for_display', true, true, true, 'cinerie-score/v1', 'ana@cinerie', 'decisao de validacao — NAO e a decisao de produto', now())`,
    )
    await exec(`UPDATE movies SET screen_score=4.2, screen_score_scale=5, screen_score_display=true WHERE id=${movieId}`)
    const scored = await q<{ screen_score_display: boolean }>(`SELECT screen_score_display FROM movies WHERE id=${movieId}`)
    record(
      42,
      'cinerie score: COM decisao vigente o banco libera (a trava e governanca, nao "sempre nao")',
      scored[0]!.screen_score_display === true,
      `display=${scored[0]!.screen_score_display}`,
    )

    // ---------- 17. stale policy ----------
    const staleOk = Object.entries(RATING_STALE_POLICY).every(([, p]) => p.refreshAfterHours < p.expireAfterHours)
    record(43, 'stale policy: refresh sempre antes de expirar, em toda fonte', staleOk, `fontes=${Object.keys(RATING_STALE_POLICY).length}`)
    // Nota velha da MESMA fonte governada (imdb tem decisao vigente e licenca
    // ok), metrica distinta para nao colidir com a nota principal. Assim ela
    // passa integridade+governanca e a UNICA coisa que sobra e o frescor: imdb
    // expira em 720h, 100 dias (2400h) esta muito alem. Prova que a stale policy
    // barra por si so — nao por falta de licenca.
    const oldRating = await q<{ id: bigint }>(
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'critics_avg', 'critics', 7.9, 10, 'imdb236', 'licensed', true, true, 'Nota fornecida por IMDb', 'https://www.imdb.com/title/tt1/', now() - interval '100 days', now()) RETURNING id`,
    )
    const oldCandidates = await store.findByIds([String(Number(oldRating[0]!.id))])
    const oldEval = evaluateRatingPromotionEligibility(oldCandidates[0]!, { now: new Date() })
    record(
      44,
      'stale policy: nota de 100 dias (imdb expira em 720h) nao promove por FRESCOR',
      !oldEval.eligible && oldEval.reason === 'expired',
      `reason=${oldEval.reason}`,
    )

    // ---------- 18. render filtra bloqueados ----------
    const displayable = await q<{ c: number }>(
      `SELECT count(*)::int AS c FROM external_ratings WHERE entity_id=${movieId} AND display_allowed = true`,
    )
    const total = await q<{ c: number }>(`SELECT count(*)::int AS c FROM external_ratings WHERE entity_id=${movieId}`)
    record(
      45,
      'render: so a nota governada e exibivel; as demais ficam no banco (auditaveis) e fora da vitrine',
      Number(displayable[0]!.c) === 1 && Number(total[0]!.c) > 1,
      `exibiveis=${displayable[0]!.c}/${total[0]!.c}`,
    )
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'cinerie-eip-pg-'))
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false })
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_eip?schema=public`
  console.log(`\n=== external intelligence product — PostgreSQL efemero :${port} (postgres:****) ===\n`)

  let started = false
  try {
    await pg.initialise()
    await pg.start()
    started = true
    await pg.createDatabase('cinerie_eip')

    const env = { ...process.env, DATABASE_URL: url }
    console.log('--- prisma migrate deploy ---')
    execFileSync('node', [prismaBin(), 'migrate', 'deploy', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })
    console.log('--- db seed ---')
    execFileSync('node', [prismaBin(), 'db', 'seed', '--schema', schemaPath], { env, stdio: 'inherit', cwd: dbDir })

    await runChecks(url)
  } catch (e) {
    record(0, 'execucao', false, (e as Error).message.split('\n')[0])
  } finally {
    if (started) {
      try { await pg.stop() } catch (e) { console.log(`[cleanup] pg.stop: ${(e as Error).message}`) }
    }
    await safeRm(dataDir)
    console.log('\n=== PostgreSQL efemero derrubado e dir temporario removido ===')
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\nRESUMO (external intelligence product): ${results.length - failed.length}/${results.length} checks OK.`)
  if (failed.length > 0) {
    console.error('FALHAS:', failed.map((f) => `${f.n}.${f.name}`).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: PASSOU. Ratings, streaming, licencas e Cinerie Score governados em PostgreSQL real.')
}

main().catch((e) => {
  console.error('Erro fatal:', e)
  process.exit(1)
})
