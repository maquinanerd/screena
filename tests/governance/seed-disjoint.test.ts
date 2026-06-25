/**
 * Teste de governanca (Fase 1, item 5) — disjuncao provider_api x rating_source.
 *
 * Invariante 2: provider_api != rating_source. As FKs apontam para tabelas
 * distintas (api_providers vs rating_sources), mas o banco aceitaria o MESMO
 * literal nas duas se a seed o introduzisse. Este teste trava a seed: o
 * conjunto de api_providers.key DEVE ser DISJUNTO de RATING_SOURCES.
 */

import { describe, expect, it } from "vitest";
import { RATING_SOURCES } from "@screena/config";
import { API_PROVIDER_SEED, RATING_SOURCE_SEED } from "@screena/db";

describe("seed: disjuncao api_providers x rating_sources (invariante 2)", () => {
  it("nenhuma chave de api_providers e uma fonte editorial (RATING_SOURCES)", () => {
    const ratingSources = new Set<string>(RATING_SOURCES);
    const offenders = API_PROVIDER_SEED.filter((p) => ratingSources.has(p.key)).map((p) => p.key);
    expect(offenders).toEqual([]);
  });

  it("'imdb' nunca e provider tecnico (o provider das notas IMDb e 'imdb236')", () => {
    const providerKeys = API_PROVIDER_SEED.map((p) => p.key);
    expect(providerKeys).not.toContain("imdb");
    expect(providerKeys).toContain("imdb236");
  });

  it("as fontes de rating semeadas espelham exatamente RATING_SOURCES", () => {
    const seededKeys = RATING_SOURCE_SEED.map((s) => s.key).sort();
    expect(seededKeys).toEqual([...RATING_SOURCES].sort());
  });

  it("intersecao dos dois conjuntos de chaves e vazia", () => {
    const providerKeys = new Set(API_PROVIDER_SEED.map((p) => p.key));
    const sourceKeys = new Set(RATING_SOURCE_SEED.map((s) => s.key));
    const intersection = [...providerKeys].filter((k) => sourceKeys.has(k));
    expect(intersection).toEqual([]);
  });
});
