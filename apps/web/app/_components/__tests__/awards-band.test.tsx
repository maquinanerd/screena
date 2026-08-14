/**
 * awards-band.test.tsx — A faixa de premios no DOM.
 *
 * DUAS COISAS QUE SO UM TESTE DE MARCACAO PEGA
 * --------------------------------------------
 * 1. CONTENCAO DO CREDITO. O gate de leitura (`entity-awards.ts`) prova que uma
 *    faixa sem `attribution_text` nao chega ao componente. Nenhuma assercao la
 *    falharia se alguem movesse o credito para o rodape da pagina ou para um
 *    tooltip. Aqui a exigencia e de CONTENCAO: o credito esta DENTRO do
 *    `<section class="awards-band">`, no mesmo bloco visual do fato.
 * 2. O NOME DO PREMIO CHEGA INTEIRO A TELA. O presenter e testado a parte, mas
 *    so aqui se ve o texto RENDERIZADO.
 *
 * TEXTO VISIVEL, NUNCA MARCACAO CRUA. `markup.includes(...)` fica verde quando
 * a frase aparece so num `aria-label` ou num atributo — foi assim que quatro
 * assercoes passaram pelo motivo errado na PR #165. Toda assercao de
 * visibilidade aqui passa por `visibleText`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AwardsBand, type AwardsCredit } from "../awards-band";
import { SectionBoundary } from "../section-boundary";
import {
  buildAwardsViewFromRaw,
  type AwardsView,
} from "../../../src/lib/awards-presenter";
import { decideSection } from "../../../src/lib/section-absence";

/** Remove TODAS as tags: sobra so o que o leitor le. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, " ");
}

const CREDIT: AwardsCredit = {
  text: "Premiacao fornecida por Fonte Fictícia",
  url: "https://exemplo.invalid/premios",
};

function render(raw: string, credit: AwardsCredit = CREDIT): string {
  const view = buildAwardsViewFromRaw(raw);
  if (view === null) throw new Error(`fixture invalida: "${raw}" nao e reconhecida`);
  return renderToStaticMarkup(<AwardsBand credit={credit} vertical="movie" view={view} />);
}

describe("a faixa, quando ha fato e credito", () => {
  it("escreve a frase em pt-BR com o nome do premio intacto", () => {
    const text = visibleText(render("Won 4 Oscars. 160 wins & 220 nominations total"));
    expect(text).toContain("Venceu 4 Oscars");
    expect(text).toContain("160 vitórias · 220 indicações");
    // Controle negativo: a frase da FONTE nao vaza para a tela em ingles.
    expect(text).not.toContain("Won 4 Oscars");
    expect(text).not.toContain("nominations total");
  });

  it("o CREDITO esta DENTRO da faixa, nao no rodape", () => {
    const markup = render("Won 4 Oscars. 160 wins & 220 nominations total");
    const open = markup.indexOf("<section");
    const close = markup.indexOf("</section>");
    expect(open).toBeGreaterThanOrEqual(0);
    expect(close).toBeGreaterThan(open);
    const inside = markup.slice(open, close);
    expect(visibleText(inside)).toContain(CREDIT.text);
  });

  it("o linkback vira link de verdade quando existe", () => {
    const markup = render("Won 4 Oscars. 160 wins & 220 nominations total");
    expect(markup).toContain(`href="${CREDIT.url}"`);
  });

  it("sem linkback o credito continua visivel, so que em texto", () => {
    const markup = render("Won 4 Oscars. 160 wins & 220 nominations total", {
      text: CREDIT.text,
      url: null,
    });
    expect(visibleText(markup)).toContain(CREDIT.text);
    expect(markup).not.toContain("<a ");
  });
});

describe("a faixa NAO renderiza", () => {
  it("sem credito textual — nunca existe faixa sem credito", () => {
    const view = buildAwardsViewFromRaw("Won 4 Oscars. 160 wins & 220 nominations total")!;
    for (const text of ["", "   "]) {
      const markup = renderToStaticMarkup(
        <AwardsBand credit={{ text, url: null }} vertical="movie" view={view} />,
      );
      expect(markup).toBe("");
    }
  });

  it("sem destaque e sem contagem — nao ha o que dizer", () => {
    const markup = renderToStaticMarkup(
      <AwardsBand
        credit={CREDIT}
        vertical="series"
        view={{ headline: null, tally: { wins: null, nominations: null, label: null } }}
      />,
    );
    expect(markup).toBe("");
  });
});

/**
 * "SUMIU DO DOM" e "REGISTROU O MOTIVO" sao o MESMO fato, e sao afirmados na
 * MESMA assercao. Um teste que checasse so o DOM ficaria verde sobre a ausencia
 * muda — que e exatamente o defeito.
 */
describe("sem dado, a faixa some E o motivo vai para o log", () => {
  beforeEach(() => {
    // O caminho de PRODUCAO e o que importa: e la que a ausencia sai do DOM.
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function observe(render: () => string): { markup: string; logs: string[] } {
    const logs: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    try {
      return { markup: render(), logs };
    } finally {
      spy.mockRestore();
    }
  }

  /** O que a fronteira entregaria se houvesse faixa (espelha `AwardsPanelView`). */
  type AwardsPanel = { view: AwardsView; credit: AwardsCredit };

  const CONTEXT = {
    section: "premios",
    entityType: "movie",
    entityId: "43",
  } as const;

  it("licenca de premiacao nao decidida: DOM vazio + no_awards_source (acionavel)", () => {
    const decision = decideSection<AwardsPanel>(null, { ...CONTEXT, reason: "no_awards_source" });

    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decision}>
          {(panel) => (
            <AwardsBand credit={panel.credit} vertical="movie" view={panel.view} />
          )}
        </SectionBoundary>,
      ),
    );

    expect({ markup: observed.markup, logs: observed.logs }).toEqual({
      markup: "",
      logs: [
        JSON.stringify({
          event: "section_absent",
          section: "premios",
          reason: "no_awards_source",
          entityType: "movie",
          entityId: "43",
          actionable: true,
        }),
      ],
    });
  });

  it("titulo sem premio: DOM vazio + no_awards_for_entity (NAO acionavel)", () => {
    // A diferenca entre os dois motivos e a diferenca entre "alguem precisa
    // decidir a licenca" e "este filme nao ganhou nada". Na tela sao iguais.
    const decision = decideSection<AwardsPanel>(null, { ...CONTEXT, reason: "no_awards_for_entity" });

    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decision}>
          {(panel) => (
            <AwardsBand credit={panel.credit} vertical="movie" view={panel.view} />
          )}
        </SectionBoundary>,
      ),
    );

    expect({ markup: observed.markup, logs: observed.logs }).toEqual({
      markup: "",
      logs: [
        JSON.stringify({
          event: "section_absent",
          section: "premios",
          reason: "no_awards_for_entity",
          entityType: "movie",
          entityId: "43",
          actionable: false,
        }),
      ],
    });
  });
});
