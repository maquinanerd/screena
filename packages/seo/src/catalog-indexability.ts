/**
 * Politica de INDEXABILIDADE das entidades de catalogo — camada que produz as
 * linhas de `page_indexability_decisions`.
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * `page_indexability_decisions` e LIDA pelo sitemap, pelos loaders publicos e
 * pelo resolver de SEO — e nunca foi ESCRITA por nenhum processo. Uma tabela
 * lida e nao escrita nao e um gate: e decoracao. As clausulas
 * `NOT EXISTS (... decision <> 'index')` espalhadas pelo sitemap nunca
 * excluiram uma linha sequer, porque nao ha linha nenhuma.
 *
 * Este modulo e o MOTOR da decisao. Ele nao decide sozinho a politica geral —
 * essa mora em `resolvePageSeo` (licenca -> idioma -> caso tecnico -> index) e
 * continua sendo a fonte unica. O que este modulo acrescenta e o que
 * `resolvePageSeo` nao tem como saber: os gates ESPECIFICOS de cada tipo de
 * entidade do catalogo.
 *
 *   filme/serie : slug canonico + titulo + traducao + SINOPSE + IMAGEM
 *   temporada   : herda a serie + conteudo proprio suficiente (sinopse OU
 *                 pelo menos um episodio listado)
 *   episodio    : herda a serie + SINOPSE propria
 *   pessoa      : credito em obra publicavel (`person-eligibility`) +
 *                 BIOGRAFIA EXIBIVEL + IMAGEM
 *
 * A REGRA E DIRIGIDA A DADO, NUNCA A TIPO
 * ---------------------------------------
 * Nenhum gate aqui e da forma `if (tipo === 'episode') return noindex`. Todo
 * gate pergunta por um FATO da entidade. A consequencia pratica e a que importa:
 * quando a ingestao passar a preencher biografia e sinopse, as paginas voltam a
 * indexar SOZINHAS, na proxima execucao do produtor, sem deploy e sem alterar
 * uma linha deste arquivo. Um banimento por tipo exigiria um novo deploy para
 * desfazer — e por isso e proibido. Ver o teste "nao e banimento por tipo".
 *
 * O QUE ESTA POLITICA NAO CONTRADIZ
 * ---------------------------------
 * A invariante 5 (indexacao total) manda indexar a ENTIDADE SINCRONIZADA; ela
 * nao obriga a publicar uma pagina que nao tem o dado que a propria pagina
 * promete. Uma pessoa sem biografia rende ~26 palavras dentro de `<main>` e um
 * episodio sem sinopse ~45, contra 236 de um filme e 712 de uma serie (medido em
 * producao, 2026-08-25). `noindex` aqui e caso tecnico — a pagina existe, esta
 * correta e nao tem o conteudo que a justifica —, nao juizo editorial.
 *
 * DETERMINISMO: a mesma entidade no mesmo estado produz SEMPRE a mesma decisao
 * e a mesma razao. E isso que permite ao produtor detectar "nada mudou" e nao
 * gravar uma linha nova — sem determinismo, cada execucao viraria churn.
 *
 * NAO LIGA INDEXACAO. Produzir a decisao e registrar o que a politica diz; a
 * chave global (`CINERIE_PUBLIC_INDEXING_ENABLED`) continua desligada e e uma
 * decisao humana separada.
 *
 * MODULO PURO: sem banco, sem rede, sem relogio.
 */

import { evaluatePersonEligibility } from "./person-eligibility.js";
import { resolvePageSeo, type DisplayedRating } from "./resolver.js";

/**
 * Versao da politica, gravada em `policy_version`.
 *
 * Mudou a regra? Suba a versao. E o que permite distinguir "a entidade mudou"
 * de "a regra mudou" ao auditar por que uma decisao virou outra.
 *
 * v1 -> v2 (2026-08-25): os gates deixaram de ser apenas estruturais (slug,
 * titulo, traducao, credito, pai publicavel) e passaram a exigir o CONTEUDO que
 * cada tipo de pagina promete — sinopse para filme/serie/temporada/episodio,
 * biografia exibivel e imagem para pessoa. Toda decisao v1 persistida precisa
 * ser reemitida sob v2, mesmo quando o veredito nao muda.
 */
export const CATALOG_POLICY_VERSION = "catalog-indexability-v2";

/** Origem gravada em `decision_origin`. */
export const CATALOG_DECISION_ORIGIN = "catalog_policy_engine";

/** Tipos de entidade de catalogo que recebem decisao. */
export type CatalogDecisionEntityType = "movie" | "tv" | "season" | "episode" | "person";

/**
 * Tipos que TEM linha em `entity_translations`.
 *
 * `upsertEntityTranslation` (services/ingestion) so e chamado para
 * `movie | tv | person`: temporada e episodio guardam o texto localizado na
 * PROPRIA linha (`seasons.overview`, `episodes.overview`), sem passar por
 * `entity_translations`. Exigir traducao deles marcaria os ~30.400 episodios e
 * as ~840 temporadas como `missing_translation` PARA SEMPRE — mascarando a
 * politica de sinopse e quebrando a reversibilidade: preencher a sinopse nao
 * traria a pagina de volta, porque a razao do `noindex` seria outra.
 */
export const TRANSLATION_BEARING_ENTITY_TYPES = Object.freeze([
  "movie",
  "tv",
  "person",
] as const);

function bearsTranslation(entityType: CatalogDecisionEntityType): boolean {
  return (TRANSLATION_BEARING_ENTITY_TYPES as readonly string[]).includes(entityType);
}

/**
 * Razao ESTRUTURADA da decisao. String livre em `reason` seria impossivel de
 * agregar no censo ("quantas bloqueadas por falta de slug?").
 */
export type CatalogDecisionReason =
  | "eligible"
  | "missing_slug"
  | "missing_title"
  | "missing_translation"
  | "no_eligible_credit"
  | "no_synopsis"
  | "no_biography"
  | "no_image"
  | "parent_not_publishable"
  | "language_not_published"
  | "blocked_license"
  | "insufficient_data";

/**
 * Fatos ja apurados sobre UMA entidade.
 *
 * Os campos de conteudo (`hasSynopsis`, `hasImage`, `hasDisplayableBiography`,
 * `listedEpisodeCount`) sao OPCIONAIS e FAIL-CLOSED: ausentes valem como
 * "nao tem". Um produtor que esqueca de ler um deles produz `noindex` com a
 * razao exata no censo — nunca um `index` por omissao.
 */
export interface CatalogEntityFacts {
  readonly entityType: CatalogDecisionEntityType;
  readonly language: string;
  /** Existe slug canonico no idioma? Para temporada/episodio, o da serie. */
  readonly hasCanonicalSlug: boolean;
  /** Titulo/nome nao vazio. Para temporada/episodio, o da serie dona. */
  readonly hasTitle: boolean;
  /**
   * Existe linha em `entity_translations` no idioma. So consultado para os
   * tipos de `TRANSLATION_BEARING_ENTITY_TYPES`.
   */
  readonly hasTranslation: boolean;
  /**
   * Creditos em obra publicavel. So consultado para `person`; ver
   * `person-eligibility.ts` para a regra e o porque.
   */
  readonly publishableCreditCount?: number;
  /** Para temporada/episodio: a SERIE dona e publicavel? */
  readonly parentPublishable?: boolean;
  /** Ratings exibidos, com flag de licenca (invariante 6). */
  readonly displayedRatings?: readonly DisplayedRating[];

  // -------------------------------------------------------------------------
  // v2 — fatos de CONTEUDO. Cada um descreve o que a pagina vai efetivamente
  // renderizar, apurado com o MESMO criterio do presenter correspondente.
  // -------------------------------------------------------------------------

  /**
   * Existe sinopse/overview que a pagina vai mostrar?
   *
   * - filme/serie: alguma linha de `entity_translations` com `summary` nao
   *   vazio. Deliberadamente NAO restrito ao locale publicado, porque
   *   `selectSynopsis` (apps/web) aceita o idioma de ORIGEM com aviso na tela
   *   para titulos entrados sob demanda. Restringir aqui excluiria pagina que
   *   de fato exibe sinopse.
   * - temporada/episodio: `seasons.overview` / `episodes.overview` da propria
   *   linha, que e o que o presenter le.
   *
   * Nao se aplica a `person` (o texto proprio da pessoa e a biografia).
   */
  readonly hasSynopsis?: boolean;
  /**
   * Existe imagem principal PERSISTIDA para a entidade (`poster_path`,
   * `still_path`, `profile_path`)?
   *
   * FATO DA ENTIDADE, NAO LICENCA. A autorizacao de EXIBIR arte do TMDB e
   * global, por fonte (`source_licenses` para `tmdb`/`image`), avaliada no
   * render por `getImageDisplayAuthorization`. Colapsar as duas coisas aqui
   * transformaria uma decisao de licenca ausente no banco — que ja derrubou o
   * poster de toda ficha uma vez — em `noindex` do catalogo inteiro. Licenca
   * governa exibicao (invariante 6) e continua sendo avaliada em separado; este
   * campo responde apenas "existe a imagem?".
   */
  readonly hasImage?: boolean;
  /**
   * Existe biografia que a pagina de pessoa vai EXIBIR?
   *
   * Nao basta `people.biography` ter texto: `selectSourceBiography` (apps/web)
   * so mostra quando `people.biography_source_status` esta em
   * `official`/`licensed`/`third_party` — e o default da coluna e `unknown`.
   * Uma bio ingerida e nao liberada rende zero palavra na tela, entao indexar
   * por causa dela seria indexar a mesma pagina de ~26 palavras.
   *
   * Ao contrario da imagem, esta e uma flag POR LINHA (coluna de `people`), nao
   * uma licenca global — por isso entra no fato sem risco de derrubar o
   * catalogo inteiro por uma decisao ausente.
   */
  readonly hasDisplayableBiography?: boolean;
  /**
   * Quantos episodios a temporada lista.
   *
   * E o conteudo PROPRIO de uma pagina de temporada: mesmo sem sinopse, a lista
   * de episodios (numero, titulo, data) e dado unico e navegavel. Temporada sem
   * sinopse E sem episodio e casca vazia.
   */
  readonly listedEpisodeCount?: number;
}

/** Decisao produzida, pronta para virar linha de `page_indexability_decisions`. */
export interface CatalogIndexabilityDecision {
  readonly decision: "index" | "noindex" | "draft" | "blocked";
  readonly reason: CatalogDecisionReason;
  /** Texto humano estavel (log, censo, auditoria). */
  readonly explanation: string;
  readonly policyVersion: string;
  readonly origin: string;
}

function decided(
  decision: CatalogIndexabilityDecision["decision"],
  reason: CatalogDecisionReason,
  explanation: string,
): CatalogIndexabilityDecision {
  return {
    decision,
    reason,
    explanation,
    policyVersion: CATALOG_POLICY_VERSION,
    origin: CATALOG_DECISION_ORIGIN,
  };
}

/**
 * Decide a indexabilidade de UMA entidade de catalogo.
 *
 * PRECEDENCIA (do mais restritivo ao menos), alinhada com `resolvePageSeo`:
 *
 *   1. licenca bloqueada            -> blocked   (invariante 6)
 *   2. idioma nao publicado         -> draft     (invariante 7)
 *   3. caso tecnico (slug/titulo/traducao) -> noindex
 *   4. gate especifico do tipo, DIRIGIDO A DADO -> noindex
 *   5. caso contrario               -> index     (invariante 5, indexacao total)
 *
 * Os passos 1 e 2 vem da fonte unica; 3 e 4 sao o que este modulo acrescenta.
 */
export function decideCatalogIndexability(
  facts: CatalogEntityFacts,
): CatalogIndexabilityDecision {
  // (1) e (2): delega a fonte unica. `hasReliableStructuredData` recebe os
  // gates tecnicos deste modulo para que a precedencia seja avaliada de uma vez
  // so — licenca e idioma continuam vencendo o caso tecnico.
  const technicallyValid = facts.hasCanonicalSlug && facts.hasTitle;
  const shared = resolvePageSeo({
    language: facts.language,
    hasReliableStructuredData: technicallyValid,
    displayedRatings: [...(facts.displayedRatings ?? [])],
    valueBlocksCount: 0,
    thinContentScore: 0,
    reviewStatusOk: true,
    isPublished: true,
    explicitlyExcluded: false,
    isStale: false,
  });

  if (shared.decision === "blocked") {
    return decided("blocked", "blocked_license", shared.reason);
  }
  if (shared.decision === "draft") {
    return decided("draft", "language_not_published", shared.reason);
  }

  // (3) caso tecnico: sem rota ou sem titulo nao ha pagina que sustente index.
  if (!facts.hasCanonicalSlug) {
    return decided(
      "noindex",
      "missing_slug",
      "entidade sem slug canonico no idioma: nao ha rota publica.",
    );
  }
  if (!facts.hasTitle) {
    return decided(
      "noindex",
      "missing_title",
      "entidade sem titulo: nao sustenta H1, metadata nem schema.",
    );
  }
  // Traducao ausente nao e caso tecnico duro (a ficha crua ainda renderiza),
  // mas indexar pagina sem o texto do idioma e publicar meia pagina. Vem ANTES
  // do gate de conteudo porque, para filme/serie, a sinopse MORA na traducao:
  // sem a linha, `no_synopsis` seria consequencia e nao causa, e o censo
  // apontaria o sintoma errado.
  if (bearsTranslation(facts.entityType) && !facts.hasTranslation) {
    return decided(
      "noindex",
      "missing_translation",
      "entidade sem traducao no idioma: a pagina indexaria sem o texto localizado.",
    );
  }

  // (4) gates especificos por tipo — todos dirigidos a DADO.
  if (facts.entityType === "movie" || facts.entityType === "tv") {
    if (facts.hasSynopsis !== true) {
      return decided(
        "noindex",
        "no_synopsis",
        "titulo sem sinopse em nenhum idioma: a ficha indexaria sem o texto que a justifica.",
      );
    }
    if (facts.hasImage !== true) {
      return decided(
        "noindex",
        "no_image",
        "titulo sem poster persistido: a ficha nao sustenta hero, card nem imagem de schema.",
      );
    }
  }
  if (facts.entityType === "season" || facts.entityType === "episode") {
    if (facts.parentPublishable !== true) {
      return decided(
        "noindex",
        "parent_not_publishable",
        "a serie dona nao e publicavel: temporada/episodio herda a exclusao.",
      );
    }
  }
  if (facts.entityType === "season") {
    // Conteudo proprio suficiente: sinopse da temporada OU a lista de
    // episodios. Sem nenhum dos dois a pagina e casca (breadcrumb + numero).
    const listed = facts.listedEpisodeCount ?? 0;
    if (facts.hasSynopsis !== true && listed < 1) {
      return decided(
        "noindex",
        "insufficient_data",
        "temporada sem sinopse e sem nenhum episodio listado: pagina sem conteudo proprio.",
      );
    }
  }
  if (facts.entityType === "episode") {
    if (facts.hasSynopsis !== true) {
      return decided(
        "noindex",
        "no_synopsis",
        "episodio sem sinopse: a pagina fica em titulo, numero e data — sem texto proprio.",
      );
    }
  }
  if (facts.entityType === "person") {
    const eligibility = evaluatePersonEligibility({
      name: facts.hasTitle ? "x" : "",
      hasCanonicalSlug: facts.hasCanonicalSlug,
      publishableCreditCount: facts.publishableCreditCount ?? 0,
    });
    if (!eligibility.eligible) {
      return decided("noindex", "no_eligible_credit", eligibility.explanation);
    }
    if (facts.hasDisplayableBiography !== true) {
      return decided(
        "noindex",
        "no_biography",
        "pessoa sem biografia exibivel (texto ausente ou fonte nao liberada): pagina de ficha sem texto proprio.",
      );
    }
    if (facts.hasImage !== true) {
      return decided(
        "noindex",
        "no_image",
        "pessoa sem foto de perfil persistida: pagina sem a imagem que a ficha promete.",
      );
    }
  }

  // (5) indexacao total.
  return decided("index", "eligible", shared.reason);
}

/**
 * Uma decisao ANTERIOR ja persistida, para comparacao.
 */
export interface PersistedCatalogDecision {
  readonly decision: string;
  readonly reason: string | null;
  readonly policyVersion: string | null;
}

/**
 * True quando a decisao nova difere da persistida e portanto PRECISA de uma
 * linha nova.
 *
 * Compara decisao, razao E versao da politica: se so a versao mudou, o registro
 * precisa ser reemitido mesmo com o mesmo veredito — e assim que se audita
 * "esta decisao foi tomada sob qual regra?". Sem essa comparacao o produtor
 * gravaria uma linha por execucao (churn) ou nunca atualizaria (mentira).
 */
export function decisionChanged(
  next: CatalogIndexabilityDecision,
  previous: PersistedCatalogDecision | null,
): boolean {
  if (previous === null) return true;
  return (
    previous.decision !== next.decision ||
    previous.reason !== next.reason ||
    previous.policyVersion !== next.policyVersion
  );
}
