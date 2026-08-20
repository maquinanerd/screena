/**
 * footer-credit-logo-size.test.ts — A marca da fonte no rodape tem tamanho
 * CONTROLADO POR CSS, nunca so pelo atributo do <img>.
 *
 * O DEFEITO QUE ISTO TRAVA, e ele foi ao ar: o componente escreve
 * `height={logo.heightPx}` no `<img>`, mas o reset global de `globals.css` tem
 *
 *     img { height: auto }
 *
 * — e regra de CSS vence atributo de apresentacao. Sem uma regra para
 * `.footer__credit-logo`, a imagem passa a sair no tamanho INTRINSECO do
 * arquivo: o wordmark do TMDB tem `viewBox="0 0 489.04 35.4"`, e foi assim que
 * ele apareceu com ~489px de largura no rodape de producao.
 *
 * A prova e sobre o CSS porque e o CSS que decide: a suite roda em `node`, sem
 * motor de layout, entao medir pixel aqui seria teatro. O que se afirma e
 * exatamente o que faltava — a regra existe, fixa altura em px, e a altura
 * declarada na licenca acompanha.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TMDB_LOGO_ASSET } from "@screena/legal";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../../globals.css"), "utf8");

/** O bloco `.footer__credit-logo { ... }`, ou `null` se a regra nao existir. */
function creditLogoRule(): string | null {
  const start = css.indexOf(".footer__credit-logo");
  if (start === -1) return null;
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  return css.slice(open + 1, close);
}

describe("marca da fonte no rodape: tamanho travado por CSS", () => {
  it("existe regra para .footer__credit-logo (sem ela o reset solta o SVG no tamanho do arquivo)", () => {
    expect(creditLogoRule()).not.toBeNull();
  });

  it("a regra fixa ALTURA em px — o atributo height do <img> e inerte sob `img { height: auto }`", () => {
    const rule = creditLogoRule()!;
    const height = /height:\s*(\d+(?:\.\d+)?)px/.exec(rule);
    expect(height, `regra sem height em px: ${rule.trim()}`).not.toBeNull();
    // Subordinada a marca do proprio site (exigencia dos termos do TMDB): o
    // wordmark da Cinerie no rodape tem 46px de altura.
    expect(Number(height![1])).toBeLessThanOrEqual(20);
  });

  it("a largura e AUTO — marca de terceiro distorcida e violacao, nao ajuste de layout", () => {
    expect(creditLogoRule()!).toMatch(/width:\s*auto/);
  });

  it("o reset global que causou o defeito continua la (senao este teste protegeria nada)", () => {
    // CONTROLE POSITIVO: se alguem remover `img { height: auto }`, a premissa
    // deste arquivo muda e o comentario acima passa a mentir.
    expect(css).toMatch(/img\s*\{\s*height:\s*auto/);
  });

  it("a altura declarada na LICENCA acompanha a do CSS (uma fonte para o mesmo fato)", () => {
    const rule = creditLogoRule()!;
    const height = Number(/height:\s*(\d+(?:\.\d+)?)px/.exec(rule)![1]);
    expect(TMDB_LOGO_ASSET.displayHeightPx).toBe(height);
  });
});
