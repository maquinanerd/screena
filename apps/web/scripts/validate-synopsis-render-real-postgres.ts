/**
 * validate-synopsis-render-real-postgres.ts — A SINOPSE RECUPERADA APARECE NO
 * HTML DA PAGINA. Medido por RENDERIZACAO da rota real.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini. PostgreSQL 16 real e efemero.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE, SE JA HA VALIDADOR DE BANCO
 * ============================================================================
 * `validate-text-recovery-real-postgres.ts` (services/ingestion) ja prova que o
 * backfill grava `entity_translations.summary` e que o VEREDITO de
 * indexabilidade muda de `no_synopsis` para `eligible`. Isso e o banco e a
 * politica. NAO e a pagina.
 *
 * Entre a coluna e o HTML ainda ha `getMoviePageData` -> `movie-presenter` ->
 * `selectSynopsis` -> o componente. Qualquer um desses elos pode descartar o
 * texto — e um deles ja descartou antes: `selectSynopsis` tem regra propria de
 * idioma e de aviso na tela. Concluir "a sinopse aparece" lendo o caminho e
 * exatamente o erro que esta leva existe para nao repetir.
 *
 * Entao aqui a rota de verdade e importada (o mesmo caminho que
 * `validate-decision-robots-render-real-postgres.ts` abriu), o componente de
 * pagina e AWAITADO como o Next o awaitaria, e o resultado e renderizado para
 * HTML estatico. O check e uma busca de substring no markup.
 *
 * ============================================================================
 * O CONTROLE NEGATIVO E PARTE DA MEDIDA
 * ============================================================================
 * Um titulo COM sinopse e outro SEM, na mesma execucao. Se o markup do segundo
 * tambem contivesse o texto, o teste estaria casando com outra coisa (um
 * atributo, um script, o proprio fixture ecoado em JSON-LD) em vez de com a
 * sinopse renderizada.
 *
 * Uso: pnpm --filter @screena/web validate:synopsis-render
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire, register } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { runChild } from "@screena/db/async-child-process";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(webDir, "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const SITE = "https://cinerie.com";

/** O texto que o backfill teria recuperado do bloco `translations`. */
const SINOPSE_RECUPERADA =
  "Sinopse recuperada do bloco translations, que estava no banco o tempo todo.";

/**
 * Quantos checks uma execucao COMPLETA registra. Um placar `n/n` com `n` menor
 * que isto e uma execucao que parou no meio (o `catch` registra UM check de
 * "execucao") ou um check apagado sem querer: nos dois casos o validador nao
 * mediu o que diz medir, e reprova.
 */
const CHECKS_ESPERADOS = 4;

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

function primeiraLinha(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0] ?? msg;
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  if (rel === undefined) throw new Error("binario do prisma nao encontrado");
  return path.join(path.dirname(pkgPath), rel);
}

/**
 * O ambiente precisa estar ligado ANTES de importar a rota: modulos como
 * `site.ts` congelam `SITE_URL` no topo.
 */
function ligarAmbienteIndexavel(): void {
  const env = process.env as Record<string, string | undefined>;
  env.CINERIE_PUBLIC_SITE_URL = SITE;
  env.CINERIE_PUBLIC_INDEXING_ENABLED = "1";
  env.NODE_ENV = "production";
  delete env.VERCEL_ENV;
}

/**
 * Faz `import "./x.css"` virar um modulo vazio NESTE processo.
 *
 * A ficha de filme importa `detail-hero.css` e `detail.css` desde a divisao do
 * CSS por rota. Quem carrega CSS e o bundler do Next; o Node puro nao sabe o que
 * e `.css` e o `import()` da rota morria com `ERR_UNKNOWN_FILE_EXTENSION` antes
 * do primeiro check (medido na CI da main de 18/11/2026 e no PR #356). A pagina
 * nao muda: o CSS nao participa do texto que este validador procura no markup.
 *
 * O gancho entra por `register` (o mesmo de
 * `validate-decision-robots-render-real-postgres.ts`) e precisa ser registrado
 * ANTES do `import()` da rota. Registrado depois do `tsx`, ele roda PRIMEIRO na
 * cadeia de `load`, entao o `.css` nunca chega ao loader do `tsx`. A query e
 * descartada antes do teste de extensao, para um `?v=` qualquer nao escapar.
 */
function tratarCssComoModuloVazio(): void {
  register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, context, nextLoad) {" +
          " if (url.split('?')[0].endsWith('.css'))" +
          " return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          " return nextLoad(url, context); }",
      ),
    import.meta.url,
  );
}

/** A pagina como o Next a chamaria: componente async que devolve JSX. */
type PageComponent = (args: {
  params: Promise<Record<string, string>>;
}) => Promise<ReactElement>;

interface PrismaLike {
  $executeRawUnsafe: (sql: string) => Promise<number>;
}

/**
 * Renderiza a rota para HTML estatico.
 *
 * `MoviePage` e um componente async: `await` devolve a arvore JSX ja com os
 * dados do banco dentro, e `renderToStaticMarkup` a serializa. Nao e o pipeline
 * de streaming do Next — e o suficiente para a pergunta deste arquivo, que e se
 * o texto atravessa loader, presenter e componente ate o markup.
 */
async function renderizar(page: PageComponent, slug: string): Promise<string> {
  const element = await page({ params: Promise.resolve({ slug }) });
  return renderToStaticMarkup(element);
}

/**
 * O markup SEM os `<script>`.
 *
 * A pagina emite JSON-LD (`serializeJsonLd`) com `description` dentro de um
 * `<script type="application/ld+json">`. Procurar a sinopse no markup inteiro
 * casaria com esse JSON e "provaria" que a pagina MOSTRA um texto que ela apenas
 * DECLARA em metadado — a diferenca inteira entre um leitor ler a sinopse e um
 * crawler achar uma string. O check central roda sobre esta versao.
 */
function semScripts(markup: string): string {
  return markup.replace(/<script[\s\S]*?<\/script>/g, '');
}

async function main(): Promise<number> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-synopsis-render-pg-"));
  // SEM `initdbFlags`: o cluster default sobe no checkout acentuado (quem morre
  // ali e `--encoding=UTF8`). Os fixtures sao ASCII de proposito.
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_synopsis_render?schema=public`;
  console.log(`\n=== Postgres efemero (embedded) :${port} ===\n`);

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_synopsis_render");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    await runChild("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    // SEM `prisma db seed`: o seed roda `tsx prisma/seed.ts`, e este validador e
    // invocado com `tsx --tsconfig scripts/tsconfig.json` (necessario para
    // `jsx: react-jsx`). O caminho do tsconfig vaza para o processo filho por
    // variavel de ambiente, e o filho tenta resolve-lo a partir de
    // `packages/db/` — onde ele nao existe. O unico registro de que este
    // validador precisa e o idioma (FK de `slugs` e `entity_translations`),
    // entao ele entra por INSERT direto.
    ligarAmbienteIndexavel();

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();
    const run = (sql: string) => prisma.$executeRawUnsafe(sql);

    // ---- Fixtures: um filme COM sinopse recuperada, um SEM ---------------
    await run(`INSERT INTO languages (code, name_pt, name_en, is_published, index_default)
               VALUES ('${LANGUAGE}','Portugues (Brasil)','Portuguese (Brazil)', true, true)
               ON CONFLICT (code) DO NOTHING`);
    await run(`INSERT INTO movies (id, tmdb_id, title_original, poster_path, updated_at) VALUES
               (901, 98901, 'Filme Recuperado', '/p901.jpg', now()),
               (902, 98902, 'Filme Sem Sinopse', '/p902.jpg', now())`);
    await run(`INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at) VALUES
               ('movie', 901, '${LANGUAGE}', 'filme-recuperado', true, now()),
               ('movie', 902, '${LANGUAGE}', 'filme-sem-sinopse', true, now())`);
    await run(`INSERT INTO entity_translations (entity_type, entity_id, language_code, title, summary, updated_at) VALUES
               ('movie', 901, '${LANGUAGE}', 'Filme Recuperado', '${SINOPSE_RECUPERADA}', now()),
               ('movie', 902, '${LANGUAGE}', 'Filme Sem Sinopse', NULL, now())`);

    tratarCssComoModuloVazio();
    const movieRoute = (await import("../app/pt/filmes/[slug]/page.tsx")) as unknown as {
      default: PageComponent;
    };

    // ---- (1) O TEXTO APARECE NO HTML --------------------------------------
    const comSinopse = await renderizar(movieRoute.default, "filme-recuperado");
    const comSinopseVisivel = semScripts(comSinopse);
    record(
      "F.2 — a sinopse recuperada aparece no CORPO do HTML (fora do JSON-LD)",
      comSinopseVisivel.includes(SINOPSE_RECUPERADA),
      `markup=${comSinopse.length}B · sem <script>=${comSinopseVisivel.length}B · contem: ${comSinopseVisivel.includes(SINOPSE_RECUPERADA)}`,
    );
    record(
      "CONTROLE: a remocao de <script> nao esvaziou o markup (o check acima nao e vacuo)",
      comSinopseVisivel.length > 1000 && comSinopseVisivel.includes("Filme Recuperado"),
      `sem <script>=${comSinopseVisivel.length}B`,
    );

    // ---- (2) CONTROLE NEGATIVO -------------------------------------------
    // Sem esta linha, um check que casasse com qualquer coisa (um atributo, o
    // JSON-LD, o proprio fixture ecoado) passaria igual.
    const semSinopse = await renderizar(movieRoute.default, "filme-sem-sinopse");
    record(
      "CONTROLE NEGATIVO: o filme SEM sinopse nao traz o texto em lugar nenhum do markup",
      !semSinopse.includes(SINOPSE_RECUPERADA),
      `markup=${semSinopse.length} bytes · contem a sinopse: ${semSinopse.includes(SINOPSE_RECUPERADA)}`,
    );

    // ---- (3) e os dois renderizaram de verdade ---------------------------
    // Um `renderToStaticMarkup` que devolvesse "" faria (2) passar por vacuidade.
    record(
      "CONTROLE POSITIVO: as duas paginas renderizaram markup nao trivial",
      comSinopse.length > 2000 &&
        semSinopse.length > 2000 &&
        comSinopse.includes("Filme Recuperado") &&
        semSinopse.includes("Filme Sem Sinopse"),
      `com=${comSinopse.length}B · sem=${semSinopse.length}B (titulos presentes nos dois)`,
    );
  } catch (e) {
    record("execucao", false, primeiraLinha(e));
    console.error(e);
  } finally {
    // Limpeza nao e check: no Windows o `stop()` do embedded-postgres rejeita com
    // `EBUSY` ao apagar o diretorio de dados (medido em 26/11/2026), e sem estes
    // `catch` a rejeicao escapava do `finally`, o RESUMO nem era impresso e o
    // codigo de saida vinha do acidente, nao do placar.
    if (disconnect) {
      await disconnect().catch((e: unknown) =>
        console.warn(`Aviso: disconnect falhou (${primeiraLinha(e)}).`),
      );
    }
    if (started) {
      await pg.stop().catch((e: unknown) =>
        console.warn(`Aviso: pg.stop falhou (${primeiraLinha(e)}); o SO limpa o resto.`),
      );
    }
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(`Aviso: dir temporario nao removido agora (${primeiraLinha(e)}).`);
    }
    console.log("\n=== Postgres efemero derrubado ===");
  }

  console.log(`\nRESUMO: ${passed}/${total} checks OK.`);
  if (passed !== total || total !== CHECKS_ESPERADOS) {
    console.error(
      `Resultado: FALHOU (${passed}/${total} OK; uma execucao completa registra ${CHECKS_ESPERADOS} checks).`,
    );
    return 1;
  }
  console.log(
    "Resultado: PASSOU. A sinopse recuperada atravessa loader, presenter e componente ate o HTML.",
  );
  return 0;
}

/**
 * `process.exit` EXPLICITO, nunca so `process.exitCode`.
 *
 * `embedded-postgres` registra `async-exit-hook` ao ser IMPORTADO, e esse gancho
 * responde ao `beforeExit` chamando `process.exit(0)` — com o zero escrito, que
 * vence qualquer `process.exitCode` atribuido antes. Por isso este validador
 * imprimia `[FAIL] 1. execucao` e `RESUMO: 0/1` e saia com codigo 0: o passo da
 * CI ficou verde sem medir nada. Chamar `process.exit(codigo)` aqui encerra o
 * processo antes de o laco de eventos esvaziar, entao o `beforeExit` nunca
 * dispara. O Postgres ja foi derrubado no `finally` de `main`.
 */
main()
  .then((codigo) => process.exit(codigo))
  .catch((e: unknown) => {
    console.error("[FAIL] validador ABORTOU fora do bloco de checks:", e);
    process.exit(1);
  });
