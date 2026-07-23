/**
 * invariants.ts — Constantes canonicas da Screena.
 *
 * Este modulo e PURO: nao le ambiente, nao faz IO, nao tem side effects.
 * Todo valor aqui e a fonte de verdade unica para as regras inegociaveis
 * do produto. Outros pacotes (schemas, seo, ui, db) devem importar destas
 * constantes em vez de redefinir literais soltos.
 */

/**
 * Uma invariante inegociavel do produto Screena.
 */
export interface Invariant {
  readonly id: number;
  readonly text: string;
}

/**
 * As 13 invariantes inegociaveis da Screena (texto fiel ao CANON).
 *
 * Estas regras nunca devem ser reescritas no significado. Qualquer feature,
 * pagina, worker ou agente que as contrarie esta fora de spec.
 */
export const INVARIANTS: readonly Invariant[] = [
  {
    id: 1,
    text: "IMDb != Rotten Tomatoes — nunca misturar fontes, escalas, icones ou linguagem.",
  },
  {
    id: 2,
    text: "provider_api != rating_source — o fornecedor tecnico (ex.: RapidAPI) nunca e a fonte editorial.",
  },
  {
    id: 3,
    text: "Zero API externa no render — paginas publicas indexaveis leem apenas PostgreSQL/cache local.",
  },
  {
    id: 4,
    text: "Zero Gemini no render — a IA so gera content_blocks offline, salvos e validados.",
  },
  {
    id: 5,
    text: "Indexacao total — toda entidade sincronizada e indexada em todos os idiomas publicados; noindex fica so para casos tecnicos (404, erro, entidade sem slug/traducao). Conteudo editorial e alavanca de ranqueamento, nao pre-requisito de indexacao.",
  },
  {
    id: 6,
    text: "Dados sem licenca clara (license_status unknown/blocked ou display_allowed=false) nao aparecem em pagina indexavel.",
  },
  {
    id: 7,
    text: "pt-BR publica primeiro; en e es sao publicados e indexados quando completos (dado + i18n de UI + hreflang), controlados por PUBLISHED_LOCALES — nao nascem mais permanentemente noindex.",
  },
  {
    id: 8,
    text: "Sem pirataria — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.",
  },
  {
    id: 9,
    text: "Screena Movies usa acento vermelho (--screena-movie-red).",
  },
  {
    id: 10,
    text: "Screena Series usa acento verde (--screena-series-green).",
  },
  {
    id: 11,
    text: "A diferenciacao filme/serie NUNCA depende so da cor — sempre label + badge + breadcrumb + schema + URL.",
  },
  {
    id: 12,
    text: "Entity Writer so escreve com base em payload controlado do PostgreSQL — nao inventa fatos, nao cria entidades, nao chama APIs externas, nao publica sozinho.",
  },
  {
    id: 13,
    text: "content_blocks sao versionados e revisaveis — prompt_version, input_hash, output_hash, model_provider, model_name e review_status obrigatorios.",
  },
] as const;

/**
 * Fontes editoriais de rating reconhecidas. Cada fonte tem linguagem,
 * escala e atribuicao proprias e NUNCA pode ser misturada com outra
 * (ver invariante 1).
 */
export const RATING_SOURCES = [
  "imdb",
  "rotten_tomatoes",
  "metacritic",
  "letterboxd",
  "filmaffinity",
] as const;

/**
 * Tipo derivado de uma fonte de rating valida.
 */
export type RatingSource = (typeof RATING_SOURCES)[number];

/**
 * Escala maxima (denominador) de cada fonte de rating.
 *
 * Atencao (invariante 1): uma nota nunca pode ser convertida entre escalas
 * para fingir equivalencia. A escala existe apenas para exibir corretamente
 * a nota atribuida a sua fonte de origem.
 */
export const RATING_SCALES = {
  imdb: 10,
  rotten_tomatoes: 100,
  metacritic: 100,
  letterboxd: 5,
  filmaffinity: 10,
} as const;

/**
 * Verticais de conteudo. A vertical define cor de acento, label, badge,
 * breadcrumb e schema. 'neutral' cobre home, busca, conteudo misto e
 * paginas institucionais.
 */
export const VERTICALS = ["movie", "series", "neutral"] as const;

/**
 * Tipo derivado de uma vertical valida.
 */
export type Vertical = (typeof VERTICALS)[number];

/**
 * Decisoes possiveis de indexabilidade de uma pagina
 * (tabela page_indexability_decisions).
 */
export const INDEX_STATUS = [
  "index",
  "noindex",
  "draft",
  "stale",
  "blocked",
] as const;

/**
 * Tipo derivado de um status de indexacao valido.
 */
export type IndexStatus = (typeof INDEX_STATUS)[number];

/**
 * Locales SUPORTADOS pelo produto (a rota existe estruturalmente), em ordem de
 * prioridade. pt-BR e o locale-base; en/es existem por construcao (o sistema
 * nasce multilingue) mas so publicam quando completos.
 */
export const SUPPORTED_LOCALES = ["pt-BR", "pt", "en", "es"] as const;

/**
 * Tipo derivado de um locale suportado valido.
 */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Locales efetivamente PUBLICADOS e indexaveis (invariante 7, politica 2026-07).
 *
 * Somente um locale listado aqui pode receber `decision = 'index'`. pt-BR/pt
 * publicam primeiro; en e es entram nesta lista APENAS quando completos (dado
 * traduzido + i18n de UI + hreflang reciproco) e apos revisao humana. Ate la,
 * en/es resolvem para draft/noindex — nao por serem "estrangeiros", mas por
 * ainda nao estarem completos. Alterar esta lista e decisao editorial humana
 * registrada (liga a publicacao de um idioma inteiro), nunca inferida por um
 * agente.
 */
export const PUBLISHED_LOCALES = ["pt-BR", "pt"] as const;

/**
 * Tipo derivado de um locale publicado valido.
 */
export type PublishedLocale = (typeof PUBLISHED_LOCALES)[number];

/**
 * Segmento de URL (primeiro segmento da rota publica) de cada `language_code`
 * suportado.
 *
 * FONTE UNICA da relacao `language_code` <-> rota. O `language_code` de dado é
 * BCP-47 (`pt-BR`, `pt`, `en`, `es`); a ROTA publica usa apenas o segmento base
 * (`/pt/`, `/en/`, `/es/`) — `pt-BR` e `pt` compartilham o segmento `pt` e a
 * rota nunca expõe `pt-BR`. Toda decisao de "quais rotas de locale
 * existem/publicam" DERIVA deste mapa + `SUPPORTED_LOCALES`/`PUBLISHED_LOCALES`;
 * uma lista paralela de locales de rota em outro workspace é duplicacao de fonte
 * de verdade e bug (era o caso de `apps/web` antes da centralizacao — ver o
 * baseline R-07).
 */
export const LOCALE_URL_SEGMENT = {
  "pt-BR": "pt",
  pt: "pt",
  en: "en",
  es: "es",
} as const satisfies Record<SupportedLocale, string>;

/**
 * Segmento de URL de um locale suportado (`"pt" | "en" | "es"`).
 */
export type UrlLocale = (typeof LOCALE_URL_SEGMENT)[SupportedLocale];

/**
 * Dedup preservando a primeira ocorrencia (mantem a ordem de prioridade dos
 * `SUPPORTED_LOCALES`, evitando reordenacao silenciosa de rotas).
 */
function uniqueUrlSegments(locales: readonly SupportedLocale[]): UrlLocale[] {
  const seen = new Set<UrlLocale>();
  const out: UrlLocale[] = [];
  for (const locale of locales) {
    const segment = LOCALE_URL_SEGMENT[locale];
    if (!seen.has(segment)) {
      seen.add(segment);
      out.push(segment);
    }
  }
  return out;
}

/**
 * Segmentos de URL SUPORTADOS (a rota existe estruturalmente), derivados de
 * `SUPPORTED_LOCALES`. Hoje: `["pt", "en", "es"]`.
 */
export const SUPPORTED_URL_LOCALES: readonly UrlLocale[] = uniqueUrlSegments(SUPPORTED_LOCALES);

/**
 * Segmentos de URL PUBLICADOS e elegiveis a `index`, derivados de
 * `PUBLISHED_LOCALES`. Hoje: `["pt"]`. Ligar um idioma em `PUBLISHED_LOCALES`
 * passa a habilitar sua rota automaticamente — sem editar nenhuma segunda lista.
 */
export const PUBLISHED_URL_LOCALES: readonly UrlLocale[] = uniqueUrlSegments(PUBLISHED_LOCALES);

/**
 * Segmento de URL default (locale-base do produto): o segmento do primeiro
 * `SUPPORTED_LOCALES`. Hoje: `"pt"`.
 */
export const DEFAULT_URL_LOCALE: UrlLocale = LOCALE_URL_SEGMENT[SUPPORTED_LOCALES[0]];

/**
 * Estados do ciclo de vida de revisao de um content_block
 * (coluna review_status).
 */
export const REVIEW_STATUS = [
  "draft",
  "ai_generated",
  "needs_review",
  "human_reviewed",
  "published",
  "needs_update",
  "blocked",
  "archived",
] as const;

/**
 * Tipo derivado de um status de revisao valido.
 */
export type ReviewStatus = (typeof REVIEW_STATUS)[number];

/**
 * Tokens de cor canonicos da Screena (chaves camelCase, valores hex).
 *
 * Regra de uso: filme=vermelho, serie=verde, home/busca/misto/institucional
 * =neutro. Nunca diferenciar filme/serie so pela cor (ver invariante 11).
 */
export const COLOR_TOKENS = {
  black: "#000000",
  white: "#F5F5F5",
  movieRed: "#FF3B30",
  seriesGreen: "#7AA66D",
  bgDark: "#050505",
  bgLight: "#F4F4F4",
} as const;

/**
 * Tipo derivado de um nome de token de cor valido.
 */
export type ColorToken = keyof typeof COLOR_TOKENS;

/**
 * Tipos de fornecedor tecnico (api_providers.kind). Espelha o enum Postgres
 * ProviderKind do schema (Fase 1, decisao D3). O fornecedor tecnico
 * (provider_api) NUNCA e a fonte editorial (rating_source) — ver invariante 2.
 *
 * - data:      provedor de metadados estruturais (ex.: tmdb).
 * - ratings:   provedor tecnico que transporta notas de uma fonte editorial
 *              (ex.: imdb236 entrega a nota cuja rating_source e 'imdb').
 * - streaming: provedor de disponibilidade legal (ex.: streaming_availability).
 * - ai:        provedor de modelo de IA usado offline (ex.: gemini).
 * - news:      provedor de noticias/clusters.
 */
export const PROVIDER_KINDS = ["data", "ratings", "streaming", "ai", "news"] as const;

/**
 * Tipo derivado de um ProviderKind valido.
 */
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
