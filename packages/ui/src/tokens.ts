/**
 * tokens.ts — Tokens de cor canonicos da Screena para a camada de UI.
 *
 * Este modulo e PURO: sem rede, DB ou IO. Ele reexporta os 6 tokens de cor
 * a partir de @screena/config (fonte de verdade unica) e os expoe em duas
 * formas uteis para o frontend:
 *   1. Um objeto tipado (COLOR_TOKENS) com chaves camelCase e valores hex.
 *   2. Os nomes das CSS custom properties (--screena-*) e uma string :root
 *      pronta para injetar em uma folha de estilo.
 *
 * Regra de cor (CANON): filme=vermelho, serie=verde,
 * home/busca/misto/institucional=neutro. A cor NUNCA e o unico diferenciador
 * entre filme e serie (invariante 11) — ver vertical.ts.
 */

import { COLOR_TOKENS } from "@screena/config";

export { COLOR_TOKENS };
export type { ColorToken } from "@screena/config";

/**
 * Mapeamento de cada token de cor para o nome de sua CSS custom property.
 *
 * As chaves espelham COLOR_TOKENS; os valores sao os nomes exatos das
 * variaveis CSS usados pelo design system (ex.: "--screena-movie-red").
 */
export const CSS_VAR_NAMES = {
  black: "--screena-black",
  white: "--screena-white",
  movieRed: "--screena-movie-red",
  seriesGreen: "--screena-series-green",
  bgDark: "--screena-bg-dark",
  bgLight: "--screena-bg-light",
} as const;

/**
 * Nome de uma CSS custom property valida da Screena.
 */
export type CssVarName = (typeof CSS_VAR_NAMES)[keyof typeof CSS_VAR_NAMES];

/**
 * Referencia uma cor da Screena como expressao CSS var() pronta para uso.
 *
 * @example
 *   cssVar("movieRed") // "var(--screena-movie-red)"
 */
export function cssVar(token: keyof typeof COLOR_TOKENS): string {
  return `var(${CSS_VAR_NAMES[token]})`;
}

/**
 * Bloco de declaracoes das CSS custom properties (sem o seletor :root),
 * uma por linha. Util para compor temas ou inserir inline.
 *
 * @example
 *   --screena-black: #000000;
 *   --screena-white: #F5F5F5;
 *   ...
 */
export const CSS_CUSTOM_PROPERTIES: string = (
  Object.keys(COLOR_TOKENS) as Array<keyof typeof COLOR_TOKENS>
)
  .map((token) => `  ${CSS_VAR_NAMES[token]}: ${COLOR_TOKENS[token]};`)
  .join("\n");

/**
 * Folha :root completa com todas as CSS custom properties da Screena,
 * pronta para injetar em um <style> ou arquivo .css global.
 *
 * @example
 *   :root {
 *     --screena-black: #000000;
 *     ...
 *   }
 */
export const ROOT_CSS_VARIABLES: string = `:root {\n${CSS_CUSTOM_PROPERTIES}\n}`;
