/**
 * tema-unico.test.ts — O PRODUTO E CLARO, SEMPRE.
 *
 * ============================================================================
 * A DECISAO
 * ============================================================================
 * Dono, 21/08/2026, final: o site nao tem tema escuro e nao deve ter. O canonico
 * e o White Cinematic Editorial System e nao tem UMA unica tela escura. O tema
 * escuro que viveu no `globals.css` nunca foi desenhado e nunca foi pedido.
 *
 * Ele nao era neutro. Foi ele que apagou os blocos das PRs #199-#201: no tema
 * escuro `--c-bg-page` virava #0b0b0d e as regras com hexadecimal LITERAL nao
 * viravam nada, entao a ficha tecnica saia #12100e sobre #0b0b0d — 1,04:1,
 * preto sobre preto, medido em navegador. E o revert da #202 nao consertou:
 * ate 21/08/2026 o defeito continuava no ar para quem visitava com o sistema
 * em modo escuro.
 *
 * ============================================================================
 * POR QUE UMA TRAVA, E NAO SO A REMOCAO
 * ============================================================================
 * Porque tema escuro volta sozinho. Ele volta como "melhoria" num PR de
 * componente, como snippet copiado de outro projeto, como default de
 * biblioteca. E quando volta, ele NAO quebra na hora: quebra so para quem tem o
 * sistema em escuro, que nunca e quem revisa o PR. Foi exatamente assim que as
 * #199-#201 passaram por revisao e capturas e mesmo assim foram ao ar cegas.
 *
 * Esta trava e barata e nao depende de navegador: ela le o arquivo.
 *
 * ============================================================================
 * A MEDIDA IGNORA COMENTARIO, DE PROPOSITO
 * ============================================================================
 * O bloco "TEMA UNICO" no topo do `globals.css` EXPLICA a decisao, e para
 * explicar precisa citar `prefers-color-scheme: dark` e `data-theme`. Uma
 * varredura de texto cru acusaria a propria documentacao da decisao — e a saida
 * obvia (apagar o comentario) deixaria a decisao sem registro.
 *
 * Guarda mede REGRA, nunca prosa. Isto vale para toda guarda deste repositorio
 * que varre arquivo: ja houve caso de comentario derrubar governanca.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS_PATH = fileURLToPath(new URL("../../apps/web/app/globals.css", import.meta.url));
const CSS_BRUTO = readFileSync(CSS_PATH, "utf8");

/** Remove comentarios `/* ... *\/`. Ver o cabecalho: guarda mede regra. */
export function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = semComentarios(CSS_BRUTO);

describe("o globals.css nao tem tema escuro", () => {
  it("CONTROLE POSITIVO: o arquivo foi lido e tem tamanho de folha real", () => {
    // Sem esta ancora, um caminho errado devolveria string vazia e TODOS os
    // testes de ausencia abaixo passariam por vacuidade — verdes medindo nada.
    expect(CSS_BRUTO.length).toBeGreaterThan(100_000);
    expect(CSS).toContain(":root {");
    expect(CSS).toContain("--c-bg-page:");
  });

  it("CONTROLE POSITIVO: a remocao de comentario nao comeu o CSS", () => {
    // Se a regex de comentario fosse gulosa demais, ela apagaria o arquivo
    // inteiro e os testes de ausencia passariam de novo por vacuidade.
    expect(CSS.length).toBeGreaterThan(CSS_BRUTO.length * 0.5);
  });

  it("nao ha `@media (prefers-color-scheme: dark)`", () => {
    expect(CSS).not.toContain("prefers-color-scheme");
  });

  it("nao ha seletor `[data-theme]` em nenhuma forma", () => {
    // Cobre `[data-theme='dark']`, `[data-theme="dark"]` e `:not([data-theme])`
    // de uma vez: o produto nao le esse atributo, ponto.
    expect(CSS).not.toContain("data-theme");
  });

  it("nao ha `color-scheme: dark`", () => {
    // `color-scheme` muda o chrome nativo (scrollbar, form controls) mesmo sem
    // uma regra de cor nossa. Escuro aqui e escuro na tela.
    expect(CSS).not.toMatch(/color-scheme\s*:\s*dark/);
  });

  it("o `:root` declara `color-scheme: light` explicitamente", () => {
    // O par afirmativo da ausencia: sem declarar, um navegador com o sistema em
    // escuro ainda escurece controles nativos por conta propria.
    expect(CSS).toMatch(/color-scheme\s*:\s*light/);
  });
});

describe("controle negativo — a trava REPROVA o tema escuro que foi removido", () => {
  /**
   * A forma EXATA que estava no arquivo ate 21/08/2026. Se algum destes passar,
   * a trava esta verde por acidente e nao guarda nada.
   */
  const ESCURO_COMO_ERA = `
:root[data-theme='dark'] {
  color-scheme: dark;
  --c-bg-page: #0b0b0d;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --c-bg-page: #0b0b0d;
  }
}
`;

  it("pega a escolha explicita", () => {
    expect(semComentarios(ESCURO_COMO_ERA)).toContain("data-theme");
  });

  it("pega a media query do sistema", () => {
    expect(semComentarios(ESCURO_COMO_ERA)).toContain("prefers-color-scheme");
  });

  it("pega o `color-scheme: dark`", () => {
    expect(semComentarios(ESCURO_COMO_ERA)).toMatch(/color-scheme\s*:\s*dark/);
  });

  it("NAO se deixa enganar por tema escuro escondido em comentario", () => {
    // O caso inverso do que a trava ignora: se alguem COMENTAR a regra, ela nao
    // vale como regra — e a trava tem que continuar dizendo que nao ha tema.
    const soComentario = "/* @media (prefers-color-scheme: dark) { :root { color-scheme: dark; } } */";
    expect(semComentarios(soComentario).trim()).toBe("");
  });
});

describe("o TypeScript tambem nao reintroduz tema", () => {
  const PREFS = readFileSync(
    fileURLToPath(new URL("../../apps/web/src/lib/presentation-preferences.ts", import.meta.url)),
    "utf8",
  );

  it("o modulo de efeito nao escreve `data-theme` no <html>", () => {
    // Atributo que nenhum seletor le e "preferencia fake" pela definicao
    // literal da regra da tela 13 — o mesmo defeito do botao morto.
    const codigo = PREFS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(codigo).not.toContain("data-theme");
  });

  it("CONTROLE POSITIVO: ele continua escrevendo os atributos que FICARAM", () => {
    // Sem isto, um arquivo esvaziado passaria o teste de cima.
    expect(PREFS).toContain("data-density");
    expect(PREFS).toContain("data-poster-size");
  });
});
