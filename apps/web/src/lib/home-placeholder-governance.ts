/**
 * Gate PURO dos diagnósticos visuais de publicidade e newsletter. Sem rede/DB/IO.
 *
 * Somente superfícies não editoriais usam esta decisão: a caixa diagnóstica de
 * um AdSlot reservado e a composição não interativa da newsletter. Conteúdo de
 * catálogo/editorial nunca é habilitado por ambiente ou flag.
 *
 * Regra: diagnósticos aparecem quando o ambiente NAO e producao (dev/preview/
 * test) OU quando explicitamente liberados por flag de preview controlado. Em
 * producao normal (sem flag) os diagnósticos ficam ocultos.
 *
 * Decisao SEMPRE server-side (server components / render server-only). A flag
 * NAO e `NEXT_PUBLIC_*`: nunca vaza para o bundle do cliente. Isto e apenas uma
 * decisao booleana de exibicao — nao e segredo e nao habilita feature real.
 */

/**
 * Ambiente injetavel para a decisao. Permite testar a funcao de forma pura, sem
 * mutar o `process.env` global. Quando um objeto e passado, seus campos sao
 * usados EXATAMENTE como estao (sem fallback para `process.env`).
 */
export interface PlaceholderEnv {
  /** Valor de `NODE_ENV` (ex.: "development" | "production" | "test"). */
  nodeEnv?: string;
  /** Valor de `SCREEN_HOME_VISUAL_PLACEHOLDERS` ("1" libera em producao). */
  flag?: string;
}

/**
 * `true` quando diagnósticos visuais podem ser exibidos:
 *  - qualquer ambiente que NAO seja `production` (dev/preview/test); OU
 *  - `production` com `SCREEN_HOME_VISUAL_PLACEHOLDERS === "1"` (preview visual
 *    controlado, ex.: para revisar o design em staging).
 *
 * Em `production` sem a flag -> `false`: diagnósticos ficam ocultos.
 *
 * Sem argumento, le `process.env` no momento da chamada (server-side). Passar um
 * `env` usa exatamente aqueles campos — isolando o teste do ambiente real.
 */
export function allowHomeVisualPlaceholders(
  env: PlaceholderEnv = {
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.SCREEN_HOME_VISUAL_PLACEHOLDERS,
  },
): boolean {
  return env.nodeEnv !== "production" || env.flag === "1";
}
