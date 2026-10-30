import { describe, expect, it } from "vitest";

import { planArticleAdCuts } from "../article-ad-positions";

const text = (n: number): boolean[] => Array.from({ length: n }, () => true);

describe("slots OpaPreço no corpo da matéria (máx. 4 por matéria)", () => {
  it("corpo de até 2 parágrafos: nenhum slot no meio — só topo e rodapé", () => {
    expect(planArticleAdCuts([])).toEqual({ inline01: null, inline02: null });
    expect(planArticleAdCuts(text(2))).toEqual({ inline01: null, inline02: null });
  });

  it("3 parágrafos: inline-01 depois do 2º, sem inline-02", () => {
    expect(planArticleAdCuts(text(3))).toEqual({ inline01: 2, inline02: null });
  });

  it("inline-01 depois do 3º parágrafo; inline-02 só com >= 3 parágrafos depois dele", () => {
    expect(planArticleAdCuts(text(5))).toEqual({ inline01: 3, inline02: null });
    expect(planArticleAdCuts(text(6))).toEqual({ inline01: 3, inline02: 6 });
    expect(planArticleAdCuts(text(12))).toEqual({ inline01: 3, inline02: 12 });
  });

  it("conta só texto de leitura: imagem e divisor não deslocam a contagem", () => {
    // p, img, p, divisor, p, p, p, p
    const blocks = [true, false, true, false, true, true, true, true];
    expect(planArticleAdCuts(blocks)).toEqual({ inline01: 5, inline02: 8 });
  });

  it("o corte do inline-01 cai logo depois do parágrafo, nunca antes de uma legenda", () => {
    // p, p, p, imagem — o slot entra entre o 3º parágrafo e a imagem
    const { inline01 } = planArticleAdCuts([true, true, true, false, true]);
    expect(inline01).toBe(3);
  });
});
