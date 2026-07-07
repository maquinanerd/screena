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
  HOME_UPCOMING_LIMIT,
  resolveUpcomingImage,
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
      { title: "Antes", date: "20 de Julho", href: "/pt/filmes/antes/", imageUrl: null },
      { title: "Depois", date: "15 de Setembro", href: "/pt/filmes/depois/", imageUrl: null },
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

  it("só aceita imagem LOCAL segura (path cru/externo do TMDB -> null)", () => {
    const local = buildUpcomingMovies(
      [movie({ slug: "a", posterPath: "/media/tmdb/movie/a-poster.jpg" })],
      NOW,
    );
    expect(local[0]?.imageUrl).toBe("/media/tmdb/movie/a-poster.jpg");
    expect(buildUpcomingMovies([movie({ slug: "b", posterPath: "/abc.jpg" })], NOW)[0]?.imageUrl).toBeNull();
    expect(
      buildUpcomingMovies(
        [movie({ slug: "c", posterPath: "https://image.tmdb.org/t/p/w500/a.jpg" })],
        NOW,
      )[0]?.imageUrl,
    ).toBeNull();
  });

  it("prefere backdrop local; sem backdrop cai no pôster local; sem nenhum -> null", () => {
    // Backdrop + pôster: usa o backdrop (thumb 16:9 do trilho).
    const both = buildUpcomingMovies(
      [
        movie({
          slug: "moana",
          backdropPath: "/media/tmdb/movie/moana-2026-backdrop.jpg",
          posterPath: "/media/tmdb/movie/moana-2026-poster.jpg",
        }),
      ],
      NOW,
    );
    expect(both[0]?.imageUrl).toBe("/media/tmdb/movie/moana-2026-backdrop.jpg");

    // Só pôster: cai no pôster.
    const posterOnly = buildUpcomingMovies(
      [movie({ slug: "aranha", posterPath: "/media/tmdb/movie/aranha-2026-poster.jpg" })],
      NOW,
    );
    expect(posterOnly[0]?.imageUrl).toBe("/media/tmdb/movie/aranha-2026-poster.jpg");

    // Nenhum: null (card cai no fallback do trilho).
    expect(buildUpcomingMovies([movie({ slug: "sem-img" })], NOW)[0]?.imageUrl).toBeNull();

    // Backdrop cru é rejeitado -> cai no pôster local válido.
    const rawBackdrop = buildUpcomingMovies(
      [
        movie({
          slug: "misto",
          backdropPath: "/cru.jpg",
          posterPath: "/media/tmdb/movie/misto-2026-poster.jpg",
        }),
      ],
      NOW,
    );
    expect(rawBackdrop[0]?.imageUrl).toBe("/media/tmdb/movie/misto-2026-poster.jpg");
  });

  it("imageUrl NUNCA é path de filesystem (`apps/web/public/...`)", () => {
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
    // Path relativo de filesystem não começa com prefixo local -> null.
    expect(fs[0]?.imageUrl).toBeNull();
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
  it("prefere backdrop local", () => {
    expect(
      resolveUpcomingImage(
        "/media/tmdb/movie/x-backdrop.jpg",
        "/media/tmdb/movie/x-poster.jpg",
      ),
    ).toBe("/media/tmdb/movie/x-backdrop.jpg");
  });

  it("cai no pôster local quando não há backdrop válido", () => {
    expect(resolveUpcomingImage(null, "/media/tmdb/movie/x-poster.jpg")).toBe(
      "/media/tmdb/movie/x-poster.jpg",
    );
    expect(resolveUpcomingImage("/cru.jpg", "/media/tmdb/movie/x-poster.jpg")).toBe(
      "/media/tmdb/movie/x-poster.jpg",
    );
  });

  it("retorna null sem imagem local válida (externo/fs/cru -> null)", () => {
    expect(resolveUpcomingImage(null, null)).toBeNull();
    expect(
      resolveUpcomingImage("https://image.tmdb.org/t/p/w1280/x.jpg", "/x.jpg"),
    ).toBeNull();
    expect(
      resolveUpcomingImage(
        "apps/web/public/media/tmdb/movie/x-backdrop.jpg",
        "apps/web/public/media/tmdb/movie/x-poster.jpg",
      ),
    ).toBeNull();
  });
});
