/**
 * @screena/omdb-client — Client offline da OMDb API (fornecedor TECNICO).
 *
 * WORKER-ONLY: nunca importado pelo render publico (invariantes 3 e 4).
 *
 * Uma requisicao (`GET /?i=<imdbID>`) devolve as notas de IMDb, Rotten Tomatoes
 * e Metacritic de uma vez. Este pacote NAO decide qual e a fonte editorial de
 * cada nota — isso e `services/ratings/src/omdb/mapping.ts` (invariante 2).
 *
 * A chave (`OMDB_API_KEY`) viaja na querystring porque a OMDb nao aceita header.
 * Ela nunca entra em erro, log, relatorio ou `api_cache`.
 */

export * from './provider.js'
export * from './config.js'
export * from './client.js'
