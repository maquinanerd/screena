/**
 * section-boundary.test.tsx — "SUMIU DO DOM" e "REGISTROU O MOTIVO" sao o MESMO
 * fato, e este arquivo os afirma na MESMA assercao.
 *
 * A exigencia e literal: sem provedor autorizado, o bloco fica fora do DOM **e**
 * o log e emitido — os dois, juntos. Um teste que checasse so o DOM ficaria
 * verde sobre a ausencia muda, que e exatamente o defeito. Por isso cada caso
 * abaixo compara UM objeto contendo a marcacao produzida E as linhas de log
 * capturadas.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionBoundary } from "../section-boundary";
import { decideSection } from "../../../src/lib/section-absence";

/** Captura o que a fronteira renderizou E o que ela registrou. */
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

const CONTEXT = {
  section: "onde-assistir",
  reason: "no_authorized_provider",
  entityType: "movie",
  entityId: "43",
} as const;

describe("onde assistir sem provedor autorizado", () => {
  beforeEach(() => {
    // O caminho de PRODUCAO e o que interessa: e la que a ausencia some do DOM.
    vi.stubEnv("NODE_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bloco FORA do DOM **e** log emitido — na mesma assercao", () => {
    const decision = decideSection(null, CONTEXT);

    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decision}>
          {() => <div className="watch-block">Onde assistir</div>}
        </SectionBoundary>,
      ),
    );

    expect(observed).toEqual({
      // Nada no DOM: nem heading, nem "sem ofertas", nem andaime.
      markup: "",
      // E o motivo registrado, com a entidade que permite achar o titulo.
      logs: [
        JSON.stringify({
          event: "section_absent",
          section: "onde-assistir",
          reason: "no_authorized_provider",
          entityType: "movie",
          entityId: "43",
          actionable: true,
        }),
      ],
    });
  });

  it("lista VAZIA conta como ausencia (nunca secao com titulo e nenhum item)", () => {
    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decideSection([], CONTEXT)}>
          {() => <div>ofertas</div>}
        </SectionBoundary>,
      ),
    );
    expect(observed.markup).toBe("");
    expect(observed.logs).toHaveLength(1);
  });

  it("CONTROLE POSITIVO: com dado, renderiza e NAO registra nada", () => {
    // Sem este caso, os testes acima passariam mesmo se a fronteira estivesse
    // quebrada de forma a nunca renderizar coisa nenhuma.
    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decideSection(["netflix"], CONTEXT)}>
          {(offers) => <div className="watch-block">{offers.join(",")}</div>}
        </SectionBoundary>,
      ),
    );

    expect(observed).toEqual({
      markup: '<div class="watch-block">netflix</div>',
      logs: [],
    });
  });
});

describe("acionavel: separa passo de operacao pendente de fato sobre o titulo", () => {
  it("registro de provedores nao populado e acionavel", () => {
    expect(decideSection(null, CONTEXT).absence!.actionable).toBe(true);
  });

  it("titulo que simplesmente nao esta em nenhum streaming NAO e acionavel", () => {
    const decision = decideSection(null, { ...CONTEXT, reason: "no_offer_for_entity" });
    expect(decision.absence!.actionable).toBe(false);
  });
});

describe("em desenvolvimento a ausencia tambem e VISIVEL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("aviso no DOM alem do log — quem monta a pagina ve o buraco", () => {
    vi.stubEnv("NODE_ENV", "development");
    const observed = observe(() =>
      renderToStaticMarkup(
        <SectionBoundary decision={decideSection(null, CONTEXT)}>
          {() => <div>bloco</div>}
        </SectionBoundary>,
      ),
    );

    expect(observed.markup).toContain('data-section-absent="onde-assistir"');
    expect(observed.markup).toContain('data-section-absent-reason="no_authorized_provider"');
    expect(observed.logs).toHaveLength(1);
    // O aviso de dev nunca finge ser conteudo.
    expect(observed.markup).not.toContain("Onde assistir");
  });
});
