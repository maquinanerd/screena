/**
 * quota-policy.ts — O que se sabe da COTA de cada fornecedor. PURO.
 *
 * ============================================================================
 * TRES PERGUNTAS DIFERENTES, E O PAINEL RESPONDE CADA UMA SEPARADA
 * ============================================================================
 *   1. Qual e o teto? (publicado pelo fornecedor, piso assumido, ou nenhum)
 *   2. O que o nosso contador conta? (requisicao real, falha de cache, planejado)
 *   3. O fornecedor nos DIZ quanto sobra? (cabecalho de cota)
 *
 * A OMDb responde "nao" a terceira: o gasto na tela e o que NOS contamos, e a
 * tela diz isso com todas as letras. Por isso a recusa DO FORNECEDOR com o nosso
 * contador abaixo do teto e alerta vermelho obrigatorio — e o unico sinal de que
 * o contador subconta.
 */

import { OMDB_BACKGROUND_DAILY_ENVELOPE, OMDB_DAILY_LIMIT, ON_DEMAND_RESERVE } from "@screena/config";

/** A politica de cota de um fornecedor. */
export interface ProviderQuotaPolicy {
  readonly key: string;
  readonly status: "ativo" | "aposentado" | "sem_registro";
  /** Teto por dia UTC. `null` = o fornecedor nao impoe teto diario. */
  readonly dailyLimit: number | null;
  /** Teto por hora (GitHub). `null` = nao se aplica. */
  readonly hourlyLimit: number | null;
  readonly limitBasis: string;
  /** Fatia reservada ao leitor. `null` = sem reserva. */
  readonly reserve: number | null;
  /** O que `api_sync_logs.quota_cost` conta para este fornecedor. */
  readonly countsWhat: string;
  /** O fornecedor publica cabeçalho de cota? */
  readonly headers: string;
  /** `error_code` que e recusa CERTA do fornecedor por cota. Vazio = nao ha como distinguir. */
  readonly certainRefusalCodes: readonly string[];
  readonly refusalNote: string;
}

export const PROVIDER_QUOTA_POLICIES: readonly ProviderQuotaPolicy[] = [
  {
    key: "omdb",
    status: "ativo",
    dailyLimit: OMDB_DAILY_LIMIT,
    hourlyLimit: null,
    limitBasis: `publicado pelo fornecedor (${String(OMDB_DAILY_LIMIT)}/dia); ${String(ON_DEMAND_RESERVE)} reservados ao leitor, fila de fundo até ${String(OMDB_BACKGROUND_DAILY_ENVELOPE)}`,
    reserve: ON_DEMAND_RESERVE,
    countsWhat: "requisições reais feitas pelo sync-omdb-ratings",
    headers: "NÃO publica cabeçalho de cota: o gasto é o que NÓS contamos, não o que a OMDb contabilizou",
    certainRefusalCodes: ["omdb-quota-exhausted"],
    refusalNote: "a OMDb recusa com HTTP 200 e corpo de erro; o worker grava omdb-quota-exhausted",
  },
  {
    key: "tmdb",
    status: "ativo",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "sem teto diário; o cliente respeita ~40 requisições por segundo (piso assumido)",
    reserve: null,
    countsWhat:
      "no import: falhas de cache (requisições que foram à rede); nas linhas do agendador de title_media e trending: o PLANEJADO do ciclo",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "TmdbHttpError mistura 429, 404 e 5xx: recusa por cota não é distinguível daqui",
  },
  {
    key: "tmdb-exports",
    status: "ativo",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "arquivos públicos, sem cota",
    reserve: null,
    countsWhat: "sempre 0",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "sem cota, sem recusa por cota",
  },
  {
    key: "github",
    status: "ativo",
    dailyLimit: null,
    hourlyLimit: 60,
    limitBasis: "publicado: 60 requisições por hora sem token (repositório público)",
    reserve: null,
    countsWhat: "requisições reais da fila deploy_reference",
    headers: "publica x-ratelimit-remaining; o cliente o lê para parar o ciclo",
    certainRefusalCodes: ["github_rate_limited"],
    refusalNote: "429, ou 403 com x-ratelimit-remaining = 0",
  },
  {
    key: "gemini",
    status: "sem_registro",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "não declarado neste repositório",
    reserve: null,
    countsWhat: "o Entity Writer NÃO grava api_sync_logs: o gasto não é medido",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "não medido",
  },
  {
    key: "streaming_availability",
    status: "aposentado",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "fornecedor aposentado em 2026-09-02 (RapidAPI); a chave fica por FK",
    reserve: null,
    countsWhat: "nada novo deveria aparecer",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "aposentado",
  },
  {
    key: "imdb236",
    status: "aposentado",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "fornecedor aposentado em 2026-09-02 (RapidAPI); a chave fica por FK",
    reserve: null,
    countsWhat: "nada novo deveria aparecer",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "aposentado",
  },
  {
    key: "rapidapi_film_show_ratings",
    status: "aposentado",
    dailyLimit: null,
    hourlyLimit: null,
    limitBasis: "fornecedor aposentado em 2026-09-02 (RapidAPI); a chave fica por FK",
    reserve: null,
    countsWhat: "nada novo deveria aparecer",
    headers: "não lido pelo cliente",
    certainRefusalCodes: [],
    refusalNote: "aposentado",
  },
];

/** A politica de um fornecedor. `null` = fornecedor sem politica declarada aqui. */
export function quotaPolicyFor(key: string): ProviderQuotaPolicy | null {
  return PROVIDER_QUOTA_POLICIES.find((policy) => policy.key === key) ?? null;
}

/** Todos os codigos de recusa certa, para uma consulta so. */
export const ALL_CERTAIN_REFUSAL_CODES: readonly string[] = PROVIDER_QUOTA_POLICIES.flatMap(
  (policy) => policy.certainRefusalCodes,
);
