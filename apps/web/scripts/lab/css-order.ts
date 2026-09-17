/**
 * css-order.ts — quando a ORDEM entre duas regras decide o estilo.
 *
 * Aqui CSS vence por ordem de documento: duas regras que alcancam o mesmo
 * elemento, com a mesma especificidade e a mesma importancia, empatam, e vence a
 * ultima. Mover uma delas para outra folha pode trocar a ultima. As funcoes abaixo
 * dizem se um par de regras esta nesse empate — o que a checagem estatica da
 * divisao do CSS (`css-move-check.ts`) precisa saber.
 *
 * Aproximacoes DECLARADAS (a paridade de estilo computado cobre o que escapa):
 *  - "alcanca o mesmo elemento" = os seletores citam uma classe em comum;
 *  - o contexto so e decidido pela largura (`min-width`/`max-width` em px);
 *    qualquer outra condicao de `@media` conta como "pode valer junto".
 *
 * PURO: sem IO. Testado em `tests/web/css-order.test.ts`.
 */

import { classTokens, type CssRule, splitTopLevel } from "./css-rules";

export type Specificity = readonly [number, number, number];

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function closing(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === openCh) depth += 1;
    else if (text[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function identEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && /[\w-]/.test(text[i] as string)) i += 1;
  return i;
}

/** Especificidade de UM seletor (Selectors Level 4, no alcance que esta folha usa). */
export function specificityOf(selector: string): Specificity {
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  const s = selector;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === "#") {
      a += 1;
      i = identEnd(s, i + 1);
    } else if (ch === ".") {
      b += 1;
      i = identEnd(s, i + 1);
    } else if (ch === "[") {
      b += 1;
      i = closing(s, i, "[", "]") + 1;
    } else if (ch === ":") {
      if (s[i + 1] === ":") {
        c += 1;
        i = identEnd(s, i + 2);
        if (s[i] === "(") i = closing(s, i, "(", ")") + 1;
        continue;
      }
      const end = identEnd(s, i + 1);
      const name = s.slice(i + 1, end).toLowerCase();
      if (["before", "after", "first-line", "first-letter"].includes(name)) {
        c += 1;
        i = end;
      } else if (s[end] === "(") {
        const close = closing(s, end, "(", ")");
        if (["not", "is", "has", "matches", "-webkit-any"].includes(name)) {
          const parts = splitTopLevel(s.slice(end + 1, close), ",").map((part) => specificityOf(part.trim()));
          const max = parts.reduce<Specificity>((best, part) => (compareSpecificity(part, best) > 0 ? part : best), [0, 0, 0]);
          a += max[0];
          b += max[1];
          c += max[2];
        } else if (name !== "where") {
          b += 1;
        }
        i = close + 1;
      } else {
        b += 1;
        i = end;
      }
    } else if (/[a-zA-Z]/.test(ch)) {
      const prev = i === 0 ? " " : (s[i - 1] as string);
      if (/[\s>+~(,]/.test(prev)) c += 1;
      i = identEnd(s, i);
    } else {
      i += 1;
    }
  }
  return [a, b, c];
}

const SHORTHAND_GROUPS: ReadonlyArray<readonly string[]> = [
  ["inset", "top", "right", "bottom", "left"],
  ["gap", "row-gap", "column-gap", "grid-gap", "grid-row-gap", "grid-column-gap"],
  ["place-items", "align-items", "justify-items"],
  ["place-content", "align-content", "justify-content"],
  ["place-self", "align-self", "justify-self"],
  ["font", "line-height"],
  ["grid-area", "grid-row-start", "grid-row-end", "grid-column-start", "grid-column-end", "grid-row", "grid-column"],
  ["grid", "grid-template-rows", "grid-template-columns", "grid-template-areas", "grid-auto-flow"],
  ["overflow", "overflow-x", "overflow-y"],
];

/** Duas propriedades disputam o mesmo valor? Iguais, ou uma e atalho da outra. */
export function propertiesOverlap(x: string, y: string): boolean {
  if (x === y) return true;
  if (x.startsWith(`${y}-`) || y.startsWith(`${x}-`)) return true;
  return SHORTHAND_GROUPS.some(
    (group) => group.includes(x) && group.includes(y) && (x === group[0] || y === group[0]),
  );
}

function widthRange(context: readonly string[]): readonly [number, number] {
  let min = 0;
  let max = Number.POSITIVE_INFINITY;
  for (const prelude of context) {
    for (const m of prelude.matchAll(/\(\s*min-width\s*:\s*([\d.]+)px\s*\)/gi)) min = Math.max(min, Number(m[1]));
    for (const m of prelude.matchAll(/\(\s*max-width\s*:\s*([\d.]+)px\s*\)/gi)) max = Math.min(max, Number(m[1]));
  }
  return [min, max];
}

/** Os dois contextos podem valer ao mesmo tempo? So a largura e decidida; o resto, sim. */
export function contextsMayOverlap(a: readonly string[], b: readonly string[]): boolean {
  const [aMin, aMax] = widthRange(a);
  const [bMin, bMax] = widthRange(b);
  return !(aMax < bMin || bMax < aMin);
}

/**
 * O que `later` (que vinha DEPOIS de `moved` no documento) disputa com ela por
 * ordem: seletores com classe em comum, MESMA especificidade, mesma importancia e
 * propriedade em comum, em contextos que podem valer juntos. Vazio = a ordem entre
 * as duas nao decide nada.
 */
export function orderConflicts(moved: CssRule, later: CssRule): string[] {
  return orderConflictDetails(moved, later).map(
    (conflict) =>
      `${conflict.movedSelector} × ${conflict.laterSelector}: ${conflict.movedProperty}/${conflict.laterProperty}`,
  );
}

export interface OrderConflict {
  readonly movedSelector: string;
  readonly laterSelector: string;
  readonly movedProperty: string;
  readonly laterProperty: string;
}

/**
 * O tipo de elemento EXPLICITO do sujeito de um seletor (`p`, `blockquote`), ou
 * `null` quando o sujeito e so classe, atributo ou `*`.
 */
export function subjectTypeOf(selector: string): string | null {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i] as string;
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(ch)) start = i + 1;
  }
  const match = /^([a-zA-Z][\w-]*)/.exec(selector.slice(start).trim());
  return match === null ? null : (match[1] as string).toLowerCase();
}

/**
 * A forma estruturada de `orderConflicts`. Alem das regras de empate, descarta o
 * par cujos SUJEITOS tem tipos de elemento explicitos e diferentes: um `p` nunca e
 * um `blockquote`, e entre regras que nao alcancam o mesmo elemento a ordem nao
 * decide nada. Medido: `[data-vertical='news'] .art-body > p` x
 * `.art-body > .art-quote blockquote` era acusado por dividirem a classe do
 * contexto (`art-body`).
 */
export function orderConflictDetails(moved: CssRule, later: CssRule): OrderConflict[] {
  if (moved.kind !== "style" || later.kind !== "style") return [];
  if (!contextsMayOverlap(moved.context, later.context)) return [];
  const found: OrderConflict[] = [];
  for (const sm of moved.selectors) {
    const tokens = new Set(classTokens(sm));
    const movedType = subjectTypeOf(sm);
    for (const sl of later.selectors) {
      if (!classTokens(sl).some((token) => tokens.has(token))) continue;
      const laterType = subjectTypeOf(sl);
      if (movedType !== null && laterType !== null && movedType !== laterType) continue;
      if (compareSpecificity(specificityOf(sm), specificityOf(sl)) !== 0) continue;
      for (const dm of moved.declarations) {
        for (const dl of later.declarations) {
          if (dm.important !== dl.important) continue;
          if (propertiesOverlap(dm.property, dl.property)) {
            found.push({ movedSelector: sm, laterSelector: sl, movedProperty: dm.property, laterProperty: dl.property });
          }
        }
      }
    }
  }
  return found;
}
