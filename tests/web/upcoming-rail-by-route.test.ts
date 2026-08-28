/**
 * upcoming-rail-by-route.test.ts — A MESMA seção "Em breve" nas três rotas
 * home-like, cada uma com o SEU dataset.
 *
 *   /pt/         -> filmes + séries  (getHomeUpcomingMixed)
 *   /pt/filmes/  -> só filmes        (getHomeUpcomingMovies)
 *   /pt/series/  -> só séries        (getHomeUpcomingSeries)
 *
 * O ESTADO ANTERIOR, que este arquivo tranca. A home chamava o getter de
 * FILMES, então o trilho da página inicial nunca mostrava série. E
 * `/pt/series/` passava `upcomingMovies={[]}` — uma lista vazia LITERAL —, de
 * modo que a seção simplesmente não existia naquela rota. Nenhum teste
 * reprovava: uma lista vazia constante é indistinguível de um catálogo sem
 * estreias futuras.
 *
 * Por isso as asserções negativas aqui são tão importantes quanto as positivas:
 * sem elas, voltar a passar `[]` ou a chamar o getter errado passa despercebido
 * de novo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const ROOT = process.cwd();

/**
 * ============================================================================
 * O INSTRUMENTO NOVO: OBSERVAR A CONSULTA, NAO O TEXTO DO MODULO
 * ============================================================================
 * As duas provas da camada server-only liam o FONTE (`toContain(
 * "prisma.movie.findMany")`). Em 2026-08-28 o loader parou de carregar o
 * catalogo inteiro para exibir seis cards e passou a fazer a selecao no banco,
 * com `JOIN` e `LIMIT`. O texto mudou; a PROPRIEDADE ("filme pergunta pela
 * coluna de filme, serie pela de serie") nao.
 *
 * Um guard textual nao sabe a diferenca entre esses dois casos — ele reprova a
 * reescrita e aprova a troca de coluna desde que a grafia bata. Por isso o fake
 * abaixo: ele captura o SQL que o modulo REALMENTE entrega ao driver, com os
 * parametros. A prova sobrevive a reescrita e continua reprovando o defeito.
 */
const sqlCapturado: Array<{ sql: string; params: unknown[] }> = [];

const fakePrisma = new Proxy(
  {},
  {
    get(_target, model: string | symbol) {
      if (typeof model === "symbol") return undefined;
      if (model === "$queryRawUnsafe") {
        return (sql: string, ...params: unknown[]) => {
          sqlCapturado.push({ sql, params });
          return Promise.resolve([]);
        };
      }
      return new Proxy(
        {},
        { get: () => () => Promise.resolve([]) },
      );
    },
  },
);

vi.mock("@screena/db/server", () => ({ getPrismaClient: () => fakePrisma }));

/** O cutoff (2o parametro) que a ultima consulta capturada entregou ao banco. */
let cutoffEntregue: Date | null = null;

/**
 * Roda o getter da vertical e devolve o SQL de PAGINA que ele emitiu.
 *
 * Os getters sao memoizados por `cache()` do React; chamar os dois na mesma
 * execucao e seguro porque sao funcoes diferentes, e o que se le e a captura
 * daquela chamada.
 */
async function sqlEmitidoPor(vertical: "movie" | "tv"): Promise<string> {
  sqlCapturado.length = 0;
  const modulo = await import("../../apps/web/src/server/home-upcoming");
  if (vertical === "movie") await modulo.getHomeUpcomingMovies();
  else await modulo.getHomeUpcomingSeries();
  const pagina = sqlCapturado.find((call) => /\bLIMIT\b/.test(call.sql));
  // Sem consulta nao ha prova: um loader que nao perguntasse nada faria todas
  // as asercoes abaixo passarem sobre uma string vazia.
  expect(pagina, `o getter de ${vertical} nao emitiu consulta de pagina`).toBeDefined();
  const cutoff = pagina?.params[1];
  cutoffEntregue = cutoff instanceof Date ? cutoff : null;
  return pagina?.sql ?? "";
}

const HOME = "apps/web/app/pt/page.tsx";
const MOVIES = "apps/web/app/pt/filmes/page.tsx";
const SERIES = "apps/web/app/pt/series/page.tsx";
const SERVER = "apps/web/src/server/home-upcoming.ts";

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

/**
 * Código SEM comentários. Um guard de "não pode conter X" que varre o arquivo
 * inteiro reprova a PROSA que explica por que X não existe — documentar a regra
 * passaria a violá-la.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ROUTES = [
  {
    label: "home",
    file: HOME,
    getter: "getHomeUpcomingMixed()",
    vertical: "'mixed'",
    outros: ["getHomeUpcomingMovies(", "getHomeUpcomingSeries("],
  },
  {
    label: "filmes",
    file: MOVIES,
    getter: "getHomeUpcomingMovies()",
    vertical: "'movie'",
    outros: ["getHomeUpcomingSeries(", "getHomeUpcomingMixed("],
  },
  {
    label: "series",
    file: SERIES,
    getter: "getHomeUpcomingSeries()",
    vertical: "'series'",
    outros: ["getHomeUpcomingMovies(", "getHomeUpcomingMixed("],
  },
] as const;

describe("cada rota home-like consome o seu dataset de 'Em breve'", () => {
  for (const route of ROUTES) {
    it(`${route.label}: chama ${route.getter} e declara vertical ${route.vertical}`, () => {
      const source = code(read(route.file));
      expect(source).toContain(route.getter);
      expect(source).toContain(`vertical: ${route.vertical}`);
    });

    it(`${route.label}: NEGATIVO — não chama o getter de outra vertical`, () => {
      const source = code(read(route.file));
      for (const outro of route.outros) {
        expect(source, `${route.label} não deveria chamar ${outro}`).not.toContain(outro);
      }
    });

    it(`${route.label}: NEGATIVO — não passa lista vazia LITERAL para o trilho`, () => {
      // Foi assim que `/pt/series/` ficou sem a seção sem ninguém notar.
      const source = code(read(route.file));
      expect(source).not.toMatch(/items:\s*\[\s*\]/);
      expect(source).not.toContain("upcomingMovies={[]}");
    });
  }

  it("CONTROLE POSITIVO: os três getters são MESMO diferentes", () => {
    // Se os três nomes colidissem, todas as asserções acima seriam vácuo.
    const names = new Set(ROUTES.map((r) => r.getter));
    expect(names.size).toBe(3);
  });
});

/**
 * O piso do trilho tem DOIS consumidores: quem decide renderizar e quem conta
 * seções populadas para a indexabilidade. Se cada um aplicasse o seu próprio
 * `>= 4`, um deles ficaria para trás no primeiro refactor e a home passaria a
 * contar como populada uma seção que não está na página.
 */
describe("o piso de 4 itens tem UMA fonte, usada pelos dois consumidores", () => {
  const HOME_LIKE = "apps/web/app/_components/home-like.tsx";
  const PRESENTER = "apps/web/src/lib/home-upcoming-presenter.ts";

  it("o piso é declarado UMA vez, no presenter", () => {
    expect(code(read(PRESENTER))).toContain("HOME_UPCOMING_MIN = 4");
  });

  it("template e home chamam a MESMA função (`hasEnoughUpcoming`)", () => {
    expect(code(read(HOME_LIKE))).toContain("hasEnoughUpcoming(upcoming.items)");
    expect(code(read(HOME))).toContain("hasEnoughUpcoming(upcomingItems)");
  });

  it("NEGATIVO — ninguém reescreve o número do piso à mão", () => {
    for (const file of [HOME_LIKE, HOME]) {
      const source = code(read(file));
      expect(source, `${file} compara contagem com literal`).not.toMatch(
        /items\.length\s*[<>]=?\s*\d/,
      );
      expect(source).not.toContain("HOME_UPCOMING_MIN =");
    }
  });

  it("NEGATIVO — o piso não vira `return null` mudo antes da fronteira", () => {
    // Cumprir só a metade visual ("some do DOM") devolveria a ausência muda que
    // o SectionBoundary existe para impedir. O piso entra na DECISÃO.
    const source = code(read(HOME_LIKE));
    expect(source).toContain("upcomingRendered ? upcoming.items : null");
    expect(source).toContain("'below_upcoming_floor'");
    expect(source).toContain("available: upcomingCount");
  });
});

describe("a camada server-only pergunta a coluna certa de cada vertical", () => {
  const server = code(read(SERVER));

  /**
   * ESTA PROVA MUDOU DE INSTRUMENTO EM 2026-08-28, e ficou mais forte.
   *
   * Ela lia o TEXTO do modulo (`toContain("prisma.movie.findMany")`). Quando o
   * loader passou a fazer a selecao no banco com `JOIN` e `LIMIT` — porque
   * antes ele carregava o catalogo inteiro para exibir seis cards — o texto
   * mudou e a prova reprovou, sem que a PROPRIEDADE tivesse mudado.
   *
   * Agora ela observa a CONSULTA QUE O CODIGO REALMENTE EMITE. Um fake registra
   * o SQL entregue ao driver: filme tem de perguntar por `movies.release_date`,
   * serie por `tv_shows.first_air_date`, e cada um so pela SUA coluna. Isso
   * sobrevive a reescrita da consulta e continua reprovando a troca de coluna,
   * que e o defeito real.
   */
  it("filme = movies.release_date futura; série = tv_shows.first_air_date futura", async () => {
    // A tabela da entidade entra por `JOIN` (a consulta PARTE de `slugs`, para
    // que quem nao tem slug canonico nunca seja carregado).
    const emitido = await sqlEmitidoPor("movie");
    expect(emitido).toMatch(/\bjoin\s+movies\b/i);
    expect(emitido).toMatch(/e\.release_date\s*>\s*\$\d/i);
    expect(emitido).not.toMatch(/\btv_shows\b/i);
    // A negativa mira a COLUNA DA ENTIDADE (`e.`), nao a palavra solta: a
    // consulta de serie APELIDA `e.first_air_date AS release_date`, e proibir a
    // palavra reprovaria o apelido — o guard passaria a medir a grafia.
    expect(emitido).not.toMatch(/e\.first_air_date/i);

    const emitidoSerie = await sqlEmitidoPor("tv");
    expect(emitidoSerie).toMatch(/\bjoin\s+tv_shows\b/i);
    expect(emitidoSerie).toMatch(/e\.first_air_date\s*>\s*\$\d/i);
    expect(emitidoSerie).not.toMatch(/\bmovies\b/i);
    expect(emitidoSerie).not.toMatch(/e\.release_date/i);
  });

  it("o CUTOFF entregue ao banco é o inicio do dia UTC — nao 'agora'", () => {
    // Uma estreia marcada para HOJE continua sendo "em breve" ate o fim do dia.
    // Passar `now` em vez do inicio do dia faria o card sumir no meio da manha.
    const cutoff = cutoffEntregue;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff?.getUTCHours()).toBe(0);
    expect(cutoff?.getUTCMinutes()).toBe(0);
    expect(cutoff?.getUTCSeconds()).toBe(0);
  });

  it("o trilho da home é a MISTURA dos dois getters, não uma terceira consulta", () => {
    expect(server).toContain("mergeUpcomingVerticals(movies, series, limit)");
  });

  it("só slug canônico pt-BR entra (sem slug a entidade nunca vira card)", async () => {
    // Tambem por observacao da consulta emitida: o `JOIN` parte de `slugs` e
    // exige `is_canonical` no idioma publicado. Uma entidade sem slug nunca
    // chega a ser carregada — e por isso nunca vira card com link quebrado.
    const emitido = await sqlEmitidoPor("movie");
    expect(emitido).toMatch(/\bfrom\s+slugs\b/i);
    expect(emitido).toMatch(/s\.is_canonical/i);
    expect(emitido).toMatch(/s\.language_code\s*=\s*\$1/i);
  });

  /**
   * Invariante 3: página indexável lê SÓ PostgreSQL/cache local.
   *
   * O guard mira a REDE, não a palavra "tmdb". A versão anterior proibia a
   * substring `tmdb` e passava só porque o módulo ainda não lia a tabela
   * `tmdb_videos`; no instante em que passou a ler (`prisma.tmdbVideo`,
   * `tmdbId`), o guard reprovou uma consulta ao PostgreSQL local — que é
   * exatamente o que a invariante MANDA fazer. Guard que confunde nome de
   * coluna com chamada externa vira ruído e acaba relaxado pelo motivo errado.
   */
  it("NEGATIVO — zero rede no caminho de render (nem fetch, nem host externo, nem Gemini)", () => {
    for (const proibido of [
      "fetch(",
      "https://",
      "http://",
      "axios",
      "XMLHttpRequest",
      "api.themoviedb.org",
      "gemini",
    ]) {
      expect(server.toLowerCase(), proibido).not.toContain(proibido.toLowerCase());
    }
  });

  it("CONTROLE POSITIVO: o módulo REALMENTE lê a tabela local de vídeos", () => {
    // Sem isto, o guard acima ficaria verde num módulo que não consulta nada.
    expect(server).toContain("prisma.tmdbVideo.findMany");
  });
});
