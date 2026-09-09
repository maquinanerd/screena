/**
 * season-episode-row-budget.test.ts — QUANTAS LINHAS a ficha de TEMPORADA e a
 * de EPISODIO pedem ao banco para desenhar uma tela, e se a navegacao continua
 * correta depois do corte.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE, SEPARADO DO OUTRO
 * ============================================================================
 * `public-surface-row-budget.test.ts` trava o mesmo defeito — varrer a tabela
 * para desenhar uma tela — nas LISTAGENS (`/pt/filmes`, `/pt/series`,
 * `/pt/pessoas`, home). Ele cobre seis superficies e NAO cobria estas duas.
 *
 * O buraco importava, porque era nelas que o defeito continuava vivo:
 *
 *  - EPISODIO (3.793.672 URLs, a rota de maior volume do sistema) trazia TODOS
 *    os `episodeNumber` da temporada — `findMany` sem `take` — apenas para
 *    descobrir dois numeros: o anterior e o proximo. Em novela e programa
 *    diario (`today`, `neighbours`, `jornal-nacional`) uma "temporada" e um ano
 *    de exibicao, e isso eram centenas de linhas por visita.
 *
 * A ficha de TEMPORADA aparece aqui por outro motivo. Ela mostra a temporada
 * INTEIRA, e isso e comportamento a preservar — nao ha teto de linhas a impor.
 * O que os testes dela travam e o inverso: que a lista continua COMPLETA depois
 * de a consulta ter mudado de lugar (saiu de um `select` aninhado e virou uma
 * consulta propria, para viajar em paralelo com o trailer e o SEO). Uma
 * "otimizacao" que encolhesse a lista seria uma regressao de produto, e e
 * exatamente isso que o teste (2) recusa.
 *
 * ============================================================================
 * COMO ESTE ARQUIVO MEDE
 * ============================================================================
 * Um Prisma FALSO com uma temporada de 5.000 episodios. Ele e generoso de
 * proposito: se o codigo pedir a temporada inteira, ele DA a temporada inteira.
 * Para o EPISODIO isso faz o numero denunciar — com o defeito de volta, a
 * contagem sobe de dezenas para milhares. Para a TEMPORADA e o contrario: a
 * generosidade e o que permite verificar que as 5.000 chegam mesmo a tela.
 *
 * Os testes (1) sao CONTROLE NEGATIVO e nao sao decoracao: sem provar que o
 * fake devolve 5.000 quando ninguem limita, "poucas linhas" seria
 * indistinguivel de "o fake nunca devolveu nada", e o arquivo inteiro passaria
 * vazio — verde pelo motivo errado.
 *
 * O que este arquivo NAO mede: tempo. Linha lida nao e milissegundo, e o numero
 * aqui nao promete velocidade — promete, para o EPISODIO, que a consulta parou
 * de crescer com o tamanho da temporada; e, para a TEMPORADA, que a lista
 * continua completa.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tamanho da temporada falsa. 5.000 e deliberadamente absurdo para uma
 * temporada de ficcao e perfeitamente banal para um programa diario com anos
 * de arquivo — que e exatamente o caso que produziu o defeito.
 */
const SEASON_SIZE = 5_000;

/**
 * Teto de linhas para desenhar UMA ficha de episodio.
 *
 * A tela mostra um episodio, o anterior e o proximo. Tudo alem disso e
 * varredura. O teto e folgado (cabem creditos, imagens e a resolucao de SEO) e
 * mesmo assim fica duas ordens de grandeza abaixo de `SEASON_SIZE`.
 */
const EPISODE_ROW_BUDGET = 200;

let rowsReturned = 0;
let heaviest: Array<{ what: string; rows: number }> = [];

function count(what: string, rows: unknown[]): unknown[] {
  rowsReturned += rows.length;
  heaviest.push({ what, rows: rows.length });
  return rows;
}

/** `findFirst`/`findUnique` devolvem no maximo uma linha. */
function countOne<T>(what: string, row: T | null): T | null {
  rowsReturned += row === null ? 0 : 1;
  heaviest.push({ what, rows: row === null ? 0 : 1 });
  return row;
}

function reset(): void {
  rowsReturned = 0;
  heaviest = [];
}

function topOffenders(): string {
  return [...heaviest]
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 4)
    .map((entry) => `${entry.what}=${entry.rows}`)
    .join(" ");
}

const SEASON_ID = 900n;
const SERIES_ID = 7n;

/**
 * A numeracao da temporada falsa.
 *
 * MUTAVEL de proposito: os testes de lacuna a trocam por uma numeracao com
 * buracos (`1, 2, 5, 10`) e por uma temporada de episodio unico, para provar
 * que a navegacao nao depende de `n±1`.
 */
let EPISODE_NUMBERS: number[] = Array.from({ length: SEASON_SIZE }, (_u, i) => i + 1);

function episodeRow(n: number): Record<string, unknown> {
  return {
    id: BigInt(10_000 + n),
    tmdbId: null,
    episodeNumber: n,
    name: `Episodio ${n}`,
    // `overview` entra de proposito: era ele que fazia a linha ser cara.
    overview: `Sinopse do episodio ${n}. `.repeat(20),
    airDate: new Date(Date.UTC(2024, 0, 1)),
    runtimeMinutes: 45,
    stillPath: `/still-${n}.jpg`,
  };
}

function episodeFindFirst(args: Record<string, unknown>): unknown {
  const where = (args.where ?? {}) as Record<string, unknown>;
  const orderBy = (args.orderBy ?? {}) as { episodeNumber?: "asc" | "desc" };
  const filter = where.episodeNumber;

  if (typeof filter === "number") {
    const found = EPISODE_NUMBERS.includes(filter) ? episodeRow(filter) : null;
    return countOne("episode.findFirst(exato)", found);
  }
  if (filter !== null && typeof filter === "object") {
    const { lt, gt } = filter as { lt?: number; gt?: number };
    // O fake respeita `LIMIT 1`: devolve UMA linha, como o Postgres devolveria
    // resolvendo pelo indice `@@unique([seasonId, episodeNumber])`.
    if (typeof lt === "number") {
      const candidates = EPISODE_NUMBERS.filter((n) => n < lt).sort((a, b) => a - b);
      const pick = orderBy.episodeNumber === "desc" ? candidates.at(-1) : candidates.at(0);
      return countOne(
        "episode.findFirst(anterior)",
        pick === undefined ? null : { episodeNumber: pick },
      );
    }
    if (typeof gt === "number") {
      const candidates = EPISODE_NUMBERS.filter((n) => n > gt).sort((a, b) => a - b);
      const pick = orderBy.episodeNumber === "desc" ? candidates.at(-1) : candidates.at(0);
      return countOne(
        "episode.findFirst(proximo)",
        pick === undefined ? null : { episodeNumber: pick },
      );
    }
  }
  return countOne("episode.findFirst", episodeRow(EPISODE_NUMBERS[0] ?? 1));
}

function rowsFor(model: string, method: string, args: Record<string, unknown>): unknown {
  const where = (args.where ?? {}) as Record<string, unknown>;
  const take = typeof args.take === "number" ? args.take : undefined;
  const skip = typeof args.skip === "number" ? args.skip : 0;

  if (model === "episode") {
    if (method === "findFirst") return episodeFindFirst(args);
    if (method === "count") return EPISODE_NUMBERS.length;
    if (method === "findMany") {
      // GENEROSO DE PROPOSITO: sem `take`, entrega a temporada inteira. E aqui
      // que o defeito antigo reaparece se alguem o reintroduzir.
      const ordered = [...EPISODE_NUMBERS].sort((a, b) => a - b).map(episodeRow);
      const sliced = take === undefined ? ordered : ordered.slice(skip, skip + take);
      return count("episode.findMany", sliced);
    }
  }

  if (model === "season") {
    if (method === "findFirst") {
      const select = args.select as { episodes?: { take?: number } } | undefined;
      const base: Record<string, unknown> = {
        id: SEASON_ID,
        tmdbId: null,
        seasonNumber: 1,
        name: "Temporada 1",
        overview: "Sinopse da temporada.",
        airDate: new Date(Date.UTC(2024, 0, 1)),
        episodeCount: EPISODE_NUMBERS.length,
        posterPath: "/poster.jpg",
      };
      // A lista aninhada so e cobrada de quem a PEDE. Depois desta leva
      // ninguem a pede — mas se alguem voltar a pedi-la, o custo aparece aqui e
      // o teto reprova. (Sem esta condicao o harness cobraria a temporada
      // inteira de quem nunca a pediu: vermelho pelo motivo errado.)
      if (select?.episodes !== undefined) {
        const nestedTake =
          typeof select.episodes.take === "number" ? select.episodes.take : undefined;
        const all = [...EPISODE_NUMBERS].sort((a, b) => a - b).map(episodeRow);
        base.episodes = count(
          "season.findFirst>episodes",
          nestedTake === undefined ? all : all.slice(0, nestedTake),
        );
      }
      return countOne("season.findFirst", base);
    }
    if (method === "findMany") return count("season.findMany", [{ seasonNumber: 1 }]);
  }

  if (model === "slug") {
    if (method === "findFirst") {
      return countOne(
        "slug.findFirst",
        where.slug !== undefined
          ? { entityId: SERIES_ID, slug: "serie-diaria" }
          : { slug: "serie-diaria", entityId: SERIES_ID },
      );
    }
    if (method === "findMany") return count("slug.findMany", []);
  }

  if (model === "tvShow" && (method === "findUnique" || method === "findFirst")) {
    return countOne(`tvShow.${method}`, {
      id: SERIES_ID,
      nameOriginal: "Serie Diaria",
      posterPath: "/serie-poster.jpg",
      backdropPath: "/serie-backdrop.jpg",
      numberOfSeasons: 1,
      numberOfEpisodes: EPISODE_NUMBERS.length,
    });
  }

  if (model === "entityTranslation" && method === "findFirst") {
    return countOne("entityTranslation.findFirst", { title: "Serie Diaria" });
  }

  // Tabelas de apoio (creditos, imagens, licenca, trailer, decisao de
  // indexabilidade): vazias. O que este arquivo mede e o volume de EPISODIO.
  if (method === "findMany") return count(`${model}.findMany`, []);
  if (method === "count") return 0;
  return countOne(`${model}.${method}`, null);
}

const fakePrisma = new Proxy(
  {},
  {
    get(_target, model: string | symbol) {
      if (typeof model === "symbol") return undefined;
      if (model.startsWith("$")) return () => Promise.resolve([]);
      return new Proxy(
        {},
        {
          get(_inner, method: string | symbol) {
            if (typeof method === "symbol") return undefined;
            return (args: Record<string, unknown> = {}) =>
              Promise.resolve(rowsFor(model, method, args));
          },
        },
      );
    },
  },
);

vi.mock("@screena/db/server", () => ({
  getPrismaClient: () => fakePrisma,
  disconnectPrisma: () => Promise.resolve(),
}));

const { getEpisodePageData } = await import("../episode-page");
const { getSeasonPageData } = await import("../season-page");

/** Restaura a numeracao densa e zera o contador entre testes. */
beforeEach(() => {
  EPISODE_NUMBERS = Array.from({ length: SEASON_SIZE }, (_u, i) => i + 1);
  reset();
});

describe(`ficha de episodio (temporada falsa de ${SEASON_SIZE})`, () => {
  it("(1) CONTROLE: o fake DA a temporada inteira quando ninguem limita", async () => {
    reset();
    await (
      fakePrisma as { episode: { findMany: (a: unknown) => Promise<unknown> } }
    ).episode.findMany({ where: { seasonId: SEASON_ID } });
    expect(rowsReturned).toBe(SEASON_SIZE);
  });

  it("(2) le vizinhos, nao a temporada", async () => {
    const data = await getEpisodePageData("serie-diaria", 1, 2_500);
    expect(data, "a pagina precisa carregar para a medicao valer").not.toBeNull();
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeGreaterThan(0);
    expect(rowsReturned, `maiores: ${topOffenders()}`).toBeLessThanOrEqual(EPISODE_ROW_BUDGET);
  });

  it("(3) prev/next continuam CORRETOS", async () => {
    const data = await getEpisodePageData("serie-diaria", 1, 2_500);
    expect(data?.view.prevEpisode?.episodeNumber).toBe(2_499);
    expect(data?.view.nextEpisode?.episodeNumber).toBe(2_501);
  });

  it("(4) as bordas da temporada nao inventam vizinho", async () => {
    const primeiro = await getEpisodePageData("serie-diaria", 1, 1);
    expect(primeiro?.view.prevEpisode).toBeNull();
    expect(primeiro?.view.nextEpisode?.episodeNumber).toBe(2);

    const ultimo = await getEpisodePageData("serie-diaria", 1, SEASON_SIZE);
    expect(ultimo?.view.prevEpisode?.episodeNumber).toBe(SEASON_SIZE - 1);
    expect(ultimo?.view.nextEpisode).toBeNull();
  });

  it("(5) o custo NAO cresce com o tamanho da temporada", async () => {
    // A propriedade que interessa nao e "menos que 200": e ser INDIFERENTE ao
    // tamanho da temporada. Dois episodios distantes tem que custar o mesmo.
    reset();
    await getEpisodePageData("serie-diaria", 1, 2);
    const perto = rowsReturned;

    reset();
    await getEpisodePageData("serie-diaria", 1, SEASON_SIZE - 1);
    const longe = rowsReturned;

    expect(longe).toBe(perto);
  });

  it("(6) LACUNA na numeracao: o vizinho e o adjacente REAL, nao `n±1`", async () => {
    // O `prevNext` removido ordenava e pegava por POSICAO. As duas consultas
    // novas fazem "o maior menor que" e "o menor maior que" — mesma semantica.
    // Uma implementacao ingenua (`episodeNumber: n - 1`) passaria em todos os
    // testes acima e falharia aqui.
    EPISODE_NUMBERS = [1, 2, 5, 10];

    const cinco = await getEpisodePageData("serie-diaria", 1, 5);
    expect(cinco?.view.prevEpisode?.episodeNumber).toBe(2);
    expect(cinco?.view.nextEpisode?.episodeNumber).toBe(10);
  });

  it("(7) temporada de episodio UNICO nao tem vizinho nenhum", async () => {
    EPISODE_NUMBERS = [1];

    const unico = await getEpisodePageData("serie-diaria", 1, 1);
    expect(unico, "a pagina precisa carregar").not.toBeNull();
    expect(unico?.view.prevEpisode).toBeNull();
    expect(unico?.view.nextEpisode).toBeNull();
  });

  it("(8) episodio inexistente continua sendo 404", async () => {
    EPISODE_NUMBERS = [1, 2, 5, 10];
    expect(await getEpisodePageData("serie-diaria", 1, 7)).toBeNull();
  });
});

describe(`ficha de temporada (temporada falsa de ${SEASON_SIZE})`, () => {
  it("(1) CONTROLE: o fake DA a temporada inteira quando ninguem limita", async () => {
    reset();
    await (
      fakePrisma as { episode: { findMany: (a: unknown) => Promise<unknown> } }
    ).episode.findMany({ where: { seasonId: SEASON_ID } });
    expect(rowsReturned).toBe(SEASON_SIZE);
  });

  it("(2) a temporada INTEIRA continua na tela", async () => {
    // O guard do comportamento preservado. A consulta dos episodios mudou de
    // lugar (saiu do `select` aninhado, virou consulta propria em paralelo com
    // trailer e SEO) e NAO pode ter mudado de tamanho: 5.000 entram, 5.000
    // saem, na mesma ordem. Qualquer `take` reintroduzido aqui reprova.
    const data = await getSeasonPageData("serie-diaria", 1);
    expect(data, "a pagina precisa carregar para a medicao valer").not.toBeNull();
    expect(data?.view.episodes.length).toBe(SEASON_SIZE);
    expect(data?.view.episodes[0]?.episodeNumber).toBe(1);
    expect(data?.view.episodes.at(-1)?.episodeNumber).toBe(SEASON_SIZE);
  });

  it("(3) a ordem e por numero de episodio, crescente", async () => {
    const data = await getSeasonPageData("serie-diaria", 1);
    const numeros = data?.view.episodes.map((e) => e.episodeNumber) ?? [];
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
  });

  it("(4) temporada CURTA aparece inteira, sem sobra", async () => {
    EPISODE_NUMBERS = Array.from({ length: 12 }, (_u, i) => i + 1);
    const data = await getSeasonPageData("serie-diaria", 1);
    expect(data?.view.episodes.length).toBe(12);
  });

  it("(5) temporada VAZIA continua sendo uma pagina valida", async () => {
    EPISODE_NUMBERS = [];
    const data = await getSeasonPageData("serie-diaria", 1);
    expect(data, "temporada sem episodio ainda e uma pagina valida").not.toBeNull();
    expect(data?.view.episodes).toEqual([]);
  });

  it("(6) a lista nao vem mais do `select` aninhado da temporada", async () => {
    // A consulta migrou para poder viajar em paralelo. Se alguem a devolver
    // para dentro de `season.findFirst`, o custo aparece rotulado como
    // `season.findFirst>episodes` — e o paralelismo se perde em silencio.
    reset();
    await getSeasonPageData("serie-diaria", 1);
    const aninhada = heaviest.find((h) => h.what === "season.findFirst>episodes");
    expect(aninhada, "a lista voltou para dentro do select da temporada").toBeUndefined();
    expect(heaviest.some((h) => h.what === "episode.findMany" && h.rows === SEASON_SIZE)).toBe(true);
  });
});
