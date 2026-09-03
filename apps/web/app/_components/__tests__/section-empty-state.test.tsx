/**
 * section-empty-state.test.tsx — a ausencia fala, e nao mente.
 *
 * ============================================================================
 * O QUE ESTA SUITE PROTEGE
 * ============================================================================
 * A regra antiga cumpria metade: a secao sumia do DOM e o motivo ia para o log.
 * Isso serve a quem OPERA. Para 99,8% das fichas, "Onde assistir" nunca
 * aparecia — e o leitor recebia silencio, que ele nao distingue de "esta pagina
 * nao trata disso".
 *
 * Dar voz a ausencia so vale se a voz for HONESTA, e o risco concreto e uma
 * frase so para duas causas opostas:
 *
 *   `no_offer_for_entity`     temos o dado e ele diz que o titulo nao esta em
 *                             lugar nenhum -> podemos afirmar sobre A OBRA.
 *   `no_authorized_provider`  NENHUMA oferta esta exibivel no catalogo inteiro
 *                             (70.036 com `display_allowed = false` em
 *                             2026-09-01) -> nao sabemos nada sobre este
 *                             titulo, e dizer que ele "nao esta em nenhum
 *                             servico" seria MENTIRA.
 *
 * O teste central e o que exige que as duas frases sejam DIFERENTES.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SectionBoundary } from "../section-boundary";
import { buildSectionAbsence } from "../../../src/lib/section-absence";
import { emptyStateFor } from "../../../src/lib/section-empty-state";
import type { SectionAbsenceReason, SectionKey } from "../../../src/lib/section-absence";

/** O que a PESSOA le: tags fora, espaco colapsado. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absentBoundary(section: SectionKey, reason: SectionAbsenceReason, speak: boolean): string {
  const decision = {
    rendered: false as const,
    value: null,
    absence: buildSectionAbsence({
      entityType: "movie",
      entityId: "1",
      section,
      reason,
    }),
  };
  return renderToStaticMarkup(
    <SectionBoundary decision={decision} speak={speak}>
      {() => <p>o bloco de verdade</p>}
    </SectionBoundary>,
  );
}

describe("as duas causas de disponibilidade NAO podem falar igual", () => {
  it("cada uma tem frase propria", () => {
    const semOferta = emptyStateFor("no_offer_for_entity");
    const semProvedor = emptyStateFor("no_authorized_provider");

    expect(semOferta).not.toBeNull();
    expect(semProvedor).not.toBeNull();

    // A REGRESSAO QUE ISTO PEGA: colapsar as duas numa frase generica
    // ("ainda nao confirmamos onde assistir") passaria em tudo menos aqui.
    expect(semOferta!.text).not.toBe(semProvedor!.text);
  });

  it("so a causa com DADO afirma algo sobre a obra", () => {
    expect(emptyStateFor("no_offer_for_entity")!.text).toMatch(/não encontramos/i);
  });

  it("mas a afirmacao e LIMITADA ao que acompanhamos", () => {
    // Medido em producao em 2026-09-02: a frase aparecia em ~99,8% das fichas,
    // porque `watchAbsenceReasonFor` devolve `no_offer_for_entity` quando existe
    // ao menos UMA oferta exibivel em QUALQUER titulo — sao 833 de 70.869.
    // Afirmar "em nenhum servico" com 1,2% de cobertura era exagero.
    const texto = emptyStateFor("no_offer_for_entity")!.text;
    expect(texto).toMatch(/que acompanhamos/i);
    // A REGRESSAO QUE ISTO PEGA: voltar ao alcance ilimitado.
    expect(texto).not.toMatch(/em nenhum serviço/i);
  });

  it("a causa SEM dado fala de NOS, nunca do titulo", () => {
    const texto = emptyStateFor("no_authorized_provider")!.text;

    // Afirma sobre o nosso estado...
    expect(texto).toMatch(/ainda não temos/i);
    // ...e NUNCA afirma que o titulo nao esta em lugar nenhum. Com 70.036
    // ofertas represadas por licenca, essa frase seria falsa.
    expect(texto).not.toMatch(/não encontramos|não está|nenhum serviço/i);
  });
});

describe("o que a frase nunca faz", () => {
  const reasons: SectionAbsenceReason[] = [
    "no_offer_for_entity",
    "no_authorized_provider",
    "no_authorized_rating",
    "no_season_trailer",
  ];

  it.each(reasons)("%s: nao promete prazo nem cita servico de streaming", (reason) => {
    const texto = emptyStateFor(reason)!.text;

    // "em breve" e um prazo que ninguem se comprometeu a cumprir.
    expect(texto).not.toMatch(/em breve|logo|aguarde/i);
    // Invariantes 6 e 8: nenhum servico e citado sem oferta confirmada.
    expect(texto).not.toMatch(/netflix|prime video|max|disney|globoplay|telecine/i);
  });

  it("motivo sem frase continua sumindo calado", () => {
    // `speak` e um pedido, nao uma garantia. Um motivo de chrome/rota nao
    // ganha voz so porque alguem ligou a flag.
    expect(emptyStateFor("no_cast")).toBeNull();
    expect(emptyStateFor("no_editorial_review")).toBeNull();
  });
});

describe("falar com o leitor nunca substitui falar com quem opera", () => {
  it("o log sai IGUAL, com e sem speak", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    absentBoundary("onde-assistir", "no_authorized_provider", false);
    const semSpeak = warn.mock.calls.length;

    warn.mockClear();
    absentBoundary("onde-assistir", "no_authorized_provider", true);
    const comSpeak = warn.mock.calls.length;

    warn.mockRestore();

    // A REGRESSAO QUE ISTO PEGA: um estado vazio que "resolve" a ausencia e
    // para de registra-la devolveria o defeito que `section-absence.ts`
    // existe para impedir — agora com uma frase bonita por cima.
    expect(semSpeak).toBe(1);
    expect(comSpeak).toBe(1);
  });

  it("sem speak, o bloco continua sem frase nenhuma", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const markup = absentBoundary("avaliacoes", "no_authorized_rating", false);
    warn.mockRestore();

    expect(markup).not.toContain("section-empty");
  });

  it("com speak, a frase entra com a CAUSA no DOM para diagnostico", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const markup = absentBoundary("onde-assistir", "no_offer_for_entity", true);
    warn.mockRestore();

    expect(markup).toContain('data-section-empty="onde-assistir"');
    expect(markup).toContain('data-section-empty-reason="no_offer_for_entity"');
    expect(visibleText(markup)).toMatch(/não encontramos/i);
    // O bloco de verdade continua fora: estado vazio nao imita conteudo.
    expect(markup).not.toContain("o bloco de verdade");
  });
});
