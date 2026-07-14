/**
 * Testes puros do presenter de "Em breve" (filmes com estreia futura).
 *
 * Garantem que a seção não inventa itens (sem título/slug/data futura -> fora),
 * só aceita imagem local segura, ordena por estreia asc, respeita o cap, formata
 * a data em pt-BR e NUNCA emite `duration` (não fingimos trailer para dado real).
 */

import { describe, expect, it } from "vitest";

import {
  buildUpcomingMovies,
  formatUpcomingDate,
  formatUpcomingWeekday,
  HOME_UPCOMING_LIMIT,
  resolveUpcomingImage,
  takeUpcomingWeek,
  type UpcomingMovieInput,
} from "../../apps/web/src/lib/home-upcoming-presenter";

/** "Hoje" fixo para os testes: 2026-07-07 (meia-noite UTC). */
const NOW = new Date(Date.UTC(2026, 6, 7));

function movie(overrides: Partial<UpcomingMovieInput> = {}): UpcomingMovieInput {
  return {
    titleOriginal: "Original Upcoming",
    translationTitle: null,
    slug: "original-upcoming",
    releaseDate: new Date(Date.UTC(2026, 7, 1)), // 2026-08-01 (futuro)
    backdropPath: null,
    posterPath: null,
    ...overrides,
  };
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

describe("buildUpcomingMovies", () => {
  it("mantém só estreias ESTRITAMENTE futuras (hoje e passado saem)", () => {
    const view = buildUpcomingMovies(
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
    const view = buildUpcomingMovies(
      [
        movie({ translationTitle: "Depois", slug: "depois", releaseDate: new Date(Date.UTC(2026, 8, 15)) }),
        movie({ translationTitle: "Antes", slug: "antes", releaseDate: new Date(Date.UTC(2026, 6, 20)) }),
      ],
      NOW,
    );
    expect(view).toEqual([
      {
        title: "Antes",
        dateIso: "2026-07-20",
        date: "20 de Julho",
        weekday: "SEG",
        href: "/pt/filmes/antes/",
        imageUrl: null,
      },
      {
        title: "Depois",
        dateIso: "2026-09-15",
        date: "15 de Setembro",
        weekday: "TER",
        href: "/pt/filmes/depois/",
        imageUrl: null,
      },
    ]);
  });

  it("recorta uma agenda real para os próximos sete dias", () => {
    const items = buildUpcomingMovies(
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
      buildUpcomingMovies([movie({ translationTitle: "  ", titleOriginal: "  " })], NOW),
    ).toEqual([]);
    expect(buildUpcomingMovies([movie({ slug: null })], NOW)).toEqual([]);
    expect(buildUpcomingMovies([movie({ slug: "bad/slug" })], NOW)).toEqual([]);
    const [card] = buildUpcomingMovies(
      [movie({ translationTitle: "PT", titleOriginal: "EN", slug: "x" })],
      NOW,
    );
    expect(card?.title).toBe("PT");
  });

  it("usa a URL REMOTA do TMDB a partir do file_path cru (local antigo/externo -> null)", () => {
    const remote = buildUpcomingMovies(
      [movie({ slug: "a", posterPath: "/abc.jpg" })],
      NOW,
    );
    // Só pôster -> w500.
    expect(remote[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/abc.jpg");
    // Path local antigo -> null (nunca vira URL remota).
    expect(
      buildUpcomingMovies([movie({ slug: "b", posterPath: "/media/tmdb/movie/a-poster.jpg" })], NOW)[0]
        ?.imageUrl,
    ).toBeNull();
    // Já-URL absoluta embutida -> null.
    expect(
      buildUpcomingMovies(
        [movie({ slug: "c", posterPath: "https://image.tmdb.org/t/p/w500/a.jpg" })],
        NOW,
      )[0]?.imageUrl,
    ).toBeNull();
  });

  it("prefere backdrop (w780); sem backdrop cai no pôster (w500); sem nenhum -> null", () => {
    // Backdrop + pôster: usa o backdrop em w780 (thumb 16:9 do trilho).
    const both = buildUpcomingMovies(
      [movie({ slug: "moana", backdropPath: "/bd.jpg", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(both[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w780/bd.jpg");

    // Só pôster: w500.
    const posterOnly = buildUpcomingMovies(
      [movie({ slug: "aranha", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(posterOnly[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/ps.jpg");

    // Nenhum: null (card cai no fallback do trilho).
    expect(buildUpcomingMovies([movie({ slug: "sem-img" })], NOW)[0]?.imageUrl).toBeNull();

    // Backdrop inválido (local antigo) -> cai no pôster cru em w500.
    const rejeitaBackdrop = buildUpcomingMovies(
      [movie({ slug: "misto", backdropPath: "/media/tmdb/x.jpg", posterPath: "/ps.jpg" })],
      NOW,
    );
    expect(rejeitaBackdrop[0]?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/ps.jpg");
  });

  it("imageUrl nunca começa com /media nem com apps/web/public (path local/fs -> null)", () => {
    const fs = buildUpcomingMovies(
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

    const ok = buildUpcomingMovies([movie({ slug: "ok", backdropPath: "/bd.jpg" })], NOW);
    const url = ok[0]?.imageUrl ?? "";
    expect(url.startsWith("/media")).toBe(false);
    expect(url.startsWith("apps/web/public")).toBe(false);
    expect(url.startsWith("https://image.tmdb.org/")).toBe(true);
  });

  it("respeita o cap (default 6) e trata lista sem válidos como vazia", () => {
    const many = Array.from({ length: HOME_UPCOMING_LIMIT + 4 }, (_unused, i) =>
      movie({ slug: `m-${i}`, releaseDate: new Date(Date.UTC(2026, 7, i + 1)) }),
    );
    expect(buildUpcomingMovies(many, NOW)).toHaveLength(HOME_UPCOMING_LIMIT);
    expect(buildUpcomingMovies(many, NOW, 3)).toHaveLength(3);
    expect(buildUpcomingMovies([], NOW)).toEqual([]);
    expect(buildUpcomingMovies([movie({ releaseDate: new Date(Date.UTC(2020, 0, 1)) })], NOW)).toEqual([]);
  });

  it("NUNCA emite `duration` (dado real não finge trailer)", () => {
    const [card] = buildUpcomingMovies([movie({ slug: "x" })], NOW);
    expect(card).toBeDefined();
    expect(card && "duration" in card).toBe(false);
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
