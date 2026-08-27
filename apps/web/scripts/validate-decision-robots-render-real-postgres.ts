/**
 * validate-decision-robots-render-real-postgres.ts — O QUE UMA DECISAO
 * `noindex` REALMENTE CAUSA NA PAGINA, medido por RENDERIZACAO.
 *
 * FERRAMENTA DE DESENVOLVIMENTO DESCARTAVEL. Nunca roda em render/build/prod.
 * ZERO rede, ZERO TMDB, ZERO Gemini. PostgreSQL 16 real e efemero
 * (`embedded-postgres`).
 *
 * A PERGUNTA
 * ----------
 * `catalog index-decisions --apply` popula `page_indexability_decisions`. Antes
 * de assinar essa execucao o dono precisa saber uma coisa que o codigo ate agora
 * so afirmava em comentario: uma decisao `noindex` tira a pagina APENAS do
 * sitemap, ou tambem faz a pagina EMITIR `<meta robots noindex>`?
 *
 * A diferenca nao e de grau. Parar de oferecer uma URL no sitemap se desfaz em
 * horas — o buscador continua com a pagina no indice. Emitir `noindex` e um
 * PEDIDO DE REMOCAO: sai do indice e volta so depois de semanas de recrawl.
 *
 * POR QUE ESTE ARQUIVO EXISTE, SE JA HA UM VALIDADOR DE SEO
 * ---------------------------------------------------------
 * `validate-seo-runtime-real-postgres.ts` (check 4) ja prova que a decisao
 * persistida chega em `getMoviePageData().seo`. Isso e a RESOLUCAO, nao a
 * pagina. Entre a resolucao e o HTML ainda ha `gatePublicRobots`, que pode
 * colapsar tudo para `noindex,nofollow` conforme o ambiente — ou seja, a
 * resolucao poderia estar certa e a tag, outra. Concluir "emite noindex" lendo o
 * caminho e exatamente o erro que esta tarefa existe para nao repetir.
 *
 * Entao aqui o teste importa a rota de verdade (`app/pt/.../page.tsx`), chama o
 * `generateMetadata` que o Next chamaria, e LE o `robots` que sai. Os cinco
 * tipos decidiveis: filme, serie, temporada, episodio e pessoa.
 *
 * O AMBIENTE E PARTE DA MEDIDA
 * -----------------------------
 * `gatePublicRobots` faz um AND: (1) o ambiente pode indexar? (2) so entao a
 * decisao da entidade decide. Medir com o gate de ambiente desligado daria
 * `noindex` em tudo e "provaria" a tese pelo motivo errado. Por isso o cenario
 * A reproduz a producao de hoje — origem oficial + flag ligada, que e o estado
 * que o `robots.txt` publico de cinerie.com denuncia (ele traz
 * `Allow: /` + `Sitemap:`, ramo que `app/robots.ts` so emite quando
 * `isOfficialIndexableEnvironment` e verdadeiro).
 *
 * O cenario B (mesmo banco, kill switch global desligado) e o CONTROLE: prova
 * que o `noindex` do cenario A veio da DECISAO e nao do ambiente, e que a chave
 * global continua sendo capaz de derrubar tudo.
 *
 * Uso: pnpm --filter @screena/web validate:decision-robots
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
const dbSchema = path.join(dbDir, "prisma", "schema.prisma");
const dbRequire = createRequire(path.join(dbDir, "package.json"));

const LANGUAGE = "pt-BR";
const SITE = "https://cinerie.com";

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
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
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** Primeira linha da mensagem de erro (split devolve string | undefined). */
function primeiraLinha(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n")[0] ?? msg;
}

function prismaBin(): string {
  const pkgPath = dbRequire.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  // noUncheckedIndexedAccess: acesso indexado devolve string | undefined.
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  if (rel === undefined) throw new Error("binario do prisma nao encontrado");
  return path.join(path.dirname(pkgPath), rel);
}

/** A forma de `robots` que o Next aceita em `Metadata`. */
interface RobotsShape {
  index?: boolean;
  follow?: boolean;
}
interface MetadataShape {
  robots?: RobotsShape;
  alternates?: { canonical?: string };
}
type GenerateMetadata = (args: { params: Promise<Record<string, string>> }) => Promise<MetadataShape>;

/** `noindex,nofollow` / `index,follow` — como o Next serializaria a tag. */
function formatRobots(robots: RobotsShape | undefined): string {
  if (robots === undefined) return "(ausente)";
  return `${robots.index === true ? "index" : "noindex"},${robots.follow === true ? "follow" : "nofollow"}`;
}

interface PrismaLike {
  movie: { create: (a: unknown) => Promise<{ id: bigint }> };
  tvShow: { create: (a: unknown) => Promise<{ id: bigint }> };
  season: { create: (a: unknown) => Promise<{ id: bigint }> };
  episode: { create: (a: unknown) => Promise<{ id: bigint }> };
  person: { create: (a: unknown) => Promise<{ id: bigint }> };
  castMember: { create: (a: unknown) => Promise<unknown> };
  slug: { create: (a: unknown) => Promise<unknown> };
  entityTranslation: { create: (a: unknown) => Promise<unknown> };
  pageIndexabilityDecision: { create: (a: unknown) => Promise<unknown> };
}

/** Uma entidade decidivel, com a rota que a serve. */
interface Alvo {
  readonly tipo: "movie" | "tv" | "season" | "episode" | "person";
  readonly rotulo: string;
  readonly params: Record<string, string>;
  readonly generateMetadata: GenerateMetadata;
  /**
   * `robots` esperado ANTES de qualquer decisao persistida.
   *
   * NAO e `index,follow` para todo tipo, e a diferenca foi medida aqui, nao
   * suposta: temporada e episodio estao suspensos do indice desde 2026-08-27
   * pela valvula de emergencia (`src/server/seo/suspended-pages.ts`, PR #234) e
   * ja saem `noindex,follow` sem nenhuma linha na tabela. Escrever
   * `index,follow` para os cinco faria este validador reprovar a REALIDADE e
   * apontar para um defeito que nao existe.
   */
  readonly robotsBase: string;
}

async function seedDecisao(
  prisma: PrismaLike,
  tipo: Alvo["tipo"],
  entityId: bigint,
  decision: "index" | "noindex",
): Promise<void> {
  await prisma.pageIndexabilityDecision.create({
    data: {
      entityType: tipo,
      entityId,
      languageCode: LANGUAGE,
      url: `${SITE}/pt/x/`,
      decision,
      isCurrent: true,
      decisionOrigin: "catalog_policy_engine",
      reason: `seed do validador (${decision})`,
    },
  });
}

/**
 * Ambiente que reproduz a PRODUCAO de hoje: origem oficial e kill switch ligado.
 * Sem isto, `gatePublicRobots` devolveria `noindex` para tudo e o teste
 * mediria o proprio ambiente.
 */
function ligarAmbienteIndexavel(): void {
  // `NODE_ENV` e declarado READ-ONLY nos tipos do Node. O alias mutavel e o
  // jeito honesto de escrever nele num script de teste — mais claro que um
  // `@ts-expect-error` por cima de uma atribuicao.
  const env = process.env as Record<string, string | undefined>;
  env.CINERIE_PUBLIC_SITE_URL = SITE;
  env.CINERIE_PUBLIC_INDEXING_ENABLED = "1";
  env.NODE_ENV = "production";
  delete env.VERCEL_ENV;
  delete env.THE_SCREEN_PUBLIC_INDEXING_ENABLED;
  delete env.THE_SCREEN_PUBLIC_SITE_URL;
}

/** Desliga o kill switch global (cenario B do validador). */
function desligarIndexacaoGlobal(): void {
  (process.env as Record<string, string | undefined>).CINERIE_PUBLIC_INDEXING_ENABLED = "0";
}

async function runChecks(prisma: PrismaLike, alvos: readonly Alvo[]): Promise<void> {
  // ---- CENARIO A: producao de hoje (ambiente indexavel) ------------------
  ligarAmbienteIndexavel();

  let n = 1;

  // (A1) LINHA DE BASE, por tipo. Filme/serie/pessoa indexam sem decisao
  // nenhuma — se ja saissem `noindex`, todo `noindex` medido abaixo seria vacuo
  // (o teste estaria confirmando o ambiente). Temporada/episodio ja saem
  // `noindex,follow` pela valvula de emergencia de 2026-08-27, e e por isso que
  // a expectativa e por tipo.
  const robotsBaseMedido = new Map<string, string>();
  for (const alvo of alvos) {
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    const robots = formatRobots(meta.robots);
    robotsBaseMedido.set(alvo.rotulo, robots);
    record(
      n++,
      `LINHA DE BASE (${alvo.tipo}): sem decisao vigente a pagina emite ${alvo.robotsBase}`,
      robots === alvo.robotsBase,
      `${alvo.rotulo} -> ${robots}`,
    );
  }

  // (A1b) CONTROLE POSITIVO explicito: pelo menos um tipo indexa de verdade
  // neste ambiente. Sem esta linha, um ambiente mal configurado deixaria tudo
  // `noindex` e os checks de (A2) passariam sem medir nada.
  record(
    n++,
    "CONTROLE POSITIVO: o ambiente do teste PERMITE indexar (ha tipo em index,follow)",
    [...robotsBaseMedido.values()].some((r) => r === "index,follow"),
    [...robotsBaseMedido.entries()].map(([k, v]) => `${k}=${v}`).join(" | "),
  );

  // O canonical ANTES da decisao, para comparar depois (B.3).
  const canonicalAntes = new Map<string, string | undefined>();
  for (const alvo of alvos) {
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    canonicalAntes.set(alvo.rotulo, meta.alternates?.canonical);
  }

  // ---- Agora a decisao `noindex` entra no banco --------------------------
  for (const alvo of alvos) {
    await seedDecisao(prisma, alvo.tipo, BigInt(alvo.params.__id ?? "0"), "noindex");
  }

  // (A2) A MEDIDA CENTRAL, por tipo de entidade.
  for (const alvo of alvos) {
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    const robots = formatRobots(meta.robots);
    record(
      n++,
      `decisao noindex EMITE noindex na pagina (${alvo.tipo})`,
      robots.startsWith("noindex"),
      `${alvo.rotulo} -> ${robots}`,
    );
  }

  // (A2b) O EFEITO COLATERAL QUE NAO E OBVIO: para temporada e episodio a
  // pagina JA era `noindex` (valvula). O que a decisao persistida muda neles nao
  // e o `noindex` — e o `follow`, que vira `nofollow`.
  //
  // A valvula escolheu `follow` de proposito: o episodio continua apontando para
  // a temporada e para a serie, que SEGUEM indexaveis, e `nofollow` faria o
  // crawler parar de seguir justamente os links que sustentam as paginas que se
  // quer manter. Aplicar `index-decisions` sobre esses dois tipos desfaz essa
  // escolha em silencio — quem decide isso e o dono, nao um efeito colateral.
  for (const alvo of alvos) {
    if (alvo.tipo !== "season" && alvo.tipo !== "episode") continue;
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    const robots = formatRobots(meta.robots);
    const base = robotsBaseMedido.get(alvo.rotulo);
    record(
      n++,
      `a decisao persistida TROCA follow por nofollow (${alvo.tipo}) — desfaz a escolha da valvula`,
      base === "noindex,follow" && robots === "noindex,nofollow",
      `${alvo.rotulo}: ${String(base)} -> ${robots}`,
    );
  }

  // (A3) O CANONICAL nao se mexe. Uma decisao de indexabilidade nao pode
  // reescrever a URL canonica: canonical vem de `slugs`, indexabilidade vem de
  // `page_indexability_decisions`, e misturar os dois faria a pagina apontar
  // para outro lugar justamente quando sai do indice.
  for (const alvo of alvos) {
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    const antes = canonicalAntes.get(alvo.rotulo);
    const depois = meta.alternates?.canonical;
    record(
      n++,
      `canonical INALTERADO pela decisao noindex (${alvo.tipo})`,
      antes !== undefined && antes === depois,
      `${String(antes)} -> ${String(depois)}`,
    );
  }

  // ---- CENARIO B: CONTROLE do ambiente ----------------------------------
  // Mesmo banco, kill switch global desligado. Se o `noindex` de (A2) viesse do
  // ambiente e nao da decisao, este bloco seria indistinguivel do anterior — e a
  // conclusao inteira desabaria.
  desligarIndexacaoGlobal();
  for (const alvo of alvos) {
    const meta = await alvo.generateMetadata({ params: Promise.resolve(alvo.params) });
    const robots = formatRobots(meta.robots);
    record(
      n++,
      `CONTROLE DE AMBIENTE (${alvo.tipo}): kill switch desligado colapsa para noindex,nofollow`,
      robots === "noindex,nofollow",
      `${alvo.rotulo} -> ${robots}`,
    );
  }
  ligarAmbienteIndexavel();
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "cinerie-robots-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: true,
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/cinerie_robots_validation?schema=public`;
  console.log(
    `\n=== Postgres efemero (embedded) :${port} | postgresql://postgres:****@127.0.0.1:${port}/cinerie_robots_validation ===\n`,
  );

  let started = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("cinerie_robots_validation");

    process.env.DATABASE_URL = url;
    const env = { ...process.env, DATABASE_URL: url };

    console.log("--- prisma migrate deploy ---");
    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });
    console.log("--- prisma db seed (idiomas/paises) ---");
    execFileSync("node", [prismaBin(), "db", "seed", "--schema", dbSchema], {
      env,
      stdio: "inherit",
      cwd: dbDir,
    });

    // O ambiente precisa estar ligado ANTES de importar as rotas: modulos como
    // `site.ts` congelam `SITE_URL` no topo, e uma origem errada faria o
    // canonical nascer apontando para localhost.
    ligarAmbienteIndexavel();

    const dbServer = (await import("@screena/db/server")) as {
      getPrismaClient: () => PrismaLike;
      disconnectPrisma: () => Promise<void>;
    };
    disconnect = dbServer.disconnectPrisma;
    const prisma = dbServer.getPrismaClient();

    // ---- Fixtures: uma entidade COMPLETA de cada tipo --------------------
    const movie = await prisma.movie.create({
      data: {
        tmdbId: 97_000_001,
        titleOriginal: "Filme Alvo",
        posterPath: "/poster.jpg",
      },
      select: { id: true },
    });
    await prisma.slug.create({
      data: {
        entityType: "movie",
        entityId: movie.id,
        languageCode: LANGUAGE,
        slug: "filme-alvo",
        isCanonical: true,
      },
    });
    await prisma.entityTranslation.create({
      data: {
        entityType: "movie",
        entityId: movie.id,
        languageCode: LANGUAGE,
        title: "Filme Alvo",
        summary: "Sinopse propria do filme alvo, longa o bastante para a ficha.",
      },
    });

    const tv = await prisma.tvShow.create({
      data: { tmdbId: 97_000_002, nameOriginal: "Serie Alvo", posterPath: "/poster-tv.jpg" },
      select: { id: true },
    });
    await prisma.slug.create({
      data: {
        entityType: "tv",
        entityId: tv.id,
        languageCode: LANGUAGE,
        slug: "serie-alvo",
        isCanonical: true,
      },
    });
    await prisma.entityTranslation.create({
      data: {
        entityType: "tv",
        entityId: tv.id,
        languageCode: LANGUAGE,
        title: "Serie Alvo",
        summary: "Sinopse propria da serie alvo, longa o bastante para a ficha.",
      },
    });

    const season = await prisma.season.create({
      data: {
        tvShowId: tv.id,
        seasonNumber: 1,
        name: "Temporada 1",
        overview: "Sinopse propria da temporada.",
        airDate: new Date("2021-01-01"),
        episodeCount: 1,
      },
      select: { id: true },
    });
    const episode = await prisma.episode.create({
      data: {
        seasonId: season.id,
        tvShowId: tv.id,
        episodeNumber: 1,
        name: "Episodio 1",
        overview: "Sinopse propria do episodio.",
        airDate: new Date("2021-01-08"),
        runtimeMinutes: 45,
        stillPath: "/still.jpg",
      },
      select: { id: true },
    });

    const person = await prisma.person.create({
      data: {
        tmdbId: 97_000_003,
        name: "Pessoa Alvo",
        profilePath: "/profile.jpg",
        biography: "Biografia propria da pessoa alvo.",
      },
      select: { id: true },
    });
    await prisma.slug.create({
      data: {
        entityType: "person",
        entityId: person.id,
        languageCode: LANGUAGE,
        slug: "pessoa-alvo",
        isCanonical: true,
      },
    });
    await prisma.entityTranslation.create({
      data: {
        entityType: "person",
        entityId: person.id,
        languageCode: LANGUAGE,
        title: "Pessoa Alvo",
      },
    });
    await prisma.castMember.create({
      data: {
        entityType: "movie",
        entityId: movie.id,
        personId: person.id,
        billingOrder: 1,
        character: "Protagonista",
      },
    });

    // ---- As rotas de verdade --------------------------------------------
    // Cast via `unknown`: o modulo da rota exporta `default`/`revalidate` alem do
    // `generateMetadata`, entao os tipos nao se sobrepoem o bastante para o cast direto.
    const movieRoute = (await import("../app/pt/filmes/[slug]/page.tsx")) as unknown as {
      generateMetadata: GenerateMetadata;
    };
    const seriesRoute = (await import("../app/pt/series/[slug]/page.tsx")) as unknown as {
      generateMetadata: GenerateMetadata;
    };
    const seasonRoute = (await import(
      "../app/pt/series/[slug]/temporadas/[season]/page.tsx"
    )) as unknown as { generateMetadata: GenerateMetadata };
    const episodeRoute = (await import(
      "../app/pt/series/[slug]/temporadas/[season]/episodios/[episode]/page.tsx"
    )) as unknown as { generateMetadata: GenerateMetadata };
    const personRoute = (await import("../app/pt/pessoas/[slug]/page.tsx")) as unknown as {
      generateMetadata: GenerateMetadata;
    };

    const alvos: Alvo[] = [
      {
        tipo: "movie",
        rotulo: "/pt/filmes/filme-alvo/",
        params: { slug: "filme-alvo", __id: String(movie.id) },
        generateMetadata: movieRoute.generateMetadata,
        robotsBase: "index,follow",
      },
      {
        tipo: "tv",
        rotulo: "/pt/series/serie-alvo/",
        params: { slug: "serie-alvo", __id: String(tv.id) },
        generateMetadata: seriesRoute.generateMetadata,
        robotsBase: "index,follow",
      },
      {
        tipo: "season",
        rotulo: "/pt/series/serie-alvo/temporadas/1/",
        params: { slug: "serie-alvo", season: "1", __id: String(season.id) },
        generateMetadata: seasonRoute.generateMetadata,
        // Valvula de emergencia de 2026-08-27: o TIPO esta suspenso do indice.
        robotsBase: "noindex,follow",
      },
      {
        tipo: "episode",
        rotulo: "/pt/series/serie-alvo/temporadas/1/episodios/1/",
        params: { slug: "serie-alvo", season: "1", episode: "1", __id: String(episode.id) },
        generateMetadata: episodeRoute.generateMetadata,
        robotsBase: "noindex,follow",
      },
      {
        tipo: "person",
        rotulo: "/pt/pessoas/pessoa-alvo/",
        params: { slug: "pessoa-alvo", __id: String(person.id) },
        generateMetadata: personRoute.generateMetadata,
        robotsBase: "index,follow",
      },
    ];

    await runChecks(prisma, alvos);
  } catch (e) {
    record(0, "execucao", false, primeiraLinha(e));
    console.error(e);
  } finally {
    if (disconnect) await disconnect();
    if (started) await pg.stop();
    delete process.env.DATABASE_URL;
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(
        `Aviso: dir temporario nao removido agora (${primeiraLinha(e)}); sera limpo pelo SO.`,
      );
    }
    console.log("\n=== Postgres efemero derrubado ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log(
    "Resultado: PASSOU. Uma decisao `noindex` EMITE noindex na pagina, nos cinco tipos, e nao altera o canonical.",
  );
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
