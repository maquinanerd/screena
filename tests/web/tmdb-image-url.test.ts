/**
 * Testes puros do ponto governado de construção da URL pública de imagem do TMDB
 * (`buildTmdbImageUrl`). Confirma: monta `base/size/file_path` cru; escolhe o
 * tamanho pelo segmento (nunca troca `.jpg` por `.webp`); rejeita path local
 * antigo (`/media/...`), path de filesystem, path sem `/` inicial, vazio/nulo,
 * traversal e entrada suja (query/hash/backslash/espaço).
 */

import { describe, expect, it } from "vitest";

import { buildTmdbImageUrl } from "../../apps/web/src/lib/tmdb-image-url";

describe("buildTmdbImageUrl", () => {
  it("monta a URL pública a partir do file_path cru (tamanho pelo segmento)", () => {
    expect(buildTmdbImageUrl("/abc.jpg", "w780")).toBe(
      "https://image.tmdb.org/t/p/w780/abc.jpg",
    );
    expect(buildTmdbImageUrl("/def.jpg", "w500")).toBe(
      "https://image.tmdb.org/t/p/w500/def.jpg",
    );
    expect(buildTmdbImageUrl("/xyz.png", "original")).toBe(
      "https://image.tmdb.org/t/p/original/xyz.png",
    );
  });

  it("usa w780 como tamanho padrão", () => {
    expect(buildTmdbImageUrl("/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w780/abc.jpg",
    );
  });

  it("preserva a extensão do file_path (NÃO converte .jpg para .webp)", () => {
    expect(buildTmdbImageUrl("/moana.jpg", "w780")).toBe(
      "https://image.tmdb.org/t/p/w780/moana.jpg",
    );
    expect(buildTmdbImageUrl("/moana.jpg", "w780")).not.toContain(".webp");
  });

  it("retorna null para ausente/vazio", () => {
    expect(buildTmdbImageUrl(null)).toBeNull();
    expect(buildTmdbImageUrl(undefined)).toBeNull();
    expect(buildTmdbImageUrl("")).toBeNull();
    expect(buildTmdbImageUrl("   ")).toBeNull();
  });

  it("rejeita path que não começa com '/' (não é file_path do TMDB)", () => {
    expect(buildTmdbImageUrl("abc.jpg")).toBeNull();
    expect(buildTmdbImageUrl("https://image.tmdb.org/t/p/w780/abc.jpg")).toBeNull();
    expect(buildTmdbImageUrl("//evil.com/x.jpg")).toBeNull();
  });

  it("rejeita path de asset LOCAL antigo (nunca gera URL remota a partir dele)", () => {
    expect(buildTmdbImageUrl("/media/tmdb/movie/moana-2026-backdrop.jpg")).toBeNull();
    expect(buildTmdbImageUrl("/media/demo/x.png")).toBeNull();
    expect(buildTmdbImageUrl("/uploads/x.jpg")).toBeNull();
    expect(buildTmdbImageUrl("/brand/logo.svg")).toBeNull();
  });

  it("rejeita path de filesystem e entrada suja (traversal/query/hash/backslash)", () => {
    expect(buildTmdbImageUrl("apps/web/public/media/tmdb/x.jpg")).toBeNull();
    expect(buildTmdbImageUrl("/../secret.jpg")).toBeNull();
    expect(buildTmdbImageUrl("/abc.jpg?evil=1")).toBeNull();
    expect(buildTmdbImageUrl("/abc.jpg#frag")).toBeNull();
    expect(buildTmdbImageUrl("/a b.jpg")).toBeNull();
  });
});
