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
    providerSlug: "netflix",
    offerType: "subscription",
    deepLink: "https://www.netflix.com/title/1",
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: null,
    // Ver watch-availability-presenter.test.ts: oferta licenciada carrega o
    // credito exigido pela licenca que a autoriza.
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Disponibilidade fornecida por Movie of the Night",
    attributionUrl: "https://www.movieofthenight.com/",
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

  /**
   * REESCRITO em 2026-08-13. Este teste exigia o credito DENTRO do painel, e a
   * matriz de licenca dizia "atribuicao junto ao painel".
   *
   * Decisao do proprietario: todo credito de fonte passou a viver no rodape
   * global. A licenca continua exigindo credito visivel — mudou o endereco. Este
   * teste agora impede o credito de voltar para ca (o que o duplicaria); a
   * presenca dele na pagina e provada em `footer-credits.test.tsx`.
   */
  it("NAO renderiza o credito da fonte (ele vive no rodape global)", () => {
    expect(code).not.toContain("view.attributions");
    expect(code).not.toContain("attribution.text");
    expect(code).not.toContain("attribution.url");
    expect(code).not.toMatch(/fornecida por/i);
  });

  it("o unico link do painel continua sendo o DESTINO da oferta, com rel seguro", () => {
    // O linkback de credito saiu; o link para onde a pessoa assiste ficou — sao
    // coisas diferentes, e so o segundo pertence a este painel.
    expect(code).toContain("offer.destinationUrl");
    expect(code).toMatch(/rel="nofollow sponsored noopener"/);
  });
});

describe("watch-availability — camada server-only", () => {
  const source = readSource(SERVER_REL);
  const code = withoutComments(source);

  it("filtra por display_allowed=true e BR", () => {
    expect(code).toContain("displayAllowed: true");
    expect(code).toContain('const WATCH_COUNTRY = "BR"');
    expect(code).toContain("countryCode: WATCH_COUNTRY");
  });

  /**
   * O GATE MUDOU, E DE PROPOSITO. Antes a query filtrava
   * `providerApi: "streaming_availability"`, o que era um gate ACIDENTAL: ele
   * deixava invisivel toda oferta de origem TMDB/JustWatch mesmo depois de
   * licenciada, revisada e promovida. Quem autoriza exibir e a CADEIA DE
   * LICENCA (decisao vigente + licenca-mae vigente e exibivel), nunca o nome de
   * quem transportou o dado.
   *
   * Este teste trava as DUAS metades: a ausencia do filtro por fornecedor E a
   * presenca da cadeia. Remover o filtro sem manter a cadeia seria abrir o
   * painel, nao corrigi-lo.
   */
  it("NAO filtra por fornecedor tecnico; a autoridade e a cadeia de licenca", () => {
    expect(code).not.toContain("providerApi:");
    expect(code).not.toContain('"streaming_availability"');

    expect(code).toContain("dataUsageDecision");
    expect(code).toContain('useCase: "watch_offer_display"');
    expect(code).toContain('stage: "approved_for_display"');
    expect(code).toContain("sourceLicense");
    expect(code).toContain('contentType: "watch_availability"');
  });

  it("le o destino do agregador e o slug canonico (as duas origens no painel)", () => {
    // `web_url` e o unico destino que a oferta de origem TMDB tem; o slug e a
    // identidade da plataforma ENTRE fornecedores (sem ele o painel duplicaria).
    expect(code).toContain("webUrl: true");
    expect(code).toContain("watchProvider: { select: { slug: true } }");
  });

  it("omite ofertas vencidas por available_until", () => {
    expect(code).toContain("availableUntil");
  });

  it("seleciona os campos de atribuicao que a licenca exige", () => {
    // Sem estes no `select`, o presenter recebe undefined e (com o gate
    // fail-closed) toda oferta cai — o painel some por completo. Este teste
    // trava a causa-raiz, nao so o sintoma.
    expect(code).toContain("requiresAttribution: true");
    expect(code).toContain("requiresLinkback: true");
    expect(code).toContain("attributionText: true");
    expect(code).toContain("attributionUrl: true");
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
    it(`${name}: importa a fileira de marcas do topo canonico, nao os paineis antigos`, () => {
      // Desde 20/08/2026 o cartao do topo usa a fileira de MARCAS
      // (WatchBrandsRow, canonico) — o painel completo por modalidade
      // continua existindo para o hub /pt/onde-assistir, mas nao nas paginas
      // de detalhe; o antigo WatchProviders segue banido.
      expect(source).toContain("WatchBrandsRow");
      expect(source).not.toContain("WatchAvailabilityPanel");
      expect(source).not.toContain("WatchProviders");
    });

    it(`${name}: so renderiza o painel quando ha oferta (fronteira de secao)`, () => {
      // ATUALIZADO: o gate deixou de ser um ternario `watch !== null ?` e
      // passou a ser `SectionBoundary` + `decideSection`. Nao e reescrita
      // cosmetica — o ternario cumpria METADE da regra. A outra metade e que a
      // ausencia REGISTRE o motivo, e um ternario nao tem onde faze-lo: hoje
      // ha ZERO provedores autorizados no banco, e o bloco sumia de todo
      // titulo sem deixar rastro nenhum. A fronteira decide e loga na mesma
      // linha, entao "sumiu" e "registrou" nao podem divergir.
      const clean = withoutComments(source);
      expect(clean).toMatch(/decideSection\(watch,/);
      // ATUALIZADO DE NOVO, e o motivo e o mesmo espirito da mudanca anterior.
      // Este teste travava o motivo FIXO `no_authorized_provider`. Ele era
      // verdadeiro so enquanto houvesse zero ofertas exibiveis — e deixaria de
      // ser exatamente quando a cadeia de streaming fosse concluida, passando a
      // marcar TODO titulo sem oferta como `actionable: true`. O motivo agora e
      // DERIVADO do estado (`watchAbsence`, de `watchAbsenceReason`), e e isso
      // que este teste trava: a pagina le o motivo, nao o escreve.
      // Ver tests/web/watch-absence-reason.test.ts para os dois estados.
      expect(clean).toMatch(/reason: watchAbsence \?\? 'no_authorized_provider'/);
      expect(clean).toMatch(/<SectionBoundary decision=\{watchSection\}>/);
      // A fileira deriva da MESMA view licenciada (watchBrandsRow(view)) — a
      // troca de painel nao abriu porta nova de dado.
      expect(clean).toContain("<WatchBrandsRow brands={watchBrandsRow(view)} />");
    });

    it(`${name}: rotulo 'Onde assistir' so existe com destino/painel REAL`, () => {
      // O rotulo nunca aparece fora do gate de oferta licenciada. O gate agora
      // e a fronteira de secao (ver o teste acima).
      const clean = withoutComments(source);
      if (/onde assistir/i.test(clean)) {
        expect(clean).toMatch(/<SectionBoundary decision=\{watchSection\}>/);
      }
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
