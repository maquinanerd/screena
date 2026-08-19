/**
 * watch-destination-notice.test.tsx — Para onde o clique leva, dito por escrito.
 *
 * O DEFEITO. Pelo caminho TMDB/JustWatch nao existe deep link por oferta: o
 * destino e a pagina de disponibilidade daquele titulo, nao o servico. Isso ja
 * viajava com a oferta (`destinationKind`) e chegava ao `aria-label` e a um
 * `data-destination-kind` — que nao tinha UMA regra de CSS. Resultado: quem usa
 * leitor de tela era avisado; quem enxerga clicava no nome do servico e caia noutro
 * lugar sem aviso nenhum.
 *
 * O CRITERIO E EMPRESTADO, DE PROPOSITO. A fileira de notas ja tinha fixado
 * que credito precisa ser TEXTO VISIVEL — os testes do gate exercitavam o
 * presenter e nenhum deles falharia se o credito fosse para um tooltip. Aqui
 * vale o mesmo: informacao que muda o que o leitor espera nao pode viver so em
 * atributo de acessibilidade. Este arquivo aplica a regra de uma PR a outra.
 *
 * PLATAFORMAS FICTICIAS nas fixtures ("Exemploflix", "Fictifilmes"). Nao e
 * estilo: `audit:invariants` proibe literal de plataforma REAL em qualquer
 * `.tsx` de `app/_components/` — a guarda existe para que nenhum componente
 * compartilhado carregue plataforma embutida, e um teste que morasse ali com
 * "Netflix" no fonte a violaria. O que este arquivo prova nao depende do nome.
 *
 * CONTENCAO SEM jsdom, como no teste do credito: a marcacao estatica e fatiada
 * por oferta e a precondicao do corte e VERIFICADA antes de qualquer assercao
 * depender dela.
 *
 * O CORTE MUDOU DE ANCORA EM 2026-08-19, e o motivo importa. Ele fatiava por
 * `<li class="watch-offer"`. Com o agrupamento por marca, o `<li>` passou a ser
 * a MARCA — que pode conter varias rotas, cada uma com seu `<a>`. Ancorar no
 * `<li>` mediria "uma marca" onde este arquivo quer medir "uma oferta", e o
 * aviso de destino pertence a OFERTA.
 *
 * A ancora nova e o proprio `<a class="watch-offer__link"`, que e exatamente a
 * unidade que este arquivo sempre quis: o link em que o leitor clica. A
 * precondicao tambem ficou mais forte — `<a>` nao aninha, e isso e VERIFICADO.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WatchAvailabilityPanel } from "../watch-availability-panel";
import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
} from "../../../src/lib/watch-availability-presenter";

const OFFER_OPEN = '<a class="watch-offer__link"';
const NOTICE = "página de disponibilidade";

/** Oferta da RapidAPI: deep link por oferta -> destino no PROVEDOR. */
function providerRow(over: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: "Exemploflix",
    providerKey: "exemploflix",
    providerSlug: "exemploflix",
    offerType: "subscription",
    deepLink: "https://www.netflix.com/title/1",
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: "2026-08-01T00:00:00.000Z",
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Disponibilidade fornecida por Movie of the Night",
    attributionUrl: "https://www.movieofthenight.com/about/api",
    ...over,
  };
}

/** Oferta do TMDB: so o link por pais -> destino no AGREGADOR. */
function aggregatorRow(over: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: "Fictifilmes",
    providerKey: "4242",
    providerSlug: "fictifilmes",
    offerType: "subscription",
    deepLink: null,
    webUrl: "https://www.themoviedb.org/movie/550/watch?locale=BR",
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: "2026-08-02T00:00:00.000Z",
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Disponibilidade fornecida por JustWatch",
    attributionUrl: "https://www.justwatch.com/",
    ...over,
  };
}

function render(rows: WatchAvailabilityRow[]): string {
  const view = buildWatchAvailabilityView(rows);
  return renderToStaticMarkup(<WatchAvailabilityPanel view={view} />);
}

/**
 * TEXTO VISIVEL de um trecho de marcacao: tags fora, ATRIBUTOS junto com elas.
 *
 * Isto nao e detalhe. A frase do aviso e a MESMA do `aria-label` (de proposito
 * — uma string so), entao `markup.includes(NOTICE)` fica VERDE mesmo com o
 * texto visivel removido: o `aria-label` sozinho satisfaz a busca. Um controle
 * negativo real pegou isso aqui: removi o `<span>` do componente e 4 das 5
 * assercoes continuaram passando. Toda assercao de visibilidade neste arquivo
 * passa por esta funcao, e nunca pelo markup cru.
 */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ");
}

/**
 * Fatia a marcacao por OFERTA — um `<a class="watch-offer__link">` por oferta.
 *
 * A precondicao (nenhuma ancora aninhada) e VERIFICADA, nao suposta: se um
 * refactor aninhasse `<a>`, o corte silenciosamente juntaria duas ofertas numa
 * fatia so e a assercao de contencao ("o aviso nao vaza para a vizinha")
 * passaria sem medir nada.
 */
function offerSlices(markup: string): string[] {
  const parts = markup.split(OFFER_OPEN).slice(1);
  for (const part of parts) {
    const end = part.indexOf("</a>");
    if (end === -1) {
      throw new Error("precondicao do corte violada: <a> de oferta sem fechamento");
    }
    if (part.slice(0, end).includes("<a ")) {
      throw new Error("precondicao do corte violada: ha <a> aninhado na oferta");
    }
  }
  return parts.map((part) => OFFER_OPEN + part.slice(0, part.indexOf("</a>")));
}

describe("CONTROLE POSITIVO das fixtures", () => {
  it("cada fixture, sozinha, PRODUZ painel com UMA oferta", () => {
    expect(offerSlices(render([providerRow()]))).toHaveLength(1);
    expect(offerSlices(render([aggregatorRow()]))).toHaveLength(1);
  });

  it("as duas fixtures declaram naturezas de destino DIFERENTES", () => {
    expect(render([providerRow()])).toContain('data-destination-kind="provider"');
    expect(render([aggregatorRow()])).toContain('data-destination-kind="aggregator"');
  });
});

describe("destino no agregador: o aviso e TEXTO VISIVEL, dentro do link", () => {
  it("CONTROLE NEGATIVO DA PROPRIA ASSERCAO: o markup cru nao prova nada", () => {
    // O `aria-label` carrega a mesma frase. Se o teste olhasse markup cru, ele
    // ficaria verde com o texto visivel apagado — foi o que aconteceu. Esta
    // assercao existe para que a armadilha nao volte despercebida.
    const semTexto = render([aggregatorRow()]).replace(
      /<span class="watch-offer__destination">[^<]*<\/span>/g,
      "",
    );
    expect(semTexto).toContain(NOTICE); // markup cru: passa MESMO sem o aviso
    expect(visibleText(semTexto)).not.toContain(NOTICE); // texto visivel: reprova
  });

  it("o aviso aparece no TEXTO VISIVEL", () => {
    expect(visibleText(render([aggregatorRow()]))).toContain(NOTICE);
  });

  it("CONTENCAO: o aviso esta DENTRO da oferta a que pertence", () => {
    const slice = offerSlices(render([aggregatorRow()]))[0]!;
    expect(visibleText(slice)).toContain(NOTICE);
    expect(visibleText(slice)).toContain("Fictifilmes");
  });

  it("CONTENCAO: o aviso esta dentro do proprio <a>, nao solto na secao", () => {
    // A fatia JA e o `<a>` (ver `offerSlices`). O que esta assercao acrescenta e
    // o complemento: fora das ancoras nao sobra aviso nenhum. Sem isso, um
    // aviso duplicado solto na secao passaria despercebido.
    const markup = render([aggregatorRow()]);
    const slice = offerSlices(markup)[0]!;
    expect(visibleText(slice)).toContain(NOTICE);
    const foraDasAncoras = markup.split(OFFER_OPEN)[0]!;
    expect(visibleText(foraDasAncoras)).not.toContain(NOTICE);
  });

  it("o aria-label continua onde estava — ele nao estava errado, estava sozinho", () => {
    expect(render([aggregatorRow()])).toContain("abrir página de disponibilidade");
  });
});

describe("destino no provedor: nada muda (o NEGATIVO)", () => {
  it("oferta com deep link NAO carrega o aviso", () => {
    const slice = offerSlices(render([providerRow()]))[0]!;
    expect(visibleText(slice)).not.toContain(NOTICE);
  });

  it("o painel inteiro so com ofertas de provedor nao tem o aviso em lugar nenhum", () => {
    expect(visibleText(render([providerRow()]))).not.toContain(NOTICE);
  });

  it("continua prometendo abrir no servico", () => {
    expect(render([providerRow()])).toContain("abrir no serviço");
  });
});

describe("as duas naturezas no mesmo painel", () => {
  const markup = render([providerRow(), aggregatorRow()]);
  const slices = offerSlices(markup);

  it("as duas ofertas aparecem (plataformas diferentes nao rivalizam)", () => {
    expect(slices).toHaveLength(2);
  });

  it("o aviso fica so na oferta do agregador — NUNCA vaza para a vizinha", () => {
    const comAviso = slices.filter((slice) => visibleText(slice).includes(NOTICE));
    expect(comAviso).toHaveLength(1);
    expect(visibleText(comAviso[0]!)).toContain("Fictifilmes");
    expect(visibleText(comAviso[0]!)).not.toContain("Exemploflix");
  });
});

describe("o aviso nomeia o DESTINO, nunca o fornecedor tecnico", () => {
  /**
   * Escrever "via TMDB" colocaria o `provider_api` na cara do leitor como se
   * fosse a fonte. A fonte creditada e o JustWatch — e `provider_api` nunca e
   * fonte editorial (invariante 2).
   */
  it("nao cita TMDB nem RapidAPI na superficie visivel", () => {
    expect(visibleText(render([aggregatorRow()]))).not.toMatch(/TMDB|RapidAPI|themoviedb/i);
  });

  /**
   * REESCRITO em 2026-08-13: o credito da origem saiu do painel e passou a viver
   * no rodape global (decisao do proprietario). A presenca dele na PAGINA e
   * provada em `footer-credits.test.tsx`; aqui prova-se que ele nao ficou para
   * tras neste painel, o que duplicaria o credito.
   */
  it("o credito da origem NAO fica no painel: ele vive no rodape", () => {
    const texto = visibleText(render([aggregatorRow()]));
    // Controle positivo: a oferta realmente foi renderizada.
    expect(texto).toContain("Disponibilidade no Brasil");
    expect(texto).not.toContain("Disponibilidade fornecida por JustWatch");
    expect(texto).not.toContain("Disponibilidade fornecida por");
  });
});
