/**
 * home-hero-selection.test.ts — QUEM abre a home, e por quê.
 *
 * ============ O DEFEITO QUE ESTE ARQUIVO TRAVA ============
 *
 * O hero ordenava por ano de lançamento decrescente e não filtrava nada. Como o
 * lixo do TMDB se concentra nas datas futuras, essa ordem premiava por
 * construção o registro mais implausível do catálogo: em produção, o destaque
 * era um curta de 1938 cadastrado com `release_date` em 2057, sem pôster.
 *
 * A prova aqui é sobre a ESCOLHA, não sobre markup: um cliente Prisma falso
 * entrega um catálogo onde o "mais novo" é lixo e o melhor título é antigo. Se a
 * ordenação voltar a ser por data, o primeiro teste cai.
 */

import { describe, expect, it, vi } from "vitest";

import { HOME_HERO_SLIDE_LIMIT, loadHeroSlides } from "../home-hero";

const NOW = new Date("2026-08-25T12:00:00.000Z");

interface MovieRow {
  id: bigint;
  titleOriginal: string;
  releaseDate: Date | null;
  voteCountTmdb: number | null;
  status: string | null;
  certification: string | null;
  screenScore: null;
  screenScoreScale: null;
  screenScoreDisplay: boolean;
  backdropPath: string | null;
  posterPath: string | null;
}

/** Um filme publicável; cada caso estraga o que quiser. */
function movie(id: bigint, over: Partial<MovieRow> = {}): MovieRow {
  return {
    id,
    titleOriginal: `Filme ${id}`,
    releaseDate: new Date(Date.UTC(2020, 0, 1)),
    voteCountTmdb: 1_000,
    status: "Released",
    certification: null,
    screenScore: null,
    screenScoreScale: null,
    screenScoreDisplay: false,
    backdropPath: `/backdrop-${id}.jpg`,
    posterPath: `/poster-${id}.jpg`,
    ...over,
  };
}

/**
 * "Der Liebesbrief": o registro REAL que motivou a mudança. Ano 2057, sem
 * pôster, quase sem votos — e, sob a ordenação antiga, o destaque da home.
 */
const DER_LIEBESBRIEF = movie(1n, {
  titleOriginal: "Der Liebesbrief",
  releaseDate: new Date(Date.UTC(2057, 0, 1)),
  voteCountTmdb: 2,
  posterPath: null,
});

/** Um blockbuster antigo: perde na data, ganha em tudo o que importa. */
const BLOCKBUSTER = movie(2n, { titleOriginal: "Blockbuster", voteCountTmdb: 9_000 });

/** Um título mediano, publicável, para haver mais de um elegível. */
const MEDIANO = movie(3n, { titleOriginal: "Mediano", voteCountTmdb: 500 });

interface FakeOptions {
  readonly movies?: readonly MovieRow[];
  /** Ids na ordem do trending da semana; vazio = sem captura vigente. */
  readonly trending?: readonly bigint[];
  /** Linhas vigentes de curadoria, já na ordem de `position`. */
  readonly curated?: readonly { entityType: string; entityId: bigint }[];
}

function fakePrisma(options: FakeOptions = {}): Parameters<typeof loadHeroSlides>[0] {
  const movies = options.movies ?? [DER_LIEBESBRIEF, BLOCKBUSTER, MEDIANO];
  return {
    /**
     * O PRE-FILTRO EM SQL, no fake: devolve TODOS os ids da fixture.
     *
     * Desde 2026-08-28 o loader pede ao banco uma lista curta de candidatos em
     * vez de carregar o catalogo (ver `home-hero.ts`). O fake e PERMISSIVO de
     * proposito: quem este arquivo mede e o PORTAO em memoria
     * (`lib/home-hero-eligibility.ts`), que continua sendo a autoridade. Um fake
     * que reimplementasse as clausulas do SQL mediria a copia, nao o original —
     * e um portao afrouxado passaria despercebido enquanto a copia continuasse
     * rigorosa.
     */
    $queryRawUnsafe: (sql: string) =>
      Promise.resolve(
        /count\(\*\)/.test(sql)
          ? [{ com_slug: 0n }]
          : sql.includes("tv_shows")
            ? []
            : movies.map((m) => ({ id: m.id })),
      ),
    slug: {
      findMany: ({ where }: { where: { entityType: "movie" | "tv" } }) =>
        Promise.resolve(
          where.entityType === "movie"
            ? movies.map((m) => ({ entityId: m.id, slug: `filme-${m.id}` }))
            : [],
        ),
    },
    movie: { findMany: () => Promise.resolve(movies) },
    tvShow: { findMany: () => Promise.resolve([]) },
    entityTranslation: {
      findMany: ({ where }: { where: { entityId: { in: bigint[] } } }) =>
        Promise.resolve(
          where.entityId.in.map((id) => ({
            entityId: id,
            title: null,
            summary: `Sinopse pt-BR do título ${id}.`,
          })),
        ),
    },
    crewMember: { findFirst: () => Promise.resolve(null) },
    castMember: { findMany: () => Promise.resolve([]) },
    /**
     * A DECISAO DE LICENCA do Cinerie Score, consultada por
     * `server/editorial-score.ts` antes de ler qualquer calculo.
     *
     * Devolve VAZIO: sem decisao vigente, o Score nao vai a tela. E o estado
     * correto para este arquivo, que mede SELECAO de slide, nao exibicao de
     * nota — e e fail-closed, entao um erro de fiacao aqui nunca produziria uma
     * nota fantasma passando no teste.
     */
    $queryRaw: () => Promise.resolve([]),
    cinerieScoreCalculation: { findMany: () => Promise.resolve([]) },
    discoverySnapshot: {
      findFirst: () =>
        Promise.resolve(
          options.trending === undefined || options.trending.length === 0
            ? null
            : {
                capturedAt: NOW,
                items: options.trending.map((entityId) => ({ entityId })),
              },
        ),
    },
    heroCurationDecision: { findMany: () => Promise.resolve(options.curated ?? []) },
  } as unknown as Parameters<typeof loadHeroSlides>[0];
}

describe("critério de seleção do hero", () => {
  it("(1) o lixo de 2057 NÃO abre a home — nem entra no carousel", async () => {
    const slides = await loadHeroSlides(fakePrisma(), "movies", NOW);

    expect(slides.length).toBeGreaterThan(0);
    expect(slides[0]?.title).toBe("Blockbuster");
    expect(slides.map((s) => s.title)).not.toContain("Der Liebesbrief");
  });

  it("(2) sem trending, a ordem é vote_count desc — NUNCA data de lançamento", async () => {
    // `Recente` é o mais novo e o menos votado: sob a ordem antiga abriria a
    // home. Se este teste passar a devolvê-lo primeiro, a data voltou.
    const recente = movie(4n, {
      titleOriginal: "Recente",
      releaseDate: new Date(Date.UTC(2026, 0, 1)),
      voteCountTmdb: 250,
    });
    const slides = await loadHeroSlides(
      fakePrisma({ movies: [recente, BLOCKBUSTER, MEDIANO] }),
      "movies",
      NOW,
    );

    expect(slides.map((s) => s.title)).toEqual(["Blockbuster", "Mediano", "Recente"]);
  });

  it("(3) com trending vigente, ele manda na ordem", async () => {
    const slides = await loadHeroSlides(
      // `MEDIANO` tem menos votos que `BLOCKBUSTER`, mas está em alta.
      fakePrisma({ trending: [3n, 2n] }),
      "movies",
      NOW,
    );

    expect(slides.map((s) => s.title)).toEqual(["Mediano", "Blockbuster"]);
  });

  it("(4) título fora do trending NÃO é descartado — vem depois, por votos", async () => {
    // Diferença deliberada em relação a "Popular essa semana", que descarta:
    // aquela faixa AFIRMA o recorte "em alta"; o hero não afirma recorte nenhum.
    const slides = await loadHeroSlides(fakePrisma({ trending: [3n] }), "movies", NOW);

    expect(slides.map((s) => s.title)).toEqual(["Mediano", "Blockbuster"]);
  });

  it("(5) com curadoria vigente, a escolha automática é IGNORADA na frente", async () => {
    const slides = await loadHeroSlides(
      // O automático abriria com `Blockbuster` (mais votado). O dono fixou o
      // `Mediano`, e é ele quem abre.
      fakePrisma({ curated: [{ entityType: "movie", entityId: 3n }] }),
      "movies",
      NOW,
    );

    expect(slides[0]?.title).toBe("Mediano");
  });

  it("(6) a curadoria NÃO passa pelo portão: decisão humana vence o filtro", async () => {
    const slides = await loadHeroSlides(
      // `Der Liebesbrief` seria recusado pelo portão. Fixado por um humano, entra.
      fakePrisma({ curated: [{ entityType: "movie", entityId: 1n }] }),
      "movies",
      NOW,
    );

    expect(slides[0]?.title).toBe("Der Liebesbrief");
  });

  it("(7) a curadoria não apaga os demais slides — o automático preenche o resto", async () => {
    const slides = await loadHeroSlides(
      fakePrisma({ curated: [{ entityType: "movie", entityId: 3n }] }),
      "movies",
      NOW,
    );

    expect(slides.length).toBeGreaterThan(1);
    expect(slides.map((s) => s.title)).toEqual(["Mediano", "Blockbuster"]);
  });

  it("(8) título curado não aparece DUAS vezes", async () => {
    const slides = await loadHeroSlides(
      fakePrisma({ curated: [{ entityType: "movie", entityId: 2n }] }),
      "movies",
      NOW,
    );

    const titulos = slides.map((s) => s.title);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it("(9) com ZERO elegíveis a faixa não renderiza — e não quebra a página", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const slides = await loadHeroSlides(
        fakePrisma({ movies: [DER_LIEBESBRIEF] }),
        "movies",
        NOW,
      );

      expect(slides).toEqual([]);
      // A ausência é declarada com o motivo — some da tela, não do log.
      const linha = aviso.mock.calls.map((c) => String(c[0])).find((t) => t.includes("hero_empty"));
      expect(linha).toBeDefined();
      expect(JSON.parse(linha!)).toMatchObject({ event: "hero_empty", scope: "movies" });
    } finally {
      aviso.mockRestore();
    }
  });

  it("(10) catálogo vazio devolve [] sem lançar", async () => {
    await expect(loadHeroSlides(fakePrisma({ movies: [] }), "movies", NOW)).resolves.toEqual([]);
  });

  it("(11) o teto de slides continua valendo", async () => {
    const muitos = Array.from({ length: HOME_HERO_SLIDE_LIMIT + 4 }, (_u, i) =>
      movie(BigInt(i + 10), { voteCountTmdb: 1_000 + i }),
    );
    const slides = await loadHeroSlides(fakePrisma({ movies: muitos }), "movies", NOW);

    expect(slides).toHaveLength(HOME_HERO_SLIDE_LIMIT);
  });

  /**
   * CONTROLE POSITIVO do portão dentro do loader: sem ele, um portão que
   * recusasse tudo passaria em (1), (9) e (10) e deixaria a home sem hero para
   * sempre.
   */
  it("(12) CONTROLE POSITIVO: um catálogo publicável produz hero", async () => {
    const slides = await loadHeroSlides(
      fakePrisma({ movies: [BLOCKBUSTER, MEDIANO] }),
      "movies",
      NOW,
    );

    expect(slides).toHaveLength(2);
    expect(slides[0]?.imageUrl).toContain("backdrop-2.jpg");
  });
});
