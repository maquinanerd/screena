/**
 * authorization-spec.ts — Declaração PURA da autorização de fontes da Cinerie.
 *
 * Este módulo é a tradução, em dados versionados, da decisão formal do
 * proprietário (docs/legal/source-replication-authorization.md). Ele NÃO decide
 * nada: só descreve o que o proprietário autorizou, para que o registry
 * (`plan.ts`) prepare `source_licenses` + `data_usage_decisions` de forma
 * idempotente e auditável.
 *
 * Regras que atravessam o arquivo inteiro (nenhuma é negociável aqui):
 *  - `logoAllowed` e `reviewQuoteAllowed` são SEMPRE false. Liberar logo ou
 *    citação integral de crítica exige autorização específica que não existe.
 *  - `derivativeAllowed` das decisões é SEMPRE false. O Cinerie Score é obra
 *    derivada e permanece BLOCKED_BY_DECISION — este spec NUNCA emite uma
 *    decisão `cinerie_score_display`.
 *  - Nada aqui promove dado: o registry mexe só em licenças e decisões, nunca
 *    liga `display_allowed` de um rating ou de uma oferta.
 *  - `license_status` reflete a origem REAL: `official` só para a API/fonte
 *    oficial; `third_party` quando o dado chega por fornecedor intermediário
 *    (RapidAPI / Film&Show Ratings / Streaming Availability). Não é tudo
 *    `official`.
 */

import type { DataUsageCase } from "@screena/config";

/** Território de publicação do produto (pt-BR/Brasil). */
export const CINERIE_TERRITORY = "BR";

/** Identidade humana que decidiu. Nunca "agent"/"system". */
export const DECIDED_BY = "Pablo Eduardo — proprietário da Cinerie";

/** Motivo canônico registrado em toda decisão/licença desta autorização. */
export const AUTHORIZATION_REASON =
  "Autorizacao de reproducao, armazenamento e exibicao para finalidade informativa, editorial e jornalistica, condicionada a creditos, linkback e disclaimers publicos.";

/** Rótulo da leva de autorização (o `--policy-version` do apply). */
export const AUTHORIZATION_BATCH = "cinerie-source-auth/2026-07-v1";

/** Papéis possíveis de uma fonte (nunca colapsam — invariante 2). */
export type SourceRole =
  /** Fonte editorial da nota (imdb, rotten_tomatoes, ...). */
  | "editorial-rating-source"
  /** Fornecedor de catálogo/metadados (TMDB). */
  | "catalog-provider"
  /** Agregador de disponibilidade de streaming (Movie of the Night). */
  | "streaming-aggregator";

/** `content_type` reconhecidos de `source_licenses` usados por este spec. */
export type LicenseContentType = "rating" | "watch_availability" | "image" | "other";

/** Estado de licença permitido (`official` só p/ API/fonte oficial). */
export type LicenseStatus = "official" | "licensed" | "third_party";

/** Alvo de uma licença (`source_licenses`). */
export interface LicenseTarget {
  readonly sourceKey: string;
  readonly contentType: LicenseContentType;
  /** FK -> rating_sources.key; obrigatório quando contentType='rating'. */
  readonly ratingSourceKey: string | null;
  /** FK -> api_providers.key (fornecedor TÉCNICO; nunca a fonte editorial). */
  readonly providerKey: string | null;
  /** territory_code; null = licença global. */
  readonly territory: string | null;
  readonly licenseStatus: LicenseStatus;
  readonly displayAllowed: boolean;
  /** SEMPRE false neste spec (logos bloqueados). */
  readonly logoAllowed: false;
  readonly scoreAllowed: boolean;
  /** SEMPRE false neste spec (citações integrais bloqueadas). */
  readonly reviewQuoteAllowed: false;
  readonly requiresAttribution: true;
  /**
   * Exigir linkback (URL clicavel) alem do credito textual.
   *
   * Era `true` LITERAL. Deixou de ser em 2026-08-12, e o motivo importa: o
   * provedor de ratings passou a ser a OMDb, cujo payload **nao traz
   * identificador** para Rotten Tomatoes nem Metacritic — so para o IMDb
   * (`imdbID`). Com `requiresLinkback: true` essas duas fontes cairiam
   * permanentemente em `missing-linkback` (ver `resolveDisplayAllowed` em
   * @screena/schemas e o trigger `external_ratings_display_guard`) e nunca
   * apareceriam, mesmo com credito textual correto.
   *
   * NAO e relaxamento geral: ver `ratingEntry` para a dispensa nominal, o IMDb
   * que a mantem obrigatoria, e o gatilho de reversao automatica.
   */
  readonly requiresLinkback: boolean;
  readonly attributionText: string;
  readonly policyVersion: string;
  readonly notes: string;
}

/** Alvo de uma decisão de uso (`data_usage_decisions`). */
export interface DecisionTarget {
  /** NUNCA 'cinerie_score_display' (o score é obra derivada bloqueada). */
  readonly useCase: Exclude<DataUsageCase, "cinerie_score_display">;
  readonly territory: string | null;
  readonly stage: "approved_for_display" | "approved_for_internal_use";
  readonly displayAllowed: boolean;
  readonly storageAllowed: boolean;
  /** SEMPRE false (obra derivada não autorizada). */
  readonly derivativeAllowed: false;
  readonly attributionRequired: true;
  /**
   * Espelha `LicenseTarget.requiresLinkback` da licenca-mae. O gate de exibicao
   * le o campo da LICENCA, nao o da decisao — mas deixar os dois divergentes
   * faria o registro afirmar "linkback obrigatorio" enquanto a licenca dispensa.
   */
  readonly linkbackRequired: boolean;
  readonly policyVersion: string;
}

/** Uma entrada de autorização: uma licença + suas decisões. */
export interface AuthorizationEntry {
  readonly label: string;
  readonly role: SourceRole;
  readonly license: LicenseTarget;
  readonly decisions: readonly DecisionTarget[];
}

const RATING_ATTRIBUTION: Record<string, string> = {
  imdb: "Nota fornecida por IMDb",
  rotten_tomatoes: "Nota fornecida por Rotten Tomatoes",
  metacritic: "Nota fornecida por Metacritic",
  letterboxd: "Nota fornecida por Letterboxd",
  filmaffinity: "Nota fornecida por FilmAffinity",
};

const RATING_POLICY: Record<string, string> = {
  // As três fontes servidas pela OMDb sobem para `2026-08-v1`: a mudança de
  // fornecedor (e, para RT/Metacritic, a dispensa de linkback) é material e
  // precisa gerar uma versão nova de licença, com histórico — nunca um UPDATE
  // silencioso sobre a versão de julho.
  imdb: "cinerie-source-auth/imdb/2026-08-v1",
  rotten_tomatoes: "cinerie-source-auth/rotten-tomatoes/2026-08-v1",
  metacritic: "cinerie-source-auth/metacritic/2026-08-v1",
  // Letterboxd e FilmAffinity NÃO são servidas pela OMDb e não mudam nada nesta
  // leva. Manter a versão de julho é o que faz o registry devolver `keep` para
  // elas em vez de supersedir licenças que ninguém tocou.
  letterboxd: "cinerie-source-auth/letterboxd/2026-07-v1",
  filmaffinity: "cinerie-source-auth/filmaffinity/2026-07-v1",
};

/**
 * Fontes que a OMDb entrega num único payload. Espelha
 * `services/ratings/src/omdb/sources.ts` — divergir aqui produziria uma nota
 * ingerida sem licença correspondente.
 */
const OMDB_SERVED_SOURCES: readonly string[] = ["imdb", "rotten_tomatoes", "metacritic"];

/**
 * ============ DISPENSA DE LINKBACK — decisão de 2026-08-12 ============
 *
 * QUEM DECIDIU: Pablo Eduardo — proprietário da Cinerie (mesma identidade de
 * `DECIDED_BY`, o padrão deste arquivo).
 *
 * O QUE FOI DECIDIDO: Rotten Tomatoes e Metacritic passam a exibir com **crédito
 * textual, sem link**. IMDb **mantém o linkback obrigatório**.
 *
 * POR QUÊ: o provedor de ratings passou a ser a OMDb, e o payload dela traz
 * `imdbID` — logo o IMDb tem URL canônica derivável — mas **nenhum
 * identificador** para Rotten Tomatoes ou Metacritic. Sem identificador não há
 * deep link possível, e derivar um slug do título fabricaria um link que pode
 * não existir. Com `requiresLinkback: true`, essas duas fontes cairiam
 * permanentemente em `missing-linkback` e nunca apareceriam.
 *
 * O QUE **NÃO** FOI DECIDIDO: isto não é relaxamento geral de política. A
 * dispensa é NOMINAL (duas fontes, nomeadas abaixo) e motivada por uma limitação
 * concreta do fornecedor. `requiresAttribution` continua `true` para todas: o
 * crédito textual nunca é dispensado, em nenhuma fonte.
 *
 * GATILHO DE REVERSÃO AUTOMÁTICA — e ele já está armado:
 *
 *   `requiresLinkback: false` significa "não EXIGE link", nunca "não PODE ter".
 *   O adapter de escrita grava `attribution_url = external_ratings.rating_url`
 *   incondicionalmente. Portanto, no dia em que existir um resolvedor de URL
 *   para Rotten Tomatoes ou Metacritic, basta ele preencher `rating_url`: a
 *   nota volta a exibir COM link, no ciclo seguinte do worker, **sem nova
 *   decisão humana e sem tocar neste arquivo**. `resolveDisplayAllowed` só pula
 *   a checagem de obrigatoriedade; a checagem de HTTPS (`unsafe-attribution-url`)
 *   continua valendo, então um link ruim nunca passa.
 *
 *   Travado por `services/legal/src/__tests__/omdb-linkback-dispensation.test.ts`
 *   e por `services/ratings/src/__tests__/omdb-display-gate.test.ts`.
 * ======================================================================
 */
const LINKBACK_DISPENSED_SOURCES: readonly string[] = ["rotten_tomatoes", "metacritic"];

/** A fonte exige linkback para exibir? Só as dispensadas nominalmente não exigem. */
export function ratingRequiresLinkback(source: string): boolean {
  return !LINKBACK_DISPENSED_SOURCES.includes(source);
}

const OMDB_NOTES_BASE =
  "Fonte editorial via OMDb API (fornecedor tecnico intermediario, provider_api=omdb), por isso third_party e nunca official. Logo e citacao integral de critica NAO autorizados.";

const LINKBACK_DISPENSED_NOTE =
  " LINKBACK DISPENSADO (decisao de Pablo Eduardo, 2026-08-12): a OMDb nao entrega identificador desta fonte, entao nao ha URL canonica derivavel e inventar slug a partir do titulo e proibido. O credito TEXTUAL permanece obrigatorio. Dispensa nominal, nao relaxamento geral: o IMDb continua exigindo linkback. REVERSAO AUTOMATICA: se um resolvedor de URL passar a preencher external_ratings.rating_url, a nota volta a exibir COM link no ciclo seguinte, sem nova decisao humana.";

const LINKBACK_REQUIRED_NOTE =
  " LINKBACK OBRIGATORIO: a OMDb entrega imdbID, entao a URL canonica (imdb.com/title/<id>/) e derivavel do proprio payload. A dispensa concedida a Rotten Tomatoes e Metacritic NAO se aplica aqui.";

/**
 * Fontes editoriais de rating. Chegam pela OMDb API, um agregador técnico — por
 * isso `third_party`, nunca `official` (elas não são a API da própria fonte).
 * Licença GLOBAL (a autorização não é limitada por território); o DISPLAY é
 * gated à BR pela decisão `rating_display`.
 *
 * Letterboxd e FilmAffinity não são servidas pela OMDb: mantêm o texto e a
 * versão de julho, e portanto não são supersedidas por esta leva.
 */
function ratingEntry(source: string): AuthorizationEntry {
  const policy = RATING_POLICY[source]!;
  const servedByOmdb = OMDB_SERVED_SOURCES.includes(source);
  const requiresLinkback = servedByOmdb ? ratingRequiresLinkback(source) : true;

  const notes = servedByOmdb
    ? OMDB_NOTES_BASE + (requiresLinkback ? LINKBACK_REQUIRED_NOTE : LINKBACK_DISPENSED_NOTE)
    : "Fonte editorial via Film & Show Ratings API (RapidAPI), fornecedor tecnico intermediario. Logo e citacao integral de critica NAO autorizados.";

  return {
    label: source,
    role: "editorial-rating-source",
    license: {
      sourceKey: source,
      contentType: "rating",
      ratingSourceKey: source,
      // null mantém o MESMO grupo da licença-semente (Fase 1), que esta
      // autorização supersede em vez de deixar uma linha `unknown` órfã. O
      // fornecedor técnico fica em `notes` e na matriz — provider_key na licença
      // é informativo e não muda o gating.
      providerKey: null,
      territory: null,
      licenseStatus: "third_party",
      displayAllowed: true,
      logoAllowed: false,
      scoreAllowed: true,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback,
      attributionText: RATING_ATTRIBUTION[source]!,
      policyVersion: policy,
      notes,
    },
    decisions: [
      {
        useCase: "rating_display",
        territory: CINERIE_TERRITORY,
        stage: "approved_for_display",
        displayAllowed: true,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: requiresLinkback,
        policyVersion: policy,
      },
      {
        useCase: "internal_analytics",
        territory: null,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: requiresLinkback,
        policyVersion: policy,
      },
    ],
  };
}

/** Autorização estática (independe do estado do banco). */
export const STATIC_AUTHORIZATION: readonly AuthorizationEntry[] = [
  // TMDB — catálogo/metadados via a PRÓPRIA API oficial do TMDB (official).
  {
    label: "TMDB (metadados)",
    role: "catalog-provider",
    license: {
      sourceKey: "tmdb",
      contentType: "other",
      ratingSourceKey: null,
      providerKey: "tmdb",
      territory: null,
      licenseStatus: "official",
      displayAllowed: true,
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      policyVersion: "cinerie-source-auth/tmdb/2026-07-v1",
      notes:
        "Metadados de catalogo via API oficial do TMDB. Exibicao de catalogo antecede o eixo use_case; a decisao registrada e internal_analytics (armazenamento). Disclaimer do TMDB obrigatorio no footer.",
    },
    decisions: [
      {
        useCase: "internal_analytics",
        territory: null,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: true,
        policyVersion: "cinerie-source-auth/tmdb/2026-07-v1",
      },
    ],
  },
  // TMDB — imagens: registradas como BLOQUEADAS (display=false, logo=false).
  {
    label: "TMDB (imagens)",
    role: "catalog-provider",
    license: {
      sourceKey: "tmdb",
      contentType: "image",
      ratingSourceKey: null,
      providerKey: "tmdb",
      territory: null,
      licenseStatus: "official",
      displayAllowed: false,
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      policyVersion: "cinerie-source-auth/tmdb/2026-07-v1",
      notes: "Imagens do TMDB permanecem NAO exibiveis (display_allowed=false) ate decisao especifica.",
    },
    decisions: [
      {
        useCase: "internal_analytics",
        territory: null,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: true,
        policyVersion: "cinerie-source-auth/tmdb/2026-07-v1",
      },
    ],
  },
  ...["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"].map(ratingEntry),
  // Movie of the Night — AGREGADOR de streaming (via Streaming Availability API,
  // RapidAPI). É a fonte cuja atribuição vai perto do painel de streaming. NÃO é
  // um provedor de streaming (Netflix, etc.) — por isso content_type='other',
  // não 'watch_availability'. A exibição de cada OFERTA é gated por decisão
  // watch_offer_display POR PROVEDOR CANÔNICO (gerada dinamicamente; ver plan.ts).
  {
    label: "Movie of the Night (agregador de streaming)",
    role: "streaming-aggregator",
    license: {
      sourceKey: "movie-of-the-night",
      contentType: "other",
      ratingSourceKey: null,
      providerKey: "streaming_availability",
      territory: CINERIE_TERRITORY,
      licenseStatus: "third_party",
      displayAllowed: false,
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: "Disponibilidade fornecida por Movie of the Night",
      policyVersion: "cinerie-source-auth/movie-of-the-night/2026-07-v1",
      notes:
        "Agregador de disponibilidade via Streaming Availability API (RapidAPI). Atribuicao obrigatoria perto do painel de streaming. A exibicao de ofertas depende de provedores canonicos registrados e suas decisoes watch_offer_display (por provedor).",
    },
    decisions: [
      {
        useCase: "internal_analytics",
        territory: CINERIE_TERRITORY,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: true,
        policyVersion: "cinerie-source-auth/movie-of-the-night/2026-07-v1",
      },
    ],
  },
];

/**
 * ============ PROVENIENCIA DA OFERTA: UMA LICENCA POR FORNECEDOR TECNICO ============
 *
 * Uma oferta de streaming pode chegar por DOIS caminhos tecnicos, e eles NAO
 * compartilham credito:
 *
 *  - `streaming_availability` (Movie of the Night, via RapidAPI) — agregador
 *    proprio, com deep link por oferta. Credito: "Movie of the Night".
 *  - `tmdb` (bloco `watch/providers`) — o TMDB REVENDE dado do **JustWatch**, e
 *    os termos do endpoint exigem, nominalmente, creditar o JustWatch sob pena
 *    de revogacao do acesso a API. Credito: "JustWatch".
 *
 * Creditar "Movie of the Night" num dado vindo do TMDB nao seria credito
 * faltando — seria **proveniencia falsa**. Por isso cada fornecedor tecnico tem
 * a SUA licenca, com o SEU `attribution_text`/`attribution_url`.
 *
 * POR QUE ISSO CABE SEM MIGRATION: o indice `source_licenses_current_unique` e
 * `(source_key, content_type, COALESCE(provider_key,''), COALESCE(territory_code,''))`
 * — e `provider_key` esta nele. `licenseGroupKey` em `plan.ts` espelha o mesmo
 * conjunto. Logo duas licencas vigentes por slug, uma por `provider_key`, sao
 * grupos DIFERENTES e coexistem legitimamente. O trigger
 * `watch_availability_display_guard` exige `license.source_key = <slug>` e
 * `content_type='watch_availability'`, e nao restringe `provider_key`: ele
 * valida a licenca da decisao que a oferta aponta.
 *
 * CONSEQUENCIA QUE NAO PODE SER ESQUECIDA: com duas licencas por slug, TODO
 * lookup de credito e TODA resolucao de decisao precisam filtrar por
 * `provider_key = <provider_api da oferta>`. Sem esse filtro, um `ORDER BY id
 * DESC` entrega a licenca mais nova para os dois caminhos — e o dado da RapidAPI
 * passaria a ser creditado ao JustWatch (ou vice-versa) em silencio. Esse filtro
 * esta em `watch-credit-lookup.ts` e em `watch-review-store.ts`, e e travado por
 * teste.
 */

/** Fornecedores tecnicos que podem originar uma oferta de streaming. */
interface StreamingOrigin {
  /** `api_providers.key` — vai para `source_licenses.provider_key`. */
  readonly providerApi: string;
  /** Credito textual exigido por ESTE fornecedor. */
  readonly attributionText: string;
  /** De onde o credito vem, para a nota de auditoria. */
  readonly note: string;
}

/**
 * As duas origens, declaradas como literais (mesmo padrao do resto do arquivo:
 * o spec nao importa client de API). Os valores espelham
 * `STREAMING_AVAILABILITY_PROVIDER_API` / `STREAMING_AVAILABILITY_ATTRIBUTION_URL`
 * e `TMDB_PROVIDER_API` / `TMDB_WATCH_ATTRIBUTION_TEXT`; a igualdade e travada
 * por `tests/governance/watch-attribution-provenance.test.ts`, que importa os
 * dois lados — divergir aqui produziria oferta ingerida com credito errado.
 */
const STREAMING_ORIGINS: readonly StreamingOrigin[] = [
  {
    providerApi: "streaming_availability",
    attributionText: "Disponibilidade fornecida por Movie of the Night",
    note: "via Streaming Availability API (Movie of the Night, RapidAPI): agregador proprio, com deep link por oferta.",
  },
  {
    providerApi: "tmdb",
    attributionText: "Disponibilidade fornecida por JustWatch",
    note: "via bloco watch/providers do TMDB, que REVENDE dado do JustWatch. Os termos do endpoint exigem creditar o JustWatch nominalmente, sob pena de revogacao do acesso a API do TMDB — que sustenta o catalogo inteiro. O destino da oferta e o link por PAIS do proprio payload (web_url), nunca um deep link fabricado por provedor.",
  },
];

/**
 * Autorização de EXIBIÇÃO por provedor canônico de streaming, POR ORIGEM.
 *
 * Gerada a partir dos provedores REALMENTE registrados em `watch_providers`
 * (nunca inventada). Em produção, com zero provedores registrados, retorna
 * lista vazia — e não há decisão `watch_offer_display` nenhuma, o que está
 * correto: a exibição de ofertas espera o onboarding real dos provedores.
 * Convenção do banco: `source_licenses.source_key` = `watch_providers.slug`.
 *
 * Cada provedor rende UMA entrada POR ORIGEM (ver `STREAMING_ORIGINS`): o
 * crédito pertence ao fornecedor técnico do dado, não ao provedor canônico.
 */
export function streamingProviderEntries(
  providers: readonly { readonly slug: string; readonly canonicalName: string }[],
): readonly AuthorizationEntry[] {
  return providers.flatMap((provider) =>
    STREAMING_ORIGINS.map((origin) => ({
      label: `Streaming: ${provider.canonicalName} (${origin.providerApi})`,
      role: "streaming-aggregator" as const,
      license: {
        sourceKey: provider.slug,
        contentType: "watch_availability" as const,
        ratingSourceKey: null,
        providerKey: origin.providerApi,
        territory: CINERIE_TERRITORY,
        licenseStatus: "third_party" as const,
        displayAllowed: true,
        logoAllowed: false as const,
        scoreAllowed: false,
        reviewQuoteAllowed: false as const,
        requiresAttribution: true as const,
        requiresLinkback: true,
        attributionText: origin.attributionText,
        policyVersion: AUTHORIZATION_BATCH,
        notes: `Provedor canonico ${provider.canonicalName} (slug ${provider.slug}) ${origin.note} Ofertas exibidas apenas apos promocao humana (pnpm streaming), nunca por este registro.`,
      },
      decisions: [
        {
          useCase: "watch_offer_display" as const,
          territory: CINERIE_TERRITORY,
          stage: "approved_for_display" as const,
          displayAllowed: true,
          storageAllowed: true,
          derivativeAllowed: false as const,
          attributionRequired: true as const,
          linkbackRequired: true,
          policyVersion: AUTHORIZATION_BATCH,
        },
      ],
    })),
  );
}
