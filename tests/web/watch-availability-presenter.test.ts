/**
 * Testes puros do presenter "Disponibilidade no Brasil" (invariantes 6 e 8).
 *
 * Garantem: LICENCA antes de exibir (so display_allowed=true entra); SEM
 * pirataria e SEM addon (so as 4 modalidades legais; tipos desconhecidos
 * descartados); deep link so http/https; descarte de linha incompleta
 * (provider_name/provider_key/offer_type/deep_link); dedupe; agrupamento na
 * ordem canonica (assinatura/gratis/aluguel/compra); preco so em aluguel/compra;
 * ordenacao estavel (provedor asc, qualidade desc); carimbo de frescor; e
 * `null` quando nao ha oferta valida.
 */

import { describe, expect, it } from "vitest";

import {
  buildWatchAvailabilityView,
  formatWatchDate,
  selectTickerWatchOffer,
  type WatchAvailabilityRow,
} from "../../apps/web/src/lib/watch-availability-presenter";

function row(overrides: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: "Netflix",
    providerKey: "netflix",
    // Slug canonico: a fabrica padrao representa a oferta do agregador
    // (RapidAPI), que e o caminho historico. Testes de proveniencia sobrescrevem.
    providerSlug: "netflix",
    offerType: "subscription",
    deepLink: "https://www.netflix.com/title/1",
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: null,
    // Oferta licenciada REAL carrega o credito da fonte: a mesma licenca que
    // permite exibir obriga a creditar. Um fixture sem isto descreveria um
    // estado que a licenca nao autoriza.
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Disponibilidade fornecida por Movie of the Night",
    attributionUrl: "https://www.movieofthenight.com/",
    ...overrides,
  };
}

describe("formatWatchDate", () => {
  it("formata ISO -> DD/MM/AAAA e recusa invalido", () => {
    expect(formatWatchDate("2026-06-15T00:00:00.000Z")).toBe("15/06/2026");
    expect(formatWatchDate("2026-06-15")).toBe("15/06/2026");
    expect(formatWatchDate(null)).toBeNull();
    expect(formatWatchDate("15/06/2026")).toBeNull();
  });
});

describe("buildWatchAvailabilityView — licenca (invariante 6)", () => {
  it("descarta oferta sem display_allowed e retorna null (gate absoluto)", () => {
    expect(buildWatchAvailabilityView([row({ displayAllowed: false })])).toBeNull();
  });

  it("nunca inclui provider com display_allowed=false ao lado de um permitido", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Max", providerKey: "max", displayAllowed: false }),
      row({ providerName: "Netflix", providerKey: "netflix", displayAllowed: true }),
    ]);
    expect(view).not.toBeNull();
    const names = view!.groups.flatMap((g) => g.offers.map((o) => o.providerName));
    expect(names).toContain("Netflix");
    expect(names).not.toContain("Max");
  });

  it("com display_allowed=true, expoe o provider real que o painel renderiza", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Netflix", providerKey: "netflix" }),
    ]);
    expect(view).not.toBeNull();
    const offer = view!.groups[0]?.offers[0];
    expect(offer?.providerName).toBe("Netflix");
    expect(offer?.destinationUrl).toBe("https://www.netflix.com/title/1");
  });
});

describe("buildWatchAvailabilityView — deep link e pirataria", () => {
  it("aceita apenas deep link http/https", () => {
    expect(buildWatchAvailabilityView([row({ deepLink: null })])).toBeNull();
    expect(buildWatchAvailabilityView([row({ deepLink: "netflix://title/1" })])).toBeNull();
    expect(
      buildWatchAvailabilityView([row({ deepLink: "javascript:alert(1)" })]),
    ).toBeNull();
    expect(
      buildWatchAvailabilityView([row({ deepLink: "http://x.example/1" })]),
    ).not.toBeNull();
    expect(
      buildWatchAvailabilityView([row({ deepLink: "https://x.example/1" })]),
    ).not.toBeNull();
  });

  it("descarta addon e qualquer modalidade fora do vocabulario", () => {
    expect(buildWatchAvailabilityView([row({ offerType: "addon" })])).toBeNull();
    // `cinema` existe no enum `OfferType` do banco mas NAO e modalidade de
    // streaming: rotula-la aqui afirmaria disponibilidade domestica de uma
    // sessao de cinema.
    expect(buildWatchAvailabilityView([row({ offerType: "cinema" })])).toBeNull();
    expect(buildWatchAvailabilityView([row({ offerType: "torrent" })])).toBeNull();
    expect(buildWatchAvailabilityView([row({ offerType: "unknown" })])).toBeNull();
  });

  it("`ads` ENTRA — era descartado em silencio e nao devia", () => {
    // Mudanca de comportamento deliberada. `ads` e catalogo gratuito com
    // anuncio (FAST) e esta no enum `OfferType`; o presenter conhecia so 4
    // modalidades e o fazia sumir com um `continue` mudo. Em producao isso
    // apagava da tela toda oferta de Mercado Play, NetMovies, Pluto TV e
    // "Amazon Prime Video Free with Ads".
    const view = buildWatchAvailabilityView([row({ offerType: "ads" })]);
    expect(view).not.toBeNull();
    expect(view!.groups.map((g) => g.offerType)).toEqual(["ads"]);
    expect(view!.groups[0]!.label).toBe("Grátis com anúncios");
  });

  it("descarte de modalidade desconhecida NUNCA e silencioso", () => {
    const seen: Array<{ message: string; raw: string | null }> = [];
    const view = buildWatchAvailabilityView([row({ offerType: "addon" })], {
      onUnsupportedOfferType: (message, raw) => seen.push({ message, raw }),
    });
    expect(view).toBeNull();
    expect(seen).toHaveLength(1);
    // O VALOR CRU chega ao log — e ele que identifica contrato de upstream que
    // mudou. E nenhum rotulo e inventado para ele.
    expect(seen[0]!.raw).toBe("addon");
    expect(seen[0]!.message).toContain('"addon"');
    expect(seen[0]!.message).not.toContain("Assinatura");
  });
});

describe("buildWatchAvailabilityView — linha incompleta", () => {
  it("descarta linha sem provider_name ou provider_key", () => {
    expect(buildWatchAvailabilityView([row({ providerName: "   " })])).toBeNull();
    expect(buildWatchAvailabilityView([row({ providerKey: null })])).toBeNull();
  });
});

describe("buildWatchAvailabilityView — agrupamento e ordem", () => {
  it("agrupa nas 4 modalidades na ordem canonica assinatura/gratis/aluguel/compra", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Apple TV", providerKey: "apple", offerType: "buy", deepLink: "https://tv.apple.com/b" }),
      row({ providerName: "Pluto", providerKey: "pluto", offerType: "free", deepLink: "https://pluto.tv/f" }),
      row({ providerName: "Google", providerKey: "google", offerType: "rent", deepLink: "https://play.google.com/r", priceAmount: "12.90", currency: "BRL" }),
      row({ providerName: "Netflix", providerKey: "netflix", offerType: "subscription", deepLink: "https://netflix.com/s" }),
    ]);
    expect(view).not.toBeNull();
    expect(view!.groups.map((g) => g.offerType)).toEqual([
      "subscription",
      "free",
      "rent",
      "buy",
    ]);
    expect(view!.groups.map((g) => g.label)).toEqual([
      "Assinatura",
      "Grátis",
      "Aluguel",
      "Compra",
    ]);
  });

  it("ordena dentro do grupo por provedor asc e depois qualidade desc", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Zeta", providerKey: "zeta", deepLink: "https://z.example/1" }),
      row({ providerName: "Alfa", providerKey: "alfa-sd", deepLink: "https://a.example/sd", quality: "sd" }),
      row({ providerName: "Alfa", providerKey: "alfa-uhd", deepLink: "https://a.example/uhd", quality: "uhd" }),
    ]);
    const offers = view!.groups[0]!.offers;
    expect(offers.map((o) => o.providerName)).toEqual(["Alfa", "Alfa", "Zeta"]);
    // Mesmo provedor: qualidade mais alta primeiro (uhd antes de sd).
    expect(offers[0]!.quality).toBe("uhd");
    expect(offers[1]!.quality).toBe("sd");
  });
});

describe("buildWatchAvailabilityView — preco e dedupe", () => {
  it("mostra preco (moeda+valor) em aluguel/compra quando existe", () => {
    const view = buildWatchAvailabilityView([
      row({ offerType: "rent", providerKey: "g", deepLink: "https://g.example/r", priceAmount: "12.90", currency: "BRL" }),
      row({ offerType: "buy", providerKey: "g2", deepLink: "https://g.example/b", priceAmount: "39.90", currency: "USD" }),
    ]);
    const rent = view!.groups.find((g) => g.offerType === "rent")!.offers[0]!;
    const buy = view!.groups.find((g) => g.offerType === "buy")!.offers[0]!;
    expect(rent.priceLabel).toBe("R$ 12.90");
    expect(buy.priceLabel).toBe("US$ 39.90");
  });

  it("nao mostra preco em assinatura mesmo com valor presente", () => {
    const view = buildWatchAvailabilityView([
      row({ offerType: "subscription", priceAmount: "55.90", currency: "BRL" }),
    ]);
    expect(view!.groups[0]!.offers[0]!.priceLabel).toBeNull();
  });

  it("usa o codigo da moeda quando nao ha simbolo mapeado", () => {
    const view = buildWatchAvailabilityView([
      row({ offerType: "rent", deepLink: "https://x.example/r", priceAmount: "10", currency: "gbp" }),
    ]);
    expect(view!.groups[0]!.offers[0]!.priceLabel).toBe("10 GBP");
  });

  it("deduplica ofertas identicas (provider/offerType/link/quality/price)", () => {
    const view = buildWatchAvailabilityView([
      row({ offerType: "rent", providerKey: "g", deepLink: "https://g.example/r", quality: "hd", priceAmount: "9.90", currency: "BRL" }),
      row({ offerType: "rent", providerKey: "g", deepLink: "https://g.example/r", quality: "hd", priceAmount: "9.90", currency: "BRL" }),
    ]);
    expect(view!.groups[0]!.offers).toHaveLength(1);
  });
});

describe("buildWatchAvailabilityView — vazio e frescor", () => {
  it("retorna null quando nao ha nenhuma oferta valida", () => {
    expect(buildWatchAvailabilityView([])).toBeNull();
    expect(
      buildWatchAvailabilityView([
        row({ displayAllowed: false }),
        row({ offerType: "addon" }),
        row({ deepLink: null }),
      ]),
    ).toBeNull();
  });

  it("deriva o carimbo pelo fetched_at mais recente das ofertas incluidas", () => {
    const view = buildWatchAvailabilityView([
      row({ providerKey: "a", deepLink: "https://a/1", fetchedAtIso: "2026-05-01T00:00:00Z" }),
      row({ providerKey: "b", deepLink: "https://b/1", fetchedAtIso: "2026-06-20T00:00:00Z" }),
    ]);
    expect(view!.updatedAtLabel).toBe("Atualizado em 20/06/2026");
  });

  it("sem fetched_at -> sem carimbo, mas com grupos", () => {
    const view = buildWatchAvailabilityView([row()]);
    expect(view!.groups).toHaveLength(1);
    expect(view!.updatedAtLabel).toBeNull();
  });
});

/**
 * Atribuicao obrigatoria (invariante 6). A licenca do agregador exige
 * `requires_attribution` + `requires_linkback` e a matriz legal registra
 * "atribuicao junto ao painel": exibir a oferta sem o credito e uso NAO
 * licenciado, nao um detalhe cosmetico.
 */
describe("buildWatchAvailabilityView — atribuicao obrigatoria", () => {
  it("expoe o credito das ofertas exibidas", () => {
    const view = buildWatchAvailabilityView([row()]);
    expect(view!.attributions).toEqual([
      {
        text: "Disponibilidade fornecida por Movie of the Night",
        url: "https://www.movieofthenight.com/",
      },
    ]);
  });

  /**
   * REESCRITOS em 2026-08-13. Os tres testes abaixo exigiam que o presenter
   * DESCARTASSE a oferta sem credito na linha.
   *
   * Decisao do proprietario: o credito passou a viver no rodape global, e o
   * rodape o deriva das ORIGENS declaradas em `services/legal`
   * (`STREAMING_ORIGIN_CREDITS`), nao da linha. Entao a oferta deixou de ser
   * recusada por isso — o que ela carrega continua sendo preservado como
   * proveniencia.
   *
   * O caminho de ESCRITA nao foi afrouxado: o trigger
   * `watch_availability_display_guard` continua recusando a linha sem licenca e
   * credito. E a presenca do credito na pagina e provada em
   * `footer-credits.test.tsx`.
   */
  it("oferta sem texto de atribuicao NAO e mais descartada", () => {
    const semTexto = buildWatchAvailabilityView([row({ attributionText: null })]);
    expect(semTexto).not.toBeNull();
    expect(semTexto!.groups[0]!.offers[0]!.providerName).toBe("Netflix");
    // Ausencia nao vira credito vazio: a lista de proveniencia fica sem entrada.
    expect(semTexto!.attributions).toEqual([]);

    const soEspacos = buildWatchAvailabilityView([row({ attributionText: "   " })]);
    expect(soEspacos).not.toBeNull();
    expect(soEspacos!.attributions).toEqual([]);
  });

  it("oferta sem linkback de credito NAO e mais descartada", () => {
    const view = buildWatchAvailabilityView([row({ attributionUrl: null })]);
    expect(view).not.toBeNull();
    expect(view!.attributions).toEqual([
      { text: "Disponibilidade fornecida por Movie of the Night", url: null },
    ]);
  });

  it("O QUE NAO MUDOU: oferta sem DESTINO continua descartada", () => {
    // A distincao que a migracao de creditos nao podia borrar: `attribution_url`
    // e o linkback para a FONTE (mudou de lugar); `deep_link`/`web_url` sao para
    // onde a pessoa vai ASSISTIR. Oferta sem destino nao e falta de credito — e
    // um clique cego, e continua fora do ar.
    expect(
      buildWatchAvailabilityView([row({ deepLink: null, webUrl: null })]),
    ).toBeNull();
  });

  it("exibe sem credito apenas quando a licenca dispensa explicitamente", () => {
    const view = buildWatchAvailabilityView([
      row({
        requiresAttribution: false,
        requiresLinkback: false,
        attributionText: null,
        attributionUrl: null,
      }),
    ]);
    expect(view!.groups).toHaveLength(1);
    expect(view!.attributions).toEqual([]);
  });

  it("aceita credito sem link quando so o linkback e dispensado", () => {
    const view = buildWatchAvailabilityView([
      row({ requiresLinkback: false, attributionUrl: null }),
    ]);
    expect(view!.attributions).toEqual([
      { text: "Disponibilidade fornecida por Movie of the Night", url: null },
    ]);
  });

  /**
   * REESCRITO em 2026-08-13. O fail-closed original protegia o gate de credito
   * DO PRESENTER, que deixou de existir quando o credito mudou para o rodape.
   *
   * O fail-closed que continua valendo e o da LICENCA (`displayAllowed`), e ele
   * nao foi tocado: e o unico campo cuja ausencia ainda derruba a oferta.
   */
  it("FAIL-CLOSED que sobreviveu: licenca ausente conta como negada, nao como liberada", () => {
    const semLicenca = {
      ...row(),
      displayAllowed: undefined,
    } as unknown as WatchAvailabilityRow;
    expect(buildWatchAvailabilityView([semLicenca])).toBeNull();

    // Controle positivo: a MESMA fixture, com a licenca presente, vai ao ar.
    expect(buildWatchAvailabilityView([row()])).not.toBeNull();
  });

  it("deduplica creditos iguais entre varias ofertas", () => {
    const view = buildWatchAvailabilityView([
      row({ providerKey: "a", providerName: "A", deepLink: "https://a/1" }),
      row({ providerKey: "b", providerName: "B", deepLink: "https://b/1" }),
    ]);
    expect(view!.attributions).toHaveLength(1);
  });

  it("nao arrasta credito de oferta descartada (credito orfao)", () => {
    const view = buildWatchAvailabilityView([
      // Descartada pelo gate de licenca — seu credito nao pode aparecer.
      row({
        providerKey: "bloqueado",
        providerName: "Bloqueado",
        deepLink: "https://bloqueado/1",
        displayAllowed: false,
        attributionText: "Credito que nao deve aparecer",
      }),
      row(),
    ]);
    const texts = view!.attributions.map((a) => a.text);
    expect(texts).not.toContain("Credito que nao deve aparecer");
    expect(texts).toEqual(["Disponibilidade fornecida por Movie of the Night"]);
  });
});

describe("selectTickerWatchOffer", () => {
  it("escolhe UMA oferta na prioridade canonica (assinatura antes de aluguel)", () => {
    const offer = selectTickerWatchOffer([
      row({ providerName: "Aluga", providerKey: "aluga", offerType: "rent" }),
      row({ providerName: "Assina", providerKey: "assina", offerType: "subscription" }),
    ]);
    expect(offer?.providerKey).toBe("assina");
    expect(offer?.offerType).toBe("subscription");
  });

  it("desempata de forma DETERMINISTICA por nome do provedor (nunca popularidade)", () => {
    const offer = selectTickerWatchOffer([
      row({ providerName: "Zeta", providerKey: "zeta" }),
      row({ providerName: "Alfa", providerKey: "alfa" }),
    ]);
    expect(offer?.providerName).toBe("Alfa");
  });

  it("carrega o credito DA OFERTA escolhida (a licenca que autoriza obriga creditar)", () => {
    const offer = selectTickerWatchOffer([row()]);
    expect(offer?.attribution).toEqual({
      text: "Disponibilidade fornecida por Movie of the Night",
      url: "https://www.movieofthenight.com/",
    });
  });

  it("null quando a oferta nao pode ser exibida (gate de licenca, invariante 6)", () => {
    expect(selectTickerWatchOffer([row({ displayAllowed: false })])).toBeNull();
  });

  /**
   * REESCRITO em 2026-08-13: a faixa da home tambem parou de creditar. O credito
   * ali era ainda mais fragil que nos paineis — acompanhava o slide ATIVO, entao
   * trocar de slide trocava o credito. O rodape nao pisca.
   */
  it("credito ausente na linha NAO derruba mais a oferta da faixa", () => {
    expect(selectTickerWatchOffer([row({ attributionText: null })])).not.toBeNull();
    expect(selectTickerWatchOffer([row({ attributionUrl: null })])).not.toBeNull();
  });

  it("null para modalidade ilegal/desconhecida e para deep link nao http(s)", () => {
    expect(selectTickerWatchOffer([row({ offerType: "addon" })])).toBeNull();
    expect(selectTickerWatchOffer([row({ deepLink: "magnet:?xt=urn:btih:abc" })])).toBeNull();
  });

  it("null quando nao ha oferta nenhuma", () => {
    expect(selectTickerWatchOffer([])).toBeNull();
  });
});
