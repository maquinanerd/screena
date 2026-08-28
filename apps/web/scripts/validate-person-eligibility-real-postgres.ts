/**
 * validate-person-eligibility-real-postgres.ts — Validador DESCARTAVEL do gate
 * de ELEGIBILIDADE DE PESSOA no sitemap, contra PostgreSQL 16 real e EFEMERO.
 *
 * POR QUE ESTE VALIDADOR EXISTE
 * -----------------------------
 * A regra pura (`@screena/seo` -> `person-eligibility.ts`) tem teste unitario, e
 * um teste estrutural garante que as duas consultas do sitemap carregam o gate.
 * Nenhum dos dois prova o que mais importa: que o SQL **discrimina de verdade**.
 * Um `EXISTS (... UNION ALL ...)` pode estar sintaticamente presente e
 * semanticamente errado — e o efeito seria publicar de novo milhares de stubs
 * de elenco.
 *
 * Aqui montamos fixtures CONTROLADAS e chamamos o runtime REAL
 * (`getSitemapShardXml`), conferindo exatamente quais pessoas entram.
 *
 * Cenarios cobertos (todas as pessoas TEM slug canonico e nome — o que varia e
 * so o credito):
 *
 *   A. credito de ELENCO em filme publicavel      -> ENTRA
 *   B. credito de EQUIPE em serie publicavel      -> ENTRA
 *   C. credito apenas em EPISODIO                 -> FICA DE FORA
 *   D. nenhum credito                             -> FICA DE FORA
 *   E. credito em filme SEM slug canonico         -> FICA DE FORA
 *   F. credito em filme com decisao != index      -> FICA DE FORA
 *   G. credito bom, bio SEM licenca liberada      -> FICA DE FORA
 *   H. credito bom, bio liberada, SEM foto        -> FICA DE FORA
 *
 * G e H sao a valvula de 2026-08-27: credito deixou de bastar. Em producao,
 * 0 de 300 pessoas do sitemap exibiam biografia, e a pagina rendia 52 palavras.
 * G prova que TEXTO nao basta sem licenca (invariante 6) — a coluna de
 * governanca nasce `unknown` e bio ingerida sem liberacao nao vai a tela.
 *
 * C e o caso sutil: episodio pertence a uma serie, e quem sustenta a relevancia
 * editorial da pessoa e a SERIE. E e o caso que prova que a obra tambem precisa
 * ser publicavel — nao basta existir.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nao roda em render, build ou
 * producao. ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * Uso: pnpm --filter @screena/web validate:person-eligibility
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");
// Resolve a partir de `packages/db`, NAO de `apps/web/scripts`: `prisma` e
// dependencia do pacote de banco, e o app nao a declara. Era latente — no
// caminho do `embedded-postgres` a execucao morria antes de chegar aqui —, e
// aparece assim que o cluster ja esta de pe (ver `externalDatabaseUrl`). Mesmo
// padrao de `validate-decision-robots-render-real-postgres.ts`.
const require = createRequire(path.join(dbDir, "package.json"));

let passed = 0;
let total = 0;
function record(name: string, ok: boolean, detail: string): void {
  total += 1;
  if (ok) passed += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${total}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

interface RawClient {
  $executeRawUnsafe(sql: string): Promise<number>;
  $disconnect(): Promise<void>;
}

/**
 * Fixtures minimas. IDs explicitos para as assercoes serem legiveis; nenhum
 * dado vem de rede.
 */
async function seedFixtures(prisma: RawClient): Promise<void> {
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);

  await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
             VALUES ('pt-BR','Portugues (Brasil)','Portuguese (Brazil)', true, true)
             ON CONFLICT (code) DO NOTHING`);

  // Obras: 1 filme publicavel, 1 serie publicavel, 1 filme SEM slug, 1 filme
  // com decisao vigente != index.
  await run(`INSERT INTO movies (id, tmdb_id, title_original, updated_at) VALUES
             (101, 90101, 'Filme Publicavel', now()),
             (102, 90102, 'Filme Sem Slug', now()),
             (103, 90103, 'Filme Bloqueado', now())`);
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, updated_at) VALUES
             (201, 90201, 'Serie Publicavel', now())`);
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, updated_at) VALUES (301, 201, 1, now())`);
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, updated_at)
             VALUES (401, 301, 201, 1, 'Episodio 1', now())`);

  // Slugs canonicos das obras (menos o filme 102, de proposito).
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-publicavel', true, now()),
             ('movie', 103, 'pt-BR', 'filme-bloqueado', true, now()),
             ('tv',    201, 'pt-BR', 'serie-publicavel', true, now())`);

  // O filme 103 tem decisao vigente != index: nao e obra publicavel.
  await run(`INSERT INTO page_indexability_decisions
               (entity_type, entity_id, language_code, url, decision, is_current)
             VALUES ('movie', 103, 'pt-BR', '/pt/filmes/filme-bloqueado/', 'noindex', true)`);

  // Pessoas: TODAS com nome e slug canonico. So o credito varia.
  // A e B tem a ficha COMPLETA (bio liberada + foto); G e H isolam cada metade
  // do gate novo. Sem bio/foto, nem A nem B entrariam — que e o ponto.
  await run(`INSERT INTO people (id, tmdb_id, name, biography, biography_source_status, profile_path, updated_at) VALUES
             (501, 95501, 'A Elenco Em Filme', 'Bio liberada de A.',  'licensed', '/a.jpg', now()),
             (502, 95502, 'B Equipe Em Serie', 'Bio liberada de B.',  'official', '/b.jpg', now()),
             (503, 95503, 'C So Episodio',     'Bio liberada de C.',  'licensed', '/c.jpg', now()),
             (504, 95504, 'D Sem Credito',     'Bio liberada de D.',  'licensed', '/d.jpg', now()),
             (505, 95505, 'E Filme Sem Slug',  'Bio liberada de E.',  'licensed', '/e.jpg', now()),
             (506, 95506, 'F Filme Bloqueado', 'Bio liberada de F.',  'licensed', '/f.jpg', now()),
             (507, 95507, 'G Bio Sem Licenca', 'Texto existe, licenca nao.', 'unknown', '/g.jpg', now()),
             (508, 95508, 'H Sem Foto',        'Bio liberada de H.',  'licensed', NULL,     now())`);
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('person', 501, 'pt-BR', 'a-elenco-em-filme', true, now()),
             ('person', 502, 'pt-BR', 'b-equipe-em-serie', true, now()),
             ('person', 503, 'pt-BR', 'c-so-episodio',     true, now()),
             ('person', 504, 'pt-BR', 'd-sem-credito',     true, now()),
             ('person', 505, 'pt-BR', 'e-filme-sem-slug',  true, now()),
             ('person', 506, 'pt-BR', 'f-filme-bloqueado', true, now()),
             ('person', 507, 'pt-BR', 'g-bio-sem-licenca', true, now()),
             ('person', 508, 'pt-BR', 'h-sem-foto',        true, now())`);

  await run(`INSERT INTO cast_members (person_id, entity_type, entity_id, updated_at) VALUES
             (501, 'movie', 101, now()),
             (503, 'episode', 401, now()),
             (505, 'movie', 102, now()),
             (506, 'movie', 103, now()),
             (507, 'movie', 101, now()),
             (508, 'movie', 101, now())`);
  await run(`INSERT INTO crew_members (person_id, entity_type, entity_id, job, updated_at) VALUES
             (502, 'tv', 201, 'Director', now())`);
}

const ELIGIBLE = ["a-elenco-em-filme", "b-equipe-em-serie"];
const INELIGIBLE = [
  "c-so-episodio",
  "d-sem-credito",
  "e-filme-sem-slug",
  "f-filme-bloqueado",
  // Valvula 2026-08-27: credito bom nao basta mais.
  "g-bio-sem-licenca",
  "h-sem-foto",
];

async function runChecks(url: string): Promise<void> {
  process.env.DATABASE_URL = url;
  process.env.CINERIE_PUBLIC_INDEXING_ENABLED = "0";

  const dbServer = (await import("@screena/db/server")) as unknown as {
    getPrismaClient: () => RawClient;
    disconnectPrisma: () => Promise<void>;
  };
  const prisma = dbServer.getPrismaClient();
  await seedFixtures(prisma);

  // Diagnostico: quantas pessoas cada estagio ve (ajuda a localizar divergencia
  // entre fixtures, gate e runtime quando algo falha).
  const diag = prisma as unknown as {
    $queryRawUnsafe<T>(sql: string): Promise<T[]>;
  };
  const rawPeople = await diag.$queryRawUnsafe<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM slugs s JOIN people p ON p.id = s.entity_id
     WHERE s.entity_type = 'person' AND s.language_code = 'pt-BR' AND s.is_canonical = true
       AND BTRIM(p.name) <> ''`,
  );
  const gatedPeople = await diag.$queryRawUnsafe<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM slugs s JOIN people p ON p.id = s.entity_id
     WHERE s.entity_type = 'person' AND s.language_code = 'pt-BR' AND s.is_canonical = true
       AND BTRIM(p.name) <> ''
       AND BTRIM(COALESCE(p.biography, '')) <> ''
       AND p.biography_source_status::text IN ('official','licensed','third_party')
       AND BTRIM(COALESCE(p.profile_path, '')) <> ''
       AND EXISTS (
         SELECT 1 FROM cast_members cm
         JOIN slugs ws ON ws.entity_type = cm.entity_type AND ws.entity_id = cm.entity_id
           AND ws.language_code = 'pt-BR' AND ws.is_canonical = true
         WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
           AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
             WHERE wd.entity_type = cm.entity_type AND wd.entity_id = cm.entity_id
               AND wd.language_code = 'pt-BR' AND wd.is_current = true AND wd.decision <> 'index')
         UNION ALL
         SELECT 1 FROM crew_members rm
         JOIN slugs ws ON ws.entity_type = rm.entity_type AND ws.entity_id = rm.entity_id
           AND ws.language_code = 'pt-BR' AND ws.is_canonical = true
         WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
           AND NOT EXISTS (SELECT 1 FROM page_indexability_decisions wd
             WHERE wd.entity_type = rm.entity_type AND wd.entity_id = rm.entity_id
               AND wd.language_code = 'pt-BR' AND wd.is_current = true AND wd.decision <> 'index')
       )`,
  );
  console.log(
    `[diag] pessoas com slug=${rawPeople[0]?.n ?? "?"} | aprovadas pelo gate=${gatedPeople[0]?.n ?? "?"}`,
  );
  record(
    "gate SQL discrimina: 8 pessoas com slug, 2 aprovadas",
    (rawPeople[0]?.n ?? 0) === 8 && (gatedPeople[0]?.n ?? 0) === 2,
    `com slug=${rawPeople[0]?.n}, aprovadas=${gatedPeople[0]?.n}`,
  );

  const sitemap = await import("../src/server/seo/sitemap-index.js");
  // O id do shard EXIGE o sufixo `.xml` (`parseShardId` recusa sem ele).
  const shard = await sitemap.getSitemapShardXml("sitemap-pt-BR-people-1.xml");
  const xml = shard?.xml ?? "";

  record(
    "shard de pessoas responde XML",
    xml.length > 0 && xml.includes("<urlset"),
    `${xml.length} bytes`,
  );

  for (const slug of ELIGIBLE) {
    record(
      `ENTRA no sitemap: ${slug}`,
      xml.includes(`/${slug}/`),
      "credito em obra publicavel",
    );
  }
  for (const slug of INELIGIBLE) {
    record(
      `FICA DE FORA do sitemap: ${slug}`,
      !xml.includes(`/${slug}/`),
      "sem credito em obra publicavel, ou sem biografia exibivel/foto",
    );
  }

  // Contagem e pagina precisam concordar: o index deriva o numero de shards da
  // CONTAGEM. Se a contagem visse 6 e a pagina devolvesse 2, o index anunciaria
  // shards vazios.
  const indexXml = (await sitemap.getSitemapIndexXml()).xml;
  const peopleShards = (indexXml.match(/sitemap-pt-BR-people-\d+/g) ?? []).length;
  record(
    "index anuncia exatamente 1 shard de pessoas (contagem == pagina)",
    peopleShards === 1,
    `${peopleShards} shard(s)`,
  );

  const urlCount = (xml.match(/<loc>/g) ?? []).length;
  record(
    "shard contem SO as 2 pessoas elegiveis",
    urlCount === ELIGIBLE.length,
    `${urlCount} URL(s), esperado ${ELIGIBLE.length}`,
  );

  await dbServer.disconnectPrisma();
}

/**
 * Escape hatch para um cluster JA de pe em loopback.
 *
 * Copiado de `services/ingestion/scripts/validate-indexability-producer-real-postgres.ts`
 * pelo motivo que aquele arquivo registra: neste checkout, cujo caminho tem
 * acento, `initdb --encoding=UTF8` morre com
 * `invalid byte sequence for encoding "UTF8"` — o caminho dos BINARIOS vaza para
 * o bootstrap, e um `dataDir` sem acento nao salva. Sem esta valvula, o unico
 * validador de `validate:all` que nao roda ali e justamente o do gate de pessoa,
 * e ele falha ANTES de qualquer check — o que faz `validate:all` reportar
 * `FALHOU` por motivo de ambiente, indistinguivel de uma regressao real.
 *
 * Variavel PROPRIA, nunca `DATABASE_URL`: o `.env` deste checkout aponta para
 * PRODUCAO, e este validador INSERE e APAGA.
 */
function externalDatabaseUrl(): string | null {
  const raw = process.env.CINERIE_VALIDATOR_DATABASE_URL;
  if (raw === undefined || raw.trim().length === 0) return null;
  const host = new URL(raw).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(
      `CINERIE_VALIDATOR_DATABASE_URL precisa apontar para loopback (recebeu host "${host}"). ` +
        "Este validador APAGA e INSERE dados; ele nunca fala com banco remoto.",
    );
  }
  return raw;
}

async function main(): Promise<void> {
  const external = externalDatabaseUrl();
  if (external !== null) {
    console.log("[info] usando CINERIE_VALIDATOR_DATABASE_URL (cluster externo, loopback).");
    try {
      execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
        env: { ...process.env, DATABASE_URL: external },
        stdio: "inherit",
        cwd: dbDir,
      });
      record("migrate deploy aplica do zero", true, "ok");
      await runChecks(external);
    } catch (error) {
      record(
        "execucao sem excecao",
        false,
        error instanceof Error ? error.message.split("\n").join(" ").slice(0, 300) : String(error),
      );
      if (error instanceof Error && error.stack) console.error(error.stack);
    }
    console.log(`\nRESUMO: ${passed}/${total} checks OK.`);
    process.exitCode = passed === total ? 0 : 1;
    return;
  }

  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-person-gate-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    // UTF8 explicito: no Windows o initdb herda o locale do SO (WIN1252).
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_person_gate`;
  let started = false;

  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_person_gate");

    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "inherit",
      cwd: dbDir,
    });
    record("migrate deploy aplica do zero", true, "ok");

    await runChecks(url);
  } catch (error) {
    record(
      "execucao sem excecao",
      false,
      error instanceof Error ? error.message.split("\n").join(" ").slice(0, 300) : String(error),
    );
    if (error instanceof Error && error.stack) console.error(error.stack);
  } finally {
    if (started) {
      try {
        await pg.stop();
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* o SO limpa */
    }
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK`);
  // `process.exit`, nao `process.exitCode`. Medido em 21/08/2026: com uma falha
  // no `initdb` este script imprimia `[FAIL] 1.` / `RESUMO: 0/1` e mesmo assim
  // encerrava com codigo 0 — o `exitCode` atribuido aqui nao sobrevivia ao
  // encerramento, e `validate:all` exibia o validador morto como PASSOU. Os
  // outros validadores desta pasta ja saem com `process.exit(1)` explicito;
  // este era o unico fora do padrao. A agregacao tambem passou a recusar
  // placar parcial (ver `validate-all-real-postgres.ts`) — as duas travas
  // existem porque uma sozinha ja falhou.
  if (passed !== total) {
    console.error("Resultado: FALHOU. Pelo menos uma assercao nao passou.");
    process.exit(1);
  }
}

void main();
