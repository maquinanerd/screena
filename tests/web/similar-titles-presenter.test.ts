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
  RECOMMENDATION_RELATION_LABEL,
  selectRecommendationLinksForVertical,
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

/**
 * A REGRA DA VERTICAL — extraida do getter server-only para poder ser provada.
 *
 * Enquanto era um `.filter` dentro do `findMany`, nao havia como testa-la sem
 * banco: o controle negativo (deixar recomendacao de outra vertical entrar no
 * trilho) passava calado, porque nenhum teste a media.
 *
 * O que ela protege e a invariante 11: a diferenciacao filme/serie nunca depende
 * so da cor — precisa de label + badge + breadcrumb + schema + URL coerentes. Um
 * card de serie dentro do bloco de um filme mente nos cinco.
 */
describe("selectRecommendationLinksForVertical", () => {
  const links = [
    { kind: "recommendation", targetMediaType: "movie", targetTmdbId: 10, position: 0 },
    { kind: "recommendation", targetMediaType: "tv", targetTmdbId: 20, position: 1 },
    { kind: "similar", targetMediaType: "movie", targetTmdbId: 30, position: 0 },
    { kind: "similar", targetMediaType: "tv", targetTmdbId: 40, position: 1 },
  ] as const;

  it("o trilho de FILME so recebe filme", () => {
    expect(
      selectRecommendationLinksForVertical(links, "movie").map((l) => l.targetTmdbId),
    ).toEqual([10, 30]);
  });

  it("o trilho de SERIE so recebe serie", () => {
    expect(
      selectRecommendationLinksForVertical(links, "tv").map((l) => l.targetTmdbId),
    ).toEqual([20, 40]);
  });

  it("preserva a ORDEM de entrada — ela e o sinal de forca do TMDB", () => {
    // Reordenar destruiria a unica informacao que o bloco carrega. Ordem
    // invertida na entrada tem de sair invertida.
    const invertidos = [...links].reverse();
    expect(
      selectRecommendationLinksForVertical(invertidos, "movie").map((l) => l.targetTmdbId),
    ).toEqual([30, 10]);
  });

  it("CONTROLE POSITIVO: a fixture tem as DUAS verticais (senao o filtro seria vacuo)", () => {
    // Sem isto, uma fixture so de filme faria o teste de "so recebe filme"
    // passar mesmo com o filtro removido.
    expect(new Set(links.map((l) => l.targetMediaType))).toEqual(new Set(["movie", "tv"]));
  });

  it("lista vazia continua vazia — nao inventa card", () => {
    expect(selectRecommendationLinksForVertical([], "movie")).toEqual([]);
  });
});

describe("o rotulo diz a RELACAO, e as duas origens nao se disfarcam", () => {
  const row = {
    entityId: "9",
    titleOriginal: "Vizinho",
    translationTitle: null,
    slug: "vizinho",
    year: 2020,
    posterPath: "/p.jpg",
    position: 0,
  };

  it("colecao continua nomeando a colecao", () => {
    const view = buildSimilarTitles([row], {
      excludeEntityId: "1",
      relationLabel: "Colecao O Poderoso Chefao",
    });
    expect(view?.relation).toBe("collection");
    expect(view?.relationLabel).toBe("Colecao O Poderoso Chefao");
  });

  it("recomendacao se declara recomendacao — nao herda o rotulo de franquia", () => {
    // Se as duas origens saissem com o mesmo rotulo, a promessa da tela valeria
    // para uma e nao para a outra. O campo `relation` existe desde o inicio
    // exatamente para impedir que um segundo sinal entrasse de carona.
    const view = buildSimilarTitles([row], {
      excludeEntityId: "1",
      relation: "recommendation",
      relationLabel: RECOMMENDATION_RELATION_LABEL,
    });
    expect(view?.relation).toBe("recommendation");
    expect(view?.relationLabel).toBe(RECOMMENDATION_RELATION_LABEL);
  });

  it("NEGATIVO: o rotulo de recomendacao nao promete parentesco que o sinal nao tem", () => {
    // "Do mesmo universo" ou "Da mesma franquia" afirmariam relacao declarada.
    // O TMDB nao da nome ao agrupamento; o rotulo cita a ORIGEM.
    expect(RECOMMENDATION_RELATION_LABEL.toLowerCase()).not.toContain("franquia");
    expect(RECOMMENDATION_RELATION_LABEL.toLowerCase()).not.toContain("universo");
    expect(RECOMMENDATION_RELATION_LABEL).toContain("TMDB");
  });
});
