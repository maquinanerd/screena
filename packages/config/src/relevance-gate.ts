/**
 * relevance-gate.ts — os NUMEROS e a CHAVE do portao de relevancia de titulos.
 *
 * DECISAO DO DONO, ASSINADA EM 24/09/2026 (`docs/seo/DECISOES-DO-DONO-2026-09-24.md`):
 * um filme ou uma serie FICA no indice se valer qualquer uma destas condicoes —
 *
 *   - algum pais de origem e EUA;
 *   - algum pais de origem e Brasil;
 *   - `vote_count_tmdb >= RELEVANCE_GATE_MIN_TMDB_VOTES`;
 *   - tem oferta de streaming no Brasil.
 *
 * Qualquer outro titulo sai do indice (`noindex, follow` + fora do sitemap),
 * inclusive o SEM PAIS. Nunca e apagado.
 *
 * O limiar e os paises moram AQUI, num lugar so: a funcao pura de `@screena/seo`
 * (pagina) e o SQL do sitemap leem as mesmas constantes. Dois numeros para a
 * mesma decisao divergiriam no primeiro ajuste.
 *
 * NASCE LIGADO. Nao ha chave para ligar — so a de EMERGENCIA para desligar:
 * `CINERIE_RELEVANCE_GATE=off`, lida em RUNTIME (a cada chamada, nunca no import
 * e nunca como build-arg). Ausente, vazia ou qualquer outro valor = ligado.
 */

/** Votos no TMDB a partir dos quais o titulo fica no indice, venha de onde vier. */
export const RELEVANCE_GATE_MIN_TMDB_VOTES = 500

/**
 * Paises de origem que, sozinhos, mantem o titulo no indice (ISO 3166-1 alfa-2,
 * como `movie_production_countries.country_code`/`tv_show_origin_countries`).
 * Filme: qualquer posicao de `production_countries`. Serie: `origin_country`.
 */
export const RELEVANCE_GATE_ANCHOR_COUNTRIES: readonly string[] = Object.freeze(['US', 'BR'])

/**
 * Territorio da oferta de streaming que mantem o titulo no indice
 * (`watch_availability.country_code`).
 */
export const RELEVANCE_GATE_OFFER_COUNTRY = 'BR'

/** Nome da variavel da chave de EMERGENCIA. */
export const RELEVANCE_GATE_ENV_VAR = 'CINERIE_RELEVANCE_GATE'

/** O unico valor que desliga o portao. */
export const RELEVANCE_GATE_OFF_VALUE = 'off'

/**
 * O portao esta ligado? Le o ambiente NA CHAMADA.
 *
 * So `off` (sem diferenciar caixa, com espacos das pontas ignorados) desliga.
 * Ausente, vazio, `on`, `false`, `0`, erro de digitacao — tudo isso e LIGADO: a
 * decisao do dono e o portao ligado, e um valor malformado nunca pode reabrir o
 * indice por acidente.
 */
export function isRelevanceGateEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[RELEVANCE_GATE_ENV_VAR]
  if (raw === undefined) return true
  return raw.trim().toLowerCase() !== RELEVANCE_GATE_OFF_VALUE
}
