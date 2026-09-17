/**
 * css-rules.ts — Leitor MINIMO de regras CSS para as ferramentas da divisao do
 * CSS por rota (`docs/frontend/CSS-SPLIT-PLAN-2026-09-15.md`).
 *
 * POR QUE UM LEITOR PROPRIO. `postcss` nao e dependencia do app, e as
 * ferramentas precisam de pouco — mas precisam CERTO: aqui CSS vence por ORDEM DE
 * DOCUMENTO, entao o que importa e a ordem das regras, o contexto (`@media`,
 * `@supports`) em volta de cada uma, e seletores e declaracoes separados sem se
 * enganar com comentario, string, `url(data:...;...)` ou `:has(...)`.
 *
 * Um extrator por expressao regular NAO serve: ele nao enxerga aninhamento e
 * devolve a regra de dentro do `@media` como se fosse de topo — o defeito ja
 * registrado em `similar-titles-computed.test.tsx`.
 *
 * PURO: sem IO. Testado em `tests/web/css-rules.test.ts`.
 */

export interface CssDeclaration {
  /** Nome da propriedade em minusculas (`--tokens` preservam a grafia). */
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
}

export interface CssRule {
  /** Posicao na folha, na ordem de documento, contando regras e blocos opacos. */
  readonly index: number;
  /** `style`: regra com seletor. `at-block`: `@font-face`, `@keyframes`, `@page`... (opaco). */
  readonly kind: "style" | "at-block";
  /** Preludios dos at-rules condicionais em volta, de fora para dentro. */
  readonly context: readonly string[];
  /** Seletores da regra, separados na virgula de topo. Vazio em `at-block`. */
  readonly selectors: readonly string[];
  /** Declaracoes da regra. Vazio em `at-block`. */
  readonly declarations: readonly CssDeclaration[];
  /** O seletor (style) ou o preludio do at-rule (at-block), com espacos colapsados. */
  readonly prelude: string;
  /** Linha (1-based) em que a regra comeca. */
  readonly line: number;
  /** Identidade da regra: contexto + preludio + corpo normalizados, sem comentario. */
  readonly identity: string;
  /** Bytes da identidade — o tamanho da regra sem comentario nem espaco sobrando. */
  readonly bytes: number;
}

/** At-rules que ENVOLVEM regras (a regra de dentro continua sendo regra). */
const CONDITIONAL_AT_RULES = /^@(media|supports|container|layer|document|scope)\b/i;

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Remove comentarios `/* *\/` sem tocar em string. */
export function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const ch = css[i] as string;
    if (ch === '"' || ch === "'") {
      const end = skipString(css, i);
      out += css.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const end = close === -1 ? css.length : close + 2;
      // Um espaco no lugar (`a/**/b` nao pode virar `ab`) e as quebras de linha do
      // comentario, para a linha de cada regra continuar sendo a do arquivo.
      out += ` ${"\n".repeat((css.slice(i, end).match(/\n/g) ?? []).length)}`;
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Indice logo depois da string que comeca em `start` (aspas simples ou duplas). */
function skipString(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/** Divide `text` no separador de TOPO (fora de string, parenteses e colchetes). */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") {
      const end = skipString(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
    i += 1;
  }
  parts.push(current);
  return parts;
}

function parseDeclarations(body: string): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  for (const raw of splitTopLevel(body, ";")) {
    const text = raw.trim();
    if (text === "") continue;
    const colon = splitTopLevel(text, ":");
    if (colon.length < 2) continue;
    const name = (colon[0] as string).trim();
    let value = colon.slice(1).join(":").trim();
    let important = false;
    const bang = /!\s*important\s*$/i.exec(value);
    if (bang !== null) {
      important = true;
      value = value.slice(0, bang.index).trim();
    }
    declarations.push({
      property: name.startsWith("--") ? name : name.toLowerCase(),
      value: collapse(value),
      important,
    });
  }
  return declarations;
}

function identityOf(context: readonly string[], prelude: string, body: string): string {
  const scope = context.length === 0 ? "" : `${context.join(" ")} `;
  return `${scope}${prelude} {${collapse(body)}}`;
}

/**
 * Le as regras de uma folha na ORDEM DE DOCUMENTO. Regras dentro de `@media` e
 * afins saem com o contexto; blocos como `@font-face` e `@keyframes` saem inteiros,
 * opacos, na posicao em que estao.
 */
export function parseCssRules(css: string): CssRule[] {
  const source = stripCssComments(css);
  const rules: CssRule[] = [];
  const context: string[] = [];
  let prelude = "";
  let preludeLine = 1;
  let line = 1;
  let i = 0;

  const push = (rule: Omit<CssRule, "index" | "bytes">): void => {
    rules.push({ ...rule, index: rules.length, bytes: Buffer.byteLength(rule.identity, "utf8") });
  };

  /** Indice do `}` que fecha o bloco aberto logo antes de `start`, contando linhas. */
  const blockEnd = (start: number): number => {
    let depth = 1;
    let j = start;
    while (j < source.length) {
      const ch = source[j] as string;
      if (ch === '"' || ch === "'") {
        const end = skipString(source, j);
        for (let k = j; k < end; k += 1) if (source[k] === "\n") line += 1;
        j = end;
        continue;
      }
      if (ch === "\n") line += 1;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return j;
      }
      j += 1;
    }
    return source.length;
  };

  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '"' || ch === "'") {
      const end = skipString(source, i);
      if (prelude.trim() === "") preludeLine = line;
      prelude += source.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "\n") {
      line += 1;
      prelude += ch;
      i += 1;
      continue;
    }
    if (ch === ";" && prelude.trim().startsWith("@")) {
      // `@import`, `@charset`: declaracao de topo sem bloco.
      const text = collapse(prelude);
      push({
        kind: "at-block",
        context: [...context],
        selectors: [],
        declarations: [],
        prelude: text,
        line: preludeLine,
        identity: identityOf(context, text, ""),
      });
      prelude = "";
      i += 1;
      continue;
    }
    if (ch === "{") {
      const text = collapse(prelude);
      const startLine = preludeLine;
      prelude = "";
      if (CONDITIONAL_AT_RULES.test(text)) {
        context.push(text);
        i += 1;
        continue;
      }
      const bodyStart = i + 1;
      const end = blockEnd(bodyStart);
      const body = source.slice(bodyStart, end);
      if (text.startsWith("@")) {
        push({
          kind: "at-block",
          context: [...context],
          selectors: [],
          declarations: [],
          prelude: text,
          line: startLine,
          identity: identityOf(context, text, body),
        });
      } else {
        push({
          kind: "style",
          context: [...context],
          selectors: splitTopLevel(text, ",").map(collapse).filter((s) => s !== ""),
          declarations: parseDeclarations(body),
          prelude: text,
          line: startLine,
          identity: identityOf(context, text, body),
        });
      }
      i = end + 1;
      continue;
    }
    if (ch === "}") {
      // Fecha um `@media`/`@supports` aberto.
      context.pop();
      prelude = "";
      i += 1;
      continue;
    }
    if (prelude.trim() === "" && ch.trim() !== "") preludeLine = line;
    prelude += ch;
    i += 1;
  }
  return rules;
}

/** Remove o conteudo de `[...]` e de strings: `[href$=".pdf"]` nao tem classe `pdf`. */
function withoutAttributesAndStrings(selector: string): string {
  let out = "";
  let i = 0;
  let bracket = 0;
  while (i < selector.length) {
    const ch = selector[i] as string;
    if (ch === '"' || ch === "'") {
      i = skipString(selector, i);
      continue;
    }
    if (ch === "[") bracket += 1;
    else if (ch === "]") bracket = Math.max(0, bracket - 1);
    else if (bracket === 0) out += ch;
    i += 1;
  }
  return out;
}

const CLASS_TOKEN = /\.(-?[_a-zA-Z][\w-]*)/g;

/** Toda classe citada no seletor, inclusive dentro de `:has()`/`:not()`. */
export function classTokens(selector: string): string[] {
  return [...withoutAttributesAndStrings(selector).matchAll(CLASS_TOKEN)].map((m) => m[1] as string);
}

/**
 * As classes do SUJEITO: o ultimo composto do seletor, fora de `:has()`,
 * `:not()`, `:is()` e `:where()`. Em `body:has(.art-hero) .site-header` o elemento
 * estilizado e o `.site-header` — `art-hero` e so contexto.
 */
export function subjectClassTokens(selector: string): string[] {
  const clean = withoutAttributesAndStrings(selector);
  let depth = 0;
  let lastBoundary = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i] as string;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && (ch === " " || ch === ">" || ch === "+" || ch === "~")) lastBoundary = i + 1;
  }
  const compound = clean.slice(lastBoundary);
  let topLevel = "";
  depth = 0;
  for (const ch of compound) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) topLevel += ch;
  }
  return [...topLevel.matchAll(CLASS_TOKEN)].map((m) => m[1] as string);
}

/** O BLOCO de uma classe: o prefixo antes de `__` ou `--` (`episode-row__title` -> `episode-row`). */
export function blockOf(classToken: string): string {
  return classToken.split(/__|--/)[0] as string;
}

/** Os blocos do sujeito de todos os seletores de uma regra. */
export function subjectBlocks(rule: CssRule): string[] {
  return [...new Set(rule.selectors.flatMap((s) => subjectClassTokens(s).map(blockOf)))];
}

/**
 * Uma regra com LISTA de seletores equivale a uma regra por seletor, na mesma
 * posicao e com as mesmas declaracoes: `a, b { D }` e `a { D } b { D }`. Devolve a
 * forma expandida — uma regra por seletor, com a identidade de cada um (regra de
 * um seletor so, ou at-rule, volta como esta).
 *
 * Existe para a divisao do CSS por rota: uma regra como o "piso de legibilidade"
 * junta, numa lista so, seletores de blocos que vao para folhas diferentes, e a
 * unica forma de move-los sem reescrever declaracao e dividir a lista.
 */
export function expandSelectorList(rule: CssRule): CssRule[] {
  if (rule.kind !== "style" || rule.selectors.length < 2) return [rule];
  const emptyBody = identityOf(rule.context, rule.prelude, "");
  const body = rule.identity.slice(emptyBody.length - 1, -1);
  return rule.selectors.map((selector) => {
    const identity = identityOf(rule.context, selector, body);
    return { ...rule, selectors: [selector], prelude: selector, identity, bytes: Buffer.byteLength(identity, "utf8") };
  });
}

/**
 * Dividir `a, b { D }` em `a { D } b { D }` so e equivalente quando nenhum seletor
 * pode invalidar a LISTA: um seletor que o navegador nao entende derruba a lista
 * inteira, e dividida ela deixaria de cair. Ficam de fora os seletores com
 * pseudo-classe de lista (`:has()`, `:is()`, `:where()`) e com prefixo de
 * fornecedor.
 */
export function splitSafeSelector(selector: string): boolean {
  return !/:has\(|:is\(|:where\(|::?-(?:webkit|moz|ms)-/i.test(selector);
}
