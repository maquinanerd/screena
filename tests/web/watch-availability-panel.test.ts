/**
 * Testes de contrato do painel "Disponibilidade no Brasil": garantem a
 * apresentacao gateada por `display_allowed` sem quebrar as invariantes de
 * render puro (3/4), licenca (6) e anti-pirataria/anti-fake-streaming (8).
 *
 * Estilo hibrido (como tests/web/public-navigation e tests/governance):
 *  - Checagens de FONTE sobre o componente, as paginas e a camada server-only
 *    (link externo com rel correto, gate de render, query com display_allowed,
 *    zero fetch/host externo, sem "Onde assistir", sem imagem/rating).
 *  - Checagens de COMPORTAMENTO do gate via o presenter puro (server ->
 *    presenter -> painel): sem display_allowed=true a view e `null` e a pagina
 *    nao renderiza; com display_allowed=true o provider real aparece.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
} from "../../apps/web/src/lib/watch-availability-presenter";

const ROOT = process.cwd();

const PANEL_REL = "apps/web/app/_components/watch-availability-panel.tsx";
const SERVER_REL = "apps/web/src/server/entity-watch.ts";
const MOVIE_PAGE_REL = "apps/web/app/pt/filmes/[slug]/page.tsx";
const SERIES_PAGE_REL = "apps/web/app/pt/series/[slug]/page.tsx";

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

/** Remove comentarios para checar o CODIGO/markup vivo, nao a documentacao. */
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

function row(overrides: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: "Netflix",
    providerKey: "netflix",
    offerType: "subscription",
    deepLink: "https://www.netflix.com/title/1",
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: null,
    ...overrides,
  };
}

describe("watch-availability-panel — componente publico", () => {
  const source = readSource(PANEL_REL);
  const code = withoutComments(source);

  it("usa a copy 'Disponibilidade no Brasil' e a nota discreta", () => {
    expect(code).toContain("Disponibilidade no Brasil");
    expect(code).toContain("As ofertas podem mudar conforme");
  });

  it("nunca usa a copy 'Onde assistir'", () => {
    expect(code).not.toMatch(/onde assistir/i);
  });

  it("retorna null quando a view e vazia/nula (gate de render)", () => {
    expect(code).toContain(
      "if (view === null || view.groups.length === 0) return null;",
    );
  });

  it("link externo usa rel='nofollow sponsored noopener' e target='_blank'", () => {
    expect(code).toContain('rel="nofollow sponsored noopener"');
    expect(code).toContain('target="_blank"');
  });

  it("nao renderiza logo/imagem, nota/rating nem placeholder", () => {
    expect(code).not.toContain("<img");
    expect(code).not.toMatch(/imageSet/i);
    expect(code).not.toMatch(/aggregaterating|tomatometer|popcornmeter|\brating\b/i);
    expect(code).not.toMatch(/placeholder/i);
  });

  it("nao importa DB nem client de API (presentacional puro)", () => {
    expect(code).not.toContain("@screena/db");
    expect(code).not.toMatch(/api-clients/);
    expect(code).not.toContain("fetch(");
  });
});

describe("watch-availability — camada server-only", () => {
  const source = readSource(SERVER_REL);
  const code = withoutComments(source);

  it("filtra por display_allowed=true, BR e provider streaming_availability", () => {
    expect(code).toContain("displayAllowed: true");
    expect(code).toContain('const WATCH_COUNTRY = "BR"');
    expect(code).toContain("countryCode: WATCH_COUNTRY");
    expect(code).toContain('const WATCH_PROVIDER_API = "streaming_availability"');
    expect(code).toContain("providerApi: WATCH_PROVIDER_API");
  });

  it("omite ofertas vencidas por available_until", () => {
    expect(code).toContain("availableUntil");
  });

  it("nao chama API externa no render (worker/host proibido)", () => {
    expect(code).not.toContain("fetch(");
    expect(code).not.toMatch(/rapidapi|themoviedb|image\.tmdb\.org/i);
  });
});

describe("watch-availability — integracao nas paginas de detalhe", () => {
  const movie = readSource(MOVIE_PAGE_REL);
  const series = readSource(SERIES_PAGE_REL);

  for (const [name, source] of [
    ["filme", movie],
    ["serie", series],
  ] as const) {
    it(`${name}: importa o painel novo e nao o antigo WatchProviders`, () => {
      expect(source).toContain("WatchAvailabilityPanel");
      expect(source).not.toContain("WatchProviders");
    });

    it(`${name}: so renderiza o painel quando ha oferta (gate watch !== null)`, () => {
      expect(source).toContain("watch !== null ?");
      expect(source).toContain("<WatchAvailabilityPanel view={watch} />");
    });

    it(`${name}: nao usa 'Onde assistir' no codigo vivo`, () => {
      expect(withoutComments(source)).not.toMatch(/onde assistir/i);
    });
  }
});

describe("watch-availability — gate de render (server -> presenter -> painel)", () => {
  it("sem display_allowed=true, a view e null -> a pagina nao renderiza painel", () => {
    // Simula o resultado da query quando nada e permitido (o worker grava
    // display_allowed=false por padrao): o presenter devolve null e o gate
    // `watch !== null` das paginas mantem o painel fora do DOM.
    expect(buildWatchAvailabilityView([])).toBeNull();
    expect(
      buildWatchAvailabilityView([row({ displayAllowed: false })]),
    ).toBeNull();
  });

  it("com display_allowed=true (fixture), o provider real aparece na view", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Netflix", providerKey: "netflix" }),
    ]);
    expect(view).not.toBeNull();
    expect(view!.groups[0]!.offers[0]!.providerName).toBe("Netflix");
  });

  it("provider com display_allowed=false nunca entra na view do painel", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Max", providerKey: "max", displayAllowed: false }),
      row({ providerName: "Netflix", providerKey: "netflix", displayAllowed: true }),
    ]);
    const names = view!.groups.flatMap((g) => g.offers.map((o) => o.providerName));
    expect(names).toEqual(["Netflix"]);
  });
});
