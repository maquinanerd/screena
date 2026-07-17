/**
 * external-intelligence.ts — Constantes canonicas do Backend B (ratings,
 * streaming e Cinerie Score).
 *
 * Modulo PURO: sem rede, sem banco, sem IO. Reexportado por "@screena/config";
 * importe sempre a partir do pacote, nunca deste arquivo.
 *
 * Estas constantes sao a fonte unica de verdade compartilhada entre workers,
 * validators, triggers (via os validators que os exercitam) e docs. Literal
 * solto em outro modulo e bug.
 */

/**
 * Casos de uso reconhecidos de `data_usage_decisions.use_case`.
 *
 * Por que este eixo existe: `source_licenses` responde "o que esta fonte
 * permite para este content_type neste territorio". NAO responde "para QUE
 * USO". Guardar uma nota para auditoria interna, exibi-la numa pagina
 * indexavel e deriva-la num Cinerie Score sao tres permissoes DIFERENTES da
 * mesma licenca — e a diferenca entre elas e exatamente onde um vazamento de
 * licenca acontece.
 *
 * `use_case` e TEXT no banco (nao enum) de proposito: um caso de uso novo e uma
 * decisao editorial/juridica, e nao deve exigir migration. Esta lista e o
 * vocabulario reconhecido pelo produto; o banco aceita outros valores para que
 * uma decisao possa ser registrada antes de o codigo saber lidar com ela.
 */
export const DATA_USAGE_CASES = [
  /** Exibir a nota de terceiro em pagina publica (external_ratings.display_allowed). */
  "rating_display",
  /** Exibir a oferta de streaming em pagina publica (watch_availability.display_allowed). */
  "watch_offer_display",
  /** Exibir o Cinerie Score — obra DERIVADA; exige derivative_allowed. */
  "cinerie_score_display",
  /** Guardar/processar o dado sem exibir (auditoria, metricas, qualidade). */
  "internal_analytics",
] as const;

/** Caso de uso reconhecido pelo produto. */
export type DataUsageCase = (typeof DATA_USAGE_CASES)[number];

/** Estagios do ciclo de vida de um dado externo (espelha o enum DataUsageStage). */
export const DATA_USAGE_STAGES = [
  "raw",
  "recognized",
  "normalized",
  "license_pending",
  "approved_for_internal_use",
  "approved_for_display",
  "revoked",
] as const;

export type DataUsageStage = (typeof DATA_USAGE_STAGES)[number];

/** Estagios que autorizam EXIBIR. Deliberadamente um so. */
export const DISPLAY_STAGES = ["approved_for_display"] as const;

/** Natureza editorial da nota (espelha o enum RatingScoreType). */
export const RATING_SCORE_TYPES = ["critics", "audience", "editorial"] as const;

export type RatingScoreType = (typeof RATING_SCORE_TYPES)[number];

/**
 * Politica de frescor por fonte de rating, VERSIONADA.
 *
 * Dois relogios distintos, nao um:
 *  - `refreshAfterHours` — a partir daqui o dado e candidato a re-sync
 *    (alimenta `external_ratings.stale_after`, conforme .claude/rules/ingestion.md).
 *    Passar deste ponto NAO tira a nota do ar: so significa "vale reconferir".
 *  - `expireAfterHours` — a partir daqui a nota e velha DEMAIS para ser
 *    apresentada como atual. Exibi-la seria afirmar frescor que nao temos.
 *
 * Valores e justificativa:
 *  - imdb / rotten_tomatoes: refresh 168h (7d), expira 720h (30d). Notas de alta
 *    circulacao mudam devagar depois da estreia, mas a janela de 30 dias impede
 *    apresentar como atual uma nota de mais de um mes.
 *  - metacritic: refresh 336h (14d), expira 1440h (60d). O Metascore muda menos
 *    (o painel de criticos e fechado e pequeno), entao reconferir toda semana
 *    gastaria cota sem ganho.
 *
 * FONTES SEM POLITICA (hoje: letterboxd, filmaffinity) sao tratadas como
 * `unknown-policy` e NUNCA sao exibiveis. Nao inventamos janela para elas: elas
 * ainda nao estao no escopo do produto, e chutar um numero seria fabricar uma
 * afirmacao de frescor. Adicionar uma fonte aqui e decisao explicita.
 */
export const RATING_STALE_POLICY = {
  imdb: { refreshAfterHours: 168, expireAfterHours: 720 },
  rotten_tomatoes: { refreshAfterHours: 168, expireAfterHours: 720 },
  metacritic: { refreshAfterHours: 336, expireAfterHours: 1440 },
} as const;

/** Versao da politica de frescor. Mudar janela => bump aqui (rastreabilidade). */
export const RATING_STALE_POLICY_VERSION = "rating-stale/v1";

/** Fonte que possui politica de frescor declarada. */
export type RatingStalePolicySource = keyof typeof RATING_STALE_POLICY;

/** Janela de frescor de uma fonte. */
export interface RatingStalePolicy {
  readonly refreshAfterHours: number;
  readonly expireAfterHours: number;
}

/**
 * Identificador da versao da formula do Cinerie Score enquanto NAO ha decisao
 * de produto aprovada. Toda tentativa de calculo registra esta versao com
 * status `blocked_by_decision`.
 *
 * A formula (escala, fontes, pesos, votos minimos, arredondamento) e decisao
 * HUMANA pendente em docs/product/cinerie-score-decision.md. Nenhum codigo
 * deste repositorio pode inventa-la.
 */
export const CINERIE_SCORE_BLOCKED_VERSION = "cinerie-score/v0-blocked";

/**
 * Nome PUBLICO da nota propria. As colunas tecnicas legadas continuam sendo
 * `screen_score*` por compatibilidade — mas "Screen Score" NUNCA aparece ao
 * usuario.
 */
export const CINERIE_SCORE_PUBLIC_NAME = "Cinerie Score";
