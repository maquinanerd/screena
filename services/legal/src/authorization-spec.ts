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
 *  - `reviewQuoteAllowed` é SEMPRE false. Liberar citação integral de crítica
 *    exige autorização específica que não existe.
 *  - `logoAllowed` carrega BASE por entrada (`logoBasis`), porque existem duas
 *    origens de permissão e o registro não pode confundi-las:
 *      `source_terms`   — os termos da própria fonte exigem/concedem a marca
 *                         (caso TMDB: "You must use the TMDB logo to identify
 *                         Your use of TMDB, the TMDB APIs, or TMDB Content").
 *      `owner_decision` — decisão do PROPRIETÁRIO (Pablo Eduardo, 20/08/2026,
 *                         ver `OWNER_DECISION_2026_08_20`), que assumiu o risco
 *                         por escrito. O registro grava a base como decisão do
 *                         dono — nunca como "a fonte permitiu".
 *    Cada entrada carrega `logoRationale` obrigatório — o que se SABE do regime
 *    de marca daquele titular (pesquisa de 20/08/2026), que decide QUAL arquivo
 *    usar e em que placement, nunca mais SE exibe.
 *  - O crédito TEXTUAL nunca sai. Os termos do TMDB pedem os DOIS (logo **e**
 *    disclaimer); logo jamais substitui atribuição — em nenhuma fonte.
 *  - `derivativeAllowed` só é true na decisão `cinerie_score_display`, com
 *    `derivativeBasis: "owner_decision"` — a autorização é do proprietário
 *    (20/08/2026), registrada como tal. Qualquer outra decisão com derivada é
 *    inválida e derruba o apply (`assertNoBlockedGrants`).
 *  - Nada aqui promove dado: o registry mexe só em licenças e decisões, nunca
 *    liga `display_allowed` de um rating ou de uma oferta.
 *  - `license_status` reflete a origem REAL: `official` só para a API/fonte
 *    oficial; `third_party` quando o dado chega por fornecedor intermediário
 *    (RapidAPI / Film&Show Ratings / Streaming Availability). Não é tudo
 *    `official`.
 */

import { CINERIE_SCORE_DECISION_POLICY, type DataUsageCase } from "@screena/config";

/** Território de publicação do produto (pt-BR/Brasil). */
export const CINERIE_TERRITORY = "BR";

/** Identidade humana que decidiu. Nunca "agent"/"system". */
export const DECIDED_BY = "Pablo Eduardo — proprietário da Cinerie";

/** Motivo canônico registrado em toda decisão/licença desta autorização. */
export const AUTHORIZATION_REASON =
  "Autorizacao de reproducao, armazenamento e exibicao para finalidade informativa, editorial e jornalistica, condicionada a creditos, linkback e disclaimers publicos.";

/** Rótulo da leva de autorização (o `--policy-version` do apply). */
export const AUTHORIZATION_BATCH = "cinerie-source-auth/2026-08-v2";

/**
 * ============ A DECISÃO DO PROPRIETÁRIO — 20/08/2026 ============
 *
 * QUEM DECIDIU: Pablo Eduardo, proprietário da Cinerie, por escrito, em
 * 20/08/2026:
 *
 *   "É pra ter tudo que está pendente, incluindo as logos, é referência,
 *    jornalismo. Os trailers, vídeos, a mesma coisa. Estou autorizando."
 *
 *   "Eu quero, faça, não me pergunte mais. Eu assumo todos os riscos. Acabou
 *    suas consultas. O que eu pedir, faça."
 *
 * O QUE FOI DECIDIDO:
 *  1. `derivative_allowed = true` para o Cinerie Score (fontes imdb, tmdb,
 *     rotten_tomatoes, metacritic) — a decisão `cinerie_score_display` passa a
 *     ser emitida por este spec, sob a licença do IMDb (a fonte de maior
 *     cobertura), com `derivativeBasis: "owner_decision"`.
 *  2. `logo_allowed = true` em todas as fontes de nota exibíveis (imdb,
 *     rotten_tomatoes, metacritic), nos provedores de streaming registrados e
 *     no JustWatch — com `logoBasis: "owner_decision"`.
 *
 * DUAS RECUSAS ANTERIORES FORAM REVOGADAS por esta decisão: a recusa de emitir
 * `derivative_allowed` (registrada em
 * docs/legal/cinerie-score-derivative-authorization.md) e o carimbo em bloco de
 * `logo_allowed = false` nos provedores de streaming. O registro diz a VERDADE
 * sobre quem autorizou: a base é a decisão do proprietário, não os termos das
 * fontes — e é exatamente por isso que `logoBasis`/`derivativeBasis` existem.
 *
 * O QUE NÃO MUDOU (técnica, não ressalva): imdb != rotten_tomatoes; crédito
 * textual permanece ao lado do logo; nenhum logo hardcoded em página (só via
 * licença + arquivo declarado); zero API externa no render.
 *
 * Documento canônico: docs/legal/owner-authorization-2026-08-20.md.
 * ================================================================
 */
export const OWNER_DECISION_2026_08_20 = {
  decidedBy: DECIDED_BY,
  decidedOn: "2026-08-20",
  quote:
    "E pra ter tudo que esta pendente, incluindo as logos, e referencia, jornalismo. " +
    "Os trailers, videos, a mesma coisa. Estou autorizando. [...] Eu quero, faca, nao " +
    "me pergunte mais. Eu assumo todos os riscos.",
} as const;

/** Base de uma permissão de marca/derivada: termos da fonte, ou decisão do dono. */
export type AuthorizationBasis = "source_terms" | "owner_decision";

/**
 * Nota curta gravada em `notes`/`reason` de toda linha cuja permissão nasce da
 * decisão do proprietário. É o registro dizendo DE ONDE veio a permissão.
 */
export const OWNER_DECISION_NOTE =
  "BASE DA PERMISSAO: decisao do proprietario (Pablo Eduardo, 2026-08-20) — nao os termos " +
  "da fonte. Registro canonico em docs/legal/owner-authorization-2026-08-20.md.";

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

/**
 * O arquivo oficial da marca de uma fonte, declarado pela LICENCA.
 *
 * `status` e o ponto do contrato. Uma marca de terceiro so pode ir ao ar a
 * partir do arquivo que o proprio detentor publica para atribuicao. Enquanto
 * esse arquivo nao estiver no repositorio, `pending_official_file` mantem o
 * render em texto puro e faz a ausencia FALAR (`SectionBoundary`) — nunca
 * desenha uma aproximacao.
 *
 * Trocar para `present` e um ato deliberado: significa "o arquivo em `path` e o
 * oficial, baixado de `officialSourceUrl`".
 */
export interface LicenseLogoAsset {
  /** Caminho publico servido por `apps/web/public` (ex.: `/brand/sources/x.svg`). */
  readonly path: string;
  /** Onde o DETENTOR publica o arquivo oficial. Nunca um espelho de terceiro. */
  readonly officialSourceUrl: string;
  /** Texto alternativo. Nomeia a marca; nunca "logo" solto. */
  readonly alt: string;
  /** Altura de exibicao em px. O logo e SUBORDINADO a marca do site (termos TMDB). */
  readonly displayHeightPx: number;
  /**
   * `present` = o arquivo oficial esta no repositorio e pode ir ao ar.
   * `pending_official_file` = a licenca EXIGE/permite o logo, mas o arquivo
   * ainda nao foi colocado. Render fica textual e registra a ausencia.
   */
  readonly status: "present" | "pending_official_file";
}

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
  /**
   * Exibir a MARCA GRAFICA da fonte.
   *
   * Era `false` LITERAL no tipo ate 20/08/2026, com a justificativa "liberar
   * logo exige autorizacao especifica que nao existe". A leitura dos termos
   * fonte por fonte mostrou que a frase estava certa para cinco fontes e
   * ERRADA para uma: o TMDB nao PERMITE o logo, ele o EXIGE.
   *
   *   "You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs,
   *    or TMDB Content." (Termos de uso da API, secao 3 — Attribution)
   *
   * Com `false` literal no tipo, o repositorio estava em DESCUMPRIMENTO e nao
   * tinha como sair sem mudar o tipo. Por isso ele virou `boolean` — nao para
   * relaxar a regra, mas porque a regra nao era a mesma para todas as fontes.
   *
   * Continua valendo, e agora e afirmado por entrada (ver `logoRationale`):
   * autorizacao do dono NAO cria direito que a fonte nao deu. Cinco das seis
   * fontes seguem `false`, cada uma com o motivo escrito.
   */
  readonly logoAllowed: boolean;
  /**
   * DE ONDE vem a permissao de marca, quando `logoAllowed`. `null` quando nao.
   *
   * `source_terms` = os termos da fonte exigem/concedem (caso TMDB).
   * `owner_decision` = decisao do proprietario (2026-08-20), registrada como
   * tal — o registro nunca afirma "a fonte permitiu" quando quem permitiu foi
   * o dono. Ver `OWNER_DECISION_2026_08_20`.
   */
  readonly logoBasis: AuthorizationBasis | null;
  /**
   * O QUE SE SABE do regime de marca deste titular. Obrigatorio, sempre.
   *
   * Desde 20/08/2026 este campo nao decide mais SE o logo entra (isso e
   * `logoAllowed` + `logoBasis`): ele registra a pesquisa por titular — pagina
   * oficial de marca, condicoes de placement, qual arquivo usar. Existe porque
   * regime sem registro escrito e indistinguivel de "ninguem olhou". Foi assim
   * que o credito de "Movie of the Night" acabou em dado da TMDB: uma regra
   * global aplicada a fontes de regime diferente.
   */
  readonly logoRationale: string;
  /**
   * O ARQUIVO oficial da marca, quando `logoAllowed`. `null` quando nao.
   *
   * A pagina NUNCA desenha um logo: ela le o que a licenca declara. Um SVG
   * escrito a mao dentro do componente seria uma marca de terceiro reproduzida
   * por aproximacao — pior que ausencia, porque uma marca distorcida e
   * violacao, nao cortesia.
   */
  readonly logoAsset: LicenseLogoAsset | null;
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
  readonly useCase: DataUsageCase;
  readonly territory: string | null;
  readonly stage: "approved_for_display" | "approved_for_internal_use";
  readonly displayAllowed: boolean;
  readonly storageAllowed: boolean;
  /**
   * `true` SOMENTE na decisão `cinerie_score_display`, e sempre acompanhado de
   * `derivativeBasis: "owner_decision"` — o Cinerie Score é obra derivada e a
   * autorização é do proprietário (2026-08-20). Qualquer outra combinação
   * derruba o apply em `assertNoBlockedGrants`.
   */
  readonly derivativeAllowed: boolean;
  /** Base da derivada quando `derivativeAllowed`; `null` quando não. */
  readonly derivativeBasis: AuthorizationBasis | null;
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

/**
 * O arquivo oficial da marca do TMDB.
 *
 * `pending_official_file` de proposito, e a distincao importa: a LICENCA ja diz
 * `logoAllowed: true` (os termos EXIGEM o logo). O que falta e o ARQUIVO — e a
 * unica origem legitima dele e a pagina de logos do proprio TMDB. Desenhar uma
 * aproximacao de marca registrada dentro de um componente seria pior que a
 * ausencia: marca distorcida e violacao, nao cortesia. Enquanto o status for
 * este, o rodape credita em TEXTO e registra a ausencia com `SectionBoundary`
 * (nada falha em silencio); no dia em que o arquivo entrar e o status virar
 * `present`, o logo sobe sem tocar em componente nenhum.
 */
export const TMDB_LOGO_ASSET: LicenseLogoAsset = {
  path: "/brand/sources/tmdb-primary.svg",
  officialSourceUrl: "https://www.themoviedb.org/about/logos-attribution",
  alt: "TMDB",
  // Subordinado a marca do site, como os termos exigem. 13px: o wordmark do
  // TMDB e LONGO (489x35 no viewBox), entao a altura e o unico controle — a
  // 13px ele ocupa ~180px de largura, contra os 150px do wordmark da Cinerie
  // no rodape, e some na linha de creditos em vez de dominar a faixa.
  // A altura so vale porque ha CSS para `.footer__credit-logo`: o atributo
  // `height` do <img> e anulado pelo reset global (`img { height: auto }`).
  displayHeightPx: 13,
  // `present` desde 2026-08-20: o arquivo em `path` e o "Primary long (blue)"
  // baixado da pagina oficial de logos do TMDB (officialSourceUrl), byte a
  // byte. Trocar o arquivo exige rebaixar para pending ate o novo oficial
  // entrar.
  status: "present",
};

/**
 * O REGIME DE MARCA de cada fonte de nota (pesquisa de 20/08/2026).
 *
 * Uma entrada por fonte, porque os regimes sao diferentes. Desde 20/08/2026 o
 * texto nao decide mais SE o logo entra — a decisao e do proprietario
 * (`OWNER_DECISION_2026_08_20`). O texto registra o que cada titular publica:
 * qual arquivo oficial existe, onde, e com que regras de placement — e o que
 * ainda falta para o arquivo entrar no repositorio.
 */
const LOGO_RATIONALE_BY_RATING_SOURCE: Readonly<Record<string, string>> = {
  imdb:
    "Logo por decisao do proprietario (2026-08-20). Regime do titular: o IMDb publica um " +
    "Design Toolkit em brand.imdb.com/imdb (logos, tipografia, cores) e as diretrizes pedem " +
    "o statement \"IMDb, IMDb.COM, and the IMDb logo are trademarks of IMDb.com, Inc. or its " +
    "affiliates\" junto ao uso, logo isolado e com clear space; usos fora das guidelines " +
    "passam por trademarks@amazon.com. Arquivo pendente no repositorio " +
    "(pending_official_file); ate ele entrar, a coluna usa a palavra-marca na mesma caixa. " +
    "Credito textual permanece: \"Nota fornecida por IMDb\".",
  rotten_tomatoes:
    "Logo por decisao do proprietario (2026-08-20). Regime do titular: os assets oficiais " +
    "so sao entregues apos aprovacao pelo Business Proposal Form " +
    "(rottentomatoes.com/help_desk/licensing), e o ICONE E VINCULADO A FAIXA DA NOTA — " +
    "Fresh/Hot Popcorn >= 60%, Rotten Splat/Stale Popcorn <= 59%, Certified Fresh >= 75%, " +
    "sempre a esquerda do numero e sem alteracao. PLACEMENT OBRIGATORIO quando o arquivo " +
    "entrar: o asset escolhido tem que respeitar a faixa da nota exibida; icone errado para " +
    "a faixa e pior que nenhum. Ate o arquivo entrar (pending_official_file), palavra-marca " +
    "na mesma caixa. Tomatometer e Popcornmeter pertencem SO ao Rotten Tomatoes (inv. 1).",
  metacritic:
    "Logo por decisao do proprietario (2026-08-20). Regime do titular: nao ha brand kit " +
    "publico; as diretrizes de dados (Fabric/Origin, distribuidor oficial) preveem " +
    "\"Metascore with the Metacritic logo, wordmark and review count\" em site de terceiro, " +
    "com assets entregues na parceria licenciada. Grafia: so o M maiusculo. Arquivo pendente " +
    "(pending_official_file); ate entrar, palavra-marca na mesma caixa.",
  letterboxd:
    "Sem exibicao, logo sem marca: a EXIBICAO da fonte foi revogada em 2026-08-13 " +
    "(DISPLAY_REVOKED_SOURCES) e um logo para uma fonte que nao aparece seria afirmacao " +
    "sem lastro. A decisao do proprietario de 2026-08-20 cobre as fontes EXIBIVEIS; esta " +
    "nao e uma delas ate nova decisao de exibicao.",
  filmaffinity:
    "Sem exibicao, logo sem marca: mesma situacao do Letterboxd — exibicao revogada em " +
    "2026-08-13; logo de fonte invisivel seria afirmacao sem lastro. Fora do escopo da " +
    "decisao de 2026-08-20 ate nova decisao de exibicao.",
};

/** Fallback FAIL-CLOSED: fonte de nota nova nasce sem logo e com o motivo dito. */
const LOGO_RATIONALE_RATING_DEFAULT =
  "Sem base: fonte de nota sem regime de marca avaliado. Bloqueado por padrao (fail-closed) " +
  "ate alguem ler os termos dela e escrever o motivo aqui.";

/**
 * O arquivo oficial da marca de cada fonte de nota EXIBIVEL, por fonte.
 *
 * Todos `pending_official_file`: a licenca ja autoriza (decisao do dono), o
 * ARQUIVO ainda nao esta no repositorio. `officialSourceUrl` e onde o titular
 * publica/entrega o oficial (pesquisa de 2026-08-20). Quando o arquivo entrar
 * em `path` e o status virar `present`, o logo sobe sem tocar em componente.
 */
const RATING_LOGO_ASSETS: Readonly<Record<string, LicenseLogoAsset>> = {
  imdb: {
    path: "/brand/sources/imdb.svg",
    officialSourceUrl: "https://brand.imdb.com/imdb",
    alt: "IMDb",
    displayHeightPx: 18,
    status: "pending_official_file",
  },
  rotten_tomatoes: {
    path: "/brand/sources/rotten-tomatoes.svg",
    officialSourceUrl: "https://www.rottentomatoes.com/help_desk/licensing",
    alt: "Rotten Tomatoes",
    displayHeightPx: 18,
    status: "pending_official_file",
  },
  metacritic: {
    path: "/brand/sources/metacritic.svg",
    officialSourceUrl: "https://knowledgebase.fabricdata.com/origin/apis-all/metacritic-api-docs",
    alt: "Metacritic",
    displayHeightPx: 18,
    status: "pending_official_file",
  },
};

const RATING_ATTRIBUTION: Record<string, string> = {
  imdb: "Nota fornecida por IMDb",
  rotten_tomatoes: "Nota fornecida por Rotten Tomatoes",
  metacritic: "Nota fornecida por Metacritic",
  letterboxd: "Nota fornecida por Letterboxd",
  filmaffinity: "Nota fornecida por FilmAffinity",
};

const RATING_POLICY: Record<string, string> = {
  // As três fontes servidas pela OMDb sobem para `2026-08-v2`: a autorização de
  // marca por decisão do proprietário (20/08/2026) é mudança material e gera
  // versão nova de licença, com histórico — nunca um UPDATE silencioso sobre a
  // v1 de agosto (que registrou a troca de fornecedor e a dispensa de linkback).
  imdb: "cinerie-source-auth/imdb/2026-08-v2",
  rotten_tomatoes: "cinerie-source-auth/rotten-tomatoes/2026-08-v2",
  metacritic: "cinerie-source-auth/metacritic/2026-08-v2",
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
 * Fontes de nota cuja MARCA foi autorizada pela decisao do proprietario
 * (2026-08-20). Sao as exibiveis; Letterboxd/FilmAffinity ficam fora porque a
 * exibicao delas esta revogada — logo de fonte invisivel seria afirmacao sem
 * lastro (decisao registrada; reverter exige nova decisao de EXIBICAO antes).
 */
const OWNER_LOGO_GRANTED_RATING_SOURCES: readonly string[] = [
  "imdb",
  "rotten_tomatoes",
  "metacritic",
];

/**
 * A fonte-ancora da decisao `cinerie_score_display` (ver o comentario da
 * decisao em `ratingEntry`): a de maior cobertura do catalogo.
 */
const CINERIE_SCORE_ANCHOR_SOURCE = "imdb";

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
  "Fonte editorial via OMDb API (fornecedor tecnico intermediario, provider_api=omdb), por isso third_party e nunca official. Citacao integral de critica NAO autorizada.";

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
  const withOwnerNote =
    !displayRevoked && OWNER_LOGO_GRANTED_RATING_SOURCES.includes(source)
      ? `${baseNotes} LOGO AUTORIZADO. ${OWNER_DECISION_NOTE}`
      : baseNotes;
  const notes = displayRevoked ? withOwnerNote + DISPLAY_REVOKED_NOTE : withOwnerNote;

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
    derivativeBasis: null,
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
    derivativeBasis: null,
    attributionRequired: true,
    linkbackRequired: requiresLinkback,
    policyVersion: policy,
  };

  /**
   * A decisao que autoriza o CINERIE SCORE (obra derivada das notas).
   *
   * Emitida SOB A LICENCA DO IMDB — a fonte de maior cobertura do catalogo
   * (88%) e a que o validador de producao ja modelava — porque o runtime
   * resolve UMA decisao vigente por use_case; pendura-la nas quatro licencas
   * criaria ambiguidade de resolucao. Se uma formula futura remover o IMDb da
   * composicao, a decisao acompanha a fonte-ancora nova (nova decisao, novo
   * policy_version).
   *
   * `derivativeAllowed: true` com base `owner_decision`: a autorizacao e do
   * proprietario (2026-08-20, ver OWNER_DECISION_2026_08_20), que revogou a
   * recusa anterior e assumiu o risco. O elo decisao->formula e o mapa
   * CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY (@screena/config): a
   * formula aprovada por esta decisao e `cinerie-score/2026-08-v1`, e trocar de
   * formula exige nova decisao — nunca deploy silencioso.
   */
  const cinerieScoreDisplay: DecisionTarget = {
    useCase: "cinerie_score_display",
    territory: CINERIE_TERRITORY,
    stage: "approved_for_display",
    displayAllowed: true,
    storageAllowed: true,
    derivativeAllowed: true,
    derivativeBasis: "owner_decision",
    attributionRequired: true,
    linkbackRequired: requiresLinkback,
    policyVersion: CINERIE_SCORE_DECISION_POLICY,
  };

  const logoGranted = !displayRevoked && OWNER_LOGO_GRANTED_RATING_SOURCES.includes(source);
  const decisions = displayRevoked
    ? [internalAnalytics]
    : source === CINERIE_SCORE_ANCHOR_SOURCE
      ? [ratingDisplay, cinerieScoreDisplay, internalAnalytics]
      : [ratingDisplay, internalAnalytics];

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
      // Fonte EXIBIVEL ganha a marca por decisao do proprietario (2026-08-20);
      // as revogadas ficam fora — logo de fonte invisivel seria afirmacao sem
      // lastro. O regime de cada titular (qual arquivo, que placement) esta em
      // logoRationale; o arquivo oficial esta declarado em logoAsset e entra
      // pendente ate ser colocado no repositorio.
      logoAllowed: logoGranted,
      logoBasis: logoGranted ? "owner_decision" : null,
      logoRationale: LOGO_RATIONALE_BY_RATING_SOURCE[source] ?? LOGO_RATIONALE_RATING_DEFAULT,
      logoAsset: logoGranted ? (RATING_LOGO_ASSETS[source] ?? null) : null,
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
    decisions,
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
      logoBasis: null,
      // A OMDb e o FORNECEDOR do dado de premiacao, e os termos dela nao
      // concedem marca — nem a propria, nem (sobretudo) a de terceiro. Secao 11
      // e explicita: "THIS AGREEMENT DOES NOT APPLY TO THIRD PARTY SITES".
      // Ou seja: a OMDb nao pode licenciar o logo do IMDb, do Rotten Tomatoes
      // nem do Metacritic — nenhum intermediario pode sublicenciar marca alheia.
      // O credito de premiacao continua TEXTUAL.
      logoRationale:
        "Sem base. A OMDb transporta o dado; os termos dela nao concedem uso de marca, " +
        "e a secao 11 exclui expressamente sites de terceiros do acordo — logo, ela nao " +
        "pode sublicenciar a marca de IMDb, Rotten Tomatoes ou Metacritic. Credito textual.",
      logoAsset: null,
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
        derivativeBasis: null,
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
      logoAllowed: true,
      logoBasis: "source_terms",
      logoRationale:
        "EXIGIDO, nao apenas permitido. Termos da API do TMDB, secao 3 (Attribution): " +
        "\"You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or TMDB Content.\" " +
        "Ate 20/08/2026 esta entrada dizia false — o repositorio estava em DESCUMPRIMENTO, nao " +
        "em excesso de zelo. Os mesmos termos impoem o limite: o logo do TMDB deve ser MENOS " +
        "proeminente que a marca que identifica o proprio produto, e nao pode sugerir endosso. " +
        "Por isso o disclaimer textual CONTINUA obrigatorio ao lado dele: os termos pedem os DOIS, " +
        "e o logo nunca substitui o credito.",
      logoAsset: TMDB_LOGO_ASSET,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      policyVersion: "cinerie-source-auth/tmdb/2026-08-v2",
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
        derivativeBasis: null,
        attributionRequired: true,
        linkbackRequired: true,
        policyVersion: "cinerie-source-auth/tmdb/2026-07-v1",
      },
    ],
  },
  // ==========================================================================
  // TMDB — IMAGENS. Decisão do proprietário (Pablo Eduardo, 2026-08-21):
  // `display_allowed` passa a `true`.
  // ==========================================================================
  //
  // O QUE ESTÁ SENDO AUTORIZADO. Pôster, backdrop, still de episódio e foto de
  // perfil, consumidos **pela API do TMDB, sob os termos da API do TMDB**, com
  // atribuição no rodapé e o logo do TMDB aceso. É o uso para o qual a API
  // existe e o uso que os termos cobrem.
  //
  // POR QUE A ENTRADA ESTAVA ERRADA. `false` aqui não descrevia o produto: as
  // imagens do TMDB já iam ao ar em toda página de detalhe, home, busca e
  // elenco — porque **o caminho de imagem não lia licença nenhuma**. O registro
  // estava desalinhado com o comportamento real e com a própria autorização de
  // agosto que ligou `logo_allowed` (mesma leitura de termos, mesma sessão).
  //
  // A ORDEM IMPORTOU, E ELA FOI CUMPRIDA. Este flag só virou `true` DEPOIS de
  // o gate existir (`packages/public-contracts/src/image-authorization.ts` +
  // `apps/web/src/server/image-license.ts`), com controle negativo provando que
  // `false` faz o pôster sumir. Ligar o flag primeiro produziria a tela certa
  // pelo motivo errado, e no dia em que alguém pusesse `false` de volta nada
  // mudaria na tela.
  //
  // AS CONDIÇÕES FICAM AQUI, NÃO NO CÓDIGO:
  //   1. atribuição obrigatória presente (`requiresAttribution`, rodapé);
  //   2. a arte é material de TERCEIRO (estúdio/distribuidora) servido sob os
  //      termos da API — a autorização é de EXIBIR pelo canal do TMDB, nunca de
  //      redistribuir o arquivo;
  //   3. sem alteração que descaracterize a arte (recorte de enquadramento e
  //      escolha de `size` do CDN são permitidos; filtro, montagem, remoção de
  //      marca ou sobreposição que altere a obra, não);
  //   4. sem reivindicação de propriedade sobre a arte.
  //
  // `derivativeAllowed` continua `false` na decisão de uso: exibir a arte de
  // terceiro não é derivar obra nova a partir dela.
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
      displayAllowed: true,
      logoAllowed: true,
      logoBasis: "source_terms",
      logoRationale:
        "EXIGIDO, nao apenas permitido. Termos da API do TMDB, secao 3 (Attribution): " +
        "\"You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or TMDB Content.\" " +
        "Ate 20/08/2026 esta entrada dizia false — o repositorio estava em DESCUMPRIMENTO, nao " +
        "em excesso de zelo. Os mesmos termos impoem o limite: o logo do TMDB deve ser MENOS " +
        "proeminente que a marca que identifica o proprio produto, e nao pode sugerir endosso. " +
        "Por isso o disclaimer textual CONTINUA obrigatorio ao lado dele: os termos pedem os DOIS, " +
        "e o logo nunca substitui o credito.",
      logoAsset: TMDB_LOGO_ASSET,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      // v3: a decisao especifica que a `notes` da v2 dizia estar faltando.
      policyVersion: "cinerie-source-auth/tmdb-image/2026-08-v3",
      notes:
        "Imagens do TMDB (poster, backdrop, still, perfil) EXIBIVEIS sob os termos da API do TMDB, " +
        "decisao do proprietario em 21/08/2026. Condicoes: atribuicao no rodape; a arte e material de " +
        "terceiro servido pelo canal do TMDB (autoriza EXIBIR, nunca redistribuir o arquivo); sem " +
        "alteracao que descaracterize a arte (escolha de `size` do CDN e enquadramento sao permitidos); " +
        "sem reivindicacao de propriedade. O gate de exibicao vive em " +
        "packages/public-contracts/src/image-authorization.ts e le ESTA linha.",
    },
    decisions: [
      {
        useCase: "internal_analytics",
        territory: null,
        stage: "approved_for_internal_use",
        displayAllowed: false,
        storageAllowed: true,
        derivativeAllowed: false,
        derivativeBasis: null,
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
      // O logo aqui e o do TMDB (exigido pelos termos); nenhuma marca do
      // YouTube e desenhada por nos. O credito textual segue no rodape.
      logoAllowed: true,
      logoBasis: "source_terms",
      logoRationale:
        "EXIGIDO, nao apenas permitido. Termos da API do TMDB, secao 3 (Attribution): " +
        "\"You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or TMDB Content.\" " +
        "Ate 20/08/2026 esta entrada dizia false — o repositorio estava em DESCUMPRIMENTO, nao " +
        "em excesso de zelo. Os mesmos termos impoem o limite: o logo do TMDB deve ser MENOS " +
        "proeminente que a marca que identifica o proprio produto, e nao pode sugerir endosso. " +
        "Por isso o disclaimer textual CONTINUA obrigatorio ao lado dele: os termos pedem os DOIS, " +
        "e o logo nunca substitui o credito.",
      logoAsset: TMDB_LOGO_ASSET,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText:
        "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
      policyVersion: "cinerie-source-auth/tmdb-video/2026-08-v2",
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
        derivativeBasis: null,
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
      // A marca do PROPRIO agregador (Movie of the Night) fica textual: a
      // entrada nao esta na lista da decisao do proprietario de 2026-08-20
      // (fontes de nota exibiveis, provedores de streaming e JustWatch), e o
      // agregador nao publica programa de marca. Os logos das PLATAFORMAS e do
      // JustWatch nao passam por aqui: desde 2026-08-20 eles tem licenca
      // propria (ver `streamingProviderEntries` e `STREAMING_ORIGIN_CREDITS`),
      // com base na decisao do proprietario.
      logoAllowed: false,
      logoBasis: null,
      logoRationale:
        "Marca do proprio agregador fora da decisao do proprietario de 2026-08-20 e sem " +
        "programa de marca publicado — credito textual. Os logos das plataformas e do " +
        "JustWatch tem licenca propria desde 2026-08-20 (owner_decision); nao dependem " +
        "desta entrada.",
      logoAsset: null,
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
        derivativeBasis: null,
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
 * para a tela). O que sai daqui é o texto de atribuição — a letra da licença —
 * e, desde 2026-08-20, a declaração de marca do JustWatch.
 *
 * Por que isto precisa existir: as licenças de streaming nascem por PROVEDOR
 * CANÔNICO, dinamicamente, a partir do que existe em `watch_providers`. Elas não
 * estão em `STATIC_AUTHORIZATION`. Sem esta lista, o rodapé só conheceria o
 * JustWatch depois que alguém registrasse um provedor — e o crédito ao JustWatch
 * é exigido NOMINALMENTE pelos termos do endpoint `watch/providers` do TMDB, sob
 * pena de revogação do acesso à API que sustenta o catálogo inteiro.
 *
 * A MARCA do JustWatch: autorizada pela decisão do proprietário (2026-08-20,
 * `logoBasis` owner_decision). A ATRIBUIÇÃO continua NOMINAL, como já
 * determinado — o logo entra AO LADO do texto, nunca no lugar dele. Regime do
 * titular (pesquisa 2026-08-20): o JustWatch fornece o logo sob pedido
 * (press@justwatch.com, justwatch.com/us/press) e declara preferir a versão
 * dourada ("We prefer the JustWatch logo to be in gold, but black or white is
 * fine as well"). Arquivo pendente até entrar no repositório.
 *
 * Consumido por `public-credits.ts`.
 */
export interface StreamingOriginCredit {
  readonly attributionText: string;
  readonly logoAllowed: boolean;
  readonly logoBasis: AuthorizationBasis | null;
  readonly logoAsset: LicenseLogoAsset | null;
}

const JUSTWATCH_LOGO_ASSET: LicenseLogoAsset = {
  path: "/brand/sources/justwatch.svg",
  officialSourceUrl: "https://www.justwatch.com/us/press",
  alt: "JustWatch",
  displayHeightPx: 16,
  status: "pending_official_file",
};

export const STREAMING_ORIGIN_CREDITS: readonly StreamingOriginCredit[] =
  STREAMING_ORIGINS.map((origin) => ({
    attributionText: origin.attributionText,
    logoAllowed: origin.providerApi === "tmdb",
    logoBasis: origin.providerApi === "tmdb" ? ("owner_decision" as const) : null,
    logoAsset: origin.providerApi === "tmdb" ? JUSTWATCH_LOGO_ASSET : null,
  }));

/**
 * ============ MARCAS DOS PROVEDORES — pesquisa por titular (2026-08-20) ============
 *
 * A decisao de EXIBIR a marca dos provedores e do proprietario
 * (`OWNER_DECISION_2026_08_20`) — a pesquisa abaixo nao decide SE, decide QUAL
 * ARQUIVO usar e de onde. Uma entrada por familia de marca; slug ausente do
 * mapa significa "o titular nao publica pagina de marca/imprensa localizavel".
 *
 * ORIGEM DO ARQUIVO quando nao ha pagina do titular: o bloco `watch/providers`
 * da TMDB entrega o `logo_path` de cada provedor como parte do TMDB Content
 * (definicao dos API Terms: "any content (including audio or visual content)
 * or other information available through, on, or from the TMDB APIs"), sob a
 * licenca que ja temos — e a TMDB declara nao reivindicar propriedade das
 * imagens ("We do not claim ownership of any of the images or data in the
 * API", FAQ oficial). Ou seja: a ENTREGA TECNICA do arquivo esta resolvida
 * pela licenca do TMDB; o direito de EXIBIR a marca do terceiro e questao
 * separada — e e exatamente essa que a decisao do proprietario cobre.
 */
const PROVIDER_BRAND_PORTALS: Readonly<Record<string, string>> = {
  netflix: "https://about.netflix.com/en/company-assets",
  "prime-video": "https://press.amazonmgmstudios.com/us/en",
  "amazon-video": "https://press.amazonmgmstudios.com/us/en",
  max: "https://press.wbd.com/us/image/max-logo",
  "hbo-max-amazon-channel": "https://press.wbd.com/us/image/max-logo",
  "apple-tv": "https://marketing.services.apple/apple-tv-identity-guidelines",
  "pluto-tv": "https://www.paramountpressexpress.com/pluto-tv/photos/",
  "google-play": "https://partnermarketinghub.withgoogle.com/brands/google-play/google-play/lockups-icons-badges/",
  "disney-plus": "https://press.disneyplus.com/about/logos",
  "paramount-plus": "https://www.paramountpressexpress.com/paramount-plus/",
  "paramount-plus-premium": "https://www.paramountpressexpress.com/paramount-plus/",
  "paramount-plus-amazon-channel": "https://www.paramountpressexpress.com/paramount-plus/",
  "paramount-plus-apple-tv-channel": "https://www.paramountpressexpress.com/paramount-plus/",
  plex: "https://www.plex.tv/about/privacy-legal/plex-trademarks-and-guidelines/",
  "mgm-plus-amazon-channel": "https://press.amazonmgmstudios.com/us/en",
  "mgm-plus-apple-tv-channel": "https://press.amazonmgmstudios.com/us/en",
  "arte-amazon-channel": "https://www.arte-international.com/en/pressroom",
  "lionsgate-plus-amazon-channels": "https://mediaroom.starz.com/",
};

/**
 * De onde vem o arquivo quando o titular nao publica pagina de marca: a entrega
 * licenciada do TMDB (`logo_path` do bloco watch/providers). Ver o comentario
 * de PROVIDER_BRAND_PORTALS.
 */
const TMDB_PROVIDER_LOGO_DELIVERY_URL =
  "https://developer.themoviedb.org/reference/movie-watch-providers";

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
 *
 * A MARCA (2026-08-20): `logoAllowed: true` POR DECISÃO DO PROPRIETÁRIO, com a
 * base gravada (`logoBasis: "owner_decision"`). O carimbo em bloco anterior
 * (`false` para todos sob um motivo só) foi revogado pelo dono; a pesquisa por
 * titular (PROVIDER_BRAND_PORTALS) passou a decidir QUAL arquivo usar. Todo
 * arquivo entra `pending_official_file`: até estar no repositório, o painel
 * usa a palavra-marca na mesma caixa, e a ausência é logada.
 */
export function streamingProviderEntries(
  providers: readonly { readonly slug: string; readonly canonicalName: string }[],
): readonly AuthorizationEntry[] {
  return providers.flatMap((provider) =>
    STREAMING_ORIGINS.map((origin) => {
      const portal = PROVIDER_BRAND_PORTALS[provider.slug] ?? null;
      const logoAsset: LicenseLogoAsset = {
        path: `/brand/providers/${provider.slug}.svg`,
        officialSourceUrl: portal ?? TMDB_PROVIDER_LOGO_DELIVERY_URL,
        alt: provider.canonicalName,
        displayHeightPx: 20,
        status: "pending_official_file",
      };
      const regimeNote =
        portal !== null
          ? `Pagina de marca/imprensa do titular: ${portal}.`
          : "Titular sem pagina publica de marca localizada (pesquisa 2026-08-20); origem do " +
            "arquivo: entrega licenciada do TMDB (logo_path do watch/providers) ou pedido " +
            "direto a assessoria do titular.";
      return {
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
          logoAllowed: true,
          logoBasis: "owner_decision" as const,
          logoRationale:
            `Marca por decisao do proprietario (2026-08-20). ${provider.canonicalName} e marca ` +
            `de titular proprio; a permissao de EXIBIR vem da decisao do dono, nao dos termos ` +
            `do titular — e o registro grava exatamente isso. ${regimeNote} Arquivo pendente ` +
            `(pending_official_file): ate entrar no repositorio, o painel usa a palavra-marca ` +
            `na mesma caixa. O credito textual da origem permanece ao lado, sempre.`,
          logoAsset,
          scoreAllowed: false,
          reviewQuoteAllowed: false as const,
          requiresAttribution: true as const,
          requiresLinkback: true,
          attributionText: origin.attributionText,
          policyVersion: AUTHORIZATION_BATCH,
          notes:
            `Provedor canonico ${provider.canonicalName} (slug ${provider.slug}) ${origin.note} ` +
            `Ofertas exibidas apenas apos promocao humana (pnpm streaming), nunca por este ` +
            `registro. LOGO AUTORIZADO. ${OWNER_DECISION_NOTE}`,
        },
        decisions: [
          {
            useCase: "watch_offer_display" as const,
            territory: CINERIE_TERRITORY,
            stage: "approved_for_display" as const,
            displayAllowed: true,
            storageAllowed: true,
            derivativeAllowed: false as const,
            derivativeBasis: null,
            attributionRequired: true as const,
            linkbackRequired: true,
            policyVersion: AUTHORIZATION_BATCH,
          },
        ],
      };
    }),
  );
}
