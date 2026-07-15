/**
 * seed-dev-movie.ts — Fixture DEV-ONLY de um filme de exemplo no banco LOCAL.
 *
 * FERRAMENTA DE DESENVOLVIMENTO. NAO faz parte do produto: nunca roda no render,
 * no build de app, nem em producao. Insere/atualiza um filme de exemplo
 * ("Interstellar" / slug pt-BR "interestelar") no PostgreSQL local de
 * desenvolvimento (o do `docker-compose.dev.yml`) para abrir a rota
 * `/pt/filmes/interestelar/` no navegador.
 *
 * Cria o minimo para a pagina ficar INDEXAVEL (a entidade ja indexaria so com
 * slug + traducao, sob a politica de indexacao total) e "rica" em qualidade
 * editorial (`hasUniqueValue=true`): movie + slug canonico pt-BR +
 * entity_translation pt-BR + 2 content_blocks renderizaveis (`editorial_intro`
 * + `cast_intro`, `published`/`human_reviewed`, `human`).
 *
 * Regras (alinhadas as invariantes):
 *  - ZERO rede, ZERO Gemini, ZERO TMDB: so escreve no PostgreSQL local via o
 *    acessor server-only `@screena/db/server` (Prisma).
 *  - SEM ratings, SEM streaming, SEM dados de API externa.
 *  - Conteudo dos blocos e claramente de FIXTURE local: nao finge resenha real,
 *    nao usa notas, nao cita plataformas nem fontes (IMDb/Rotten/Metacritic).
 *  - IDEMPOTENTE: rodar de novo atualiza/mantem; nunca duplica movie, slug,
 *    translation nem content_block ativo.
 *  - Exige `DATABASE_URL`; aborta se ausente; NUNCA imprime a senha/URL.
 *
 * Uso: pnpm --filter @screena/web seed:dev-movie
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANGUAGE = "pt-BR";
const ENTITY_TYPE = "movie";
const SLUG = "interestelar";
const TITLE_ORIGINAL = "Interstellar";
const TITLE_PT = "Interestelar";
// Id-sentinela de FIXTURE local (NAO e um id real do TMDB; nunca chamamos TMDB).
// Serve so como chave natural estavel para o upsert idempotente do movie local.
const DEV_FIXTURE_TMDB_ID = 99990001;
const RELEASE_DATE = new Date("2014-11-06");
const RUNTIME_MINUTES = 169;
// Paths crus em formato parecido com poster/backdrop de provider. Nesta fase
// eles NAO renderizam imagem: a pagina so aceita paths locais seguros
// (/media/, /uploads/, /brand/), mantendo fallback visual.
const POSTER_PATH = "/dev-fixture-poster.jpg";
const BACKDROP_PATH = "/dev-fixture-backdrop.jpg";

/** Blocos renderizaveis da fixture (2 = passa o gate anti-thin -> index). */
const FIXTURE_BLOCKS = [
  {
    blockType: "editorial_intro",
    reviewStatus: "published",
    content:
      "Bloco de introducao editorial de EXEMPLO (fixture local de desenvolvimento). " +
      "Serve apenas para abrir a pagina do filme no navegador durante o desenvolvimento. " +
      "Nao e uma resenha real e nao contem dados de terceiros.",
  },
  {
    blockType: "cast_intro",
    reviewStatus: "human_reviewed",
    content:
      "Bloco de elenco de EXEMPLO (fixture local de desenvolvimento). " +
      "Texto generico de teste, sem nomes reais de elenco, sem notas e sem disponibilidade.",
  },
] as const;

/** Prisma client tipado minimamente (resolvido por import dinamico em runtime). */
type PrismaLike = {
  movie: { upsert: (args: unknown) => Promise<{ id: bigint }> };
  slug: { upsert: (args: unknown) => Promise<unknown> };
  entityTranslation: { upsert: (args: unknown) => Promise<unknown> };
  contentBlock: {
    findFirst: (args: unknown) => Promise<{ id: bigint } | null>;
    update: (args: unknown) => Promise<unknown>;
    create: (args: unknown) => Promise<unknown>;
  };
};

/** getMoviePageData tipado minimamente (so para a confirmacao pos-seed). */
type GetMoviePageData = (
  slug: string,
) => Promise<{ view: { renderableBlockCount: number }; indexability: { decision: string }; canonicalUrl: string } | null>;

/**
 * Insere/atualiza a fixture de forma idempotente. Ancoras de unicidade:
 *  - movie: `tmdb_id` (sentinela de fixture) — upsert;
 *  - slug: unique (entity_type, language_code, slug) — upsert;
 *  - translation: unique (entity_type, entity_id, language_code) — upsert;
 *  - content_block: sem unique no schema -> find-ativo-ou-cria (atualiza o
 *    existente do mesmo block_type; nunca duplica).
 */
async function seedDevMovie(prisma: PrismaLike): Promise<string> {
  const movie = await prisma.movie.upsert({
    where: { tmdbId: DEV_FIXTURE_TMDB_ID },
    update: {
      titleOriginal: TITLE_ORIGINAL,
      releaseDate: RELEASE_DATE,
      runtimeMinutes: RUNTIME_MINUTES,
      posterPath: POSTER_PATH,
      backdropPath: BACKDROP_PATH,
    },
    create: {
      tmdbId: DEV_FIXTURE_TMDB_ID,
      titleOriginal: TITLE_ORIGINAL,
      releaseDate: RELEASE_DATE,
      runtimeMinutes: RUNTIME_MINUTES,
      posterPath: POSTER_PATH,
      backdropPath: BACKDROP_PATH,
    },
    select: { id: true },
  });
  const entityId = movie.id;

  await prisma.slug.upsert({
    where: { entityType_languageCode_slug: { entityType: ENTITY_TYPE, languageCode: LANGUAGE, slug: SLUG } },
    update: { entityId, isCanonical: true },
    create: { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE, slug: SLUG, isCanonical: true },
  });

  await prisma.entityTranslation.upsert({
    where: { entityType_entityId_languageCode: { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE } },
    update: { title: TITLE_PT },
    create: { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE, title: TITLE_PT },
  });

  for (const block of FIXTURE_BLOCKS) {
    const existing = await prisma.contentBlock.findFirst({
      where: {
        entityType: ENTITY_TYPE,
        entityId,
        languageCode: LANGUAGE,
        blockType: block.blockType,
        reviewStatus: { not: "archived" },
      },
      select: { id: true },
    });
    if (existing !== null) {
      await prisma.contentBlock.update({
        where: { id: existing.id },
        data: { content: block.content, reviewStatus: block.reviewStatus, sourceType: "human" },
      });
    } else {
      await prisma.contentBlock.create({
        data: {
          entityType: ENTITY_TYPE,
          entityId,
          languageCode: LANGUAGE,
          blockType: block.blockType,
          content: block.content,
          sourceType: "human", // human -> modelProvider pode ser null (sem CHECK)
          modelProvider: null,
          modelName: null,
          promptVersion: "dev-fixture",
          inputHash: "dev-fixture",
          outputHash: "dev-fixture",
          reviewStatus: block.reviewStatus,
        },
      });
    }
  }

  return entityId.toString();
}

async function main(): Promise<void> {
  // Carrega .env da raiz do monorepo (best-effort), para o fluxo documentado
  // `cp .env.example .env` funcionar sem exportar a variavel manualmente. Se nao
  // houver .env, seguimos com as variaveis ja presentes no ambiente.
  const scriptDir = path.dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
  const repoRoot = path.resolve(scriptDir, "..", "..", "..");
  const envPath = path.join(repoRoot, ".env");
  if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    console.error(
      "Erro: DATABASE_URL ausente. Defina o banco LOCAL de desenvolvimento (ex.: copie .env.example para .env " +
        "e suba o docker-compose.dev.yml) antes de rodar o seed da fixture.",
    );
    process.exitCode = 1;
    return;
  }

  // Import dinamico do acessor server-only DEPOIS do .env: o singleton do Prisma
  // e criado sob demanda na 1a query, ja apontando para o banco local.
  const dbServer = (await import("@screena/db/server")) as {
    getPrismaClient: () => PrismaLike;
    disconnectPrisma: () => Promise<void>;
  };
  const moviePage = (await import("../src/server/movie-page.ts")) as {
    getMoviePageData: GetMoviePageData;
  };

  const prisma = dbServer.getPrismaClient();
  try {
    console.log("Aplicando fixture dev do filme no PostgreSQL local...");
    const entityId = await seedDevMovie(prisma);

    // Confirmacao read-only: prova que a pagina ficou indexavel (gate anti-thin).
    const data = await moviePage.getMoviePageData(SLUG);
    if (data === null) {
      console.error("Aviso: fixture aplicada mas getMoviePageData retornou null (verifique o banco).");
      process.exitCode = 1;
      return;
    }
    console.log(`Fixture pronta: movie id=${entityId}`);
    console.log(`  rota:    /pt/filmes/${SLUG}/`);
    console.log(`  blocos renderizaveis: ${data.view.renderableBlockCount}`);
    console.log(`  indexabilidade: ${data.indexability.decision}`);
    console.log(`  canonical: ${data.canonicalUrl}`);
    console.log("\nAbra no navegador (com `pnpm --filter @screena/web dev`): /pt/filmes/interestelar/");
  } finally {
    await dbServer.disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("Falha ao aplicar a fixture dev:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
