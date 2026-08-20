/**
 * group-label-rule.ts — A regra do RÓTULO DE GRUPO redundante. PURA.
 *
 * O defeito que ela nomeia: um rótulo de grupo emitido duas vezes — uma como
 * sobrancelha/cabeçalho e outra como o próprio título (ou primeiro item) do
 * grupo. Duas encarnações reais do mesmo defeito:
 *
 *  - a sobrancelha "— ELENCO" acima do título "ELENCO PRINCIPAL" nas páginas de
 *    detalhe (o rótulo diz o que o título logo abaixo já diz);
 *  - o cabeçalho de coluna do rodapé duplicado ("Filmes" em cima de "Filmes"),
 *    que existia como `aria-label` no `<nav>` + `<p>` visível com o mesmo texto
 *    — invisível no render normal, empilhado em toda vista derivada da árvore
 *    de acessibilidade.
 *
 * A regra é UMA, genérica — caso a caso não serve: some daqui e volta na
 * próxima seção que alguém criar. Consumida por
 * `group-label-redundancy.test.tsx` (rodapé) e pelas suítes de seção das
 * páginas de detalhe.
 *
 * Sobrancelha que diz algo DIFERENTE do título fica: "Editorial" acima de
 * "Notícias e bastidores" informa; "Elenco" acima de "Elenco principal" repete.
 */

const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Normaliza para comparação: minúsculas, sem acento, espaço colapsado, sem o
 * traço decorativo ("— ELENCO" e "ELENCO" são o mesmo rótulo).
 *
 * Marcas combinantes via ESCAPE unicode, nunca o literal cru: um caractere
 * combinante solto viaja mal entre encodings (mesma decisão de `creditKeyOf`
 * em @screena/legal/public-credits).
 */
export function normalizeGroupLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[—–-]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `true` quando o rótulo do grupo é REDUNDANTE frente ao texto que o segue
 * (título da seção ou primeiro item do grupo): igual, ou prefixo dele — com ou
 * sem abreviação de acento/caixa/traço.
 */
export function isRedundantGroupLabel(groupLabel: string, followingText: string): boolean {
  const label = normalizeGroupLabel(groupLabel);
  const following = normalizeGroupLabel(followingText);
  if (label === "" || following === "") return false;
  if (label === following) return true;
  // Prefixo por PALAVRA inteira: "elenco" é prefixo de "elenco principal";
  // "not" não é prefixo de "notícias".
  return following.startsWith(`${label} `);
}
