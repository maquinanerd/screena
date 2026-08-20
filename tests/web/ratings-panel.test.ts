/**
 * Testes de contrato do painel de notas externas e do seu WIRING.
 *
 * Antes desta etapa, `getRatingsForEntity` existia mas NAO tinha nenhum
 * chamador (codigo morto) e as paginas passavam `displayedRatings: []` fixo ao
 * resolver de SEO — um gate de licenca cego, que nunca podia disparar. Estes
 * testes travam as duas pontas: o componente (invariantes 1/2/6, sem logo, sem
 * nota propria) e o wiring server -> pagina -> gate de SEO.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const PANEL_REL = "apps/web/app/_components/ratings-panel.tsx";
const SERVER_REL = "apps/web/src/server/entity-ratings.ts";
const MOVIE_SERVER_REL = "apps/web/src/server/movie-page.ts";
const SERIES_SERVER_REL = "apps/web/src/server/series-page.ts";
const MOVIE_PAGE_REL = "apps/web/app/pt/filmes/[slug]/page.tsx";
const SERIES_PAGE_REL = "apps/web/app/pt/series/[slug]/page.tsx";

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

/** Remove comentarios para checar o CODIGO vivo, nao a documentacao. */
function withoutComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === "/" && line[i + 1] === "/") {
          if (i > 0 && line[i - 1] === ":") continue;
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

describe("ratings-panel — componente publico", () => {
  const code = withoutComments(readSource(PANEL_REL));

  it("exibe fonte, natureza e MEDIDA junto do numero", () => {
    expect(code).toContain("item.sourceLabel");
    expect(code).toContain("item.scoreTypeLabel");
    // A fileira de chips tipografa o numero e o sufixo em tamanhos diferentes
    // (canonico: `84` em 22/800 e `%` em 11/600), entao os dois pedacos sao
    // renderizados separados em vez de `item.scoreLabel` colado. A REGRA nao
    // mudou: o numero nunca aparece sem a medida.
    expect(code).toContain("item.valueLabel");
    expect(code).toContain("item.valueSuffix");
  });

  /**
   * REESCRITO em 2026-08-13: o credito saiu do chip e passou a viver no rodape
   * global (decisao do proprietario). Este teste exigia o oposto — agora ele
   * impede que o credito volte para ca e passe a aparecer duas vezes na pagina.
   * A presenca do credito e provada em `footer-credits.test.tsx`.
   */
  it("NAO exibe o credito junto da nota (ele vive no rodape)", () => {
    expect(code).not.toContain("item.attribution.text");
    expect(code).not.toContain("item.attribution.url");
    expect(code).not.toMatch(/fornecida por/i);
  });

  it("NUNCA renderiza logo/imagem de fonte (logo_allowed=false)", () => {
    expect(code).not.toContain("<img");
    expect(code).not.toMatch(/logo/i);
  });

  it("nao inventa nota propria nem AggregateRating", () => {
    expect(code).not.toMatch(/aggregaterating/i);
    expect(code).not.toMatch(/cinerie[ _-]?score/i);
    expect(code).not.toMatch(/\bm[eé]dia\b/i);
  });

  it("nao cita o fornecedor tecnico como fonte (invariante 2)", () => {
    expect(code).not.toMatch(/rapidapi/i);
    expect(code).not.toMatch(/provider_?api/i);
  });

  it("nao importa DB nem client de API (presentacional puro)", () => {
    expect(code).not.toContain("@screena/db");
    expect(code).not.toMatch(/api-clients/);
    expect(code).not.toContain("fetch(");
  });

  /**
   * REESCRITO em 2026-08-13. O unico `<a>` do chip era o linkback do credito.
   * Com o credito no rodape, o painel de notas nao tem link externo nenhum — e
   * nao pode ganhar um por outro caminho, que seria o mesmo credito de volta.
   */
  it("o painel de notas nao tem mais link externo (o linkback foi com o credito)", () => {
    expect(code).not.toContain("<a");
    expect(code).not.toMatch(/href=/);
  });
});

describe("ratings — camada server-only", () => {
  const code = withoutComments(readSource(SERVER_REL));

  it("filtra por display_allowed e revalida decisao/licenca vigentes", () => {
    expect(code).toContain("displayAllowed: true");
    expect(code).toContain("dataUsageDecision");
    expect(code).toContain("sourceLicense");
    expect(code).toContain('const RATING_DISPLAY_USE_CASE = "rating_display"');
  });

  it("aplica territorialidade (decisao de outro territorio nao exibe aqui)", () => {
    expect(code).toContain('const RATING_DISPLAY_TERRITORY = "BR"');
    expect(code).toContain("decision.territory !== RATING_DISPLAY_TERRITORY");
  });

  it("nao chama API externa no render", () => {
    expect(code).not.toContain("fetch(");
    expect(code).not.toMatch(/https?:\/\/(?!schema\.org)/);
  });
});

/**
 * O elo que faltava. Um teste que so olhasse o componente passaria mesmo com o
 * painel jamais montado — foi exatamente esse o estado anterior.
 */
describe("ratings — wiring ate a pagina e ate o gate de SEO", () => {
  for (const [label, serverRel, pageRel] of [
    ["filme", MOVIE_SERVER_REL, MOVIE_PAGE_REL],
    ["serie", SERIES_SERVER_REL, SERIES_PAGE_REL],
  ] as const) {
    describe(label, () => {
      const serverCode = withoutComments(readSource(serverRel));
      const pageCode = withoutComments(readSource(pageRel));

      it("a camada server realmente busca as notas governadas", () => {
        expect(serverCode).toContain("getRatingsForEntity");
        expect(serverCode).toContain("buildRatingsView");
        expect(serverCode).toContain("ratings");
      });

      it("a pagina monta o painel", () => {
        expect(pageCode).toContain("RatingsPanel");
        // A view agora chega pela fronteira de secao — que garante, na MESMA
        // linha, que a ausencia sai do DOM e vira log. `decideSection(ratings,
        // ...)` continua provando que e a view GOVERNADA que alimenta o painel,
        // e nao um dado qualquer.
        expect(pageCode).toMatch(/decideSection\(ratings,/);
        expect(pageCode).toMatch(/<SectionBoundary decision=\{ratingsSection\}>/);
        expect(pageCode).toContain("<RatingsPanel view={view} />");
      });

      it("displayedRatings NAO e mais uma lista vazia fixa (gate cego)", () => {
        // A regressao que este teste impede: voltar a passar `[]` literal e
        // deixar o gate da invariante 6 sem nada para avaliar.
        expect(serverCode).not.toMatch(/displayedRatings:\s*\[\s*\]/);
        expect(serverCode).toMatch(/displayedRatings:\s*\(ratings\?\.items\s*\?\?\s*\[\]\)/);
      });
    });
  }
});
