/**
 * footer-newsletter-gate.test.tsx — "A FAIXA SO EXISTE SE A INSCRICAO PUDER DAR
 * CERTO — E A AUSENCIA DIZ POR QUE."
 *
 * Decisao do proprietario (Pablo Eduardo, 13/08/2026): a faixa de newsletter nao
 * renderiza enquanto nao houver onde guardar a inscricao. O formulario, os tres
 * estados e os testes continuam existindo, atras de flag.
 *
 * O QUE ESTE ARQUIVO TRAVA, E POR QUE CADA METADE SOZINHA NAO BASTA:
 *
 *  - so "a faixa some" => ausencia MUDA. Ninguem descobre se e decisao ou
 *    defeito, e a #163 ja mostrou que ausencia muda custa mais caro que o bloco
 *    vazio que ela evita;
 *  - so "o log sai" => a faixa continuaria no ar prometendo o que nao cumpre.
 *
 * Por isso as duas sao afirmadas na MESMA assertion (`toEqual({ markup, logs })`).
 * Um teste que olhasse so o DOM ficaria verde sobre a ausencia muda.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SiteFooter } from "../site-footer";
import { isNewsletterEnabled } from "../../../src/lib/site";

/**
 * Renderiza o rodape capturando o que ele DIZ e o que ele MOSTRA.
 *
 * `console.warn` e onde o `SectionBoundary` escreve. Capturar aqui e o que
 * permite afirmar os dois fatos juntos.
 */
function renderFooter(): { markup: string; logs: string[] } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
    const texto = String(line);
    // FILTRA PELA SECAO, e o motivo importa: este arquivo afirma "a faixa some
    // E diz por que" comparando a lista INTEIRA de logs com `[ABSENCE_LOG]`. O
    // rodape passou a poder emitir uma segunda ausencia legitima e sem relacao
    // (`creditos-de-dados`/`source_logo_asset_missing`, quando a licenca exige
    // a marca de uma fonte e o arquivo oficial ainda nao esta no repositorio), e
    // a igualdade de lista quebrava por causa dela.
    //
    // Estreitar o ESCOPO, nunca afrouxar a asserçao: continua sendo igualdade
    // exata, e continua reprovando se a faixa sumir calada. So deixou de
    // afirmar, de lado, que o rodape inteiro nunca loga mais nada — o que nunca
    // foi o assunto deste arquivo.
    if (!texto.includes('"section":"newsletter"')) return;
    logs.push(texto);
  });
  try {
    return { markup: renderToStaticMarkup(<SiteFooter />), logs };
  } finally {
    spy.mockRestore();
  }
}

/** A faixa esta na tela? Medida pelo formulario, nao pelo titulo. */
function hasNewsletterBand(markup: string): boolean {
  return markup.includes('class="footer-newsletter__form"');
}

const ABSENCE_LOG = JSON.stringify({
  event: "section_absent",
  section: "newsletter",
  reason: "newsletter_storage_unavailable",
  surface: "footer",
  actionable: true,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isNewsletterEnabled — flag fail-closed", () => {
  it('so "true" e "1" ligam', () => {
    expect(isNewsletterEnabled({ CINERIE_NEWSLETTER_ENABLED: "1" })).toBe(true);
    expect(isNewsletterEnabled({ CINERIE_NEWSLETTER_ENABLED: "true" })).toBe(true);
    expect(isNewsletterEnabled({ CINERIE_NEWSLETTER_ENABLED: "TRUE" })).toBe(true);
  });

  it("ausente, vazio, invalido ou negado DESLIGAM", () => {
    // Fail-closed literal: na duvida, nao promete uma inscricao que ninguem guarda.
    expect(isNewsletterEnabled({})).toBe(false);
    for (const raw of ["", "  ", "0", "false", "sim", "yes", "on"]) {
      expect(isNewsletterEnabled({ CINERIE_NEWSLETTER_ENABLED: raw }), raw).toBe(false);
    }
  });

  it("NAO herda a flag de indexacao (eixos diferentes)", () => {
    // Amarrar as duas faria a newsletter acender em producao so porque a
    // indexacao foi ligada — uma pergunta ("pode aparecer no Google?") nao
    // responde a outra ("existe onde guardar?").
    expect(isNewsletterEnabled({ CINERIE_PUBLIC_INDEXING_ENABLED: "1" })).toBe(false);
  });
});

describe("a faixa some E diz por que (os dois fatos, na mesma assertion)", () => {
  it("flag DESLIGADA: sem faixa no DOM, com o motivo acionavel no log", () => {
    vi.stubEnv("CINERIE_NEWSLETTER_ENABLED", "");

    const { markup, logs } = renderFooter();

    expect({
      faixa: hasNewsletterBand(markup),
      logs,
    }).toEqual({
      faixa: false,
      logs: [ABSENCE_LOG],
    });
  });

  it("o log sai UMA vez por processo, nao uma por request", () => {
    // O rodape renderiza em TODA pagina. Sem isto, uma ausencia constante
    // emitiria uma linha por pageview e afogaria o log inteiro — o proprio
    // contrato de `section-absence.ts` avisa sobre esse ruido.
    //
    // A primeira renderizacao ja aconteceu no teste acima (mesmo processo),
    // entao aqui NAO deve sair nenhuma linha nova.
    vi.stubEnv("CINERIE_NEWSLETTER_ENABLED", "");

    const primeira = renderFooter();
    const segunda = renderFooter();

    expect({ primeira: primeira.logs, segunda: segunda.logs }).toEqual({
      primeira: [],
      segunda: [],
    });
    // CONTROLE POSITIVO: o silencio acima e deduplicacao, nao rodape quebrado.
    expect(hasNewsletterBand(primeira.markup)).toBe(false);
    expect(primeira.markup).toContain("footer__credits");
  });

  it("flag LIGADA: a faixa volta inteira, e o log para", () => {
    // CONTROLE POSITIVO do gate: sem este teste, um rodape que nunca renderiza a
    // faixa (por bug, nao por decisao) passaria nos negativos acima.
    vi.stubEnv("CINERIE_NEWSLETTER_ENABLED", "1");

    const { markup, logs } = renderFooter();

    expect({ faixa: hasNewsletterBand(markup), logs }).toEqual({ faixa: true, logs: [] });
    // E volta INTEIRA: o formulario real, nao um resto dele.
    expect(markup).toContain("Receba a newsletter da Cinerie");
    expect(markup).toContain('type="email"');
    expect(markup).toContain('type="submit"');
    expect(markup).toMatch(/aria-live="polite"/);
  });

  it("com a faixa oculta, o RESTO do rodape continua inteiro", () => {
    // O risco real de esconder um bloco do chrome: levar junto o que estava ao
    // lado. Os creditos de fonte, em especial, sao o unico endereco da
    // atribuicao desde 13/08/2026 — perde-los seria violar licenca.
    vi.stubEnv("CINERIE_NEWSLETTER_ENABLED", "");

    const { markup } = renderFooter();

    expect(hasNewsletterBand(markup)).toBe(false);
    expect(markup).toContain("Nota fornecida por IMDb");
    expect(markup).toContain("Disponibilidade fornecida por JustWatch");
    expect(markup).toContain("nao e endossado ou certificado pelo TMDB");
    expect(markup).toContain("Créditos de dados");
  });
});
