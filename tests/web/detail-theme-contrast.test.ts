/**
 * Contraste das telas de detalhe (filme / serie / temporada) NOS DOIS TEMAS.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * As PRs #199, #200 e #201 subiram e o texto de "A OBRA" e da ficha tecnica
 * ficou invisivel. A explicacao registrada foi "o canonico e claro e a producao
 * e escura, deu preto sobre preto" — nunca verificada, e errada no mecanismo.
 *
 * A producao NAO e escura. Ela e clara ate o sistema do leitor estar em modo
 * escuro; ai `@media (prefers-color-scheme: dark) :root:not([data-theme])`
 * troca `--c-bg-page` para `#0b0b0d` — e as regras que escreviam a cor como
 * HEXADECIMAL LITERAL nao trocam nada. Medido no navegador, antes do conserto:
 *
 *   .ficha-row dd   #12100e sobre #0b0b0d = 1,04:1  (invisivel)
 *   .synopsis-body  #4a463e sobre #0b0b0d = 2,09:1
 *
 * O hero sobreviveu porque `.detail-hero` pinta um fundo claro OPACO proprio.
 * Quem quebrou foi exatamente o texto que fica sobre `--c-bg-page` — que e a
 * lista abaixo. As cores ruins ja existiam antes das PRs; o que as #199/#200
 * fizeram foi passar a RENDERIZAR esses blocos.
 *
 * O QUE ESTE TESTE TRAVA
 * 1. Cor de texto sobre o fundo da pagina se declara com TOKEN, nunca com
 *    literal — literal nao vira com o tema, e essa e a causa raiz.
 * 2. O par (token de texto, `--c-bg-page`) alcanca 4.5:1 NO MESMO TEMA, nos
 *    tres estados: claro, escuro por escolha e escuro por preferencia do
 *    sistema. Um tema que ninguem mede e um tema que ninguem viu.
 *
 * Sem navegador de proposito: a suite roda em `environment: 'node'`, e a
 * matematica de contraste sobre os valores REAIS do arquivo e deterministica.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CSS_PATH = fileURLToPath(new URL("../../apps/web/app/globals.css", import.meta.url));

/**
 * Comentario dentro da regra separa o `{` do `color:` e faz o analisador dizer
 * "regra sem color" numa regra que TEM color. Some com eles antes de analisar —
 * um comentario explicando a cor nao pode derrubar a medicao da cor.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const CSS = stripComments(readFileSync(CSS_PATH, "utf8"));

/** Piso de contraste para texto (WCAG 2.1 AA, texto normal). */
const AA_NORMAL = 4.5;

/**
 * Texto das telas de detalhe que fica sobre `--c-bg-page` — sem superficie
 * opaca propria entre ele e o fundo da pagina. E este conjunto que o tema
 * escuro apaga quando a cor e literal.
 */
const TEXT_ON_PAGE_BACKGROUND = [
  ".detail-section-title",
  ".synopsis-lead",
  ".synopsis-body",
  ".detail-see-all",
  ".ficha-row dt",
  ".ficha-row dd",
  ".eyebrow-bar span",
  // Pagina de temporada (21/08/2026). Estas quatro tinham o MESMO defeito
  // latente e so nao apareciam porque a rota ia ao ar sem desenho nenhum —
  // aplicar o desenho sem tokenizar teria repetido a #199 na temporada.
  ".episode-row__title",
  ".episode-row__synopsis",
  ".episode-row__meta",
  ".season-info",
  "[data-nav='prev-next'] a",
  "[data-vertical='series'] .detail-see-all",
] as const;

// --------------------------------------------------------------------------
// Analisador puro. Recebe CSS como string para que o CONTROLE NEGATIVO possa
// alimenta-lo com um fixture quebrado — um teste que so consegue analisar o
// proprio arquivo do repositorio nao prova que sabe reprovar.
// --------------------------------------------------------------------------

export interface ThemeTokens {
  readonly light: ReadonlyMap<string, string>;
  readonly darkExplicit: ReadonlyMap<string, string>;
  readonly darkSystem: ReadonlyMap<string, string>;
}

function blockAfter(css: string, marker: string): string {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`bloco nao encontrado no CSS: ${marker}`);
  const open = css.indexOf("{", start + marker.length - 1);
  if (open === -1) throw new Error(`bloco sem abertura: ${marker}`);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`bloco sem fechamento: ${marker}`);
}

function tokensIn(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]?/gi)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    found.set(name, value.trim());
  }
  return found;
}

export function parseThemeTokens(css: string): ThemeTokens {
  // O `:root {` do topo. `indexOf` pega a PRIMEIRA ocorrencia, que e a
  // declaracao base — as redefinicoes de tema tem seletor proprio.
  const light = tokensIn(blockAfter(css, "\n:root {"));
  const darkExplicit = tokensIn(blockAfter(css, ":root[data-theme='dark'] {"));
  const darkSystem = tokensIn(blockAfter(css, ":root:not([data-theme]) {"));
  return { light, darkExplicit, darkSystem };
}

/**
 * Valor de `color:` da PRIMEIRA regra cujo grupo de seletores contem o alvo.
 * Reconhece grupo separado por virgula (`.a,\n.b { }`) — casar so o seletor
 * inteiro antes da chave faria o teste dizer "seletor nao encontrado" para uma
 * regra que existe, e um guarda que nao acha o que mede nao guarda nada.
 */
export function declaredColor(css: string, selector: string): string {
  const target = selector.replace(/\s+/g, " ").trim();
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = rule[1] ?? "";
    const body = rule[2] ?? "";
    const names = head.split(",").map((name) => name.replace(/\s+/g, " ").trim());
    if (!names.includes(target)) continue;
    const color = /(?:^|[;{])\s*color\s*:\s*([^;}]+)/.exec(body);
    if (color === null) throw new Error(`regra sem 'color': ${selector}`);
    return (color[1] ?? "").trim();
  }
  throw new Error(`seletor nao encontrado no CSS: ${selector}`);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`hexadecimal invalido: ${hex}`);
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `var(--x)` -> `--x`; qualquer outra coisa -> null (inclui literal). */
export function tokenReference(value: string): string | null {
  const match = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value.trim());
  return match === null ? null : (match[1] ?? null);
}

function resolve(tokens: ReadonlyMap<string, string>, name: string, theme: string): string {
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`token ${name} nao definido no tema ${theme}`);
  return value;
}

// --------------------------------------------------------------------------

describe("contraste das telas de detalhe nos dois temas", () => {
  const tokens = parseThemeTokens(CSS);

  const themes = [
    { name: "claro", table: tokens.light, fallback: tokens.light },
    { name: "escuro (escolha explicita)", table: tokens.darkExplicit, fallback: tokens.light },
    { name: "escuro (preferencia do sistema)", table: tokens.darkSystem, fallback: tokens.light },
  ] as const;

  it("os tres estados de tema estao declarados", () => {
    // Se um dos blocos sumir, o teste abaixo mediria menos temas e passaria
    // verde medindo menos — o buraco tem que ser barulhento.
    expect(tokens.light.size).toBeGreaterThan(0);
    expect(tokens.darkExplicit.get("--c-bg-page")).toBeDefined();
    expect(tokens.darkSystem.get("--c-bg-page")).toBeDefined();
  });

  it.each(TEXT_ON_PAGE_BACKGROUND)(
    "%s declara a cor por TOKEN (literal nao vira com o tema)",
    (selector) => {
      const declared = declaredColor(CSS, selector);
      const token = tokenReference(declared);
      expect(
        token,
        `${selector} escreve 'color: ${declared}'. Sobre --c-bg-page a cor PRECISA ` +
          `virar com o tema; um literal fica igual e vira #12100e sobre #0b0b0d.`,
      ).not.toBeNull();
    },
  );

  for (const theme of themes) {
    it.each(TEXT_ON_PAGE_BACKGROUND)(
      `%s alcanca ${AA_NORMAL}:1 no tema ${theme.name}`,
      (selector) => {
        const token = tokenReference(declaredColor(CSS, selector));
        if (token === null) throw new Error(`${selector} nao usa token — ver teste anterior`);

        // Tema escuro so REDEFINE o que muda; o que ele nao redefine continua
        // valendo do `:root` claro. Resolver so na tabela do tema daria
        // "token nao definido" para tokens legitimamente herdados.
        const ink = theme.table.get(token) ?? resolve(theme.fallback, token, theme.name);
        const page =
          theme.table.get("--c-bg-page") ?? resolve(theme.fallback, "--c-bg-page", theme.name);

        const ratio = contrastRatio(ink, page);
        expect(
          ratio,
          `${selector} no tema ${theme.name}: ${ink} sobre ${page} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      },
    );
  }
});

/**
 * A OUTRA METADE DA MESMA REGRA.
 *
 * `.detail-hero` pinta `background: #fdfcfa` FIXO — ele NAO acompanha o tema.
 * Entao dentro do hero a regra se INVERTE: quem usa token que vira sai claro
 * sobre claro. Medido antes do conserto, no tema escuro:
 *
 *   .detail-hero__crumbs  --c-text-muted-aa -> #a8a49b sobre #fdfcfa = 2,42:1
 *
 * Este defeito e ANTERIOR as PRs revertidas — esta no ar hoje, nas tres telas.
 * O par de testes junto diz a regra inteira: a cor segue a SUPERFICIE em que
 * o texto esta, nao a pagina.
 */
describe("contraste dentro do hero (superficie clara FIXA)", () => {
  const HERO_BACKGROUND = "#fdfcfa";

  const TEXT_ON_HERO = [
    ".detail-hero .detail-hero__crumbs",
    ".detail-hero .detail-hero__crumbs [aria-current='page']",
    ".detail-hero__back",
  ] as const;

  it("o fundo do hero continua sendo o literal claro que estas regras assumem", () => {
    // Se alguem fizer o hero acompanhar o tema, este teste cai — e ai as
    // regras abaixo tem que virar token. O acoplamento fica explicito em vez
    // de virar surpresa na producao.
    const declared = /\.detail-hero\s*\{([^}]*)\}/.exec(CSS);
    expect(declared, "regra .detail-hero nao encontrada").not.toBeNull();
    expect(declared?.[1]).toContain(HERO_BACKGROUND);
  });

  it.each(TEXT_ON_HERO)("%s alcanca 4.5:1 sobre o hero claro", (selector) => {
    const declared = declaredColor(CSS, selector);
    const token = tokenReference(declared);
    const ink =
      token === null
        ? declared
        : // Token permitido AQUI so se ele nao virar com o tema: se virar, a
          // cor clara do escuro cai sobre um fundo que continuou claro.
          (() => {
            const tokens = parseThemeTokens(CSS);
            const light = tokens.light.get(token);
            const dark = tokens.darkSystem.get(token) ?? light;
            expect(
              dark,
              `${selector} usa ${token}, que MUDA no tema escuro (${light} -> ${dark}). ` +
                `O hero nao muda: isso sai claro sobre claro.`,
            ).toBe(light);
            return light ?? "";
          })();
    const ratio = contrastRatio(ink, HERO_BACKGROUND);
    expect(ratio, `${selector}: ${ink} sobre ${HERO_BACKGROUND} = ${ratio.toFixed(2)}:1`)
      .toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("controle negativo: o token que causou o defeito REPROVA aqui", () => {
    const tokens = parseThemeTokens(CSS);
    const mutedDark = tokens.darkSystem.get("--c-text-muted-aa");
    expect(mutedDark).toBeDefined();
    // #a8a49b sobre #fdfcfa — o 2,42:1 medido no navegador.
    expect(contrastRatio(mutedDark ?? "", HERO_BACKGROUND)).toBeLessThan(AA_NORMAL);
  });
});

describe("controle negativo — o analisador REPROVA o CSS que quebrou as #199-#201", () => {
  /**
   * Fixture com a forma exata do defeito revertido: literal quente sobre um
   * `--c-bg-page` que vira no escuro. Se algum destes tres passar, o teste
   * acima esta verde pelo motivo errado e nao guarda nada.
   */
  const BROKEN = `
:root {
  --c-bg-page: #fdfdfd;
}
:root[data-theme='dark'] {
  --c-bg-page: #0b0b0d;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --c-bg-page: #0b0b0d;
  }
}
.ficha-row dd {
  font-weight: 600;
  color: #12100e;
}
`;

  it("ve o literal onde deveria haver token", () => {
    expect(tokenReference(declaredColor(BROKEN, ".ficha-row dd"))).toBeNull();
  });

  it("mede 1,04:1 para #12100e sobre #0b0b0d — o valor que foi ao ar", () => {
    expect(contrastRatio("#12100e", "#0b0b0d")).toBeLessThan(1.1);
  });

  it("mede 2,09:1 para #4a463e sobre #0b0b0d — o texto de A OBRA", () => {
    const ratio = contrastRatio("#4a463e", "#0b0b0d");
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(2.2);
  });

  it("confirma que o par CLARO sempre passou — por isso ninguem reproduziu", () => {
    expect(contrastRatio("#12100e", "#fdfdfd")).toBeGreaterThan(AA_NORMAL);
  });

  it("nao inventa aprovacao quando o seletor nao existe", () => {
    expect(() => declaredColor(BROKEN, ".seletor-que-nao-existe")).toThrow(
      /seletor nao encontrado/,
    );
  });
});
