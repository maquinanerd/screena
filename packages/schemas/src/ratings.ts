/**
 * ratings.ts — Validacao de integridade de ratings externos.
 *
 * Este modulo e PURO: nao faz rede, DB nem IO. Aplica as invariantes
 * inegociaveis da Screena a um rating antes que ele possa ser persistido
 * ou exibido:
 *
 *  - Invariante 1: IMDb != Rotten Tomatoes != Metacritic ... — nunca
 *    misturar fontes, escalas ou linguagem. Cada fonte tem escala propria
 *    (ver RATING_SCALES) e label coerente com a fonte (anti cross-label).
 *  - Invariante 2: provider_api != rating_source — o fornecedor tecnico
 *    (ex.: RapidAPI, imdb236) nunca e a fonte editorial.
 *
 * As constantes RATING_SOURCES e RATING_SCALES sao a fonte de verdade unica
 * e vem de @screena/config; este modulo nunca redefine literais soltos.
 */

import { RATING_SCALES, RATING_SOURCES, type RatingSource } from "@screena/config";

export type { RatingSource };

/**
 * Entrada bruta de um rating a validar.
 *
 * - ratingSource: fonte editorial (deve pertencer a RATING_SOURCES).
 * - ratingLabel: rotulo humano exibido (ex.: "IMDb Rating", "Tomatometer").
 * - metric: nome tecnico da metrica (ex.: "user_rating", "tomatometer").
 * - ratingValue: valor numerico da nota na escala da fonte.
 * - ratingScale: escala (denominador) declarada para o valor.
 * - providerApi: fornecedor tecnico que entregou o dado (ex.: "imdb236").
 */
export interface RatingInput {
  readonly ratingSource: string;
  readonly ratingLabel: string;
  readonly metric: string;
  readonly ratingValue: number;
  readonly ratingScale: number;
  readonly providerApi: string;
}

/**
 * Resultado de uma validacao: ok=true quando nao ha erros; caso contrario
 * errors lista todas as violacoes encontradas (em pt-BR).
 */
export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

/**
 * Conjunto de fontes validas para busca O(1) e narrowing de tipo.
 */
const RATING_SOURCE_SET: ReadonlySet<string> = new Set(RATING_SOURCES);

/**
 * Type guard: true quando o valor e uma RatingSource canonica.
 */
function isRatingSource(value: string): value is RatingSource {
  return RATING_SOURCE_SET.has(value);
}

/**
 * Mapa de termos de label -> fonte obrigatoria (anti cross-label).
 *
 * Se o label (lowercase) contem qualquer um destes termos, a fonte do
 * rating DEVE ser a fonte associada. Isso impede, por exemplo, exibir um
 * "Tomatometer" atribuido ao IMDb (ver invariante 1).
 */
const LABEL_SOURCE_RULES: ReadonlyArray<{
  readonly term: string;
  readonly requiredSource: RatingSource;
}> = [
  { term: "tomatometer", requiredSource: "rotten_tomatoes" },
  { term: "tomate", requiredSource: "rotten_tomatoes" },
  { term: "popcornmeter", requiredSource: "rotten_tomatoes" },
  { term: "imdb", requiredSource: "imdb" },
  { term: "metacritic", requiredSource: "metacritic" },
  { term: "metascore", requiredSource: "metacritic" },
];

/**
 * Valida a integridade de um rating contra as invariantes da Screena.
 *
 * Regras aplicadas (todas obrigatorias):
 *  (a) ratingSource pertence a RATING_SOURCES;
 *  (b) ratingScale === RATING_SCALES[ratingSource] (escala correta da fonte);
 *  (c) provider_api != rating_source: providerApi nao pode ser igual ao
 *      ratingSource nem ser um valor de RATING_SOURCES usado como fonte;
 *  (d) anti cross-label: termos no ratingLabel forcam a fonte correta.
 *
 * Funcao pura. Retorna todos os erros encontrados de uma vez.
 */
export function validateRating(input: RatingInput): ValidationResult {
  const errors: string[] = [];

  const { ratingSource, ratingLabel, ratingScale, providerApi } = input;

  // (a) fonte pertence ao conjunto canonico
  const sourceIsValid = isRatingSource(ratingSource);
  if (!sourceIsValid) {
    errors.push(
      `ratingSource invalida: "${ratingSource}" nao pertence a RATING_SOURCES (${RATING_SOURCES.join(", ")}).`,
    );
  }

  // (b) escala correta por fonte (so checavel quando a fonte e valida)
  if (sourceIsValid) {
    const expectedScale = RATING_SCALES[ratingSource];
    if (ratingScale !== expectedScale) {
      errors.push(
        `escala incorreta para "${ratingSource}": esperado ${expectedScale}, recebido ${ratingScale}.`,
      );
    }
  }

  // (c) provider_api != rating_source (invariante 2)
  if (providerApi === ratingSource) {
    errors.push(
      `provider_api nao pode ser igual a rating_source ("${providerApi}"): o fornecedor tecnico nunca e a fonte editorial.`,
    );
  } else if (isRatingSource(providerApi)) {
    errors.push(
      `provider_api invalido: "${providerApi}" e uma fonte editorial (RATING_SOURCES) e nao pode ser usado como fornecedor tecnico.`,
    );
  }

  // (d) anti cross-label (invariante 1)
  const labelLower = ratingLabel.toLowerCase();
  for (const rule of LABEL_SOURCE_RULES) {
    if (labelLower.includes(rule.term) && ratingSource !== rule.requiredSource) {
      errors.push(
        `cross-label proibido: label "${ratingLabel}" referencia "${rule.term}", logo ratingSource deveria ser "${rule.requiredSource}", mas e "${ratingSource}".`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Versao "assercao" de validateRating: lanca Error quando o rating viola
 * qualquer regra. Util em fronteiras de escrita (workers/sync) onde um
 * rating invalido jamais deve seguir adiante.
 *
 * Funcao pura (so lanca, nao tem side effects).
 */
export function assertRatingIntegrity(input: RatingInput): void {
  const result = validateRating(input);
  if (!result.ok) {
    throw new Error(`rating invalido: ${result.errors.join(" | ")}`);
  }
}
