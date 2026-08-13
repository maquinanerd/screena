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

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

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

describe("a camada server-only pergunta a coluna certa de cada vertical", () => {
  const server = code(read(SERVER));

  it("filme = Movie.releaseDate futura; série = TvShow.firstAirDate futura", () => {
    expect(server).toContain("prisma.movie.findMany");
    expect(server).toMatch(/releaseDate:\s*\{\s*gt:\s*cutoff\s*\}/);
    expect(server).toContain("prisma.tvShow.findMany");
    expect(server).toMatch(/firstAirDate:\s*\{\s*gt:\s*cutoff\s*\}/);
  });

  it("o trilho da home é a MISTURA dos dois getters, não uma terceira consulta", () => {
    expect(server).toContain("mergeUpcomingVerticals(movies, series, limit)");
  });

  it("só slug canônico pt-BR entra (sem slug a entidade nunca vira card)", () => {
    expect(server).toContain('languageCode: LANGUAGE_CODE, isCanonical: true');
  });

  /**
   * Invariante 3: página indexável lê SÓ PostgreSQL/cache local. O getter de
   * séries é novo — é exatamente onde uma chamada externa entraria por
   * distração.
   */
  it("NEGATIVO — zero rede no caminho de render (nem fetch, nem TMDB, nem Gemini)", () => {
    for (const proibido of ["fetch(", "https://", "axios", "tmdb", "gemini"]) {
      expect(server.toLowerCase()).not.toContain(proibido.toLowerCase());
    }
  });
});
