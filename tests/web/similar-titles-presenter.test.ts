/**
 * similar-titles-presenter.test.ts — "Mais como este" (telas 06/07).
 *
 * O QUE ESTE ARQUIVO GUARDA. A segunda coluna da faixa final existia como
 * `<div />`: metade da faixa reservada para nada em TODO titulo. O bloco agora
 * ou tem trilho, ou nao existe — e "nao existe" tem de continuar significando
 * ausencia REGISTRADA, nunca secao vazia. Por isso quase todo teste aqui e
 * sobre o `null`: e o valor que o chamador transforma em log.
 *
 * O sinal e a COLECAO do TMDB. Nao ha tabela de ligacao filme<->genero no
 * schema (so o dicionario `genres`), entao recomendacao por genero exigiria
 * migration. Ver o cabecalho do modulo.
 */

import { describe, expect, it } from "vitest";

import {
  buildSimilarTitles,
  SIMILAR_TITLES_LIMIT,
  type SimilarTitleRow,
} from "../../apps/web/src/lib/similar-titles-presenter";

function row(overrides: Partial<SimilarTitleRow> & { entityId: string }): SimilarTitleRow {
  return {
    titleOriginal: `Original ${overrides.entityId}`,
    translationTitle: null,
    slug: `slug-${overrides.entityId}`,
    year: null,
    posterPath: null,
    position: null,
    ...overrides,
  };
}

const BASE = { excludeEntityId: "1", relationLabel: "Coleção Exemplo" } as const;

describe("buildSimilarTitles — quando o bloco NAO existe", () => {
  it("devolve null sem nenhuma linha utilizavel", () => {
    expect(buildSimilarTitles([], BASE)).toBeNull();
  });

  it("devolve null quando a unica linha e a propria entidade", () => {
    expect(buildSimilarTitles([row({ entityId: "1" })], BASE)).toBeNull();
  });

  it("devolve null quando nenhuma linha tem slug canonico pt-BR", () => {
    const rows = [row({ entityId: "2", slug: null }), row({ entityId: "3", slug: "   " })];
    expect(buildSimilarTitles(rows, BASE)).toBeNull();
  });

  it("devolve null sem nome de colecao — o rotulo na tela nomeia a relacao", () => {
    expect(buildSimilarTitles([row({ entityId: "2" })], { ...BASE, relationLabel: null })).toBeNull();
    expect(buildSimilarTitles([row({ entityId: "2" })], { ...BASE, relationLabel: "  " })).toBeNull();
  });
});

describe("buildSimilarTitles — o trilho", () => {
  it("exclui a propria entidade e mantem os parentes", () => {
    const view = buildSimilarTitles(
      [row({ entityId: "1" }), row({ entityId: "2" }), row({ entityId: "3" })],
      BASE,
    );
    expect(view?.items.map((item) => item.entityId)).toEqual(["2", "3"]);
  });

  it("nao repete o mesmo titulo quando ele vem por duas colecoes", () => {
    const view = buildSimilarTitles([row({ entityId: "2" }), row({ entityId: "2" })], BASE);
    expect(view?.items).toHaveLength(1);
  });

  it("ordena pela posicao DECLARADA pela colecao", () => {
    const rows = [
      row({ entityId: "4", position: 3 }),
      row({ entityId: "2", position: 1 }),
      row({ entityId: "3", position: 2 }),
    ];
    const view = buildSimilarTitles(rows, BASE);
    expect(view?.items.map((item) => item.entityId)).toEqual(["2", "3", "4"]);
  });

  it("joga a linha SEM posicao para o fim — `null` nao vira 'primeiro da franquia'", () => {
    const rows = [
      row({ entityId: "2", position: null, year: 1990 }),
      row({ entityId: "3", position: 9 }),
    ];
    const view = buildSimilarTitles(rows, BASE);
    expect(view?.items.map((item) => item.entityId)).toEqual(["3", "2"]);
  });

  it("respeita o teto de cards", () => {
    const rows = Array.from({ length: SIMILAR_TITLES_LIMIT + 5 }, (_, index) =>
      row({ entityId: String(index + 2), position: index }),
    );
    expect(buildSimilarTitles(rows, BASE)?.items).toHaveLength(SIMILAR_TITLES_LIMIT);
  });

  it("prefere o titulo pt-BR e cai no original quando nao ha traducao", () => {
    const rows = [
      row({ entityId: "2", translationTitle: "Traduzido", position: 1 }),
      row({ entityId: "3", translationTitle: "   ", position: 2 }),
    ];
    const view = buildSimilarTitles(rows, BASE);
    expect(view?.items.map((item) => item.title)).toEqual(["Traduzido", "Original 3"]);
  });

  it("monta href de FILME (a URL faz parte da diferenciacao de vertical)", () => {
    const view = buildSimilarTitles([row({ entityId: "2", slug: "duna-parte-dois" })], BASE);
    expect(view?.items[0]?.href).toBe("/pt/filmes/duna-parte-dois/");
  });

  it("sem poster no banco, o card vem sem imagem — nunca com placeholder remoto", () => {
    const view = buildSimilarTitles([row({ entityId: "2", posterPath: null })], BASE);
    expect(view?.items[0]?.poster).toBeNull();
  });

  it("carrega a relacao que justifica o bloco", () => {
    const view = buildSimilarTitles([row({ entityId: "2" })], BASE);
    expect(view?.relation).toBe("collection");
    expect(view?.relationLabel).toBe("Coleção Exemplo");
  });
});
