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

  /**
   * O INSERT/UPDATE proibido passou? Entao a trava NAO existe.
   *
   * `expected` e OBRIGATORIO (achado A4 da revisao adversarial): erros do
   * Prisma comecam com "\n", entao `split('\n')[0]` produzia detail VAZIO e o
   * check passava com QUALQUER erro — inclusive um typo de coluna ou uma FK
   * nao relacionada. "Barrado pelo motivo errado" agora e FALHA, nao PASS.
   */
  async function expectViolation(n: number, name: string, sql: string, expected: string): Promise<void> {
    try {
      await exec(sql)
      record(n, name, false, 'STATEMENT PROIBIDO FOI ACEITO (a trava nao barrou)')
    } catch (e) {
      const msg = (e as Error).message.replace(/\s+/g, ' ').trim()
      const hit = msg.toLowerCase().includes(expected.toLowerCase())
      const at = hit ? Math.max(0, msg.toLowerCase().indexOf(expected.toLowerCase()) - 20) : 0
      record(n, name, hit,
        hit
          ? `barrado: ...${msg.slice(at, at + 120)}`
          : `BARRADO PELO MOTIVO ERRADO (esperado "${expected}"): ${msg.slice(0, 160)}`)
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
      'provider_api nao pode ser igual a rating_source',
    )
    await expectViolation(
      2,
      'invariante 2: provider_api que E o id de outra fonte editorial e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, 'metacritic', now())`,
      'fornecedor tecnico nao usa identificador de rating_source',
    )

    // ---------- 2. escalas ----------
    await expectViolation(
      3,
      'invariante 1: imdb com escala 100 e barrado (a escala pertence a fonte)',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 84, 100, 'imdb236', now())`,
      'nao corresponde a escala',
    )
    await expectViolation(
      4,
      'valor fora da escala e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 11, 10, 'imdb236', now())`,
      'fora da escala',
    )

    // ---------- 3. cross-label ----------
    await expectViolation(
      5,
      'invariante 1: Tomatometer atribuido ao IMDb e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'Tomatometer', 'user_rating', 8.4, 10, 'imdb236', now())`,
      'pertence ao Rotten Tomatoes',
    )

    // ---------- 4. critics/audience ----------
    await expectViolation(
      6,
      'critics/audience: Tomatometer com score_type=audience e barrado',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'rotten_tomatoes', 'Tomatometer', 'tomatometer', 'audience', 92, 100, 'imdb236', now())`,
      'nota de CRITICA',
    )

    // ---------- 5. votos ----------
    await expectViolation(
      7,
      'votos negativos sao barrados (null = desconhecido e legitimo; -1 nao)',
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, rating_value, rating_scale, rating_count, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'imdb', 'IMDb Rating', 'user_rating', 8.4, 10, -1, 'imdb236', now())`,
      'nao pode ser negativo',
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
      'nao permite uso concedido',
    )
    await expectViolation(
      10,
      'escada de permissao: display sem storage e barrado por CHECK',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'x', 'approved_for_display', true, false, 'v1', 'ana@cinerie', 'motivo', now())`,
      'data_usage_decisions_display_requires_storage',
    )
    await expectViolation(
      11,
      'estagio: display_allowed sem approved_for_display e barrado por CHECK',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'y', 'license_pending', true, true, 'v1', 'ana@cinerie', 'motivo', now())`,
      'data_usage_decisions_display_requires_stage',
    )
    await expectViolation(
      12,
      'revogada nao permite nada (CHECK)',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, display_allowed, storage_allowed, policy_version, decided_by, reason, updated_at)
       VALUES (${imdbLicenseId}, 'z', 'revoked', false, true, 'v1', 'ana@cinerie', 'motivo', now())`,
      'data_usage_decisions_revoked_allows_nothing',
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
      'approved_payload_hash ausente ou != fingerprint',
    )
    await expectViolation(
      19,
      'linkback exigido: apagar attribution_url derruba a exibicao',
      `UPDATE external_ratings SET attribution_url=NULL WHERE id=${ratingId}`,
      'approved_payload_hash ausente ou != fingerprint',
    )

    // ---------- 9. MUDANCA REVOGA ----------
    await expectViolation(
      20,
      'mudanca revoga: alterar a nota sem novo hash e barrado pelo trigger',
      `UPDATE external_ratings SET rating_value=8.5 WHERE id=${ratingId}`,
      'approved_payload_hash ausente ou != fingerprint',
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
      'approved_payload_hash ausente ou != fingerprint',
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
      'nao e a vigente',
    )
    await exec(`UPDATE data_usage_decisions SET is_current=true WHERE id=${decisionId}`)

    // ---------- 13. historico da decisao ----------
    await expectViolation(
      25,
      'supersedes cross-group e barrado pelo guard',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, storage_allowed, policy_version, decided_by, reason, supersedes_id, is_current, updated_at)
       VALUES (${mcLicenseId}, 'rating_display', 'approved_for_internal_use', true, 'v1', 'ana@cinerie', 'motivo', ${decisionId}, false, now())`,
      'mesmo (source_license_id, use_case, territory)',
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
      // Prisma raw omite o nome da constraint (so code 23505 + colunas); as
      // colunas da chave identificam o indice unico parcial inequivocamente.
      '(source_license_id, use_case, COALESCE(territory',
    )

    // ---------- 14. streaming BR + provedor canonico ----------
    await exec(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('netflix','Netflix','https://www.netflix.com/', now())`)
    await exec(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id,'streaming_availability','netflix','Netflix', now() FROM watch_providers WHERE slug='netflix'`)
    await expectViolation(
      28,
      'watch_providers: slug com maiuscula/espaco e barrado (CHECK de formato)',
      `INSERT INTO watch_providers (slug, canonical_name, updated_at) VALUES ('Prime Video','Prime Video', now())`,
      'watch_providers_slug_format',
    )
    await expectViolation(
      29,
      'watch_providers: homepage nao-HTTPS e barrada',
      `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('max','Max','http://max.com/', now())`,
      'watch_providers_homepage_https',
    )
    await expectViolation(
      30,
      'alias: mesma (provider_api, external_key) para dois provedores e barrado',
      `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
       SELECT id,'streaming_availability','netflix','Outro', now() FROM watch_providers WHERE slug='netflix'`,
      '(provider_api, external_key)',
    )
    await expectViolation(
      31,
      'provider_api fantasma e barrado pela FK nova',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'X', 'subscription', 'nao_existe', now())`,
      'watch_availability_provider_api_fkey',
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
      'watch_provider_id obrigatorio',
    )

    // ---------- 15. links / preco / moeda ----------
    await expectViolation(
      34,
      'preco sem moeda e barrado (CHECK)',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'Netflix', 'rent', 14.90, 'streaming_availability', now())`,
      'watch_availability_price_requires_currency',
    )
    await expectViolation(
      35,
      'preco em modalidade nao-transacional e barrado (CHECK)',
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, offer_type, price, currency, provider_api, updated_at)
       VALUES ('movie', ${movieId}, 'BR', 'Netflix', 'subscription', 39.90, 'BRL', 'streaming_availability', now())`,
      'watch_availability_price_only_transactional',
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
    // O registro deixou de estar VAZIO em 20/08/2026: o proprietario fechou a
    // formula e ela foi registrada como `cinerie-score/2026-08-v1`.
    //
    // A checagem NAO foi removida nem afrouxada — ela era "vazio", virou uma
    // IGUALDADE DE CONJUNTO. Registrar uma segunda formula sem decisao humana
    // continua reprovando aqui. E o que de fato importa continua provado pelo
    // check 36, logo acima: mesmo COM a formula no build, o resultado e
    // `blocked_by_decision`, porque o elo que falta e a DataUsageDecision — e
    // ela nao existe, ja que as quatro fontes proibem obra derivada nos
    // proprios termos (ver docs/legal/cinerie-score-derivative-authorization.md).
    record(
      37,
      'cinerie score: registro de PRODUCAO tem exatamente a formula aprovada (nem mais, nem menos)',
      PRODUCTION_FORMULA_REGISTRY.versions.length === 1 &&
        PRODUCTION_FORMULA_REGISTRY.versions[0] === 'cinerie-score/2026-08-v1',
      `versoes=[${PRODUCTION_FORMULA_REGISTRY.versions.join(', ')}]`,
    )
    await expectViolation(
      38,
      'cinerie score: screen_score_display=true sem decisao vigente e barrado',
      `UPDATE movies SET screen_score=4.2, screen_score_scale=5, screen_score_display=true WHERE id=${movieId}`,
      'BLOCKED_BY_DECISION',
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
      'cinerie_score_calculations_status_shape',
    )
    await expectViolation(
      41,
      'cinerie score: linha "calculada" sem valor e barrada (CHECK)',
      `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, version, inputs_hash, calculated_at)
       VALUES ('movie', ${movieId}, 'calculated', 'x', 'y', now())`,
      'cinerie_score_calculations_status_shape',
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

    // ================= Revisao adversarial da PR #74 (achados A1/A2/A3/A6/A8) =================

    // ---------- A6: estados de DADO nao entram na tabela de DECISOES ----------
    await expectViolation(
      46,
      'A6: decisao com stage=raw e barrada (raw/recognized/normalized sao do dado, nao da decisao)',
      `INSERT INTO data_usage_decisions (source_license_id, use_case, stage, policy_version, decided_by, reason, is_current, updated_at)
       VALUES (${imdbLicenseId}, 'estado_impossivel', 'raw', 'v1', 'ana@cinerie', 'motivo', false, now())`,
      'data_usage_decisions_stage_is_decision',
    )

    // ---------- A8: historico de score de entidade inexistente nao entra ----------
    await expectViolation(
      47,
      'A8: cinerie_score_calculations exige entidade real (FK composta para entities)',
      `INSERT INTO cinerie_score_calculations (entity_type, entity_id, status, version, inputs_hash, blocked_reason, calculated_at)
       VALUES ('movie', 999999999, 'blocked_by_decision', 'x', 'orfao', 'motivo', now())`,
      'cinerie_score_calculations_entity_fkey',
    )

    // ---------- A2: decisao territorial de OUTRO territorio nao autoriza aqui ----------
    // Licenca filmaffinity valida mas US-only + decisao US-only (o guard de
    // decisoes ACEITA: casa com a licenca). O site exibe BR: o store nao pode
    // selecionar essa decisao, e sem decisao o trigger recusa a promocao.
    const faLicense = await q<{ id: bigint }>(
      `INSERT INTO source_licenses (source_key, content_type, rating_source_key, provider_key, territory_code, license_status, display_allowed, score_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
       VALUES ('filmaffinity','rating','filmaffinity','imdb236','US','licensed',true,true,true,true,'FilmAffinity',true,'ana@cinerie',now(),'validation/v1',now()) RETURNING id`,
    )
    await exec(
      `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, attribution_required, linkback_required, policy_version, decided_by, reason, updated_at)
       VALUES (${Number(faLicense[0]!.id)}, 'rating_display', 'US', 'approved_for_display', true, true, true, true, 'validation/v1', 'ana@cinerie', 'decisao US-only (cenario A2)', now())`,
    )
    const faRating = await q<{ id: bigint }>(
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie', ${movieId}, 'filmaffinity', 'FilmAffinity', 'rating', 'audience', 7.6, 10, 'imdb236', 'licensed', true, true, 'FilmAffinity', 'https://www.filmaffinity.com/x', now(), now()) RETURNING id`,
    )
    const faId = String(Number(faRating[0]!.id))
    const faPromotion = await store.promote([faId], 'ana@cinerie')
    const faRow = (await q<{ display_allowed: boolean; data_usage_decision_id: bigint | null }>(
      `SELECT display_allowed, data_usage_decision_id FROM external_ratings WHERE id=${faId}`,
    ))[0]!
    record(
      48,
      'A2: decisao rating_display de territorio US nao promove exibicao no site BR',
      faPromotion.updated === 0 && faRow.display_allowed === false && faRow.data_usage_decision_id === null,
      `updated=${faPromotion.updated}, display=${faRow.display_allowed}`,
    )

    // ---------- A1: licenca supersedida derruba a autoridade da decisao ----------
    // Re-promove a nota imdb com a decisao vigente (successor), entao supersede a
    // LICENCA (v2 blocked). A decisao continua is_current=true — e ainda assim
    // nenhuma reescrita da nota exibida pode passar: a licenca-mae e a autoridade.
    await store.revoke([String(ratingId)])
    const repromoted = await store.promote([String(ratingId)], 'ana@cinerie')
    await exec(`UPDATE source_licenses SET is_current=false WHERE id=${imdbLicenseId}`)
    await exec(
      `INSERT INTO source_licenses (source_key, content_type, rating_source_key, provider_key, license_status, display_allowed, is_current, decided_by, decided_at, policy_version, supersedes_id, updated_at)
       VALUES ('imdb','rating','imdb','imdb236','blocked',false,true,'juridico@cinerie',now(),'validation/v2',${imdbLicenseId},now())`,
    )
    await expectViolation(
      49,
      'A1: com a licenca supersedida, reescrever a nota exibida e barrado (decisao ainda vigente nao basta)',
      `UPDATE external_ratings SET rating_count=14000, approved_payload_hash = external_rating_payload_fingerprint_v1(entity_type, entity_id, rating_source, metric, score_type, rating_label, rating_value, rating_scale, 14000, rating_url, provider_api, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url) WHERE id=${ratingId}`,
      'da decisao foi supersedida',
    )
    record(
      50,
      'A1: a re-promocao governada (licenca vigente) tinha funcionado antes do supersede — a trava e a licenca, nao um "sempre nao"',
      repromoted.updated === 1,
      `updated=${repromoted.updated}`,
    )
    // Restaura a licenca imdb para nao poluir estado (historico preservado).
    await exec(`UPDATE source_licenses SET is_current=false WHERE source_key='imdb' AND policy_version='validation/v2'`)
    await exec(`UPDATE source_licenses SET is_current=true WHERE id=${imdbLicenseId}`)

    // ---------- A3: sync sem mudanca renova o carimbo de verificacao ----------
    const { createPrismaExternalRatings } = await import('../src/persistence/external-ratings-store.js')
    const syncStore = createPrismaExternalRatings(prisma as never)
    const t1 = new Date('2026-07-01T00:00:00.000Z')
    const t2 = new Date('2026-07-10T00:00:00.000Z')
    const baseRow = {
      entityType: 'movie' as const,
      entityId: String(movieId),
      ratingSource: 'metacritic' as const,
      ratingLabel: 'Metascore',
      metric: 'metascore',
      scoreType: 'critics' as const,
      ratingValue: 81,
      ratingScale: 100,
      ratingCount: 44,
      ratingUrl: 'https://www.metacritic.com/y',
      providerApi: 'imdb236',
      providerPayloadHash: 'hash-a3',
    }
    await syncStore.upsert({ ...baseRow, fetchedAt: t1, staleAfter: new Date(t1.getTime() + 336 * 3600_000) })
    const afterFirst = (await q<{ updated_at: Date }>(
      `SELECT updated_at FROM external_ratings WHERE entity_id=${movieId} AND rating_source='metacritic' AND metric='metascore'`,
    ))[0]!
    const second = await syncStore.upsert({ ...baseRow, fetchedAt: t2, staleAfter: new Date(t2.getTime() + 336 * 3600_000) })
    // Comparacao NO BANCO (nao por round-trip de Date): as colunas sao
    // timestamp sem tz armazenando UTC; um Date lido via raw chega deslocado
    // pelo timezone da sessao e a comparacao local mentiria fora de UTC.
    const freshCheck = (await q<{ fetched_ok: boolean; updated_same: boolean }>(
      `SELECT fetched_at = '${t2.toISOString()}'::timestamptz AT TIME ZONE 'UTC' AS fetched_ok,
              updated_at = '${afterFirst.updated_at.toISOString()}'::timestamptz AT TIME ZONE 'UTC' AS updated_same
         FROM external_ratings WHERE entity_id=${movieId} AND rating_source='metacritic' AND metric='metascore'`,
    ))[0]!
    record(
      51,
      'A3: sync identico renova fetched_at (relogio de frescor anda) SEM bumpar updated_at',
      second.changed === false && freshCheck.fetched_ok === true && freshCheck.updated_same === true,
      `changed=${second.changed}, fetchedRenovado=${freshCheck.fetched_ok}, updatedAtIgual=${freshCheck.updated_same}`,
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
