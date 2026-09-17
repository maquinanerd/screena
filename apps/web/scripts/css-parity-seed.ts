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
 * Tambem: titulos com estreia FUTURA (filme datado, filme anunciado sem data e
 * serie datada), para /pt/em-breve/ e a agenda de /pt/explorar/ terem cards; e
 * OFERTAS de streaming com a cadeia de licenca completa (provedor, alias, licenca
 * `watch_availability`, decisao `watch_offer_display` aprovada e hash do payload
 * aprovado), para /pt/onde-assistir/ e o painel das fichas renderizarem. As datas
 * futuras sao fixas e distantes (2031): a paridade compara capturas do mesmo dia,
 * e uma data "a partir de hoje" mudaria o texto dos cards de uma captura para outra.
 *
 * Roda SO contra o Postgres efemero do laboratorio (loopback). Idempotente.
 *
 * Uso: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:PORTA/cinerie_route_cache?schema=public \
 *        pnpm --filter @screena/web css:parity:seed
 */

const LANGUAGE = "pt-BR";

type PrismaLike = {
  $queryRawUnsafe: <T>(sql: string) => Promise<T[]>;
  $executeRawUnsafe: (sql: string) => Promise<number>;
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

/** Escapa literal de texto para SQL gerado (fixture do laboratorio, nunca entrada de usuario). */
function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const LAB_REVIEWER = "laboratorio-paridade-css";

/** Titulos com estreia futura, com traducao e slug canonico. Devolve quantos criou. */
async function seedUpcomingTitles(prisma: PrismaLike): Promise<number> {
  const specs = [
    { table: "movies", type: "movie", tmdbId: 991001, slug: "paridade-filme-futuro", title: "Filme futuro de paridade", date: "2031-06-15", status: "In Production" },
    { table: "movies", type: "movie", tmdbId: 991002, slug: "paridade-filme-anunciado", title: "Filme anunciado de paridade", date: null, status: "Post Production" },
    { table: "tv_shows", type: "tv", tmdbId: 991003, slug: "paridade-serie-futura", title: "Serie futura de paridade", date: "2031-09-01", status: "Planned" },
  ] as const;
  let created = 0;
  for (const spec of specs) {
    const existing = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM ${spec.table} WHERE tmdb_id = ${spec.tmdbId}`,
    );
    if (existing.length > 0) continue;
    const row =
      spec.table === "movies"
        ? await prisma.$queryRawUnsafe<{ id: bigint }>(
            `INSERT INTO movies (tmdb_id, title_original, release_date, status, runtime_minutes, updated_at)
             VALUES (${spec.tmdbId}, ${lit(spec.title)}, ${spec.date === null ? "NULL" : `DATE '${spec.date}'`}, ${lit(spec.status)}, 112, now()) RETURNING id`,
          )
        : await prisma.$queryRawUnsafe<{ id: bigint }>(
            `INSERT INTO tv_shows (tmdb_id, name_original, first_air_date, status, number_of_episodes, updated_at)
             VALUES (${spec.tmdbId}, ${lit(spec.title)}, ${spec.date === null ? "NULL" : `DATE '${spec.date}'`}, ${lit(spec.status)}, 8, now()) RETURNING id`,
          );
    const id = (row[0] as { id: bigint }).id;
    await prisma.$executeRawUnsafe(
      `INSERT INTO slugs (entity_type, entity_id, language_code, slug, is_canonical, updated_at)
       VALUES (${lit(spec.type)}, ${id}, ${lit(LANGUAGE)}, ${lit(spec.slug)}, true, now())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO entity_translations (entity_type, entity_id, language_code, title, updated_at)
       VALUES (${lit(spec.type)}, ${id}, ${lit(LANGUAGE)}, ${lit(spec.title)}, now())`,
    );
    created += 1;
  }
  return created;
}

interface OfferSpec {
  readonly entityType: "movie" | "tv";
  readonly entityId: bigint;
  readonly providerSlug: string;
  readonly providerName: string;
  readonly offerType: "subscription" | "rent" | "buy" | "free" | "ads";
}

/**
 * Ofertas de streaming com a cadeia de licenca inteira que `licensedWatchWhere`
 * exige — a mesma receita de `qa-home-editorial-ticker-real-postgres.ts`: provedor,
 * alias, licenca `watch_availability`, decisao `watch_offer_display` aprovada e o
 * hash do payload aprovado calculado pela funcao do banco. Devolve quantas criou.
 */
async function seedLicensedOffers(prisma: PrismaLike, specs: readonly OfferSpec[]): Promise<number> {
  let created = 0;
  for (const spec of specs) {
    const externalOfferId = `paridade-${spec.entityType}-${spec.entityId}-${spec.providerSlug}-${spec.offerType}`;
    const already = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM watch_availability WHERE external_offer_id = ${lit(externalOfferId)}`,
    );
    if (already.length > 0) continue;

    let provider = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM watch_providers WHERE slug = ${lit(spec.providerSlug)}`,
    );
    if (provider.length === 0) {
      provider = await prisma.$queryRawUnsafe<{ id: bigint }>(
        `INSERT INTO watch_providers (slug, canonical_name, homepage_url, updated_at)
         VALUES (${lit(spec.providerSlug)}, ${lit(spec.providerName)}, ${lit(`https://www.${spec.providerSlug}.com/`)}, now()) RETURNING id`,
      );
    }
    const providerId = (provider[0] as { id: bigint }).id;
    const alias = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM watch_provider_aliases WHERE provider_api = 'streaming_availability' AND external_key = ${lit(spec.providerSlug)}`,
    );
    if (alias.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO watch_provider_aliases (provider_id, provider_api, external_key, display_name, updated_at)
         VALUES (${providerId}, 'streaming_availability', ${lit(spec.providerSlug)}, ${lit(spec.providerName)}, now())`,
      );
    }
    let license = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM source_licenses WHERE source_key = ${lit(spec.providerSlug)} AND content_type = 'watch_availability' AND is_current`,
    );
    if (license.length === 0) {
      license = await prisma.$queryRawUnsafe<{ id: bigint }>(
        `INSERT INTO source_licenses (source_key, content_type, provider_key, territory_code, license_status, display_allowed, logo_allowed, score_allowed, review_quote_allowed, requires_attribution, requires_linkback, attribution_text, is_current, decided_by, decided_at, policy_version, updated_at)
         VALUES (${lit(spec.providerSlug)}, 'watch_availability', 'streaming_availability', 'BR', 'third_party', true, false, false, false, true, true, 'Disponibilidade fornecida por Movie of the Night', true, ${lit(LAB_REVIEWER)}, now(), 'paridade/v1', now()) RETURNING id`,
      );
    }
    const licenseId = (license[0] as { id: bigint }).id;
    let decision = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `SELECT id FROM data_usage_decisions WHERE source_license_id = ${licenseId} AND use_case = 'watch_offer_display' AND is_current`,
    );
    if (decision.length === 0) {
      decision = await prisma.$queryRawUnsafe<{ id: bigint }>(
        `INSERT INTO data_usage_decisions (source_license_id, use_case, territory, stage, display_allowed, storage_allowed, derivative_allowed, attribution_required, linkback_required, valid_from, policy_version, decided_by, reason, is_current, updated_at)
         VALUES (${licenseId}, 'watch_offer_display', 'BR', 'approved_for_display', true, true, false, true, true, TIMESTAMPTZ '2026-01-01T00:00:00Z', 'paridade/v1', ${lit(LAB_REVIEWER)}, 'laboratorio efemero da paridade de CSS', true, now()) RETURNING id`,
      );
    }
    const decisionId = (decision[0] as { id: bigint }).id;
    const offer = await prisma.$queryRawUnsafe<{ id: bigint }>(
      `INSERT INTO watch_availability (entity_type, entity_id, country_code, provider_api, external_offer_id, provider_key, provider_name, offer_type, deep_link, quality, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url, fetched_at, reviewed_at, reviewed_by, watch_provider_id, data_usage_decision_id, display_allowed, updated_at)
       VALUES (${lit(spec.entityType)}::"EntityType", ${spec.entityId}, 'BR', 'streaming_availability', ${lit(externalOfferId)}, ${lit(spec.providerSlug)}, ${lit(spec.providerName)}, ${lit(spec.offerType)}, ${lit(`https://www.${spec.providerSlug}.com/br/paridade`)}, 'hd', 'third_party', true, true, 'Disponibilidade fornecida por Movie of the Night', 'https://www.movieofthenight.com/', now(), now(), ${lit(LAB_REVIEWER)}, ${providerId}, ${decisionId}, false, now()) RETURNING id`,
    );
    const offerId = (offer[0] as { id: bigint }).id;
    await prisma.$executeRawUnsafe(
      `UPDATE watch_availability SET approved_payload_hash = watch_offer_payload_fingerprint_v1(provider_api, external_offer_id, entity_type, entity_id, country_code, offer_type, provider_key, provider_name, package, quality, price, currency, deep_link, web_url, available_from, available_until, license_status, requires_attribution, requires_linkback, attribution_text, attribution_url), display_allowed = true WHERE id = ${offerId}`,
    );
    created += 1;
  }
  return created;
}

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

    const upcoming = await seedUpcomingTitles(prisma);
    const offers = await seedLicensedOffers(prisma, [
      { entityType: "movie", entityId: movieId, providerSlug: "netflix", providerName: "Netflix", offerType: "subscription" },
      { entityType: "tv", entityId: tvId, providerSlug: "netflix", providerName: "Netflix", offerType: "subscription" },
      { entityType: "movie", entityId: movieId, providerSlug: "max", providerName: "Max", offerType: "rent" },
    ]);

    console.log(
      `paridade semeada: ${articles} materia(s) nova(s), ${episodes.count} episodio(s) novo(s), ` +
        `${cast.count} credito(s) novo(s), ${upcoming} titulo(s) futuro(s), ${offers} oferta(s) licenciada(s), ` +
        "licenca de imagem e biografia de pessoa-1.",
    );
  } finally {
    await db.disconnectPrisma();
  }
}

main().catch((error: unknown) => {
  console.error("[FALHA] o seed de paridade abortou:", error);
  process.exit(1);
});
