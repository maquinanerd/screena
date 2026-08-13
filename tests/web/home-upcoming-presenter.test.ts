/**
 * Testes puros do presenter de "Em breve" (filmes E séries com estreia futura).
 *
 * Garantem que a seção não inventa itens (sem título/slug/data futura -> fora),
 * só aceita imagem remota governada do TMDB, ordena por estreia asc, respeita o
 * cap, formata a data em pt-BR, NUNCA emite `duration` (não fingimos trailer
 * para dado real) — e que a vertical de cada card viaja em TEXTO e em URL, não
 * só na cor (invariante 11).
 *
 * A parte nova: `mergeUpcomingVerticals`, o trilho MISTO da home. Ele tem DUAS
 * ordenações diferentes (seleção por cota equilibrada, exibição por data) e os
 * casos abaixo escolhem propositalmente cenários onde as duas DIVERGEM — se
 * fossem a mesma coisa, nenhum teste aqui provaria nada.
 */

import { describe, expect, it } from "vitest";

import {
  buildUpcomingItems,
  formatUpcomingDate,
  formatUpcomingWeekday,
  HOME_UPCOMING_LIMIT,
  mergeUpcomingVerticals,
  resolveUpcomingImage,
  takeUpcomingWeek,
  type UpcomingEntityInput,
} from "../../apps/web/src/lib/home-upcoming-presenter";

/** "Hoje" fixo para os testes: 2026-07-07 (meia-noite UTC). */
const NOW = new Date(Date.UTC(2026, 6, 7));

function movie(overrides: Partial<UpcomingEntityInput> = {}): UpcomingEntityInput {
  return {
    vertical: "movie",
    titleOriginal: "Original Upcoming",
    translationTitle: null,
    slug: "original-upcoming",
    releaseDate: new Date(Date.UTC(2026, 7, 1)), // 2026-08-01 (futuro)
    backdropPath: null,
    posterPath: null,
    ...overrides,
  };
}

function series(overrides: Partial<UpcomingEntityInput> = {}): UpcomingEntityInput {
  return movie({ vertical: "series", slug: "serie-upcoming", ...overrides });
}

describe("formatUpcomingDate", () => {
  it("formata data pt-BR (dia + mês capitalizado, componentes UTC)", () => {
    expect(formatUpcomingDate(new Date(Date.UTC(2026, 2, 22)))).toBe("22 de Março");
    expect(formatUpcomingDate(new Date(Date.UTC(2026, 5, 5)))).toBe("5 de Junho");
    expect(formatUpcomingDate(new Date(Date.UTC(2026, 11, 31)))).toBe("31 de Dezembro");
  });

  it("formata o dia da semana canônico em UTC", () => {
    expect(formatUpcomingWeekday(new Date(Date.UTC(2026, 6, 8)))).toBe("QUA");
    expect(formatUpcomingWeekday(new Date(Date.UTC(2026, 6, 10)))).toBe("SEX");
  });
});

describe("buildUpcomingItems", () => {
  it("mantém só estreias ESTRITAMENTE futuras (hoje e passado saem)", () => {
    const view = buildUpcomingItems(
      [
        movie({ slug: "futuro", releaseDate: new Date(Date.UTC(2026, 7, 10)) }),
        movie({ slug: "amanha", releaseDate: new Date(Date.UTC(2026, 6, 8)) }),
        movie({ slug: "hoje", releaseDate: new Date(Date.UTC(2026, 6, 7)) }), // == cutoff -> fora
        movie({ slug: "passado", releaseDate: new Date(Date.UTC(2026, 0, 1)) }), // fora
        movie({ slug: "sem-data", releaseDate: null }), // fora
      ],
      NOW,
    );
    expect(view.map((m) => m.href)).toEqual([
      "/pt/filmes/amanha/",
      "/pt/filmes/futuro/",
    ]);
  });

  it("ordena por estreia ascendente e monta href/título/data", () => {
    const view = buildUpcomingItems(
      [
        movie({ translationTitle: "Depois", slug: "depois", releaseDate: new Date(Date.UTC(2026, 8, 15)) }),
        movie({ translationTitle: "Antes", slug: "antes", releaseDate: new Date(Date.UTC(2026, 6, 20)) }),
      ],
      NOW,
    );
    expect(view).toEqual([
      {
        entityId: null,
        vertical: "movie",
        verticalLabel: "Filme",
        bookmarkType: "movie",
        title: "Antes",
        dateIso: "2026-07-20",
        date: "20 de Julho",
        weekday: "SEG",
        href: "/pt/filmes/antes/",
        imageUrl: null,
      },
      {
        entityId: null,
        vertical: "movie",
        verticalLabel: "Filme",
        bookmarkType: "movie",
        title: "Depois",
        dateIso: "2026-09-15",
        date: "15 de Setembro",
        weekday: "TER",
        href: "/pt/filmes/depois/",
        imageUrl: null,
      },
    ]);
  });

  /**
   * A vertical não é decoração: ela decide a ROTA, o RÓTULO e o alvo do
   * bookmark. Um card de série apontando para `/pt/filmes/` seria uma URL
   * mentirosa e um bookmark gravado na entidade errada.
   */
  it("SÉRIE: rota /pt/series/, rótulo 'Série' e bookmark `tv`", () => {
    const [card] = buildUpcomingItems([series({ slug: "nova-serie" })], NOW);
    expect(card).toEqual({
      entityId: null,
      vertical: "series",
      verticalLabel: "Série",
      bookmarkType: "tv",
      title: "Original Upcoming",
      dateIso: "2026-08-01",
      date: "1 de Agosto",
      weekday: "SÁB",
      href: "/pt/series/nova-serie/",
      imageUrl: null,
    });
  });

  it("CONTROLE NEGATIVO: filme e série do MESMO slug não colidem em href", () => {
    // Sem este par, um presenter que ignorasse `vertical` e sempre montasse
    // /pt/filmes/ passaria em todos os testes acima que só olham filme.
    const [asMovie] = buildUpcomingItems([movie({ slug: "duna" })], NOW);
    const [asSeries] = buildUpcomingItems([series({ slug: "duna" })], NOW);
    expect(asMovie?.href).toBe("/pt/filmes/duna/");
    expect(asSeries?.href).toBe("/pt/series/duna/");
    expect(asMovie?.href).not.toBe(asSeries?.href);
    expect(asMovie?.verticalLabel).not.toBe(asSeries?.verticalLabel);
  });

  it("recorta uma agenda real para os próximos sete dias", () => {
    const items = buildUpcomingItems(
      [
        movie({ slug: "amanha", releaseDate: new Date(Date.UTC(2026, 6, 8)) }),
        movie({ slug: "em-sete", releaseDate: new Date(Date.UTC(2026, 6, 14)) }),
        movie({ slug: "fora", releaseDate: new Date(Date.UTC(2026, 6, 15)) }),
      ],
      NOW,
      10,
    );

    expect(takeUpcomingWeek(items, NOW, 5).map((item) => item.href)).toEqual([
      "/pt/filmes/amanha/",
      "/pt/filmes/em-sete/",
    ]);
  });

  it("prefere translationTitle e descarta sem título/sem slug", () => {
    expect(
      buildUpcomingItems([movie({ translationTitle: "  ", titleOriginal: "  " })], NOW),
    ).toEqual([]);
    expect(buildUpcomingItems([movie({ slug: null })], NOW)).toEqual([]);
    expect(buildUpcomingItems([movie({ slug: "bad/slug" })], NOW)).toEqual([]);
    expect(buildUpcomingItems([series({ slug: "bad/slug" })], NOW)).toEqual([]);
    const [card] = buildUpcomingItems(
      [movie({ translationTitle: "PT", titleOriginal: "EN", slug: "x" })],
      NOW,
    );
    expect(card?.title).toBe("PT");
  });

  it("usa a URL REMOTA do TMDB a partir do file_path cru (local antigo/externo -> null)", () => {
    const remote = buildUpcomingItems(
      [movie({ slug: "a", posterPath: "/abc.jpg" })],
      NOW,
    );
    // Só pôster -> w500.
    expect(remote[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    // Path local antigo -> null (nunca vira URL remota).
    expect(
      buildUpcomingItems([movie({ slug: "b", posterPath: "/media/tmdb/movie/a-poster.jpg" })], NOW)[0]
        ?.imageUrl,
    ).toBeNull();
    // Já-URL absoluta embutida -> null.
    expect(
      buildUpcomingItems(
        [movie({ slug: "c", posterPath: "https://image.tmdb.org/t/p/w500/a.jpg" })],
        NOW,
      )[0]?.imageUrl,
    ).toBeNull();
  });

  it("prefere backdrop (w780); sem backdrop cai no pôster (w500); sem nenhum -> null", () => {
    // Backdrop + pôster: usa o backdrop em w780 (thumb 16:9 do trilho).
    const both = buildUpcomingItems(
      [movie({ slug: "moana", backdropPath: "/bd.jpg", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(both[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w780/bd.jpg");

    // Só pôster: w500.
    const posterOnly = buildUpcomingItems(
      [movie({ slug: "aranha", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(posterOnly[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/ps.jpg");

    // Nenhum: null (card cai no fallback do trilho).
    expect(buildUpcomingItems([movie({ slug: "sem-img" })], NOW)[0]?.imageUrl).toBeNull();

    // Backdrop inválido (local antigo) -> cai no pôster cru em w500.
    const rejeitaBackdrop = buildUpcomingItems(
      [movie({ slug: "misto", backdropPath: "/media/tmdb/x.jpg", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(rejeitaBackdrop[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/ps.jpg");
  });

  it("imageUrl nunca começa com /media nem com apps/web/public (path local/fs -> null)", () => {
    const fs = buildUpcomingItems(
      [
        movie({
          slug: "fs",
          backdropPath: "apps/web/public/media/tmdb/movie/fs-backdrop.jpg",
          posterPath: "apps/web/public/media/tmdb/movie/fs-poster.jpg",
        }),
      ],
      NOW,
    );
    expect(fs[0]?.imageUrl).toBeNull();

    const ok = buildUpcomingItems([movie({ slug: "ok", backdropPath: "/bd.jpg" })], NOW);
    const url = ok[0]?.imageUrl ?? "";
    expect(url.startsWith("/media")).toBe(false);
    expect(url.startsWith("apps/web/public")).toBe(false);
    expect(url.startsWith("https://image.tmdb.org/")).toBe(true);
  });

  it("respeita o cap (default 6) e trata lista sem válidos como vazia", () => {
    const many = Array.from({ length: HOME_UPCOMING_LIMIT + 4 }, (_unused, i) =>
      movie({ slug: `m-${i}`, releaseDate: new Date(Date.UTC(2026, 7, i + 1)) }),
    );
    expect(buildUpcomingItems(many, NOW)).toHaveLength(HOME_UPCOMING_LIMIT);
    expect(buildUpcomingItems(many, NOW, 3)).toHaveLength(3);
    expect(buildUpcomingItems([], NOW)).toEqual([]);
    expect(buildUpcomingItems([movie({ releaseDate: new Date(Date.UTC(2020, 0, 1)) })], NOW)).toEqual([]);
  });

  it("NUNCA emite `duration` (dado real não finge trailer)", () => {
    const [card] = buildUpcomingItems([movie({ slug: "x" })], NOW);
    expect(card).toBeDefined();
    expect(card && "duration" in card).toBe(false);
  });
});

/**
 * O trilho misto da home. Cenário-base montado de propósito para que SELEÇÃO e
 * EXIBIÇÃO discordem: os seis filmes estreiam TODOS antes de qualquer série.
 * Uma implementação que só ordenasse por data devolveria seis filmes e nenhuma
 * série — e é exatamente esse o defeito que a home tinha.
 */
describe("mergeUpcomingVerticals — a home mistura filme e série", () => {
  const MOVIES = buildUpcomingItems(
    Array.from({ length: 6 }, (_unused, i) =>
      movie({ slug: `filme-${i}`, releaseDate: new Date(Date.UTC(2026, 6, 10 + i)) }),
    ),
    NOW,
    20,
  );
  const SERIES = buildUpcomingItems(
    Array.from({ length: 6 }, (_unused, i) =>
      series({ slug: `serie-${i}`, releaseDate: new Date(Date.UTC(2026, 8, 10 + i)) }),
    ),
    NOW,
    20,
  );

  it("CONTROLE POSITIVO: no cenário-base, data pura DE FATO daria só filme", () => {
    // Sem esta linha, os testes abaixo poderiam passar por acidente (se as duas
    // ordens coincidissem, "equilibrou" e "não equilibrou" seriam iguais).
    const soPorData = [...MOVIES, ...SERIES]
      .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
      .slice(0, 6);
    expect(new Set(soPorData.map((i) => i.vertical))).toEqual(new Set(["movie"]));
  });

  it("SELEÇÃO por cota: 6 vagas viram 3 filmes + 3 séries", () => {
    const merged = mergeUpcomingVerticals(MOVIES, SERIES, 6);
    expect(merged).toHaveLength(6);
    expect(merged.filter((i) => i.vertical === "movie")).toHaveLength(3);
    expect(merged.filter((i) => i.vertical === "series")).toHaveLength(3);
  });

  it("EXIBIÇÃO por data: o conjunto selecionado sai em estreia ascendente", () => {
    const merged = mergeUpcomingVerticals(MOVIES, SERIES, 6);
    const dates = merged.map((i) => i.dateIso);
    expect(dates).toEqual([...dates].sort());
    // E os escolhidos são os MAIS PRÓXIMOS de cada vertical, não quaisquer três.
    expect(merged.map((i) => i.href)).toEqual([
      "/pt/filmes/filme-0/",
      "/pt/filmes/filme-1/",
      "/pt/filmes/filme-2/",
      "/pt/series/serie-0/",
      "/pt/series/serie-1/",
      "/pt/series/serie-2/",
    ]);
  });

  it("vertical vazia devolve as vagas para a outra (nunca encolhe o trilho)", () => {
    expect(mergeUpcomingVerticals(MOVIES, [], 6)).toHaveLength(6);
    expect(mergeUpcomingVerticals([], SERIES, 6)).toHaveLength(6);
    expect(mergeUpcomingVerticals([], [], 6)).toEqual([]);
  });

  it("vertical curta cede o resto: 1 filme + 10 séries = 1 + 5", () => {
    const umFilme = MOVIES.slice(0, 1);
    const merged = mergeUpcomingVerticals(umFilme, SERIES, 6);
    expect(merged.filter((i) => i.vertical === "movie")).toHaveLength(1);
    expect(merged.filter((i) => i.vertical === "series")).toHaveLength(5);
  });

  it("catálogo pequeno não é preenchido com invenção: 2 + 2 = 4 itens", () => {
    const merged = mergeUpcomingVerticals(MOVIES.slice(0, 2), SERIES.slice(0, 2), 6);
    expect(merged).toHaveLength(4);
  });
});

describe("resolveUpcomingImage", () => {
  it("prefere backdrop cru do TMDB em w780", () => {
    expect(resolveUpcomingImage("/bd.jpg", "/ps.jpg")).toBe(
      "https://image.tmdb.org/t/p/w780/bd.jpg",
    );
  });

  it("cai no pôster cru em w500 quando não há backdrop válido", () => {
    expect(resolveUpcomingImage(null, "/ps.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/ps.jpg",
    );
    // Backdrop local antigo é rejeitado -> usa o pôster cru.
    expect(resolveUpcomingImage("/media/tmdb/x.jpg", "/ps.jpg")).toBe(
      "https://image.tmdb.org/t/p/w500/ps.jpg",
    );
  });

  it("retorna null sem file_path cru válido (local/fs/ausente -> null)", () => {
    expect(resolveUpcomingImage(null, null)).toBeNull();
    expect(
      resolveUpcomingImage("/media/tmdb/x.jpg", "/media/tmdb/y.jpg"),
    ).toBeNull();
    expect(
      resolveUpcomingImage(
        "apps/web/public/media/tmdb/movie/x-backdrop.jpg",
        "apps/web/public/media/tmdb/movie/x-poster.jpg",
      ),
    ).toBeNull();
  });
});
