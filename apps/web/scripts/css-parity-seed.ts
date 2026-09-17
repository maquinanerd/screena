/**
 * css-parity-seed.ts — os dados que a paridade de CSS precisa ver RENDERIZADOS e
 * que o seed do `validate:route-cache` nao traz: materias com e sem capa (e com
 * elas a pagina de autor), temporada com episodios, elenco, biografia de pessoa e
 * a licenca de imagem do TMDB.
 *
 * Sem isto, a paridade compararia paginas vazias: familia de CSS que nao aparece
 * na tela nao tem estilo computado para comparar, e uma paridade "verde" diria
 * pouco sobre ela.
 *
 * Roda SO contra o Postgres efemero do laboratorio (loopback). Idempotente.
 *
 * Uso: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:PORTA/cinerie_route_cache?schema=public \
 *        pnpm --filter @screena/web css:parity:seed
 */

const LANGUAGE = "pt-BR";

type PrismaLike = {
  slug: { findFirst: (args: unknown) => Promise<{ entityId: bigint } | null> };
  sourceLicense: {
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<unknown>;
  };
  article: { create: (args: unknown) => Promise<{ id: bigint }> };
  articleTranslation: {
    findFirst: (args: unknown) => Promise<{ id: bigint } | null>;
    create: (args: unknown) => Promise<unknown>;
  };
  entityNewsLink: { createMany: (args: unknown) => Promise<{ count: number }> };
  season: { upsert: (args: unknown) => Promise<{ id: bigint; tvShowId: bigint }> };
  episode: { createMany: (args: unknown) => Promise<{ count: number }> };
  castMember: { createMany: (args: unknown) => Promise<{ count: number }> };
  person: { update: (args: unknown) => Promise<unknown> };
};

const BODY = [
  "Primeiro paragrafo da materia de paridade, com texto suficiente para a pagina renderizar o corpo completo e medir o estilo computado de cada bloco.",
  "Segundo paragrafo, mais longo, para que a largura de leitura e o espacamento entre paragrafos aparecam na medicao da materia, como aparecem numa materia real publicada.",
  "Terceiro paragrafo encerra o corpo com uma frase comum.",
].join("\n\n");

const ARTICLES = [
  {
    slug: "paridade-materia-com-capa",
    title: "Materia de paridade com capa",
    deck: "Uma materia com capa, fonte, nota de IA e entidades citadas.",
    authorName: "Autora Paridade",
    category: "Series",
    heroImagePath: "/media/editorial/paridade/capa.webp",
    aiAssisted: true,
    sourceName: "Fonte Paridade",
    withLinks: true,
  },
  {
    slug: "paridade-materia-sem-capa",
    title: "Materia de paridade sem capa",
    deck: "Uma materia sem capa e sem fonte.",
    authorName: "Autora Paridade",
    category: "Filmes",
    heroImagePath: null,
    aiAssisted: false,
    sourceName: null,
    withLinks: false,
  },
  {
    slug: "paridade-materia-tres",
    title: "Terceira materia de paridade",
    deck: "A terceira, para a listagem ter o destaque e os cards.",
    authorName: "Autor Paridade",
    category: "Series",
    heroImagePath: null,
    aiAssisted: false,
    sourceName: null,
    withLinks: false,
  },
] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(url)) {
    throw new Error("DATABASE_URL precisa ser o Postgres EFEMERO do laboratorio, em 127.0.0.1");
  }
  const db = (await import("@screena/db/server")) as {
    getPrismaClient: () => PrismaLike;
    disconnectPrisma: () => Promise<void>;
  };
  const prisma = db.getPrismaClient();
  try {
    const entityId = async (entityType: string, slug: string): Promise<bigint> => {
      const row = await prisma.slug.findFirst({
        where: { entityType, languageCode: LANGUAGE, slug, isCanonical: true },
        select: { entityId: true },
      });
      if (row === null) throw new Error(`slug ausente no laboratorio: ${entityType}/${slug}`);
      return row.entityId;
    };
    const movieId = await entityId("movie", "filme-1");
    const tvId = await entityId("tv", "serie-1");
    const people: bigint[] = [];
    for (const n of [1, 2, 3, 4, 5, 6]) people.push(await entityId("person", `pessoa-${n}`));

    // Licenca de imagem do TMDB: sem ela nenhuma arte (poster, still, retrato) vai para a tela.
    if ((await prisma.sourceLicense.count({ where: { sourceKey: "tmdb", contentType: "image", isCurrent: true } })) === 0) {
      await prisma.sourceLicense.create({
        data: {
          sourceKey: "tmdb",
          contentType: "image",
          providerKey: "tmdb",
          territoryCode: null,
          licenseStatus: "official",
          displayAllowed: true,
          logoAllowed: true,
          scoreAllowed: false,
          reviewQuoteAllowed: false,
          requiresAttribution: true,
          requiresLinkback: true,
          attributionText: "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
          isCurrent: true,
          decisionOrigin: "validator-harness",
          policyVersion: "cinerie-source-auth/tmdb-image/2026-08-v4",
        },
      });
    }

    let articles = 0;
    for (const [index, spec] of ARTICLES.entries()) {
      const existing = await prisma.articleTranslation.findFirst({
        where: { languageCode: LANGUAGE, slug: spec.slug },
        select: { id: true },
      });
      if (existing !== null) continue;
      const publishedAt = new Date(Date.UTC(2026, 8, 1 + index, 12));
      const article = await prisma.article.create({
        data: {
          authorName: spec.authorName,
          category: spec.category,
          heroImagePath: spec.heroImagePath,
          publishedAt,
          readTimeMinutes: 4,
          aiAssisted: spec.aiAssisted,
          sourceName: spec.sourceName,
          sourceUrl: null,
          licenseStatus: "official",
          displayAllowed: true,
          requiresAttribution: false,
          requiresLinkback: false,
        },
        select: { id: true },
      });
      await prisma.articleTranslation.create({
        data: {
          articleId: article.id,
          languageCode: LANGUAGE,
          slug: spec.slug,
          title: spec.title,
          deck: spec.deck,
          body: BODY,
          metaTitle: null,
          metaDescription: null,
          reviewStatus: "published",
          indexStatus: "index",
          publishedAt,
        },
      });
      if (spec.withLinks) {
        await prisma.entityNewsLink.createMany({
          data: [
            { articleId: article.id, entityType: "movie", entityId: movieId },
            { articleId: article.id, entityType: "tv", entityId: tvId },
            { articleId: article.id, entityType: "person", entityId: people[0] as bigint },
          ],
          skipDuplicates: true,
        });
      }
      articles += 1;
    }

    const season = await prisma.season.upsert({
      where: { tvShowId_seasonNumber: { tvShowId: tvId, seasonNumber: 1 } },
      create: {
        tvShowId: tvId,
        seasonNumber: 1,
        name: "Temporada 1",
        overview: "A primeira temporada da serie de paridade.",
        airDate: new Date(Date.UTC(2019, 0, 1)),
        episodeCount: 12,
        posterPath: "/poster-temporada-paridade.jpg",
      },
      update: {},
    });
    const episodes = await prisma.episode.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        seasonId: season.id,
        tvShowId: season.tvShowId,
        episodeNumber: i + 1,
        name: `Episodio ${i + 1} da paridade`,
        overview: `Sinopse inteira do episodio ${i + 1}, longa o bastante para quebrar em mais de uma linha na lista de episodios da ficha.`,
        airDate: new Date(Date.UTC(2019, 0, 1 + i * 7)),
        runtimeMinutes: 45,
        stillPath: `/still-paridade-${i + 1}.jpg`,
      })),
      skipDuplicates: true,
    });

    const cast = await prisma.castMember.createMany({
      data: people.flatMap((personId, i) => [
        {
          personId,
          entityType: "movie",
          entityId: movieId,
          character: `Personagem ${i + 1}`,
          billingOrder: i,
          creditId: `paridade-movie-${i + 1}`,
          isGuest: false,
        },
        {
          personId,
          entityType: "tv",
          entityId: tvId,
          character: `Personagem ${i + 1}`,
          billingOrder: i,
          creditId: `paridade-tv-${i + 1}`,
          isGuest: false,
        },
      ]),
      skipDuplicates: true,
    });

    await prisma.person.update({
      where: { id: people[0] as bigint },
      data: {
        biography:
          "Biografia de paridade da pessoa 1.\n\nSegundo paragrafo da biografia, para a pagina de pessoa renderizar o corpo de texto.",
        biographySourceStatus: "licensed",
      },
    });

    console.log(
      `paridade semeada: ${articles} materia(s) nova(s), ${episodes.count} episodio(s) novo(s), ` +
        `${cast.count} credito(s) novo(s), licenca de imagem e biografia de pessoa-1.`,
    );
  } finally {
    await db.disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("[FALHA] o seed de paridade abortou:", error);
  process.exit(1);
});
