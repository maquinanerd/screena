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
 * Cenarios cobertos (todas as pessoas TEM slug canonico e nome):
 *
 *   A. bio liberada + foto + ELENCO em 1 filme publicavel     -> ENTRA
 *   B. bio liberada + foto + EQUIPE em 1 serie publicavel     -> ENTRA
 *   C. credito apenas em EPISODIO                             -> FICA DE FORA
 *   D. nenhum credito                                         -> FICA DE FORA
 *   E. credito so em filme SEM slug canonico                  -> FICA DE FORA
 *   F. credito so em filme com decisao != index               -> FICA DE FORA
 *   G. bio SEM licenca + foto + 1 obra                        -> FICA DE FORA
 *   H. bio liberada + SEM foto + 1 obra                       -> FICA DE FORA
 *   I. SEM bio exibivel + foto + 5 obras no indice            -> ENTRA
 *   J. SEM bio + foto + 4 obras no indice + 1 obra bloqueada  -> FICA DE FORA
 *   K. SEM bio + foto + 5 LINHAS de credito em 2 obras        -> FICA DE FORA
 *   L. SEM bio + foto + 4 obras + 1 ficha tmdb-N sem traducao -> FICA DE FORA
 *   M. SEM bio + foto + 4 obras + 1 ficha tmdb-N LOCALIZADA   -> ENTRA
 *   N. SEM bio + SEM foto + 5 obras no indice                 -> FICA DE FORA
 *
 * G e H sao a valvula de 2026-08-27. I a N sao a leitura da D2 de 22/09/2026:
 * sem biografia exibivel, a FILMOGRAFIA sustenta a pagina a partir de cinco
 * obras NO INDICE. Cada controle isola uma parte da conta: J prova que obra
 * bloqueada nao soma; K, que a conta e de OBRA e nao de linha de credito; L e M,
 * que a ficha tmdb-N so soma quando o portao de localizacao (D3) a aceita — L
 * sozinho passaria com um portao que descartasse todo tmdb-N; N, que a foto
 * continua obrigatoria.
 *
 * C e o caso sutil: episodio pertence a uma serie, e quem sustenta a relevancia
 * editorial da pessoa e a SERIE. E e o caso que prova que a obra tambem precisa
 * ser publicavel — nao basta existir.
 *
 * Alem do sitemap, o validador confere que a PAGINA (`getPersonPageData`) da o
 * mesmo veredito para cada pessoa, e que a LISTAGEM (`getPersonIndexData`) abre
 * so com as aptas.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL: nao roda em render, build ou
 * producao. ZERO rede, ZERO TMDB, ZERO Gemini.
 *
 * Uso: pnpm --filter @screena/web validate:person-eligibility
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";

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

  // Obras. 101-105 publicaveis e populares (a listagem sai do elenco delas);
  // 106 sem slug; 107 com decisao vigente != index; 108 e 109 com slug de
  // fallback tmdb-N e titulo no alfabeto original — 108 sem traducao (o portao
  // D3 a tira do indice), 109 com titulo pt-BR proprio (volta ao indice).
  await run(`INSERT INTO movies (id, tmdb_id, title_original, popularity, updated_at) VALUES
             (101, 90101, 'Filme Um',       90, now()),
             (102, 90102, 'Filme Dois',     80, now()),
             (103, 90103, 'Filme Tres',     70, now()),
             (104, 90104, 'Filme Quatro',   60, now()),
             (105, 90105, 'Filme Cinco',    50, now()),
             (106, 90106, 'Filme Sem Slug', NULL, now()),
             (107, 90107, 'Filme Bloqueado', NULL, now()),
             (108, 90108, '길', NULL, now()),
             (109, 90109, '길', NULL, now())`);
  await run(`INSERT INTO tv_shows (id, tmdb_id, name_original, updated_at) VALUES
             (201, 90201, 'Serie Publicavel', now())`);
  await run(`INSERT INTO seasons (id, tv_show_id, season_number, updated_at) VALUES (301, 201, 1, now())`);
  await run(`INSERT INTO episodes (id, season_id, tv_show_id, episode_number, name, updated_at)
             VALUES (401, 301, 201, 1, 'Episodio 1', now())`);

  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('movie', 101, 'pt-BR', 'filme-um', true, now()),
             ('movie', 102, 'pt-BR', 'filme-dois', true, now()),
             ('movie', 103, 'pt-BR', 'filme-tres', true, now()),
             ('movie', 104, 'pt-BR', 'filme-quatro', true, now()),
             ('movie', 105, 'pt-BR', 'filme-cinco', true, now()),
             ('movie', 107, 'pt-BR', 'filme-bloqueado', true, now()),
             ('movie', 108, 'pt-BR', 'tmdb-90108', true, now()),
             ('movie', 109, 'pt-BR', 'tmdb-90109', true, now()),
             ('tv',    201, 'pt-BR', 'serie-publicavel', true, now())`);
  // 109 localizada: titulo pt-BR PROPRIO (diferente do original). 108 fica sem
  // linha nenhuma.
  await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at) VALUES
             ('movie', 109, 'pt-BR', 'O Caminho', now())`);

  // O filme 107 tem decisao vigente != index: nao e obra no indice.
  await run(`INSERT INTO page_indexability_decisions
               (entity_type, entity_id, language_code, url, decision, is_current)
             VALUES ('movie', 107, 'pt-BR', '/pt/filmes/filme-bloqueado/', 'noindex', true)`);

  await run(`INSERT INTO people (id, tmdb_id, name, biography, biography_source_status, profile_path, updated_at) VALUES
             (501, 95501, 'A Elenco Em Filme',  'Bio liberada de A.', 'licensed', '/a.jpg', now()),
             (502, 95502, 'B Equipe Em Serie',  'Bio liberada de B.', 'official', '/b.jpg', now()),
             (503, 95503, 'C So Episodio',      'Bio liberada de C.', 'licensed', '/c.jpg', now()),
             (504, 95504, 'D Sem Credito',      'Bio liberada de D.', 'licensed', '/d.jpg', now()),
             (505, 95505, 'E Filme Sem Slug',   'Bio liberada de E.', 'licensed', '/e.jpg', now()),
             (506, 95506, 'F Filme Bloqueado',  'Bio liberada de F.', 'licensed', '/f.jpg', now()),
             (507, 95507, 'G Bio Sem Licenca',  'Texto existe, licenca nao.', 'unknown', '/g.jpg', now()),
             (508, 95508, 'H Sem Foto',         'Bio liberada de H.', 'licensed', NULL, now()),
             (509, 95509, 'I Filmografia',      'Texto existe, licenca nao.', 'unknown', '/i.jpg', now()),
             (510, 95510, 'J Quatro E Bloqueada', NULL, 'unknown', '/j.jpg', now()),
             (511, 95511, 'K Linhas Nao Obras', NULL, 'unknown', '/k.jpg', now()),
             (512, 95512, 'L Ficha Sem Traducao', NULL, 'unknown', '/l.jpg', now()),
             (513, 95513, 'M Ficha Localizada', NULL, 'unknown', '/m.jpg', now()),
             (514, 95514, 'N Filmografia Sem Foto', NULL, 'unknown', NULL, now())`);
  await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
             ('person', 501, 'pt-BR', 'a-elenco-em-filme', true, now()),
             ('person', 502, 'pt-BR', 'b-equipe-em-serie', true, now()),
             ('person', 503, 'pt-BR', 'c-so-episodio',     true, now()),
             ('person', 504, 'pt-BR', 'd-sem-credito',     true, now()),
             ('person', 505, 'pt-BR', 'e-filme-sem-slug',  true, now()),
             ('person', 506, 'pt-BR', 'f-filme-bloqueado', true, now()),
             ('person', 507, 'pt-BR', 'g-bio-sem-licenca', true, now()),
             ('person', 508, 'pt-BR', 'h-sem-foto',        true, now()),
             ('person', 509, 'pt-BR', 'i-filmografia',     true, now()),
             ('person', 510, 'pt-BR', 'j-quatro-e-bloqueada', true, now()),
             ('person', 511, 'pt-BR', 'k-linhas-nao-obras', true, now()),
             ('person', 512, 'pt-BR', 'l-ficha-sem-traducao', true, now()),
             ('person', 513, 'pt-BR', 'm-ficha-localizada', true, now()),
             ('person', 514, 'pt-BR', 'n-filmografia-sem-foto', true, now())`);

  // billing_order < 4 = elenco principal (candidato da listagem).
  await run(`INSERT INTO cast_members (person_id, entity_type, entity_id, billing_order, updated_at) VALUES
             (501, 'movie', 101, 0, now()),
             (503, 'episode', 401, 0, now()),
             (505, 'movie', 106, 0, now()),
             (506, 'movie', 107, 0, now()),
             (507, 'movie', 101, 1, now()),
             (508, 'movie', 101, 2, now()),
             (509, 'movie', 101, 3, now()), (509, 'movie', 102, 0, now()), (509, 'movie', 103, 0, now()),
             (509, 'movie', 104, 0, now()), (509, 'movie', 105, 0, now()),
             (510, 'movie', 101, 9, now()), (510, 'movie', 102, 1, now()), (510, 'movie', 103, 1, now()),
             (510, 'movie', 104, 1, now()), (510, 'movie', 107, 1, now()),
             (511, 'movie', 101, 8, now()), (511, 'movie', 102, 2, now()),
             (512, 'movie', 101, 7, now()), (512, 'movie', 102, 3, now()), (512, 'movie', 103, 2, now()),
             (512, 'movie', 104, 2, now()), (512, 'movie', 108, 0, now()),
             (513, 'movie', 101, 6, now()), (513, 'movie', 102, 4, now()), (513, 'movie', 103, 3, now()),
             (513, 'movie', 104, 3, now()), (513, 'movie', 109, 0, now()),
             (514, 'movie', 101, 5, now()), (514, 'movie', 102, 5, now()), (514, 'movie', 103, 4, now()),
             (514, 'movie', 104, 4, now()), (514, 'movie', 105, 1, now())`);
  // K: tres linhas de EQUIPE nas MESMAS duas obras — cinco linhas, duas obras.
  await run(`INSERT INTO crew_members (person_id, entity_type, entity_id, job, updated_at) VALUES
             (502, 'tv', 201, 'Director', now()),
             (511, 'movie', 101, 'Director', now()),
             (511, 'movie', 101, 'Writer', now()),
             (511, 'movie', 102, 'Producer', now())`);
}

const ELIGIBLE = ["a-elenco-em-filme", "b-equipe-em-serie", "i-filmografia", "m-ficha-localizada"];
const INELIGIBLE = [
  "c-so-episodio",
  "d-sem-credito",
  "e-filme-sem-slug",
  "f-filme-bloqueado",
  // Valvula 2026-08-27: credito bom nao basta.
  "g-bio-sem-licenca",
  "h-sem-foto",
  // D2, leitura de 22/09/2026: a filmografia precisa de cinco obras NO INDICE.
  "j-quatro-e-bloqueada",
  "k-linhas-nao-obras",
  "l-ficha-sem-traducao",
  "n-filmografia-sem-foto",
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
    record(`ENTRA no sitemap: ${slug}`, xml.includes(`/${slug}/`), "portao D2 aprovado");
  }
  for (const slug of INELIGIBLE) {
    record(`FICA DE FORA do sitemap: ${slug}`, !xml.includes(`/${slug}/`), "portao D2 reprovado");
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
    "shard contem SO as pessoas aptas",
    urlCount === ELIGIBLE.length,
    `${urlCount} URL(s), esperado ${ELIGIBLE.length}`,
  );

  // A PAGINA precisa dar o MESMO veredito que o sitemap, pessoa por pessoa: e a
  // divergencia (a) da auditoria que a D2 fechou, e cada copia nova da regra
  // pode reabri-la.
  const personPage = (await import("../src/server/person-page.js")) as unknown as {
    getPersonPageData: (slug: string) => Promise<{
      seo: { robots: { index: boolean; follow: boolean } };
    } | null>;
  };
  const divergentes: string[] = [];
  for (const slug of [...ELIGIBLE, ...INELIGIBLE]) {
    const data = await personPage.getPersonPageData(slug);
    const noSitemap = xml.includes(`/${slug}/`);
    if (data === null || data.seo.robots.index !== noSitemap || data.seo.robots.follow !== true) {
      divergentes.push(`${slug}: pagina=${data === null ? "null" : data.seo.robots.index} sitemap=${noSitemap}`);
    }
  }
  record(
    "PAGINA e SITEMAP dao o mesmo veredito para as 14 pessoas (e barrada fica com follow)",
    divergentes.length === 0,
    divergentes.length === 0 ? "14/14" : divergentes.join(" | "),
  );

  // A LISTAGEM abre com as aptas do elenco principal das obras populares, da
  // obra mais popular para a menos (empate: id). B e apta mas e EQUIPE, e o
  // recorte e o elenco — entra pelo complemento, com as demais.
  const indexes = (await import("../src/server/entity-indexes.js")) as unknown as {
    getPersonIndexData: () => Promise<{ view: { cards: ReadonlyArray<{ href: string }> } }>;
  };
  const cards = (await indexes.getPersonIndexData()).view.cards.map((card) => card.href);
  const abertura = cards.slice(0, 3);
  const esperada = ["/pt/pessoas/a-elenco-em-filme/", "/pt/pessoas/i-filmografia/", "/pt/pessoas/m-ficha-localizada/"];
  record(
    "LISTAGEM abre com as aptas do elenco principal, na ordem da obra mais popular",
    JSON.stringify(abertura) === JSON.stringify(esperada),
    `abertura=[${abertura.join(", ")}]`,
  );
  record(
    "LISTAGEM: CONTROLE — nenhuma pessoa barrada pelo portao aparece antes das aptas",
    abertura.every((href) => ELIGIBLE.some((slug) => href === `/pt/pessoas/${slug}/`)),
    `abertura=[${abertura.join(", ")}]`,
  );
  record(
    "LISTAGEM: o complemento traz as demais pessoas depois das aptas (nada some)",
    cards.length === ELIGIBLE.length + INELIGIBLE.length,
    `${cards.length} card(s)`,
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
      await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
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

    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
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
