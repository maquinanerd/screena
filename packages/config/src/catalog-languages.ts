/**
 * catalog-languages.ts — O RECORTE DE IDIOMA DO CATALOGO.
 *
 * ============================================================================
 * A DECISAO
 * ============================================================================
 * "pt, en, es, ja, ko — o resto exclua! e proiba do tmdb parar de subir essas
 *  coisas." — Pablo Eduardo, dono do projeto, 2026-08-31.
 *
 * Este modulo e a FONTE UNICA desse recorte. Ele governa duas coisas distintas
 * que nunca devem virar duas listas:
 *
 *   1. QUEM ENTRA — o gate de criacao de titulo na ingestao.
 *   2. QUEM SAI   — o criterio do apagamento em massa.
 *
 * Uma segunda lista em qualquer outro arquivo e duplicacao de fonte de verdade,
 * e a forma como este projeto ja perdeu dado antes: uma lista fechada de
 * `en`/`es` escondida no normalizador descartou o idioma real de 41.505 titulos
 * em silencio (ver `normalizeOriginalLanguage`).
 *
 * ============================================================================
 * CONFIGURACAO, NAO LITERAL ENTERRADO
 * ============================================================================
 * O dono precisa poder acrescentar um idioma SEM PR. Por isso a lista efetiva
 * vem de `CINERIE_CATALOG_LANGUAGES` (lista separada por virgula) quando
 * definida, e do default abaixo quando nao. `resolveCatalogLanguageAllowlist`
 * e a UNICA forma suportada de ler o recorte.
 *
 * ============================================================================
 * POR QUE O SUBTAG BASE, E NAO O CODIGO INTEIRO
 * ============================================================================
 * O TMDB emite `original_language` em ISO 639-1 puro (`pt`, `ja`, `ko`), mas o
 * `language_code` do nosso dado editorial e BCP-47 (`pt-BR`). Comparar as duas
 * grafias cruas faria `pt-BR` nunca casar com `pt` — que e EXATAMENTE o defeito
 * que o seed antigo tinha: `languages` continha `pt-BR`, o TMDB mandava `pt`, e
 * todo titulo brasileiro caiu para NULL. A comparacao e sempre pelo subtag base
 * em minusculas.
 */

/**
 * O recorte default: os cinco idiomas que ficam.
 *
 * `pt` cobre `pt-BR` e `pt-PT` — o subtag base e o que compara (ver cabecalho).
 */
export const CATALOG_LANGUAGE_ALLOWLIST_DEFAULT: readonly string[] = ['pt', 'en', 'es', 'ja', 'ko']

/** Variavel de ambiente que SOBRESCREVE o default (C.3: sem PR). */
export const CATALOG_LANGUAGE_ENV_VAR = 'CINERIE_CATALOG_LANGUAGES'

/**
 * Subtag base de um codigo de idioma, em minusculas: `pt-BR` -> `pt`.
 *
 * Devolve `null` para ausencia/vazio — o chamador DEVE distinguir "idioma fora
 * da lista" de "idioma desconhecido"; sao decisoes diferentes (ver
 * `classifyCatalogLanguage`).
 */
export function baseLanguageSubtag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === '') return null
  const base = trimmed.split(/[-_]/)[0] ?? ''
  return base === '' ? null : base
}

/**
 * O recorte EFETIVO. Le `CINERIE_CATALOG_LANGUAGES` quando presente.
 *
 * Uma variavel definida porem VAZIA (ou so com separadores) NAO significa
 * "aceite tudo": significa configuracao malformada, e cair para o default e o
 * unico comportamento que nao transforma um erro de digitacao em catalogo
 * aberto. Recorte vazio de verdade nao existe — sempre sobra pelo menos um
 * idioma publicado.
 */
export function resolveCatalogLanguageAllowlist(
  env: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const raw = env[CATALOG_LANGUAGE_ENV_VAR]
  if (raw === undefined) return CATALOG_LANGUAGE_ALLOWLIST_DEFAULT
  const parsed = raw
    .split(',')
    .map((entry) => baseLanguageSubtag(entry))
    .filter((entry): entry is string => entry !== null)
  const unique = [...new Set(parsed)]
  return unique.length === 0 ? CATALOG_LANGUAGE_ALLOWLIST_DEFAULT : unique
}

/**
 * Veredito de um `original_language` diante do recorte.
 *
 * `unknown_language` NAO e sinonimo de `rejected`, e a distincao e a diferenca
 * entre um log util e um log que mente. Titulo sem idioma pode ser payload
 * truncado, extrator quebrado ou obra sem dialogo — juntar tudo em "recusado
 * por idioma" esconderia um defeito nosso dentro de uma decisao do dono.
 */
export type CatalogLanguageVerdict = 'allowed' | 'rejected' | 'unknown_language'

/** Classifica um `original_language` cru contra o recorte. */
export function classifyCatalogLanguage(
  raw: string | null | undefined,
  allowlist: readonly string[] = CATALOG_LANGUAGE_ALLOWLIST_DEFAULT,
): CatalogLanguageVerdict {
  const base = baseLanguageSubtag(raw)
  if (base === null) return 'unknown_language'
  return allowlist.includes(base) ? 'allowed' : 'rejected'
}
