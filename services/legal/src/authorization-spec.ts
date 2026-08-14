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
export type LicenseContentType =
  | "rating"
  | "watch_availability"
  | "image"
  /** Trailers/teasers do TMDB. O valor já existia no enum do banco desde a Fase 7. */
  | "video"
  | "other";

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
  // Letterboxd e FilmAffinity: EXIBIÇÃO REVOGADA em 2026-08-13 (ver
  // DISPLAY_REVOKED_SOURCES). A versão sobe para `v2-revogada` justamente para
  // que o registry SUPERSEDA a licença de julho em vez de devolver `keep` — sem
  // bump de versão, a revogação não chegaria ao banco.
  letterboxd: "cinerie-source-auth/letterboxd/2026-08-v2-revogada",
  filmaffinity: "cinerie-source-auth/filmaffinity/2026-08-v2-revogada",
};

/**
 * ============ REVOGAÇÃO DE EXIBIÇÃO — decisão de 2026-08-13 ============
 *
 * QUEM DECIDIU: Pablo Eduardo — proprietário da Cinerie.
 *
 * O QUE FOI DECIDIDO: **Letterboxd e FilmAffinity deixam de ser autorizadas para
 * exibição.** A licença continua declarada aqui, mas com `displayAllowed: false`,
 * `scoreAllowed: false` e **sem decisão `rating_display`** — só o armazenamento
 * interno permanece.
 *
 * POR QUÊ: nenhuma das duas alimenta o produto. A OMDb não as serve, elas não
 * têm janela em `RATING_STALE_POLICY` (logo `evaluateRatingFreshness` devolve
 * `unknown-policy` e a nota é inexibível ESTRUTURALMENTE), e as linhas órfãs em
 * produção estão pendentes de limpeza. Manter uma licença que autoriza exibir o
 * que nunca vai ao ar produzia um crédito no rodapé para uma fonte que não
 * aparece em lugar nenhum — afirmação pública sem lastro.
 *
 * POR QUE A ENTRADA NÃO FOI SIMPLESMENTE APAGADA — e isto é o ponto:
 *
 *   `planAuthorization` faz `entries.map(...)`. Ele **só visita o que está no
 *   spec**. Uma licença que existe no banco e some daqui NUNCA é visitada: não
 *   vira `supersede`, não é desativada, e permanece `is_current = true` para
 *   sempre — autorizando exibição, sem nada no repositório declarando isso.
 *
 *   Apagar a entrada seria, portanto, o pior dos dois mundos: o crédito sumiria
 *   do rodapé (que lê o spec) enquanto a autorização continuaria viva no banco.
 *   Exatamente a combinação que a migração de créditos existe para impedir.
 *
 * COMO A REVOGAÇÃO CHEGA AO BANCO: pelo caminho de supersede que já existe e já
 * é testado. `licenseMatches` reprova (display/score/versão mudaram) => o
 * registry emite `supersede`, a licença de julho vira `is_current = false`
 * (histórico preservado, nunca apagada) e as decisões dela são desativadas.
 * Requer `pnpm legal sources apply ... --confirm` em produção — decisão humana,
 * como sempre. O subcomando é `sources apply`, e `--confirm` exige `--reviewer`
 * E `--policy-version`, esta última com o valor EXATO de `AUTHORIZATION_BATCH`
 * (qualquer outro sai com erro de uso e não escreve nada). A linha completa está
 * em `services/legal/README.md` — não a reescreva de memória.
 *
 * O QUE **NÃO** FOI DECIDIDO: remover as fontes do vocabulário canônico.
 * `RATING_SOURCES` e `RATING_SCALES` seguem intactos — a escala do Letterboxd
 * continua sendo 5, e `validateRating` continua reconhecendo as duas. Revogar
 * exibição não é apagar a existência da fonte.
 * ======================================================================
 */
const DISPLAY_REVOKED_SOURCES: readonly string[] = ["letterboxd", "filmaffinity"];

const DISPLAY_REVOKED_NOTE =
  " EXIBICAO REVOGADA (decisao de Pablo Eduardo, 2026-08-13): display_allowed=false, score_allowed=false e SEM decisao rating_display — so armazenamento interno. Motivo: a fonte nao alimenta o produto (nao e servida pela OMDb e nao tem janela em RATING_STALE_POLICY, logo a nota e inexibivel estruturalmente), e manter a autorizacao produzia credito publico no rodape para uma fonte que nao aparece. A entrada NAO foi apagada do spec de proposito: planAuthorization so visita o que esta no spec, entao uma licenca ausente daqui ficaria orfa e vigente no banco. Reverter exige nova decisao humana.";

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
  const displayRevoked = DISPLAY_REVOKED_SOURCES.includes(source);

  const baseNotes = servedByOmdb
    ? OMDB_NOTES_BASE + (requiresLinkback ? LINKBACK_REQUIRED_NOTE : LINKBACK_DISPENSED_NOTE)
    : "Fonte editorial via Film & Show Ratings API (RapidAPI), fornecedor tecnico intermediario. Logo e citacao integral de critica NAO autorizados.";
  const notes = displayRevoked ? baseNotes + DISPLAY_REVOKED_NOTE : baseNotes;

  /**
   * Armazenamento interno: existe para TODA fonte, revogada ou não. É o que
   * mantém a linha auditável em `external_ratings` sem autorizar exibição.
   */
  const internalAnalytics: DecisionTarget = {
    useCase: "internal_analytics",
    territory: null,
    stage: "approved_for_internal_use",
    displayAllowed: false,
    storageAllowed: true,
    derivativeAllowed: false,
    attributionRequired: true,
    linkbackRequired: requiresLinkback,
    policyVersion: policy,
  };

  /**
   * A decisão de EXIBIR. Fonte revogada não emite nenhuma: sem decisão
   * `approved_for_display`, o trigger `external_ratings_display_guard` não tem
   * o que aprovar e a nota nunca pode ir ao ar — a revogação é estrutural, não
   * uma flag que alguém possa religar sozinho.
   */
  const ratingDisplay: DecisionTarget = {
    useCase: "rating_display",
    territory: CINERIE_TERRITORY,
    stage: "approved_for_display",
    displayAllowed: true,
    storageAllowed: true,
    derivativeAllowed: false,
    attributionRequired: true,
    linkbackRequired: requiresLinkback,
    policyVersion: policy,
  };

  return {
    label: displayRevoked ? `${source} (exibicao revogada)` : source,
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
      displayAllowed: !displayRevoked,
      logoAllowed: false,
      // A nota (o número) segue a exibição: revogar a exibição e deixar
      // `scoreAllowed: true` descreveria um estado que não existe.
      scoreAllowed: !displayRevoked,
      reviewQuoteAllowed: false,
      // Continua `true` mesmo revogada: a obrigação de creditar não some porque
      // a exibição parou — ela volta junto no dia em que a exibição voltar.
      requiresAttribution: true,
      requiresLinkback,
      attributionText: RATING_ATTRIBUTION[source]!,
      policyVersion: policy,
      notes,
    },
    decisions: displayRevoked ? [internalAnalytics] : [ratingDisplay, internalAnalytics],
  };
}

/**
 * ============ PREMIACAO (`entity_awards`) — DECISAO DE 2026-08-13 ============
 *
 * QUEM DECIDIU: Pablo Eduardo — proprietario da Cinerie (mesma identidade de
 * `DECIDED_BY`).
 *
 * O QUE FOI DECIDIDO: o fato de premiacao ("Venceu 4 Oscars. 160 vitorias · 220
 * indicacoes") e creditado a **OMDb**, com o texto
 * **"Dados de premiacao fornecidos por OMDb"**.
 *
 * POR QUE ISTO NAO VIOLA A INVARIANTE 2. A invariante existe porque uma NOTA e
 * uma OPINIAO: `8,5/10` pertence a quem julgou, e por isso IMDb, Rotten Tomatoes
 * e Metacritic sao creditados separadamente mesmo chegando todos pela OMDb —
 * colapsa-los seria mentira, e o guard de `external_ratings` continua recusando
 * essa igualdade, intocado.
 *
 * Um PREMIO nao e opiniao. E fato publico: "Inception venceu 4 Oscars" e verdade
 * independentemente de quem conta, e quem premiou foi a Academia — nao o IMDb,
 * nao a OMDb, nao a Cinerie. Nao existe autoria editorial a proteger, porque nao
 * existe juizo. Logo a pergunta que a invariante faz ("de quem e essa
 * opiniao?") nao se aplica, e sobra a que tem resposta unica, verificavel e nao
 * contestada: **quem entregou este dado?** A OMDb.
 *
 * O VERBO CARREGA A DECISAO. "fornecidos por" e transporte, nao autoria — e por
 * isso o texto NAO segue a forma curta da casa ("Premiacao fornecida por OMDb"),
 * que se leria como se a OMDb tivesse PREMIADO alguem. A forma longa e mais
 * feia e diz a coisa certa; a feiura fica.
 *
 * POR QUE NAO O IMDb: o payload nao o nomeia (`Ratings[]` traz `Source` em cada
 * item; `Awards` e string de topo sem rotulo) e a OMDb nega a afiliacao por
 * escrito ("This site is not endorsed by or affiliated with IMDb.com").
 * Credita-lo seria afirmar proveniencia que nao se consegue provar — a mesma
 * familia de defeito que a PR #164 consertou no streaming.
 *
 * Historico completo da pergunta, da evidencia levantada e da decisao:
 * `docs/legal/omdb-awards-source-provenance.md`.
 * ======================================================================
 */

/**
 * `content_type` da licenca de premiacao. `other` porque premio nao e nota,
 * nao e oferta, nao e imagem e nao e texto de noticia — e nenhum valor novo do
 * enum e necessario para dize-lo.
 */
export const AWARDS_LICENSE_CONTENT_TYPE = "other" as const;

/** `use_case` que autoriza exibir o fato de premiacao. */
export const AWARDS_DISPLAY_USE_CASE = "awards_display" as const;

/** Fonte creditada pelo fato de premiacao (decisao de 2026-08-13). */
export const AWARDS_SOURCE_KEY = "omdb";

/**
 * Credito exibido ao lado do fato, DENTRO da faixa.
 *
 * "Dados de premiacao fornecidos por" — e nao "Premiacao fornecida por", a forma
 * curta usada nas notas e nas ofertas. A forma curta se leria como se a OMDb
 * tivesse concedido o premio. Quem premia e a Academia; a OMDb entrega o dado.
 */
export const AWARDS_ATTRIBUTION_TEXT = "Dados de premiacao fornecidos por OMDb";

/**
 * Versao de politica DA FONTE (mesmo molde por fonte de `RATING_POLICY`).
 *
 * NAO e a leva: a leva continua sendo `AUTHORIZATION_BATCH`, e e ela que o
 * `--policy-version` da CLI exige. Nenhuma leva nova foi criada aqui.
 */
export const AWARDS_POLICY_VERSION = "cinerie-source-auth/omdb/2026-08-v1";

/**
 * A entrada de autorizacao de premiacao.
 *
 * `sourceKey` e quem RECEBE O CREDITO do fato. Para premiacao ele e o proprio
 * fornecedor (`omdb`) — ver a decisao acima —, e `providerKey` registra o mesmo
 * valor porque e por ali que o dado chega. Os dois campos continuam separados no
 * schema; o que mudou e que, para um FATO, eles coincidem sem mentir.
 *
 * Continua sendo uma FUNCAO, e nao um literal inline, porque e ela que documenta
 * a forma exigida quando a fonte mudar (um agregador de premios de verdade, por
 * exemplo): trocar a fonte e trocar os argumentos, nao reescrever a entrada.
 */
export function awardsAuthorizationEntry(input: {
  readonly sourceKey: string;
  readonly attributionText: string;
  readonly policyVersion: string;
  readonly requiresLinkback: boolean;
  readonly notes: string;
}): AuthorizationEntry {
  return {
    label: `Premiacao: ${input.sourceKey}`,
    role: "editorial-rating-source",
    license: {
      sourceKey: input.sourceKey,
      contentType: AWARDS_LICENSE_CONTENT_TYPE,
      // Premio nao e nota: nao ha `rating_sources.key` a apontar, e o CHECK do
      // banco so exige `rating_source_key` quando content_type='rating'.
      ratingSourceKey: null,
      providerKey: AWARDS_SOURCE_KEY === input.sourceKey ? input.sourceKey : "omdb",
      territory: CINERIE_TERRITORY,
      // `third_party`, nunca `official`: a OMDb entrega o dado, mas nao e a
      // autoridade que concedeu o premio (isso e a Academia, o BAFTA, o Emmy).
      licenseStatus: "third_party",
      displayAllowed: true,
      logoAllowed: false,
      // Premio nao tem escala nem numero de nota. `score_allowed` governa o
      // NUMERO DA NOTA (regra de ratings secao 5) e nao e lido pelo gate de
      // premiacao — deixa-lo false mantem a licenca minima.
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: input.requiresLinkback,
      attributionText: input.attributionText,
      policyVersion: input.policyVersion,
      notes: input.notes,
    },
    decisions: [
      {
        useCase: AWARDS_DISPLAY_USE_CASE,
        territory: CINERIE_TERRITORY,
        stage: "approved_for_display",
        displayAllowed: true,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: input.requiresLinkback,
        policyVersion: input.policyVersion,
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
  // TMDB — VÍDEO (trailers/teasers). Decisão de 13/08/2026, e é a PRIMEIRA vez
  // que este content_type é decidido: até aqui `tmdb_videos` era ingerida e
  // nascia `display_allowed=false` sem nenhuma licença que pudesse liberá-la.
  //
  // O QUE ESTÁ SENDO AUTORIZADO, EXATAMENTE. O metadado do vídeo vindo da API
  // oficial do TMDB: `site`, `video_key`, `video_type`, `official`, idioma. Não
  // é o vídeo — o arquivo nunca passa por nós, não é baixado, não é
  // rehospedado, não é recortado. O player é do YouTube e roda sob os termos do
  // Google; o leitor os aciona por clique explícito, e a política de
  // privacidade publicada declara isso no item 6.1.
  //
  // Por isso `derivativeAllowed` continua false: exibir o player de terceiro
  // não é derivar obra nova a partir do dado do TMDB.
  {
    label: "TMDB (trailers)",
    role: "catalog-provider",
    license: {
      sourceKey: "tmdb",
      contentType: "video",
      ratingSourceKey: null,
      providerKey: "tmdb",
      territory: null,
      licenseStatus: "official",
      displayAllowed: true,
      // Logo do TMDB e do YouTube seguem bloqueados: nenhuma marca de terceiro
      // é desenhada por nós. O crédito é textual, no rodapé.
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      policyVersion: "cinerie-source-auth/tmdb-video/2026-08-v1",
      notes:
        "Metadado de VIDEO (site/key/tipo/idioma) via API oficial do TMDB, para localizar o trailer. O arquivo de video NAO e baixado, reproduzido por nos nem rehospedado: o player e do YouTube e carrega apenas apos clique explicito do leitor (politica de privacidade, item 6.1). Disclaimer do TMDB obrigatorio no rodape.",
    },
    decisions: [
      // Mesmo eixo das outras duas entradas TMDB: a exibição de CATÁLOGO
      // antecede o eixo use_case, e não existe caso de uso de vídeo em
      // DATA_USAGE_CASES. Inventar um aqui criaria vocabulário novo numa PR de
      // licença — a decisão registrada é a de armazenamento, e quem libera a
      // exibição é a licença-mãe acima.
      {
        useCase: "internal_analytics",
        territory: null,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        attributionRequired: true,
        linkbackRequired: true,
        policyVersion: "cinerie-source-auth/tmdb-video/2026-08-v1",
      },
    ],
  },
  ...["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"].map(ratingEntry),
  // PREMIACAO — o FATO ("Venceu 4 Oscars"), creditado a quem o entregou.
  // Decisao de 2026-08-13; o raciocinio inteiro esta no bloco de premiacao
  // abaixo e em docs/legal/omdb-awards-source-provenance.md.
  //
  // LINKBACK DISPENSADO, e o motivo e MECANICO, nao de politica: `apply.ts` nao
  // escreve `terms_url` (a coluna nao esta no INSERT de `source_licenses`), e o
  // lookup de credito de premiacao le `terms_url` como URL de linkback. Com
  // `requiresLinkback: true` a faixa cairia em `missing-linkback` para SEMPRE —
  // exatamente o que aconteceria com Rotten Tomatoes e Metacritic antes da
  // dispensa nominal delas. O credito TEXTUAL continua obrigatorio.
  //
  // REVERSAO AUTOMATICA, ja armada: `requiresLinkback: false` significa "nao
  // EXIGE link", nunca "nao PODE ter". No dia em que `terms_url` for preenchido
  // (por `apply.ts` ou a mao), o lookup passa a devolver a URL e a faixa exibe
  // COM link no ciclo seguinte do worker, sem nova decisao humana. A checagem de
  // HTTPS continua valendo, entao um link ruim nunca passa.
  awardsAuthorizationEntry({
    sourceKey: AWARDS_SOURCE_KEY,
    attributionText: AWARDS_ATTRIBUTION_TEXT,
    policyVersion: AWARDS_POLICY_VERSION,
    requiresLinkback: false,
    notes:
      "Fato de premiacao (campo Awards da OMDb), promovido de api_cache para entity_awards. " +
      "Premio e FATO PUBLICO, nao opiniao: quem premiou foi a Academia/BAFTA/Emmy, e nao ha " +
      "autoria editorial a proteger. Por isso o credito e de quem ENTREGOU o dado (OMDb) e o " +
      "verbo e 'fornecidos por', nunca 'apurados por'. NAO se aplica a notas: la vale a " +
      "invariante 2 e o guard de external_ratings continua recusando provider=fonte. " +
      "Logo NAO autorizado (logo_allowed=false). Linkback dispensado por limitacao mecanica " +
      "(apply.ts nao escreve terms_url); credito textual obrigatorio. " +
      "Decisao de Pablo Eduardo, 2026-08-13: docs/legal/omdb-awards-source-provenance.md.",
  }),
  // Movie of the Night — AGREGADOR de streaming (via Streaming Availability API,
  // RapidAPI). NÃO é um provedor de streaming (Netflix, etc.) — por isso
  // content_type='other', não 'watch_availability'. A exibição de cada OFERTA é
  // gated por decisão watch_offer_display POR PROVEDOR CANÔNICO (gerada
  // dinamicamente; ver plan.ts).
  //
  // ONDE A ATRIBUIÇÃO APARECE mudou em 13/08/2026 (decisão de Pablo Eduardo):
  // era "perto do painel de streaming", passou a ser o RODAPÉ GLOBAL, junto com
  // todo crédito de fonte. `requiresAttribution` continua `true` — mudou o
  // endereço, nunca a obrigação. A projeção pública vive em `public-credits.ts`.
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
        "Agregador de disponibilidade via Streaming Availability API (RapidAPI). Atribuicao obrigatoria no rodape global (decisao de 2026-08-13; antes era perto do painel de streaming). A exibicao de ofertas depende de provedores canonicos registrados e suas decisoes watch_offer_display (por provedor).",
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
 * Os créditos das origens de streaming, expostos para a PROJEÇÃO PÚBLICA.
 *
 * `STREAMING_ORIGINS` continua privado (o `note` é auditoria interna, não vai
 * para a tela). O que sai daqui é só o texto de atribuição — a letra da licença.
 *
 * Por que isto precisa existir: as licenças de streaming nascem por PROVEDOR
 * CANÔNICO, dinamicamente, a partir do que existe em `watch_providers`. Elas não
 * estão em `STATIC_AUTHORIZATION`. Sem esta lista, o rodapé só conheceria o
 * JustWatch depois que alguém registrasse um provedor — e o crédito ao JustWatch
 * é exigido NOMINALMENTE pelos termos do endpoint `watch/providers` do TMDB, sob
 * pena de revogação do acesso à API que sustenta o catálogo inteiro.
 *
 * Consumido por `public-credits.ts`.
 */
export const STREAMING_ORIGIN_CREDITS: readonly { readonly attributionText: string }[] =
  STREAMING_ORIGINS.map((origin) => ({ attributionText: origin.attributionText }));

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
