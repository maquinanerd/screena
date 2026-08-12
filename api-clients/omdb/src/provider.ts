/**
 * provider.ts — Identidade do fornecedor TECNICO OMDb.
 *
 * INVARIANTE 2: `provider_api` != `rating_source`. `omdb` e o fornecedor tecnico
 * que TRANSPORTA notas; ele NUNCA e a fonte editorial de nenhuma delas. Um unico
 * payload da OMDb carrega notas de TRES fontes editoriais distintas (IMDb,
 * Rotten Tomatoes, Metacritic) — quem as separa e reatribui e o worker
 * `services/ratings`, nunca este pacote.
 */

/** Chave em `api_providers` (kind = ratings). */
export const OMDB_PROVIDER_API = 'omdb'

/** Base URL padrao (sem barra final). */
export const OMDB_DEFAULT_BASE_URL = 'https://www.omdbapi.com'

/**
 * Host canonico. A OMDb NAO e RapidAPI e nao usa header de host; este valor
 * existe so para preencher a config compartilhada e aparecer em diagnostico.
 */
export const OMDB_DEFAULT_HOST = 'www.omdbapi.com'

/**
 * Nome do parametro de query que carrega a chave.
 *
 * A OMDb NAO aceita a chave em header — `?apikey=` e o unico mecanismo. Ver o
 * cabecalho de `@screena/rapidapi-core/http.ts` para por que isso continua sendo
 * seguro (a chave nunca entra em erro, log, relatorio ou `api_cache`).
 */
export const OMDB_API_KEY_QUERY_PARAM = 'apikey'

/**
 * Endpoint unico da OMDb. Toda consulta e na raiz, diferenciada por query
 * params (`i=<imdbID>`, `t=<titulo>`, ...). Aqui so usamos `i` — busca por
 * TITULO seria casamento por nome, que a regra de ingestao proibe.
 */
export const OMDB_ENDPOINT = '/'

/**
 * Teto do plano gratuito: 1.000 requisicoes por DIA.
 *
 * O numero vive aqui (e nao no worker) porque e propriedade do fornecedor. Uma
 * requisicao devolve as tres fontes de uma vez, entao o teto vale em ENTIDADES
 * por dia, nao em notas.
 */
export const OMDB_FREE_TIER_DAILY_LIMIT = 1000

/**
 * TTL padrao do `api_cache` para este provider: 24h.
 *
 * Conservador e alinhado ao demais providers de rating. O relogio que decide
 * RE-CONSULTA nao e este — e `RATING_STALE_POLICY` (@screena/config), aplicado
 * pela selecao de candidatos do worker.
 */
export const OMDB_DEFAULT_CACHE_TTL_MS = 86_400_000

/** Forma de um IMDb id aceito pelo parametro `i`: `tt` + digitos. */
export const IMDB_ID_PATTERN = /^tt\d+$/

/** `value` e um IMDb id valido (`tt<digitos>`)? */
export function isImdbId(value: string): boolean {
  return IMDB_ID_PATTERN.test(value.trim())
}

/**
 * URL canonica de um titulo no IMDb, a partir do `imdbID` do payload.
 *
 * Este e o UNICO linkback que a OMDb permite construir sem inventar nada: o
 * `imdbID` vem do proprio payload e o padrao de URL do IMDb e estavel e publico.
 * Rotten Tomatoes e Metacritic NAO trazem identificador nenhum no payload — para
 * elas nao ha URL derivavel, e derivar um slug do titulo seria fabricar um link
 * que pode nao existir. Ver `services/ratings/src/omdb/mapping.ts`.
 *
 * Devolve `null` para id malformado (nunca monta URL a partir de lixo).
 */
export function buildImdbTitleUrl(imdbId: string): string | null {
  const trimmed = imdbId.trim()
  if (!isImdbId(trimmed)) return null
  return `https://www.imdb.com/title/${trimmed}/`
}
