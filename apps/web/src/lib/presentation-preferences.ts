/**
 * presentation-preferences.ts — Tema, densidade e tamanho de pôster. PURO.
 *
 * ============================================================================
 * O QUE ESTE MÓDULO EXISTE PARA EVITAR
 * ============================================================================
 * Controle que não faz efeito. O painel de configurações OMITIA estes três de
 * propósito — o cabeçalho de `settings-panel.tsx` registra "sem preferência
 * fake: nunca toggle sem efeito" — e a omissão estava certa: não havia coluna,
 * não havia contrato, não havia efeito.
 *
 * Agora há os três. Este módulo é a metade do EFEITO: ele traduz a preferência
 * salva em atributos no elemento raiz, e o CSS reage a eles. Nada aqui salva
 * nada; nada aqui lê o banco.
 *
 * ============================================================================
 * POR QUE ATRIBUTO NO `<html>`, E NÃO CLASSE NO COMPONENTE
 * ============================================================================
 * Porque a preferência é global: ela vale para a página inteira, inclusive para
 * chrome que não é filho de nenhum componente de conteúdo. Um `data-*` na raiz
 * é o único ponto que todo seletor alcança sem que cada componente precise
 * conhecer a preferência — e é o que permite escrever a regra UMA vez em CSS.
 *
 * `data-theme="system"` NÃO é escrito: quando o leitor escolhe "sistema", o
 * atributo é REMOVIDO, e a página volta a obedecer `prefers-color-scheme`.
 * Escrever `system` como valor obrigaria toda regra a listar três casos em vez
 * de dois, e a media query já resolve o terceiro.
 */

/** As três preferências, como saem do perfil. */
export interface PresentationPreferences {
  readonly theme: string;
  readonly density: string;
  readonly posterSize: string;
}

/** Vocabulários FECHADOS. Espelham o CHECK da coluna e o parser do contrato. */
export const THEMES = ["system", "light", "dark"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export const POSTER_SIZES = ["small", "medium", "large"] as const;

/** Defaults IGUAIS aos da coluna: nenhuma tela muda sem escolha do leitor. */
export const DEFAULT_PREFERENCES: PresentationPreferences = {
  theme: "system",
  density: "comfortable",
  posterSize: "medium",
};

/** Um atributo a aplicar (ou remover, quando `value` é `null`). */
export interface PreferenceAttribute {
  readonly name: string;
  readonly value: string | null;
}

function normalizar(valor: string, permitidos: readonly string[], padrao: string): string {
  return permitidos.includes(valor) ? valor : padrao;
}

/**
 * Traduz preferências em atributos do `<html>`.
 *
 * FAIL-SAFE, não fail-closed: valor desconhecido cai no DEFAULT em vez de
 * lançar. Uma preferência corrompida não pode derrubar a renderização da
 * página — o pior caso aceitável é o leitor ver a aparência padrão.
 *
 * `theme: "system"` devolve `value: null` — o atributo sai do DOM e a media
 * query volta a mandar.
 */
export function preferenceAttributes(
  prefs: PresentationPreferences,
): readonly PreferenceAttribute[] {
  const theme = normalizar(prefs.theme, THEMES, DEFAULT_PREFERENCES.theme);
  return [
    { name: "data-theme", value: theme === "system" ? null : theme },
    {
      name: "data-density",
      value: normalizar(prefs.density, DENSITIES, DEFAULT_PREFERENCES.density),
    },
    {
      name: "data-poster-size",
      value: normalizar(prefs.posterSize, POSTER_SIZES, DEFAULT_PREFERENCES.posterSize),
    },
  ];
}

/**
 * Aplica as preferências ao documento. Único ponto que TOCA o DOM.
 *
 * Recebe o elemento por parâmetro (em vez de ler `document` aqui dentro) para
 * que a função continue testável sem jsdom global e para que ela não presuma um
 * `document` que não existe no servidor.
 */
export function applyPreferences(root: Element, prefs: PresentationPreferences): void {
  for (const attr of preferenceAttributes(prefs)) {
    if (attr.value === null) {
      root.removeAttribute(attr.name);
      continue;
    }
    root.setAttribute(attr.name, attr.value);
  }
}
