/**
 * css-usage.ts — uma classe de CSS ainda e usada pelo codigo do app?
 *
 * A remocao de CSS sem uso (divisao do CSS por rota, PR de limpeza) so pode tirar
 * regra cuja classe NENHUM codigo escreve. "Escreve" tem duas formas:
 *  - LITERAL: `className="topinfo__title"` — a classe inteira, com fronteira
 *    (`site-header__menu-btn` nao e uso de `btn`);
 *  - COMPOSTA: `list-card__media--g${index}` ou `'badge--' + kind` — um PREFIXO da
 *    classe seguido de interpolacao. Caso medido: `list-card__media--g0..g5` so
 *    existe composto em `lists-panel.tsx`, e uma busca literal o daria por morto.
 *
 * O prefixo precisa conter o bloco E o separador (`__` ou `--`): `btn` nunca e
 * "usado" por um `btn${x}` qualquer.
 *
 * PURO: recebe o texto do codigo. Testado em `tests/web/css-usage.test.ts`.
 */

import { blockOf } from "./css-rules";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classUsedInSource(token: string, source: string): boolean {
  if (new RegExp(`(^|[^\\w-])${escapeRegex(token)}($|[^\\w-])`).test(source)) return true;
  // O bloco e o que vem ANTES do primeiro `__`/`--`: com dois caracteres a mais, o
  // prefixo ja inclui o separador. Classe sem separador nao tem forma composta.
  const minimum = blockOf(token).length + 2;
  for (let length = token.length - 1; length >= minimum; length -= 1) {
    const prefix = token.slice(0, length);
    const composed = new RegExp(`(^|[^\\w-])${escapeRegex(prefix)}(\\$\\{|['"\`]\\s*\\+)`);
    if (composed.test(source)) return true;
  }
  return false;
}
