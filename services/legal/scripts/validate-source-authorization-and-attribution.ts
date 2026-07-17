/**
 * validate-source-authorization-and-attribution.ts — Prova, em PostgreSQL 16
 * REAL e efêmero, que o registro de autorização de fontes (`pnpm legal`) e o
 * contrato de footer cumprem a seção 12 da missão final.
 *
 * Não testa SQL sintético: aplica a migration + seed de verdade, roda o APPLY
 * real do registry (o mesmo `applyAuthorization` que o bin usa) e verifica o
 * estado resultante. Prova também as travas: nada é promovido, logos/citações/
 * derivada/Cinerie Score continuam bloqueados, apply é idempotente.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTÁVEL — nunca em produto/render/produção.
 * Motor: embedded-postgres (PostgreSQL 16 real, efêmero), devDependency-only.
 * Segurança: nenhum segredo; DATABASE_URL só em memória, mascarado; PG derrubado
 * no finally.
 *
 * Uso (a partir da raiz): pnpm validate:source-authorization-and-attribution
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import {
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
  DECIDED_BY,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import { assertNoBlockedGrants, planAuthorization, isPlanClean } from "../src/plan.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");
const footerContractPath = path.join(repoRoot, "docs", "frontend-contracts", "footer-and-attribution.md");

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
      srv.close();
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

/**
 * Apply REAL do registry contra `tx`. É uma cópia fiel do laço do bin — o bin
 * não é importável (fora do typecheck principal), então o laço vive aqui e no
 * bin; ambos exercitam o MESMO plano puro (`planAuthorization`) e as mesmas
 * funções de fingerprint do banco. O que este validador prova é o resultado.
 */
async function applyAuthorization(
  prisma: PrismaClient,
  entries: readonly AuthorizationEntry[],
  reviewer: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const licenses = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, source_key, content_type::text AS content_type, rating_source_key, provider_key,
              territory_code, license_status::text AS license_status, display_allowed, logo_allowed,
              score_allowed, review_quote_allowed, requires_attribution, requires_linkback,
              attribution_text, policy_version FROM source_licenses WHERE is_current = true`,
    )).map((r) => ({
      id: String(r.id), sourceKey: r.source_key as string, contentType: r.content_type as string,
      ratingSourceKey: (r.rating_source_key as string | null) ?? null, providerKey: (r.provider_key as string | null) ?? null,
      territory: (r.territory_code as string | null) ?? null, licenseStatus: r.license_status as string,
      displayAllowed: r.display_allowed as boolean, logoAllowed: r.logo_allowed as boolean, scoreAllowed: r.score_allowed as boolean,
      reviewQuoteAllowed: r.review_quote_allowed as boolean, requiresAttribution: r.requires_attribution as boolean,
      requiresLinkback: r.requires_linkback as boolean, attributionText: (r.attribution_text as string | null) ?? null,
      policyVersion: (r.policy_version as string | null) ?? null,
    }));
    const decisions = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, source_license_id, use_case, territory, stage::text AS stage, display_allowed,
              storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version
         FROM data_usage_decisions WHERE is_current = true`,
    )).map((r) => ({
      id: String(r.id), sourceLicenseId: String(r.source_license_id), useCase: r.use_case as string,
      territory: (r.territory as string | null) ?? null, stage: r.stage as string, displayAllowed: r.display_allowed as boolean,
      storageAllowed: r.storage_allowed as boolean, derivativeAllowed: r.derivative_allowed as boolean,
      attributionRequired: r.attribution_required as boolean, linkbackRequired: r.linkback_required as boolean,
      policyVersion: (r.policy_version as string | null) ?? null,
    }));

    const plan = planAuthorization(entries, licenses, decisions);
    assertNoBlockedGrants(plan);
    if (isPlanClean(plan)) return;

    for (const entry of plan.entries) {
      let licenseId: string;
      const l = entry.license.target;
      const insertLicense = async (supersedes: string | null): Promise<string> => {
        const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
          INSERT INTO "source_licenses" (
            "source_key","content_type","rating_source_key","provider_key","territory_code",
            "license_status","display_allowed","logo_allowed","score_allowed","review_quote_allowed",
            "requires_attribution","requires_linkback","attribution_text","is_current","supersedes_id",
            "decided_by","decided_at","decision_origin","policy_version","notes","updated_at"
          ) VALUES (
            ${l.sourceKey}, ${l.contentType}::"SourceLicenseContentType", ${l.ratingSourceKey}, ${l.providerKey}, ${l.territory},
            ${l.licenseStatus}::"LicenseStatus", ${l.displayAllowed}, ${l.logoAllowed}, ${l.scoreAllowed}, ${l.reviewQuoteAllowed},
            ${l.requiresAttribution}, ${l.requiresLinkback}, ${l.attributionText}, true,
            ${supersedes === null ? null : BigInt(supersedes)}, ${reviewer}, now(), 'owner_authorization',
            ${l.policyVersion}, ${l.notes}, now()
          ) RETURNING "id"`;
        return String(rows[0]!.id);
      };

      if (entry.license.action === "keep") {
        licenseId = entry.license.currentId!;
      } else if (entry.license.action === "create") {
        licenseId = await insertLicense(null);
      } else {
        await tx.$executeRaw`UPDATE "source_licenses" SET "is_current"=false, "updated_at"=now() WHERE "id"=${BigInt(entry.license.currentId!)}`;
        for (const oldId of entry.deactivateDecisionIds) {
          await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current"=false, "updated_at"=now() WHERE "id"=${BigInt(oldId)}`;
        }
        licenseId = await insertLicense(entry.license.currentId);
      }

      for (const d of entry.decisions) {
        if (d.action === "keep") continue;
        if (d.action === "supersede") {
          await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current"=false, "updated_at"=now() WHERE "id"=${BigInt(d.currentId!)}`;
        }
        const t = d.target;
        await tx.$executeRaw`
          INSERT INTO "data_usage_decisions" (
            "source_license_id","use_case","territory","stage","display_allowed","storage_allowed",
            "derivative_allowed","attribution_required","linkback_required","valid_from","policy_version",
            "decided_by","reason","is_current","supersedes_id","updated_at"
          ) VALUES (
            ${BigInt(licenseId)}, ${t.useCase}, ${t.territory}, ${t.stage}::"DataUsageStage",
            ${t.displayAllowed}, ${t.storageAllowed}, ${t.derivativeAllowed}, ${t.attributionRequired}, ${t.linkbackRequired},
            now(), ${t.policyVersion}, ${reviewer}, 'validacao do registro de autorizacao', true,
            ${d.action === "supersede" ? BigInt(d.currentId!) : null}, now()
          )`;
      }
    }
  });
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql);

  async function expectViolation(n: number, name: string, sql: string, expected: string): Promise<void> {
    try {
      await exec(sql);
      record(n, name, false, "STATEMENT PROIBIDO FOI ACEITO (a trava nao barrou)");
    } catch (e) {
      const msg = (e as Error).message.replace(/\s+/g, " ").trim();
      const hit = msg.toLowerCase().includes(expected.toLowerCase());
      record(n, name, hit, hit ? `barrado corretamente` : `BARRADO PELO MOTIVO ERRADO (esperava "${expected}"): ${msg.slice(0, 140)}`);
    }
  }

  try {
    // Um provedor canônico real (simula onboarding): prova o caminho de streaming
    // display sem inventar slug no spec estático.
    await exec(`INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at) VALUES ('netflix','Netflix','https://www.netflix.com/', now())`);
    await exec(`INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at) SELECT id,'streaming_availability','netflix','Netflix', now() FROM watch_providers WHERE slug='netflix'`);

    const providers = (await q<{ slug: string; canonical_name: string }>(`SELECT slug, canonical_name FROM watch_providers ORDER BY slug`)).map((p) => ({ slug: p.slug, canonicalName: p.canonical_name }));
    const entries = [...STATIC_AUTHORIZATION, ...streamingProviderEntries(providers)];

    // Estado ANTES: notas e ofertas não-exibíveis (simula dados já ingeridos).
    const movie = await q<{ id: bigint }>(`INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (910001,'Filme Legal',now()) RETURNING id`);
    const movieId = Number(movie[0]!.id);
    await exec(`INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type, rating_value, rating_scale, provider_api, fetched_at, updated_at) VALUES ('movie',${movieId},'imdb','IMDb Rating','user_rating','audience',8.4,10,'imdb236', now(), now())`);
    await exec(`INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_name, provider_key, offer_type, provider_api, updated_at) VALUES ('movie',${movieId},'BR','Netflix','netflix','subscription','streaming_availability', now())`);

    const ratingsDisplayableBefore = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM external_ratings WHERE display_allowed=true`))[0]!.c);
    const offersDisplayableBefore = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM watch_availability WHERE display_allowed=true`))[0]!.c);

    // ===================== APPLY REAL =====================
    await applyAuthorization(prisma, entries, DECIDED_BY);

    // 1. Toda fonte declarada tem licença vigente com policy version + decided_by pessoa.
    const licRows = await q<{ source_key: string; content_type: string; license_status: string; policy_version: string | null; decided_by: string | null }>(
      `SELECT source_key, content_type::text AS content_type, license_status::text AS license_status, policy_version, decided_by FROM source_licenses WHERE is_current=true AND decision_origin='owner_authorization'`,
    );
    const expectedSources = new Set(entries.map((e) => `${e.license.sourceKey}/${e.license.contentType}`));
    const gotSources = new Set(licRows.map((r) => `${r.source_key}/${r.content_type}`));
    const allPresent = [...expectedSources].every((s) => gotSources.has(s));
    record(1, "fontes declaradas possuem licenca vigente (owner_authorization)", allPresent && licRows.length === expectedSources.size, `esperadas=${expectedSources.size} obtidas=${licRows.length}`);

    record(2, "toda licenca tem policy_version e decided_by = pessoa", licRows.every((r) => (r.policy_version ?? "").length > 0 && r.decided_by === DECIDED_BY), `decided_by=${licRows[0]?.decided_by ?? "?"}`);

    // 3. rating_display existe para os 5 ratings, território BR, atribuição+linkback.
    const ratingDecisions = await q<{ source_key: string; territory: string | null; attribution_required: boolean; linkback_required: boolean }>(
      `SELECT l.source_key, d.territory, d.attribution_required, d.linkback_required
         FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
        WHERE d.is_current=true AND d.use_case='rating_display' AND d.stage='approved_for_display'`,
    );
    const ratingSources = new Set(ratingDecisions.map((r) => r.source_key));
    const fiveRatings = ["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"].every((s) => ratingSources.has(s));
    record(3, "rating_display existe para as 5 fontes de rating", fiveRatings, `fontes=${[...ratingSources].join(",")}`);
    record(4, "rating_display: territorio=BR e atribuicao/linkback obrigatorios", ratingDecisions.every((r) => r.territory === "BR" && r.attribution_required && r.linkback_required), `n=${ratingDecisions.length}`);

    // 5. watch_offer_display existe para o provedor real, território BR.
    const watchDecisions = await q<{ territory: string | null; attribution_required: boolean }>(
      `SELECT d.territory, d.attribution_required FROM data_usage_decisions d WHERE d.is_current=true AND d.use_case='watch_offer_display' AND d.stage='approved_for_display'`,
    );
    record(5, "watch_offer_display existe para streaming (provedor real), territorio BR", watchDecisions.length === 1 && watchDecisions[0]!.territory === "BR" && watchDecisions[0]!.attribution_required, `n=${watchDecisions.length}`);

    // 6. Logos continuam bloqueados em TODA licença.
    const anyLogo = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM source_licenses WHERE is_current=true AND logo_allowed=true`))[0]!.c);
    record(6, "logos continuam bloqueados (logo_allowed=false em toda licenca vigente)", anyLogo === 0, `logo_allowed=true: ${anyLogo}`);

    // 7. Review quotes bloqueados.
    const anyRq = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM source_licenses WHERE is_current=true AND review_quote_allowed=true`))[0]!.c);
    record(7, "citacao integral de critica bloqueada (review_quote_allowed=false)", anyRq === 0, `review_quote_allowed=true: ${anyRq}`);

    // 8. Derivative bloqueado em TODA decisão.
    const anyDerivative = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM data_usage_decisions WHERE is_current=true AND derivative_allowed=true`))[0]!.c);
    record(8, "obra derivada bloqueada (derivative_allowed=false em toda decisao)", anyDerivative === 0, `derivative_allowed=true: ${anyDerivative}`);

    // 9. Cinerie Score continua bloqueado: nenhuma decisão cinerie_score_display.
    const cinerieDecisions = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM data_usage_decisions WHERE use_case='cinerie_score_display'`))[0]!.c);
    record(9, "Cinerie Score continua BLOCKED_BY_DECISION (nenhuma decisao cinerie_score_display)", cinerieDecisions === 0, `decisoes=${cinerieDecisions}`);

    // 10. NENHUMA promoção: ratings e ofertas continuam não-exibíveis.
    const ratingsDisplayableAfter = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM external_ratings WHERE display_allowed=true`))[0]!.c);
    const offersDisplayableAfter = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM watch_availability WHERE display_allowed=true`))[0]!.c);
    record(10, "nenhum rating foi promovido por efeito colateral", ratingsDisplayableBefore === 0 && ratingsDisplayableAfter === 0, `antes=${ratingsDisplayableBefore} depois=${ratingsDisplayableAfter}`);
    record(11, "nenhuma oferta foi promovida por efeito colateral", offersDisplayableBefore === 0 && offersDisplayableAfter === 0, `antes=${offersDisplayableBefore} depois=${offersDisplayableAfter}`);

    // 12. screen_score_display continua barrado (Cinerie Score sem decisão).
    await expectViolation(12, "cinerie score: screen_score_display=true continua barrado (sem decisao)",
      `UPDATE movies SET screen_score=4.0, screen_score_scale=5, screen_score_display=true WHERE id=${movieId}`,
      "BLOCKED_BY_DECISION");

    // 13. APPLY é IDEMPOTENTE: segunda vez não escreve.
    const licCountBefore = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM source_licenses`))[0]!.c);
    const decCountBefore = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM data_usage_decisions`))[0]!.c);
    await applyAuthorization(prisma, entries, DECIDED_BY);
    const licCountAfter = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM source_licenses`))[0]!.c);
    const decCountAfter = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM data_usage_decisions`))[0]!.c);
    record(13, "apply idempotente: segunda execucao nao cria linhas", licCountAfter === licCountBefore && decCountAfter === decCountBefore, `lic ${licCountBefore}->${licCountAfter}, dec ${decCountBefore}->${decCountAfter}`);

    // 14. Histórico preservado: as sementes de rating viraram is_current=false (supersedidas).
    const seedSuperseded = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM source_licenses WHERE source_key='imdb' AND content_type='rating' AND is_current=false`))[0]!.c);
    record(14, "historico preservado: licenca-semente supersedida (nao apagada)", seedSuperseded >= 1, `linhas is_current=false=${seedSuperseded}`);

    // 15. Uma nota IMDb agora PODE ser promovida pelo caminho governado (a cadeia
    // existe), provando que a autorização é funcional — mas só sob revisor humano.
    const imdbRatingId = String(Number((await q<{ id: bigint }>(`SELECT id FROM external_ratings WHERE entity_id=${movieId} AND rating_source='imdb'`))[0]!.id));
    await exec(`UPDATE external_ratings SET license_status='third_party', attribution_text='Nota fornecida por IMDb', attribution_url='https://www.imdb.com/title/tt1/' WHERE id=${imdbRatingId}`);
    await exec(`UPDATE external_ratings r SET display_allowed=true, reviewed_at=now(), reviewed_by='ana@cinerie',
                 data_usage_decision_id=(SELECT d.id FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
                   WHERE d.use_case='rating_display' AND d.is_current AND d.stage='approved_for_display' AND l.rating_source_key='imdb' AND l.is_current AND l.content_type='rating' AND (d.territory IS NULL OR d.territory='BR') ORDER BY (d.territory IS NOT NULL) DESC LIMIT 1),
                 approved_payload_hash=external_rating_payload_fingerprint_v1(r.entity_type,r.entity_id,r.rating_source,r.metric,r.score_type,r.rating_label,r.rating_value,r.rating_scale,r.rating_count,r.rating_url,r.provider_api,r.license_status,r.requires_attribution,r.requires_linkback,r.attribution_text,r.attribution_url)
                 WHERE r.id=${imdbRatingId}`);
    const imdbDisplay = (await q<{ display_allowed: boolean }>(`SELECT display_allowed FROM external_ratings WHERE id=${imdbRatingId}`))[0]!.display_allowed;
    record(15, "a autorizacao e FUNCIONAL: nota IMDb promovivel pelo caminho governado (revisor humano)", imdbDisplay === true, `display=${imdbDisplay}`);

    // 16. Licença supersedida bloqueia reescrita da nota exibida (autoridade).
    const imdbLicId = Number((await q<{ id: bigint }>(`SELECT id FROM source_licenses WHERE source_key='imdb' AND content_type='rating' AND is_current=true`))[0]!.id);
    await exec(`UPDATE source_licenses SET is_current=false WHERE id=${imdbLicId}`);
    await exec(`INSERT INTO source_licenses (source_key, content_type, rating_source_key, license_status, display_allowed, is_current, decided_by, decided_at, policy_version, supersedes_id, updated_at) VALUES ('imdb','rating','imdb','blocked',false,true,'juridico@cinerie',now(),'x/v2',${imdbLicId},now())`);
    // fetched_at NÃO está no fingerprint (é o que o sync toca a cada verificação):
    // mantém o hash válido e faz o guard chegar até o check da licença-mãe, em
    // vez de parar antes no check de hash. Prova o achado A1 isolado.
    await expectViolation(16, "licenca supersedida bloqueia reescrever a nota exibida",
      `UPDATE external_ratings SET fetched_at=now() WHERE id=${imdbRatingId}`,
      "foi supersedida");

    // 17. Footer contract contém a frase literal do TMDB.
    let footerHasTmdb = false;
    try {
      const footer = readFileSync(footerContractPath, "utf8");
      footerHasTmdb = footer.includes("Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB.");
    } catch { footerHasTmdb = false; }
    record(17, "footer contract contem a frase literal do TMDB", footerHasTmdb, footerHasTmdb ? "presente" : "AUSENTE");

    // 18. Território BR respeitado: nenhuma decisão de display fora de {BR, global}.
    const badTerritory = Number((await q<{ c: number }>(`SELECT count(*)::int AS c FROM data_usage_decisions WHERE is_current=true AND display_allowed=true AND territory IS NOT NULL AND territory<>'BR'`))[0]!.c);
    record(18, "territorio BR respeitado (nenhuma decisao de display fora de BR/global)", badTerritory === 0, `fora de BR/global: ${badTerritory}`);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.split("\n")[0]);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-legal-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_legal?schema=public`;
  console.log(`\n=== source authorization & attribution — PostgreSQL efemero :${port} (postgres:****) ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_legal");
    const env = { ...process.env, DATABASE_URL: url };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-1, "migrate deploy", true, "ok");
    console.log("--- db seed ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-2, "db seed", true, "ok");
    await runChecks(url);
  } catch (e) {
    record(0, "boot", false, (e as Error).message.split("\n")[0]);
  } finally {
    if (started) {
      try { await pg.stop(); } catch { /* best-effort */ }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.filter((r) => r.n > 0).length;
  console.log(`\nRESUMO (source authorization & attribution): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Autorizacao de fontes registrada e atribuicao/bloqueios provados; nada promovido, Cinerie Score bloqueado.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
