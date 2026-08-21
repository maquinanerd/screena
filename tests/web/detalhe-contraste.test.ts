/**
 * detalhe-contraste.test.ts — Contraste das telas de detalhe (filme, serie,
 * temporada) no TEMA UNICO.
 *
 * ============================================================================
 * O QUE MUDOU, E POR QUE ESTE ARQUIVO ENCOLHEU
 * ============================================================================
 * A versao anterior media TRES estados de tema e exigia que toda cor de texto
 * fosse TOKEN — porque com tema escuro um hexadecimal literal nao virava e a
 * ficha saia #12100e sobre #0b0b0d (1,04:1, medido).
 *
 * O tema escuro SAIU (dono, 21/08/2026). Com uma superficie so, a exigencia de
 * token perdeu o sentido: literal quente sobre fundo claro esta CERTO e e o que
 * o canonico manda. Exigir token agora seria cerimonia — indirecao que nao
 * protege de nada e que empurra quem porta o canonico a inventar token para um
 * valor que ja tem dono.
 *
 * O que NAO perdeu o sentido e a medida: o piso de 4,5:1 continua, agora sobre
 * uma superficie so. Quem impede o tema escuro de voltar e `tema-unico.test.ts`.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO MEDE
 * ============================================================================
 * Para cada bloco de texto das tres telas, resolve a cor declarada (literal ou
 * token) contra a cor da SUPERFICIE em que ele fica, e reprova abaixo de 4,5:1.
 *
 * Sao duas superficies, e elas sao diferentes de proposito:
 *   - `--c-bg-page` (#fdfdfd) — o corpo da pagina
 *   - `.detail-hero`  (#fdfcfa) — a faixa do topo, que pinta o proprio fundo
 *
 * Sem navegador de proposito: a suite roda em `environment: 'node'`, e a
 * matematica de contraste sobre os valores REAIS do arquivo e deterministica.
 * A varredura em navegador de TODO no de texto folha e feita a parte, com a
 * pagina aberta — esta aqui e a rede que roda em toda CI.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS_PATH = fileURLToPath(new URL("../../apps/web/app/globals.css", import.meta.url));

/**
 * Comentario dentro da regra separa o `{` do `color:` e faz o analisador dizer
 * "regra sem color" numa regra que TEM color. Some com eles antes de analisar.
 *
 * Isto foi um DEFEITO REAL do analisador, nao precaucao: ele aprovava por
 * ignorancia ate um comentario aparecer. Ver o bloco de controle negativo no
 * fim do arquivo — a ferramenta de medicao tambem precisa de controle negativo.
 */
function semComentarios(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = semComentarios(readFileSync(CSS_PATH, "utf8"));

/** Piso de contraste para texto (WCAG 2.1 AA, texto normal). */
const AA_NORMAL = 4.5;

/** As duas superficies das telas de detalhe. */
const FUNDO_PAGINA = "--c-bg-page";
const FUNDO_HERO = "#fdfcfa";

/** Texto que fica sobre o fundo da PAGINA. */
const TEXTO_SOBRE_PAGINA = [
  ".detail-section-title",
  ".synopsis-lead",
  ".synopsis-body",
  ".detail-see-all",
  ".ficha-row dt",
  ".ficha-row dd",
  ".eyebrow-bar span",
  ".episode-row__title",
  ".episode-row__synopsis",
  ".episode-row__meta",
  ".season-info",
  "[data-nav='prev-next'] a",
  "[data-vertical='series'] .detail-see-all",
] as const;

/** Texto que fica sobre a faixa do topo, que pinta o proprio fundo. */
const TEXTO_SOBRE_HERO = [
  ".detail-hero__crumbs",
  ".detail-hero__crumbs [aria-current='page']",
  ".detail-hero__synopsis",
  ".detail-hero__back",
  ".detail-hero__meta-text",
] as const;

// --------------------------------------------------------------------------
// Analisador puro. Recebe CSS como string para que o CONTROLE NEGATIVO possa
// alimenta-lo com um fixture quebrado — um analisador que so consegue analisar
// o proprio arquivo do repositorio nao prova que sabe reprovar.
// --------------------------------------------------------------------------

/** Tokens declarados no `:root` (o unico bloco de tema que existe). */
export function tokensDoRoot(css: string): ReadonlyMap<string, string> {
  const inicio = css.indexOf(":root {");
  if (inicio === -1) throw new Error(":root nao encontrado no CSS");
  const abre = css.indexOf("{", inicio);
  let profundidade = 0;
  let fim = -1;
  for (let i = abre; i < css.length; i += 1) {
    if (css[i] === "{") profundidade += 1;
    else if (css[i] === "}") {
      profundidade -= 1;
      if (profundidade === 0) {
        fim = i;
        break;
      }
    }
  }
  if (fim === -1) throw new Error(":root sem fechamento");
  const bloco = css.slice(abre + 1, fim);
  const achados = new Map<string, string>();
  for (const m of bloco.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]?/gi)) {
    const nome = m[1];
    const valor = m[2];
    if (nome !== undefined && valor !== undefined) achados.set(nome, valor.trim());
  }
  return achados;
}

/**
 * Valor de `color:` da PRIMEIRA regra cujo grupo de seletores contem o alvo.
 * Reconhece grupo separado por virgula (`.a,\n.b { }`) — casar so o seletor
 * inteiro antes da chave faria o teste dizer "seletor nao encontrado" para uma
 * regra que existe, e um guarda que nao acha o que mede nao guarda nada.
 */
export function corDeclarada(css: string, seletor: string): string {
  const alvo = seletor.replace(/\s+/g, " ").trim();
  for (const regra of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const cabeca = regra[1] ?? "";
    const corpo = regra[2] ?? "";
    const nomes = cabeca.split(",").map((n) => n.replace(/\s+/g, " ").trim());
    if (!nomes.includes(alvo)) continue;
    const cor = /(?:^|[;{])\s*color\s*:\s*([^;}]+)/.exec(corpo);
    if (cor === null) throw new Error(`regra sem 'color': ${seletor}`);
    return (cor[1] ?? "").trim();
  }
  throw new Error(`seletor nao encontrado no CSS: ${seletor}`);
}

/** `var(--x)` -> valor do token; hexadecimal -> ele mesmo. */
export function resolverCor(valor: string, tokens: ReadonlyMap<string, string>): string {
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(valor.trim());
  if (ref === null) return valor.trim();
  const nome = ref[1] ?? "";
  const resolvido = tokens.get(nome);
  if (resolvido === undefined) throw new Error(`token nao declarado no :root: ${nome}`);
  return resolverCor(resolvido, tokens);
}

function hexParaRgb(hex: string): { r: number; g: number; b: number } {
  const limpo = hex.trim().replace(/^#/, "");
  const cheio =
    limpo.length === 3
      ? limpo
          .split("")
          .map((c) => c + c)
          .join("")
      : limpo;
  if (!/^[0-9a-f]{6}$/i.test(cheio)) throw new Error(`hexadecimal invalido: ${hex}`);
  return {
    r: Number.parseInt(cheio.slice(0, 2), 16),
    g: Number.parseInt(cheio.slice(2, 4), 16),
    b: Number.parseInt(cheio.slice(4, 6), 16),
  };
}

function luminancia(hex: string): number {
  const { r, g, b } = hexParaRgb(hex);
  const canal = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(frente: string, fundo: string): number {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// --------------------------------------------------------------------------

describe("contraste das telas de detalhe (tema unico)", () => {
  const tokens = tokensDoRoot(CSS);
  const fundoPagina = resolverCor(`var(${FUNDO_PAGINA})`, tokens);

  it("CONTROLE POSITIVO: o :root foi lido e traz os tokens de fundo", () => {
    // Sem esta ancora, um `:root` vazio faria toda medicao abaixo lancar — ou
    // pior, um fundo errado faria tudo passar folgado.
    expect(tokens.size).toBeGreaterThan(20);
    expect(fundoPagina).toBe("#fdfdfd");
  });

  it.each(TEXTO_SOBRE_PAGINA)(`%s alcanca ${AA_NORMAL}:1 sobre o fundo da pagina`, (seletor) => {
    const tinta = resolverCor(corDeclarada(CSS, seletor), tokens);
    const razao = contraste(tinta, fundoPagina);
    expect(razao, `${seletor}: ${tinta} sobre ${fundoPagina} = ${razao.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("o hero continua pintando o proprio fundo claro", () => {
    // As regras abaixo assumem ESTE fundo. Se alguem mudar a faixa do topo, o
    // acoplamento aparece aqui em vez de virar surpresa na tela.
    const regra = /\.detail-hero\s*\{([^}]*)\}/.exec(CSS);
    expect(regra, "regra .detail-hero nao encontrada").not.toBeNull();
    expect(regra?.[1]).toContain(FUNDO_HERO);
  });

  it.each(TEXTO_SOBRE_HERO)(`%s alcanca ${AA_NORMAL}:1 sobre o hero`, (seletor) => {
    const tinta = resolverCor(corDeclarada(CSS, seletor), tokens);
    const razao = contraste(tinta, FUNDO_HERO);
    expect(razao, `${seletor}: ${tinta} sobre ${FUNDO_HERO} = ${razao.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * D3 — VALOR DO CANONICO QUE REPROVA EM CONTRASTE NAO ENTRA.
 *
 * O pacote canonico usa #9A958C na sobrancelha de TODA secao: 2,93:1 sobre
 * #FDFDFD. A producao usa `--c-text-muted-aa` (#6e6a61, 5,30:1) e por isso
 * diverge do canonico DE PROPOSITO.
 *
 * A regra, decidida pelo dono em 21/08/2026: legibilidade ganha de fidelidade
 * de pixel. Este bloco existe para que a divergencia fique REGISTRADA em codigo
 * — e para que quem "corrigir" a sobrancelha para o valor do canonico, achando
 * que esta consertando uma infidelidade, encontre um teste vermelho explicando.
 */
describe("D3: a sobrancelha diverge do canonico por LEGIBILIDADE", () => {
  const CANONICO_SOBRANCELHA = "#9a958c";

  it("o valor do canonico REPROVA — e por isso nao foi portado", () => {
    const razao = contraste(CANONICO_SOBRANCELHA, "#fdfdfd");
    expect(razao).toBeLessThan(AA_NORMAL);
    expect(razao).toBeCloseTo(2.93, 1);
  });

  it("a sobrancelha em producao usa o token acessivel, e PASSA", () => {
    const tokens = tokensDoRoot(CSS);
    const tinta = resolverCor(corDeclarada(CSS, ".eyebrow-bar span"), tokens);
    expect(tinta).not.toBe(CANONICO_SOBRANCELHA);
    expect(contraste(tinta, "#fdfdfd")).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * CONTROLE NEGATIVO DA FERRAMENTA DE MEDICAO.
 *
 * Nao basta o codigo ter controle negativo; a REGUA tambem precisa. Este
 * analisador ja aprovou por ignorancia: com um comentario dentro da regra ele
 * dizia "regra sem color" numa regra que tinha color — e a leitura ingenua
 * desse erro seria "o seletor sumiu", nao "meu parser esta furado".
 *
 * Os casos abaixo alimentam o analisador com fixtures que ele PRECISA errar ou
 * acertar de forma conhecida.
 */
describe("controle negativo — o analisador sabe reprovar", () => {
  const FIXTURE = `
:root {
  --c-bg-page: #fdfdfd;
  --tinta-fraca: #b9b4aa;
}
.bloco-ruim {
  color: var(--tinta-fraca);
}
.bloco-com-comentario {
  /* um comentario que separa a chave do color */
  color: #12100e;
}
.a,
.b {
  color: #4a463e;
}
`;

  const tokens = tokensDoRoot(semComentarios(FIXTURE));

  it("reprova uma cor fraca sobre o fundo claro", () => {
    const tinta = resolverCor(corDeclarada(semComentarios(FIXTURE), ".bloco-ruim"), tokens);
    expect(contraste(tinta, "#fdfdfd")).toBeLessThan(AA_NORMAL);
  });

  it("NAO se perde num comentario dentro da regra — o defeito que ele teve", () => {
    expect(corDeclarada(semComentarios(FIXTURE), ".bloco-com-comentario")).toBe("#12100e");
  });

  it("acha o seletor dentro de um GRUPO separado por virgula", () => {
    // Sem isto ele dizia "seletor nao encontrado" para regra que existe.
    expect(corDeclarada(semComentarios(FIXTURE), ".b")).toBe("#4a463e");
  });

  it("lanca quando o seletor nao existe, em vez de aprovar em silencio", () => {
    expect(() => corDeclarada(FIXTURE, ".nao-existe")).toThrow(/seletor nao encontrado/);
  });

  it("lanca quando o token nao esta declarado, em vez de aprovar em silencio", () => {
    expect(() => resolverCor("var(--inventado)", tokens)).toThrow(/token nao declarado/);
  });

  it("mede 1,04:1 para #12100e sobre #0b0b0d — o valor que foi ao ar nas #199-#201", () => {
    // Memoria do defeito: e este numero que o tema escuro produzia.
    expect(contraste("#12100e", "#0b0b0d")).toBeLessThan(1.1);
  });
});
