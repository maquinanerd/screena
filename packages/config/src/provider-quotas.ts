/**
 * provider-quotas.ts — O TETO REAL de cada fornecedor tecnico, com a FONTE de
 * cada numero. Modulo PURO (so dados e funcoes puras).
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * Ate aqui o unico teto escrito no repositorio era o da OMDb (1.000/dia), e ele
 * vivia dentro de um modulo de crescimento sob demanda. O agendador precisa dos
 * tres, no mesmo lugar, para poder RECUSAR trabalho antes de gastar — e teto
 * presumido e teto errado: cada entrada abaixo carrega `basis` dizendo se o
 * numero foi PUBLICADO pelo fornecedor, MEDIDO por nos, ou e um piso
 * conservador escolhido por nao existir numero publicado.
 *
 * `basis` nao e decoracao. `assumed_floor` significa "ninguem publicou; este e
 * um piso que preferimos respeitar" — e o agendador trata os dois iguais na
 * hora de barrar, mas o relatorio diz qual e qual, para que ninguem cite um
 * palpite como se fosse documentacao.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================================
 * Nao mede consumo (isso e `api_sync_logs.quota_cost`, lido em runtime), nao
 * decide quem cede a vez (isso e `omdb-budget.ts`) e nao fala com rede.
 */

/** De onde veio o numero do teto. */
export type QuotaBasis =
  /** O fornecedor publica o numero na documentacao/pagina de planos. */
  | "published"
  /** Nos medimos (relatorio de execucao, cabecalho de resposta). */
  | "measured"
  /**
   * O fornecedor NAO publica limite numerico. O valor e um piso conservador
   * escolhido por nos para nao descobrir o teto batendo nele.
   */
  | "assumed_floor";

/** O teto de um fornecedor tecnico. */
export interface ProviderQuota {
  /** `api_providers.key` — o fornecedor TECNICO, nunca a fonte editorial. */
  readonly providerApi: string;
  /** Teto de requisicoes por dia civil. `null` = o fornecedor nao impoe um. */
  readonly perDay: number | null;
  /** Teto de requisicoes por segundo. `null` = nao declarado. */
  readonly perSecond: number | null;
  readonly basis: QuotaBasis;
  /** A citacao. Onde o numero foi lido, palavra por palavra quando cabe. */
  readonly source: string;
}

/**
 * OMDb — plano gratuito.
 *
 * PUBLICADO: a pagina de chave da OMDb (omdbapi.com/apikey.aspx) oferece
 * "FREE! (1,000 daily limit)" contra os planos pagos do Patreon. Nao ha teto
 * por segundo declarado.
 */
export const OMDB_QUOTA: ProviderQuota = {
  providerApi: "omdb",
  perDay: 1_000,
  perSecond: null,
  basis: "published",
  source:
    "omdbapi.com/apikey.aspx — plano FREE anunciado como \"1,000 daily limit\". " +
    "Sem teto por segundo declarado.",
};

/**
 * TMDB — API de leitura.
 *
 * NAO HA TETO DIARIO. O TMDB removeu o limite de 40 requisicoes/10s em
 * dezembro de 2019 e desde entao a documentacao de rate limiting diz que o
 * limite pratico gira em torno de ~50 requisicoes por segundo, sem cota diaria.
 * `perDay: null` e uma AFIRMACAO, nao uma lacuna: o gargalo do TMDB e taxa
 * instantanea, e o agendador espaca as chamadas em vez de contar o dia.
 *
 * 40/s (e nao 50) por escolha nossa: um piso 20% abaixo do limite praticado
 * absorve rajada e retry sem descobrir o teto batendo nele.
 */
export const TMDB_QUOTA: ProviderQuota = {
  providerApi: "tmdb",
  perDay: null,
  perSecond: 40,
  basis: "assumed_floor",
  source:
    "developer.themoviedb.org — o limite de 40 req/10s foi removido em 12/2019; " +
    "a orientacao vigente e ~50 req/s e NENHUMA cota diaria. Usamos 40 req/s " +
    "(piso 20% abaixo) para nao descobrir o teto batendo nele.",
};

/**
 * Daily ID Exports do TMDB — arquivos publicos em files.tmdb.org.
 *
 * Sem token e sem cota: nao passam pela API. O teto e a PUBLICACAO (um arquivo
 * por dia, ~08:00 UTC), nao um numero de requisicoes — baixar duas vezes no
 * mesmo dia baixa o MESMO arquivo.
 */
export const TMDB_EXPORTS_QUOTA: ProviderQuota = {
  providerApi: "tmdb-exports",
  perDay: null,
  perSecond: null,
  basis: "published",
  source:
    "files.tmdb.org/p/exports — arquivos publicos, sem token e fora da cota da API. " +
    "Publicados uma vez por dia (job ~07:00 UTC, disponiveis ~08:00 UTC).",
};

/**
 * RapidAPI (Streaming Availability / Film & Show Ratings).
 *
 * O teto e do PLANO contratado, nao do endpoint, e o repositorio nao guarda
 * qual plano esta ativo. `assumed_floor` com o menor plano gratuito tipico
 * (500/mes ≈ 16/dia): se o plano real for maior, o agendador so anda mais
 * devagar do que poderia — o erro cai para o lado seguro.
 *
 * Nenhuma das duas fontes esta ativa como produto hoje (ver .claude/rules/ratings.md).
 */
export const RAPIDAPI_QUOTA: ProviderQuota = {
  providerApi: "rapidapi",
  perDay: 16,
  perSecond: 1,
  basis: "assumed_floor",
  source:
    "O teto e do PLANO contratado no RapidAPI, e o repositorio nao registra qual " +
    "plano esta ativo. Piso conservador do menor plano gratuito tipico (500/mes). " +
    "Trocar exige ler o painel do plano e atualizar aqui com basis=published.",
};

/** Todos os tetos, por `provider_api`. */
export const PROVIDER_QUOTAS: Readonly<Record<string, ProviderQuota>> = {
  [OMDB_QUOTA.providerApi]: OMDB_QUOTA,
  [TMDB_QUOTA.providerApi]: TMDB_QUOTA,
  [TMDB_EXPORTS_QUOTA.providerApi]: TMDB_EXPORTS_QUOTA,
  [RAPIDAPI_QUOTA.providerApi]: RAPIDAPI_QUOTA,
};

/**
 * O teto de um fornecedor, ou `null` quando ele nao esta declarado aqui.
 *
 * FAIL-CLOSED no chamador: um fornecedor desconhecido NAO deve ser tratado como
 * "sem limite". Devolver `null` obriga quem pergunta a decidir explicitamente,
 * em vez de herdar um default permissivo.
 */
export function resolveProviderQuota(providerApi: string): ProviderQuota | null {
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_QUOTAS, providerApi)) return null;
  return PROVIDER_QUOTAS[providerApi] ?? null;
}

/** Uma volta completa de rotacao: quantos dias, dado o teto e o tamanho. */
export interface RotationLap {
  /** Itens a percorrer. */
  readonly items: number;
  /** Requisicoes que cada item custa. */
  readonly requestsPerItem: number;
  /** Requisicoes disponiveis por dia para ESTA fila (ja descontada a reserva). */
  readonly requestsPerDay: number;
  /** Dias para uma volta completa. `null` quando a fila nao tem cota nenhuma. */
  readonly days: number | null;
}

/**
 * Quantos dias uma volta completa leva.
 *
 * Arredonda para CIMA: meia volta nao existe — a ultima fracao de dia ainda e um
 * dia em que a fila esta rodando. `requestsPerDay <= 0` devolve `days: null`
 * ("nunca fecha a volta"), nunca `Infinity` disfarcado de numero.
 */
export function planRotationLap(input: {
  readonly items: number;
  readonly requestsPerItem: number;
  readonly requestsPerDay: number;
}): RotationLap {
  const items = Math.max(0, Math.trunc(input.items));
  const requestsPerItem = Math.max(1, Math.trunc(input.requestsPerItem));
  const requestsPerDay = Math.trunc(input.requestsPerDay);
  const days =
    requestsPerDay <= 0 ? null : Math.ceil((items * requestsPerItem) / requestsPerDay);
  return { items, requestsPerItem, requestsPerDay, days };
}
