/**
 * dialog-behavior.test.ts — As decisões do modal, sem DOM.
 *
 * O teste com DOM (`app/_components/__tests__/trailer-modal.test.tsx`) prova o
 * comportamento montado. Este prova as REGRAS nos casos de borda que um teste
 * de interação raramente alcança: foco perdido fora da lista, lista vazia,
 * barra de rolagem sobreposta. São exatamente os casos em que um laço de foco
 * quebra em silêncio.
 */

import { describe, expect, it } from "vitest";

import {
  dialogKeyAction,
  DIALOG_FOCUSABLE_SELECTOR,
  nextFocusIndex,
  scrollbarCompensation,
} from "../dialog-behavior";

describe("dialogKeyAction", () => {
  it("ESC fecha (nos dois nomes que navegadores usam)", () => {
    expect(dialogKeyAction("Escape", false)).toBe("close");
    expect(dialogKeyAction("Esc", false)).toBe("close");
  });

  it("Tab anda, Shift+Tab volta", () => {
    expect(dialogKeyAction("Tab", false)).toBe("focus-next");
    expect(dialogKeyAction("Tab", true)).toBe("focus-previous");
  });

  it("NEGATIVO — tecla alheia devolve null e não é interceptada", () => {
    // Um modal que engolisse qualquer tecla quebraria digitação e atalhos.
    for (const key of ["a", "Enter", " ", "ArrowDown", "F5", "Home"]) {
      expect(dialogKeyAction(key, false), key).toBeNull();
    }
  });
});

describe("nextFocusIndex — o laço de foco", () => {
  it("CONTROLE POSITIVO: no meio da lista, anda um para cada lado", () => {
    expect(nextFocusIndex(1, 4, false)).toBe(2);
    expect(nextFocusIndex(1, 4, true)).toBe(0);
  });

  it("do ÚLTIMO, Tab volta ao primeiro (é isso que prende o foco)", () => {
    expect(nextFocusIndex(3, 4, false)).toBe(0);
  });

  it("do PRIMEIRO, Shift+Tab vai ao último", () => {
    expect(nextFocusIndex(0, 4, true)).toBe(3);
  });

  it("foco PERDIDO (fora da lista) volta para dentro, nos dois sentidos", () => {
    // Acontece de verdade: a pessoa clica no fundo, ou um elemento some.
    expect(nextFocusIndex(-1, 4, false)).toBe(0);
    expect(nextFocusIndex(-1, 4, true)).toBe(3);
  });

  it("lista vazia não estoura nem devolve índice inválido", () => {
    expect(nextFocusIndex(-1, 0, false)).toBe(0);
    expect(nextFocusIndex(2, 0, true)).toBe(0);
  });

  it("com UM só focável, o foco fica nele em qualquer direção", () => {
    expect(nextFocusIndex(0, 1, false)).toBe(0);
    expect(nextFocusIndex(0, 1, true)).toBe(0);
  });
});

describe("scrollbarCompensation — a página não pode saltar ao abrir", () => {
  it("barra de 15px devolve 15px de compensação", () => {
    expect(scrollbarCompensation(1440, 1425)).toBe(15);
  });

  it("barra sobreposta (macOS, celular) devolve 0 — nada a compensar", () => {
    expect(scrollbarCompensation(390, 390)).toBe(0);
  });

  it("NEGATIVO — valor negativo ou absurdo devolve 0, nunca empurra a página", () => {
    expect(scrollbarCompensation(1000, 1200)).toBe(0);
    expect(scrollbarCompensation(Number.NaN, 100)).toBe(0);
    expect(scrollbarCompensation(Number.POSITIVE_INFINITY, 100)).toBe(0);
  });
});

describe("DIALOG_FOCUSABLE_SELECTOR", () => {
  it("inclui o iframe do player — Tab tem de poder entrar no vídeo", () => {
    expect(DIALOG_FOCUSABLE_SELECTOR).toContain("iframe");
  });

  it("NEGATIVO — exclui tabindex=-1 (focável por código, não por Tab)", () => {
    expect(DIALOG_FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });

  it("ignora controle desabilitado", () => {
    expect(DIALOG_FOCUSABLE_SELECTOR).toContain("button:not([disabled])");
  });
});
