/**
 * Testes puros da fronteira de segurança do serving de mídia local
 * (`resolveMediaFile`), usada pelo route handler /media/tmdb/[...path].
 *
 * Garantem: aceita imagem com extensão da allowlist; rejeita traversal
 * (`..`), separadores dentro de segmento, segmento vazio, sem extensão e
 * extensão não permitida; deriva o content-type correto.
 */

import { describe, expect, it } from "vitest";

import { resolveMediaFile } from "../../apps/web/src/lib/media-file-path";

describe("resolveMediaFile", () => {
  it("aceita imagem válida e deriva content-type + path relativo", () => {
    expect(resolveMediaFile(["movie", "moana-2026-backdrop.jpg"])).toEqual({
      relativePath: "movie/moana-2026-backdrop.jpg",
      contentType: "image/jpeg",
    });
    expect(resolveMediaFile(["tv", "wandinha-2022-poster.png"])).toEqual({
      relativePath: "tv/wandinha-2022-poster.png",
      contentType: "image/png",
    });
    expect(resolveMediaFile(["x.webp"])?.contentType).toBe("image/webp");
    expect(resolveMediaFile(["x.avif"])?.contentType).toBe("image/avif");
    expect(resolveMediaFile(["x.svg"])?.contentType).toBe("image/svg+xml");
    expect(resolveMediaFile(["x.JPG"])?.contentType).toBe("image/jpeg"); // case-insensitive
  });

  it("rejeita lista vazia/nula", () => {
    expect(resolveMediaFile([])).toBeNull();
    expect(resolveMediaFile(undefined)).toBeNull();
    expect(resolveMediaFile(null)).toBeNull();
  });

  it("rejeita traversal e separadores/NUL dentro de segmento", () => {
    expect(resolveMediaFile(["..", "secrets.jpg"])).toBeNull();
    expect(resolveMediaFile(["movie", "..", "x.jpg"])).toBeNull();
    expect(resolveMediaFile(["."])).toBeNull();
    expect(resolveMediaFile(["movie/x.jpg"])).toBeNull(); // separador embutido
    expect(resolveMediaFile(["movie\\x.jpg"])).toBeNull(); // backslash embutido
    expect(resolveMediaFile(["x\0.jpg"])).toBeNull(); // NUL
    expect(resolveMediaFile(["movie", ""])).toBeNull(); // segmento vazio
  });

  it("rejeita sem extensão ou extensão fora da allowlist", () => {
    expect(resolveMediaFile(["movie", "sem-extensao"])).toBeNull();
    expect(resolveMediaFile(["movie", "x."])).toBeNull(); // ponto final sem ext
    expect(resolveMediaFile(["movie", "malware.exe"])).toBeNull();
    expect(resolveMediaFile(["movie", "data.json"])).toBeNull();
    expect(resolveMediaFile(["movie", "script.js"])).toBeNull();
  });
});
