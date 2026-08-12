/**
 * validate-source-authorization-supersede.ts — Prova, em PostgreSQL 16 REAL e
 * efêmero, o ciclo que derrubou o `legal sources apply --confirm` em produção
 * (2026-08-12):
 *
 *   P0001: data_usage_decisions fail-closed: licenca 8 nao e a vigente (is_current=false)
 *
 * O QUE ESTE VALIDADOR TEM QUE O OUTRO NÃO TINHA: o **estado inicial**.
 * `validate-source-authorization-and-attribution.ts` parte do seed — cinco
 * licenças conservadoras (`unknown`, `display_allowed=false`) e ZERO decisões.
 * Nesse estado o `supersede` roda com `deactivateDecisionIds` vazio: o laço que
 * contém o defeito nunca executa. Produção estava uma leva à frente — licenças
 * vigentes JÁ COM decisões vigentes penduradas —, e é exatamente aí que a ordem
 * das desativações importa.
 *
 * Então aqui o banco é levado ao estado de produção pelo caminho real (aplicar a
 * leva ANTERIOR de autorização) antes de aplicar a leva nova. Números que este
 * script reproduz e confere, os mesmos observados em produção:
 *   - 8 licenças vigentes de 13 totais (as 5 sementes supersedidas, não apagadas)
 *   - 13 decisões vigentes, 5 delas rating_display/BR com display_allowed=true
 *   - plano da leva nova: supersede=5, licenças mantidas=3, decisões create=10
 *
 * Fecha com o CONTROLE NEGATIVO: reexecuta a ordem defeituosa à mão e exige que
 * o banco ainda barre com a mesma mensagem. Sem ele, este validador ficaria
 * verde também se alguém afrouxasse o trigger em vez de corrigir o laço.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTÁVEL — nunca em produto/render/produção.
 * Motor: embedded-postgres (PostgreSQL 16 real, efêmero), devDependency-only.
 * Segurança: nenhum segredo; DATABASE_URL só em memória, mascarado; PG derrubado
 * no finally.
 *
 * Uso (a partir da raiz): pnpm validate:source-authorization-supersede
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

import { applyAuthorizationWithin, readCurrentState } from "../src/apply.js";
import {
  STATIC_AUTHORIZATION,
  AUTHORIZATION_REASON,
  DECIDED_BY,
  ratingRequiresLinkback,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import { planAuthorization } from "../src/plan.js";

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

/**
 * A leva ANTERIOR de autorização — o que já estava gravado no banco de produção
 * quando o apply de 2026-08-12 rodou.
 *
 * Construída a partir do spec ATUAL: nas cinco licenças de `rating` recua a
 * versão de política e restaura o linkback obrigatório (o estado anterior à
 * dispensa de 2026-08-12); as três não-rating (TMDB metadados, TMDB imagens,
 * Movie of the Night) ficam idênticas.
 *
 * As strings exatas de `policy_version` gravadas em produção não são
 * reconstrutíveis a partir do repositório. O que este helper fixa — e é o que
 * importa — é a FORMA do plano que produção imprimiu no dry-run: supersede=5,
 * licenças mantidas=3, decisões create=10, decisões mantidas=3, e **cada
 * licença a supersedir já carregando decisões vigentes** (checks 5 e 6).
 */
function previousLeva(entries: readonly AuthorizationEntry[]): readonly AuthorizationEntry[] {
  return entries.map((entry) => {
    if (entry.license.contentType !== "rating") return entry;
    const policyVersion = entry.license.policyVersion.replace(/\/2026-0[0-9]-v1$/, "/2026-07-v0");
    return {
      ...entry,
      license: { ...entry.license, requiresLinkback: true, policyVersion },
      decisions: entry.decisions.map((d) => ({ ...d, linkbackRequired: true, policyVersion })),
    };
  });
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const q = <T>(sql: string): Promise<T[]> => prisma.$queryRawUnsafe<T[]>(sql);
  const exec = (sql: string): Promise<number> => prisma.$executeRawUnsafe(sql);
  const count = async (sql: string): Promise<number> =>
    Number((await q<{ c: number }>(`SELECT count(*)::int AS c ${sql}`))[0]!.c);

  /** Roda o apply REAL (o mesmo laço do bin) numa transação. */
  const apply = (entries: readonly AuthorizationEntry[]): Promise<void> =>
    prisma.$transaction(async (tx) => {
      await applyAuthorizationWithin(tx, entries, { reviewer: DECIDED_BY, reason: AUTHORIZATION_REASON });
    });

  try {
    // Produção não tem NENHUM provedor canônico de streaming registrado, então
    // `streamingProviderEntries` devolve lista vazia lá. Reproduzir isso é o que
    // faz os totais baterem (8 licenças / 13 decisões).
    const entries = STATIC_AUTHORIZATION;

    // ============ 1. ESTADO INICIAL: só a semente conservadora ============
    const seedLicenses = await q<{ source_key: string; license_status: string; display_allowed: boolean }>(
      `SELECT source_key, license_status::text AS license_status, display_allowed FROM source_licenses WHERE is_current=true ORDER BY source_key`,
    );
    const seedDecisions = await count(`FROM data_usage_decisions`);
    const seedConservative =
      seedLicenses.length === 5 &&
      seedLicenses.every((l) => l.license_status === "unknown" && !l.display_allowed) &&
      seedDecisions === 0;
    record(1, "estado inicial e a semente conservadora (5 licencas unknown/display=false, 0 decisoes)",
      seedConservative, `licencas=${seedLicenses.length} status=${[...new Set(seedLicenses.map((l) => l.license_status))].join(",")} decisoes=${seedDecisions}`);

    // ============ 2. LEVA ANTERIOR: como producao chegou ao estado atual ============
    let levaAnteriorErro = "";
    try {
      await apply(previousLeva(entries));
    } catch (e) {
      levaAnteriorErro = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(2, "leva ANTERIOR aplica sobre a semente (nenhuma decisao vigente a desativar)",
      levaAnteriorErro === "", levaAnteriorErro === "" ? "aplicada" : `FALHOU: ${levaAnteriorErro.slice(0, 160)}`);

    // ============ 3. O ESTADO INICIAL DE PRODUCAO, REPRODUZIDO ============
    const licCurrent = await count(`FROM source_licenses WHERE is_current=true`);
    const licTotal = await count(`FROM source_licenses`);
    const decCurrent = await count(`FROM data_usage_decisions WHERE is_current=true`);
    const ratingDisplayCurrent = await count(
      `FROM data_usage_decisions WHERE is_current=true AND use_case='rating_display' AND territory='BR' AND display_allowed=true`,
    );
    const productionShape = licCurrent === 8 && licTotal === 13 && decCurrent === 13 && ratingDisplayCurrent === 5;
    record(3, "estado inicial == producao (8 licencas vigentes de 13; 13 decisoes vigentes; 5 rating_display/BR display=true)",
      productionShape, `vigentes=${licCurrent}/${licTotal} decisoes=${decCurrent} rating_display/BR=${ratingDisplayCurrent}`);

    // A semente NÃO foi apagada: virou histórico.
    const seedSuperseded = await count(`FROM source_licenses WHERE is_current=false AND license_status='unknown'`);
    record(4, "semente conservadora preservada como historico (is_current=false, nao apagada)",
      seedSuperseded === 5, `linhas unknown is_current=false: ${seedSuperseded}`);

    // ============ 5. O DRY-RUN DA LEVA NOVA, IGUAL AO DE PRODUCAO ============
    const { licenses, decisions } = await readCurrentState(prisma);
    const plan = planAuthorization(entries, licenses, decisions);
    const s = plan.summary;
    record(5, "dry-run da leva nova reproduz o plano de producao (supersede=5, keep=3, decisoes create=10)",
      s.licensesSupersede === 5 && s.licensesKeep === 3 && s.licensesCreate === 0 && s.decisionsCreate === 10,
      `supersede=${s.licensesSupersede} keep=${s.licensesKeep} create=${s.licensesCreate} decCreate=${s.decisionsCreate} decKeep=${s.decisionsKeep}`);

    // A CONDIÇÃO QUE O OUTRO VALIDADOR NUNCA TINHA: toda licença a supersedir já
    // carrega decisões vigentes. É este laço — e só ele — que o defeito habitava.
    const supersedeEntries = plan.entries.filter((e) => e.license.action === "supersede");
    const comDecisoesPenduradas = supersedeEntries.filter((e) => e.deactivateDecisionIds.length > 0);
    record(6, "toda licenca a supersedir JA carrega decisoes vigentes (a condicao que o defeito exigia)",
      supersedeEntries.length > 0 && comDecisoesPenduradas.length === supersedeEntries.length,
      `supersede=${supersedeEntries.length} com decisoes penduradas=${comDecisoesPenduradas.length} (total a desativar=${supersedeEntries.reduce((a, e) => a + e.deactivateDecisionIds.length, 0)})`);

    // ============ 7. O APPLY QUE FALHAVA ============
    let applyErro = "";
    try {
      await apply(entries);
    } catch (e) {
      applyErro = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(7, "apply da leva nova NAO e barrado pelo guarda fail-closed de data_usage_decisions",
      applyErro === "", applyErro === "" ? "aplicado" : `BARRADO: ${applyErro.slice(0, 200)}`);

    // ============ 8-11. O ESTADO RESULTANTE ============
    // A invariante que o trigger defende: decisão vigente sob licença vigente.
    const orfas = await q<{ id: bigint; source_license_id: bigint }>(
      `SELECT d.id, d.source_license_id FROM data_usage_decisions d
         JOIN source_licenses l ON l.id = d.source_license_id
        WHERE d.is_current = true AND l.is_current = false`,
    );
    record(8, "nenhuma decisao vigente aponta para licenca supersedida (invariante do guarda)",
      orfas.length === 0, orfas.length === 0 ? "0 orfas" : `orfas=${orfas.map((o) => `dec ${o.id}->lic ${o.source_license_id}`).join(", ")}`);

    // As decisões novas apontam para as licenças NOVAS — não para as que saíram.
    const antigas = new Set(supersedeEntries.map((e) => e.license.currentId!));
    const ratingDecisions = await q<{ source_key: string; source_license_id: bigint; policy_version: string | null }>(
      `SELECT l.source_key, d.source_license_id, d.policy_version
         FROM data_usage_decisions d JOIN source_licenses l ON l.id = d.source_license_id
        WHERE d.is_current = true AND d.use_case = 'rating_display'`,
    );
    const apontandoParaAntiga = ratingDecisions.filter((d) => antigas.has(String(d.source_license_id)));
    record(9, "decisoes novas apontam para as licencas NOVAS (nenhuma para a licenca supersedida)",
      ratingDecisions.length === 5 && apontandoParaAntiga.length === 0,
      `rating_display vigentes=${ratingDecisions.length} apontando p/ licenca antiga=${apontandoParaAntiga.length}`);

    // Histórico: as decisões da leva anterior continuam lá, desativadas.
    const decTotal = await count(`FROM data_usage_decisions`);
    const decDesativadas = await count(`FROM data_usage_decisions WHERE is_current=false`);
    record(10, "historico preservado: decisoes da leva anterior desativadas, nunca apagadas",
      decTotal === 23 && decDesativadas === 10, `total=${decTotal} desativadas=${decDesativadas} vigentes=${decTotal - decDesativadas}`);

    // A cadeia supersedes_id da licença aponta para a versão anterior.
    const cadeia = await count(
      `FROM source_licenses novo JOIN source_licenses antigo ON antigo.id = novo.supersedes_id
        WHERE novo.is_current = true AND novo.content_type = 'rating' AND antigo.is_current = false`,
    );
    record(11, "cadeia supersedes_id das licencas de rating aponta para a leva anterior",
      cadeia === 5, `licencas de rating com supersedes_id valido: ${cadeia}`);

    // ============ 12. IDEMPOTENCIA ============
    const licAntes = await count(`FROM source_licenses`);
    const decAntes = await count(`FROM data_usage_decisions`);
    await apply(entries);
    const licDepois = await count(`FROM source_licenses`);
    const decDepois = await count(`FROM data_usage_decisions`);
    record(12, "terceira execucao e idempotente (nao escreve nada)",
      licAntes === licDepois && decAntes === decDepois, `lic ${licAntes}->${licDepois}, dec ${decAntes}->${decDepois}`);

    // ============ 13-14. A LEVA E FUNCIONAL: NOTA EXIBINDO COM CREDITO ============
    const movie = await q<{ id: bigint }>(
      `INSERT INTO movies (tmdb_id, title_original, updated_at) VALUES (920001,'Filme da Leva Nova',now()) RETURNING id`,
    );
    const movieId = Number(movie[0]!.id);

    /**
     * Nota como o adaptador OMDb realmente a grava. `metric`/`score_type`/
     * `rating_label` não são livres: `external_ratings_integrity_guard` casa os
     * três com a fonte (Tomatometer é nota de CRÍTICA, escala 100; IMDb é nota
     * de PÚBLICO, escala 10). Fixture errada aqui provaria a coisa errada.
     */
    interface Fixture {
      readonly source: string;
      readonly label: string;
      readonly metric: "audience" | "critics";
      readonly value: number;
      readonly scale: number;
      /** `null` quando não há URL canônica derivável (RT/Metacritic na OMDb). */
      readonly url: string | null;
      readonly attribution: string;
    }

    /**
     * Promove uma nota pelo caminho GOVERNADO (o mesmo que o worker usa): a nota
     * só exibe se achar a decisão vigente da SUA fonte e passar em todos os
     * checks de `external_ratings_display_guard`.
     */
    async function promover(f: Fixture): Promise<string> {
      const url = f.url === null ? "NULL" : `'${f.url}'`;
      await exec(
        `INSERT INTO external_ratings (entity_type, entity_id, rating_source, rating_label, metric, score_type,
           rating_value, rating_scale, rating_url, provider_api, license_status, requires_attribution, requires_linkback,
           attribution_text, attribution_url, fetched_at, updated_at)
         VALUES ('movie',${movieId},'${f.source}','${f.label}','${f.metric}','${f.metric}',${f.value},${f.scale},
           ${url},'omdb','third_party',true,${ratingRequiresLinkback(f.source)},
           '${f.attribution}', ${url}, now(), now())`,
      );
      const id = String(Number((await q<{ id: bigint }>(
        `SELECT id FROM external_ratings WHERE entity_id=${movieId} AND rating_source='${f.source}'`,
      ))[0]!.id));
      await exec(
        `UPDATE external_ratings r SET display_allowed=true, reviewed_at=now(), reviewed_by='ana@cinerie',
           data_usage_decision_id=(SELECT d.id FROM data_usage_decisions d JOIN source_licenses l ON l.id=d.source_license_id
             WHERE d.use_case='rating_display' AND d.is_current AND d.stage='approved_for_display'
               AND l.rating_source_key='${f.source}' AND l.is_current AND l.content_type='rating'
               AND (d.territory IS NULL OR d.territory='BR') ORDER BY (d.territory IS NOT NULL) DESC LIMIT 1),
           approved_payload_hash=external_rating_payload_fingerprint_v1(r.entity_type,r.entity_id,r.rating_source,r.metric,
             r.score_type,r.rating_label,r.rating_value,r.rating_scale,r.rating_count,r.rating_url,r.provider_api,
             r.license_status,r.requires_attribution,r.requires_linkback,r.attribution_text,r.attribution_url)
         WHERE r.id=${id}`,
      );
      return id;
    }

    // IMDb: linkback OBRIGATORIO (a OMDb entrega imdbID).
    let imdbErro = "";
    let imdbRow: { display_allowed: boolean; attribution_text: string | null; attribution_url: string | null } | undefined;
    try {
      const imdbId = await promover({
        source: "imdb", label: "IMDb", metric: "audience", value: 8.4, scale: 10,
        url: "https://www.imdb.com/title/tt0111161/", attribution: "Nota fornecida por IMDb",
      });
      imdbRow = (await q<{ display_allowed: boolean; attribution_text: string | null; attribution_url: string | null }>(
        `SELECT display_allowed, attribution_text, attribution_url FROM external_ratings WHERE id=${imdbId}`,
      ))[0];
    } catch (e) {
      imdbErro = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(13, "apos a leva nova, nota IMDb exibe COM credito e COM link (linkback obrigatorio)",
      imdbErro === "" && imdbRow?.display_allowed === true &&
        (imdbRow?.attribution_text ?? "") === "Nota fornecida por IMDb" &&
        (imdbRow?.attribution_url ?? "").startsWith("https://"),
      imdbErro !== "" ? `BARRADO: ${imdbErro.slice(0, 160)}` : `display=${imdbRow?.display_allowed} credito="${imdbRow?.attribution_text}" link=${imdbRow?.attribution_url}`);

    // Rotten Tomatoes: linkback DISPENSADO — exibe com credito TEXTUAL, sem link.
    let rtErro = "";
    let rtRow: { display_allowed: boolean; attribution_text: string | null; attribution_url: string | null } | undefined;
    try {
      const rtId = await promover({
        source: "rotten_tomatoes", label: "Rotten Tomatoes", metric: "critics", value: 91, scale: 100,
        url: null, attribution: "Nota fornecida por Rotten Tomatoes",
      });
      rtRow = (await q<{ display_allowed: boolean; attribution_text: string | null; attribution_url: string | null }>(
        `SELECT display_allowed, attribution_text, attribution_url FROM external_ratings WHERE id=${rtId}`,
      ))[0];
    } catch (e) {
      rtErro = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(14, "apos a leva nova, nota Rotten Tomatoes exibe com credito TEXTUAL e SEM link (dispensa nominal)",
      rtErro === "" && rtRow?.display_allowed === true &&
        (rtRow?.attribution_text ?? "") === "Nota fornecida por Rotten Tomatoes" &&
        rtRow?.attribution_url === null,
      rtErro !== "" ? `BARRADO: ${rtErro.slice(0, 160)}` : `display=${rtRow?.display_allowed} credito="${rtRow?.attribution_text}" link=${rtRow?.attribution_url ?? "<nenhum>"}`);

    // ============ 15. CONTROLE NEGATIVO: o guarda continua ARMADO ============
    //
    // Reproduz À MÃO a ordem defeituosa (licença primeiro, decisão depois) e
    // exige a mesma mensagem P0001. Sem este check, o validador ficaria verde
    // também se alguém tivesse afrouxado o trigger em vez de corrigir o laço —
    // e a proteção da invariante 6 teria sumido sem ninguém notar.
    const alvo = (await q<{ lic: bigint; dec: bigint }>(
      `SELECT l.id AS lic, d.id AS dec FROM source_licenses l JOIN data_usage_decisions d ON d.source_license_id = l.id
        WHERE l.is_current = true AND d.is_current = true AND d.use_case = 'rating_display' LIMIT 1`,
    ))[0]!;
    let negativo = "";
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE source_licenses SET is_current=false WHERE id=${alvo.lic}`);
        await tx.$executeRawUnsafe(`UPDATE data_usage_decisions SET is_current=false WHERE id=${alvo.dec}`);
        throw new Error("ROLLBACK-INTENCIONAL: a ordem defeituosa NAO foi barrada");
      });
    } catch (e) {
      negativo = (e as Error).message.replace(/\s+/g, " ").trim();
    }
    record(15, "controle negativo: a ordem defeituosa (licenca antes das decisoes) continua barrada",
      negativo.toLowerCase().includes("nao e a vigente"),
      negativo.includes("ROLLBACK-INTENCIONAL") ? "A TRAVA SUMIU: a ordem defeituosa passou" : negativo.slice(0, 160));

    // O rollback do controle negativo tem de ter devolvido o estado intacto.
    const orfasFinal = await count(
      `FROM data_usage_decisions d JOIN source_licenses l ON l.id = d.source_license_id
        WHERE d.is_current = true AND l.is_current = false`,
    );
    record(16, "controle negativo nao deixou residuo (transacao voltou atras inteira)",
      orfasFinal === 0 && (await count(`FROM source_licenses WHERE is_current=true`)) === 8,
      `orfas=${orfasFinal} licencas vigentes=${await count(`FROM source_licenses WHERE is_current=true`)}`);
  } catch (e) {
    record(0, "execucao", false, (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 200));
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-legal-supersede-pg-"));
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: false });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_legal?schema=public`;
  console.log(`\n=== supersede de licenca com decisoes vigentes — PostgreSQL efemero :${port} (postgres:****) ===\n`);

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
    record(0, "boot", false, (e as Error).message.replace(/\s+/g, " ").trim().slice(0, 200));
  } finally {
    if (started) {
      try { await pg.stop(); } catch { /* best-effort */ }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  const total = results.filter((r) => r.n > 0).length;
  console.log(`\nRESUMO (supersede com decisoes vigentes): ${total - failed.filter((f) => f.n > 0).length}/${total} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Leva nova aplica sobre licencas que ja carregavam decisoes vigentes; historico preservado; nota exibindo com credito.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
