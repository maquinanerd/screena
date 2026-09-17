/**
 * validate-source-authorization-legacy-grants.ts — O ciclo completo do reparo,
 * em PostgreSQL 16 REAL e efêmero, partindo do estado de produção.
 *
 * O PROBLEMA. Até 2026-08-12, `db:seed` rodado depois de `legal sources apply`
 * fazia `update` IN PLACE na licença VIGENTE de cada fonte de rating — mesmo id,
 * mesmo `is_current`, mesmas decisões penduradas — rebaixando para
 * `license_status='unknown'`/`display_allowed=false`. As decisões continuavam
 * concedendo sob licença não-exibível. Elas eram LEGAIS quando nasceram (o
 * guarda `data_usage_decisions_guard` está armado desde a criação da tabela);
 * a licença é que foi rebaixada debaixo delas. Daí o impasse: a decisão não sai
 * porque a licença-mãe é `unknown`; a licença não é substituída porque a
 * decisão não sai.
 *
 * O QUE ESTE VALIDADOR PROVA, nesta ordem:
 *   (b1) `db:seed` rodado DEPOIS do apply não muda mais NADA.
 *   (b4) o rebaixamento é recusado NA ORIGEM pelo trigger novo.
 *   ---- desarma o trigger só para reconstruir o estado legado (que nasceu
 *        antes dele existir) — o próprio desarme é a prova de que (b4) o impede
 *   (a)  a remediação aposenta as decisões legadas zerando os grants,
 *        preservando stage/use_case/policy_version/decided_by/reason/valid_from;
 *        recusa por inteiro o que não bate a impressão digital.
 *   ---- e então o `legal sources apply` volta a passar, e uma nota exibe com
 *        crédito.
 *
 * CONTAGENS: saem do `STATIC_AUTHORIZATION` vigente (`./spec-expectations.ts`),
 * nunca de literal. Os literais de 2026-08-12 (8 licenças, 13 decisões, 10
 * decisões legadas, 5 licenças de rating exibíveis) batiam com o spec daquele
 * dia e envelheceram com ele sem ninguém ver — este validador não roda na CI.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTÁVEL — nunca em produto/render/produção.
 * Motor: embedded-postgres (PostgreSQL 16 real, efêmero), devDependency-only.
 * Segurança: nenhum segredo; DATABASE_URL só em memória, mascarado; PG derrubado
 * no finally.
 *
 * Uso (a partir da raiz): pnpm validate:source-authorization-legacy-grants
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

import { applyAuthorizationWithin } from "../src/apply.js";
import {
  STATIC_AUTHORIZATION,
  AUTHORIZATION_REASON,
  DECIDED_BY,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import {
  applyRemediationWithin,
  planRemediation,
  readLegacyGrants,
  renderRemediationRecord,
} from "../src/remediation.js";
import { describeSpecExpectations, specExpectations } from "./spec-expectations.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

interface CheckResult { n: number; name: string; ok: boolean; detail: string }
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

/** Ver a nota extensa em validate-source-authorization-and-attribution.ts. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      if (port <= 0) {
        srv.close(() => reject(new Error("nao foi possivel reservar uma porta TCP valida")));
        return;
      }
      srv.close((error) => (error !== undefined ? reject(error) : resolve(port)));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  if (rel === undefined) throw new Error("prisma/package.json sem entrada bin.prisma");
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

const msg = (e: unknown): string => (e as Error).message.replace(/\s+/g, " ").trim();

/**
 * O UPDATE que `seed.ts` fazia ATÉ 2026-08-12 — verbatim nos campos que ele
 * tocava (os de `SOURCE_LICENSE_SEED`). `decision_origin` e `policy_version`
 * NÃO estão aqui de propósito: o seed nunca os escreveu, e é essa combinação
 * (`unknown` + `owner_authorization` + policy preenchida) que vira a impressão
 * digital do rebaixamento.
 */
const CLOBBER_SQL = `
  UPDATE source_licenses
     SET license_status='unknown', display_allowed=false, logo_allowed=false,
         score_allowed=false, review_quote_allowed=false,
         requires_attribution=true, requires_linkback=true,
         notes='Licenca nao confirmada; nada exibivel ate revisao humana (Fase 1, default seguro).',
         updated_at=now()
   WHERE is_current=true AND content_type='rating'`;

async function runChecks(url: string, runSeed: () => void): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql);
  const count = async (sql: string): Promise<number> =>
    Number((await q<{ c: number }>(`SELECT count(*)::int AS c ${sql}`))[0]!.c);

  /** Apply REAL — o mesmo laço que `pnpm legal sources apply --confirm` executa. */
  const apply = (entries: readonly AuthorizationEntry[]): Promise<void> =>
    prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, entries, { reviewer: DECIDED_BY, reason: AUTHORIZATION_REASON });
    });

  // `id` vem como BigInt do Prisma e JSON.stringify nao serializa BigInt.
  const snapshot = async (): Promise<string> =>
    JSON.stringify(
      await q(
        `SELECT id, license_status::text AS s, display_allowed, score_allowed, requires_linkback, policy_version, decision_origin
           FROM source_licenses ORDER BY id`,
      ),
      (_k, v: unknown) => (typeof v === "bigint" ? String(v) : v),
    );

  try {
    // Só a leva ESTÁTICA (as licenças de provedor de streaming nascem de
    // `watch_providers`, que este banco efêmero não tem). É dela que sai toda
    // contagem esperada abaixo.
    const entries = STATIC_AUTHORIZATION;
    const esperado = specExpectations(entries);
    console.log(describeSpecExpectations(esperado));
    // A semente, lida ANTES do apply: a leva a supersede inteira, e ela continua
    // no total de `source_licenses` como histórico.
    const semente = await count(`FROM source_licenses WHERE is_current=true`);
    const licTotalEsperado = esperado.licenses + semente;

    // ============ 1-2. (b1) O SEED NAO REBAIXA MAIS ============
    await apply(entries);
    record(1, `apply cria a leva completa (${esperado.licenses} licencas vigentes, ${esperado.decisions} decisoes)`,
      (await count(`FROM source_licenses WHERE is_current=true`)) === esperado.licenses &&
        (await count(`FROM data_usage_decisions WHERE is_current=true`)) === esperado.decisions,
      `licencas=${await count(`FROM source_licenses WHERE is_current=true`)} decisoes=${await count(`FROM data_usage_decisions WHERE is_current=true`)}`);

    const antesDoSeed = await snapshot();
    runSeed();
    const depoisDoSeed = await snapshot();
    record(2, "(b1) db:seed rodado DEPOIS do apply nao muda NADA em source_licenses",
      antesDoSeed === depoisDoSeed,
      antesDoSeed === depoisDoSeed ? "estado identico (o seed pulou e logou)" : "O SEED AINDA MEXE NA LICENCA VIGENTE");

    record(3, "(b1) o seed tambem nao cria linha nova nem mexe em decisao",
      (await count(`FROM source_licenses`)) === licTotalEsperado &&
        (await count(`FROM data_usage_decisions`)) === esperado.decisions,
      `licencas=${await count(`FROM source_licenses`)} decisoes=${await count(`FROM data_usage_decisions`)} (esperado ${licTotalEsperado} e ${esperado.decisions})`);

    // ============ 4. (b4) O REBAIXAMENTO E RECUSADO NA ORIGEM ============
    let recusaDowngrade = "";
    try {
      await exec(CLOBBER_SQL);
    } catch (e) {
      recusaDowngrade = msg(e);
    }
    record(4, "(b4) rebaixar licenca vigente com decisao viva concedendo e RECUSADO pelo banco",
      recusaDowngrade.toLowerCase().includes("nao pode ser rebaixada"),
      recusaDowngrade === "" ? "O REBAIXAMENTO PASSOU (a trava nao existe)" : recusaDowngrade.slice(0, 175));

    // (b4) não pode ser zeloso demais: aposentar licença continua permitido (é o
    // caminho do supersede) e mexer em campo irrelevante também.
    let colateral = "";
    try {
      await exec(`UPDATE source_licenses SET notes = notes || ' ' WHERE is_current=true AND content_type='rating'`);
    } catch (e) {
      colateral = msg(e);
    }
    record(5, "(b4) nao e zelosa demais: UPDATE que nao rebaixa continua passando",
      colateral === "", colateral === "" ? "UPDATE neutro aceito" : `BARRADO INDEVIDAMENTE: ${colateral.slice(0, 150)}`);

    // ============ 6. RECONSTRUCAO DO ESTADO LEGADO ============
    // O estado legado nasceu ANTES de (b4). Reconstruí-lo exige desarmar o
    // trigger — e precisar desarmar é, em si, a prova de que (b4) o impede.
    await exec(`ALTER TABLE source_licenses DISABLE TRIGGER "source_licenses_no_downgrade_guard"`);
    await exec(CLOBBER_SQL);
    await exec(`ALTER TABLE source_licenses ENABLE TRIGGER "source_licenses_no_downgrade_guard"`);

    const licCurrent = await count(`FROM source_licenses WHERE is_current=true`);
    const licTotal = await count(`FROM source_licenses`);
    const decCurrent = await count(`FROM data_usage_decisions WHERE is_current=true`);
    const ratingDisplay = await count(
      `FROM data_usage_decisions WHERE is_current=true AND use_case='rating_display' AND territory='BR' AND display_allowed=true`,
    );
    record(6, `estado tem a forma de producao (${esperado.licenses} licencas vigentes de ${licTotalEsperado}; ${esperado.decisions} decisoes vigentes; ${esperado.ratingDisplayBR} rating_display/BR display=true)`,
      licCurrent === esperado.licenses && licTotal === licTotalEsperado &&
        decCurrent === esperado.decisions && ratingDisplay === esperado.ratingDisplayBR,
      `vigentes=${licCurrent}/${licTotal} decisoes=${decCurrent} rating_display/BR=${ratingDisplay}`);

    // ============ 7. O IMPASSE, ANTES DO REPARO ============
    let impasse = "";
    try {
      await apply(entries);
    } catch (e) {
      impasse = msg(e);
    }
    record(7, "apply empaca: license_status unknown nao permite uso concedido",
      impasse.toLowerCase().includes("nao permite uso concedido"),
      impasse === "" ? "O APPLY PASSOU (impasse nao reproduzido)" : impasse.slice(0, 175));

    // ============ 8-10. (a) A REMEDIACAO ============
    const grants = await readLegacyGrants(prisma);
    const plan = planRemediation(grants);
    // O rebaixamento pega as licenças de RATING (`CLOBBER_SQL`), então a
    // remediação tem de enxergar toda decisão delas que concede alguma coisa.
    record(8, `remediacao enxerga TODA decisao viva concedendo sob licenca unknown (${esperado.ratingGrants} no spec)`,
      plan.items.length === esperado.ratingGrants && plan.remediable.length === esperado.ratingGrants &&
        plan.refused.length === 0,
      `total=${plan.items.length} reparaveis=${plan.remediable.length} recusadas=${plan.refused.length} ` +
        `(display=${plan.items.filter((i) => i.grant.displayAllowed).length}, so storage=${plan.items.filter((i) => !i.grant.displayAllowed).length})`);

    // Dry-run não escreve.
    const decAntes = await count(`FROM data_usage_decisions WHERE is_current=true`);
    record(9, "dry-run nao escreve nada",
      decAntes === esperado.decisions, `decisoes vigentes apos o dry-run=${decAntes} (esperado ${esperado.decisions})`);
    console.log("\n--- REGISTRO NOMINAL (o que vai para docs/legal/) ---");
    console.log(renderRemediationRecord(plan, "2026-08-12"));
    console.log("--- fim do registro ---\n");

    const antesPorId = new Map(
      (await q<{ id: bigint; stage: string; use_case: string; policy_version: string; decided_by: string; reason: string; valid_from: Date }>(
        `SELECT id, stage::text AS stage, use_case, policy_version, decided_by, reason, valid_from FROM data_usage_decisions`,
      )).map((r) => [String(r.id), r]),
    );

    const retired = await prisma.$transaction(async (tx) => applyRemediationWithin(tx, plan));
    record(10, `--confirm aposenta as ${esperado.ratingGrants} decisoes legadas`,
      retired === esperado.ratingGrants &&
        (await count(`FROM data_usage_decisions WHERE is_current=true`)) === esperado.decisions - esperado.ratingGrants,
      `aposentadas=${retired} vigentes restantes=${await count(`FROM data_usage_decisions WHERE is_current=true`)} (esperado ${esperado.ratingGrants} e ${esperado.decisions - esperado.ratingGrants})`);

    // ============ 11-12. O QUE SOBREVIVEU / O QUE SE PERDEU ============
    const depois = await q<{ id: bigint; stage: string; use_case: string; policy_version: string; decided_by: string; reason: string; valid_from: Date; display_allowed: boolean; storage_allowed: boolean; derivative_allowed: boolean; is_current: boolean }>(
      `SELECT id, stage::text AS stage, use_case, policy_version, decided_by, reason, valid_from,
              display_allowed, storage_allowed, derivative_allowed, is_current
         FROM data_usage_decisions WHERE is_current=false ORDER BY id`,
    );
    const preservado = depois.every((d) => {
      const a = antesPorId.get(String(d.id));
      return a !== undefined && a.stage === d.stage && a.use_case === d.use_case &&
        a.policy_version === d.policy_version && a.decided_by === d.decided_by && a.reason === d.reason &&
        new Date(a.valid_from).getTime() === new Date(d.valid_from).getTime();
    });
    record(11, "auditoria preservada: stage, use_case, policy_version, decided_by, reason e valid_from intactos",
      depois.length === esperado.ratingGrants && preservado,
      `linhas aposentadas=${depois.length} stages=${[...new Set(depois.map((d) => d.stage))].join(",")}`);

    record(12, "grants zerados (a perda declarada) e nada mais",
      depois.every((d) => !d.display_allowed && !d.storage_allowed && !d.derivative_allowed && !d.is_current),
      `com grant remanescente=${depois.filter((d) => d.display_allowed || d.storage_allowed).length}`);

    // ============ 13-15. O APPLY VOLTA A PASSAR ============
    let applyDepois = "";
    try {
      await apply(entries);
    } catch (e) {
      applyDepois = msg(e);
    }
    record(13, "apos a remediacao, o apply passa",
      applyDepois === "", applyDepois === "" ? "aplicado" : `BARRADO: ${applyDepois.slice(0, 175)}`);

    // Toda licença de rating volta ao estado que o SPEC declara para ela. Em
    // 2026-08-12 eram as 5 em third_party/display=true; desde a revogação de
    // 2026-08-13, Letterboxd e FilmAffinity voltam a third_party/display=false —
    // que é o autorizado para elas, e não uma licença que deixou de voltar.
    const specRating = new Map(
      entries.filter((e) => e.license.contentType === "rating").map((e) => [e.license.ratingSourceKey, e.license]),
    );
    const ratingVigentes = await q<{ rating_source_key: string; license_status: string; display_allowed: boolean }>(
      `SELECT rating_source_key, license_status::text AS license_status, display_allowed
         FROM source_licenses WHERE is_current=true AND content_type='rating' ORDER BY rating_source_key`,
    );
    const deVoltaAoSpec = ratingVigentes.filter((l) => {
      const alvo = specRating.get(l.rating_source_key);
      return alvo !== undefined && alvo.licenseStatus === l.license_status && alvo.displayAllowed === l.display_allowed;
    }).length;
    record(14, `as ${esperado.ratingLicenses} licencas de rating voltam ao estado do spec (license_status e display_allowed)`,
      ratingVigentes.length === esperado.ratingLicenses && deVoltaAoSpec === esperado.ratingLicenses,
      `vigentes=${ratingVigentes.length} de volta ao spec=${deVoltaAoSpec} ` +
        `(${ratingVigentes.map((l) => `${l.rating_source_key}=${l.license_status}/${l.display_allowed ? "display" : "sem display"}`).join(", ")})`);

    record(15, "nenhuma decisao vigente concede sob licenca nao-exibivel",
      (await readLegacyGrants(prisma)).length === 0,
      `linhas legadas restantes=${(await readLegacyGrants(prisma)).length}`);

    // ============ 16. UMA NOTA EXIBINDO COM CREDITO ============
    const movie = await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (930001,'Filme Pos-Remediacao',now()) RETURNING id`,
    );
    const movieId = Number(movie[0]!.id);
    await exec(
      `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type,
         rating_value, rating_scale, rating_url, provider_api, license_status, requires_attribution, requires_linkback,
         attribution_text, attribution_url, fetched_at, updated_at)
       VALUES ('movie',${movieId},'imdb','IMDb','audience','audience',8.4,10,'https://www.imdb.com/title/tt0111161/',
         'omdb','third_party',true,true,'Nota fornecida por IMDb','https://www.imdb.com/title/tt0111161/', now(), now())`,
    );
    let notaErro = "";
    try {
      await exec(
        `UPDATE external_ratings r SET display_allowed=true, reviewed_at=now(), reviewed_by='ana@cinerie',
           data_usage_decision_id=(SELECT d.id FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
             WHERE d.use_case='rating_display' AND d.is_current AND d.stage='approved_for_display'
               AND l.rating_source_key='imdb' AND l.is_current AND l.content_type='rating'
               AND (d.territory IS NULL OR d.territory='BR') ORDER BY (d.territory IS NOT NULL) DESC LIMIT 1),
           approved_payload_hash=external_rating_payload_fingerprint_v1(r.entity_type,r.entity_id,r.rating_source,r.metric,
             r.score_type,r.rating_label,r.rating_value,r.rating_scale,r.rating_count,r.rating_url,r.provider_api,
             r.license_status,r.requires_attribution,r.requires_linkback,r.attribution_text,r.attribution_url)
         WHERE r.entity_id=${movieId}`,
      );
    } catch (e) {
      notaErro = msg(e);
    }
    const nota = (await q<{ display_allowed: boolean; attribution_text: string | null }>(
      `SELECT display_allowed, attribution_text FROM external_ratings WHERE entity_id=${movieId}`,
    ))[0];
    record(16, "nota IMDb exibe com credito pelo caminho governado",
      notaErro === "" && nota?.display_allowed === true && (nota?.attribution_text ?? "") === "Nota fornecida por IMDb",
      notaErro !== "" ? `BARRADO: ${notaErro.slice(0, 150)}` : `display=${nota?.display_allowed} credito="${nota?.attribution_text}"`);

    // ============ 17. CONTROLE NEGATIVO: IMPRESSAO DIGITAL QUE NAO BATE ============
    // `blocked` e decisao humana deliberada — a remediacao tem de RECUSAR, nao
    // "consertar". Reconstruido do mesmo jeito (desarmando (b4)), o que de novo
    // prova que a trava esta funcionando.
    const alvo = (await q<{ id: bigint }>(
      `SELECT id FROM source_licenses WHERE is_current=true AND content_type='rating' ORDER BY id LIMIT 1`,
    ))[0]!;
    await exec(`ALTER TABLE source_licenses DISABLE TRIGGER "source_licenses_no_downgrade_guard"`);
    await exec(`UPDATE source_licenses SET license_status='blocked', display_allowed=false WHERE id=${alvo.id}`);
    await exec(`ALTER TABLE source_licenses ENABLE TRIGGER "source_licenses_no_downgrade_guard"`);

    const planBlocked = planRemediation(await readLegacyGrants(prisma));
    record(17, "controle negativo: licenca 'blocked' NAO bate a impressao digital e a remediacao recusa",
      planBlocked.items.length > 0 && planBlocked.remediable.length === 0 &&
        planBlocked.refused.length === planBlocked.items.length &&
        planBlocked.refused.every((r) => r.failedConditions.some((c) => c.includes("blocked"))),
      `itens=${planBlocked.items.length} reparaveis=${planBlocked.remediable.length} recusadas=${planBlocked.refused.length} motivo="${planBlocked.refused[0]?.failedConditions[0] ?? ""}"`);

    let recusaEscrita = "";
    try {
      await prisma.$transaction(async (tx) => applyRemediationWithin(tx, planBlocked));
    } catch (e) {
      recusaEscrita = msg(e);
    }
    record(18, "controle negativo: a escrita tambem recusa (fail-closed, nao so o relatorio)",
      recusaEscrita.toLowerCase().includes("remediacao recusada"),
      recusaEscrita === "" ? "A ESCRITA PASSOU" : recusaEscrita.slice(0, 150));
  } catch (e) {
    record(0, "execucao", false, msg(e).slice(0, 220));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-legal-legacy-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_legal?schema=public`;
  console.log(`\n=== remediacao de decisoes legadas sob licenca unknown — PostgreSQL efemero :${port} (postgres:****) ===\n`);

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_legal");
    const env = { ...process.env, DATABASE_URL: url };
    const runSeed = (): void => {
      execFileSync("node", [prismaBin(), "db", "seed", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    };
    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], { env, stdio: "inherit", cwd: dbDir });
    record(-1, "migrate deploy", true, "ok");
    console.log("--- db seed (1a vez) ---");
    runSeed();
    record(-2, "db seed", true, "ok");
    await runChecks(url, runSeed);
  } catch (e) {
    record(0, "boot", false, msg(e).slice(0, 200));
  } finally {
    if (started) {
      try { await pg.stop(); } catch { /* best-effort */ }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.filter((r) => r.n > 0).length;
  console.log(`\nRESUMO (remediacao de decisoes legadas): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Seed nao rebaixa mais, banco recusa rebaixamento, remediacao aposenta preservando auditoria, apply volta a passar.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
