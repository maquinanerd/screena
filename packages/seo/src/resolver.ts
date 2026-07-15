/**
 * resolver.ts — FONTE UNICA DE VERDADE da indexabilidade/SEO de runtime.
 *
 * Prompt 3 (SEO como fonte unica de verdade): metadata (<meta robots>),
 * sitemap, canonical e validadores devem consumir O MESMO contrato. Antes desta
 * fase cada consumidor derivava a decisao por conta propria (paginas com
 * `evaluate*Indexability`, sitemap com um conjunto de evaluators, robots com sua
 * propria regra), abrindo espaco para divergencia entre o que a pagina declara e
 * o que o sitemap lista. Este modulo centraliza a decisao em uma unica funcao
 * pura `resolvePageSeo`, que devolve TUDO que os consumidores precisam:
 *
 *  - decisao final (`index | noindex | draft | stale | blocked`);
 *  - `robots` ({ index, follow }) ja materializado para a metadata do Next;
 *  - `includeInSitemap` (regra unica: sitemap == decisao `index`);
 *  - `canonical` (repassado do chamador, resolvido em `slugs`/`redirects`);
 *  - `reason` legivel (auditoria/log);
 *  - `decisionSource` (qual FATO PERSISTIDO governou a decisao);
 *  - `policy` + `policyVersion` (rastreabilidade da politica aplicada).
 *
 * Politica vigente (2026-07): INDEXACAO TOTAL (invariante 5). Uma pagina indexa
 * por padrao; `noindex` fica so para caso tecnico. A licenca (invariante 6) e o
 * idioma nao publicado (invariante 7) continuam bloqueando. Blocos de valor sao
 * alavanca de ranqueamento, NAO gate de indexacao.
 *
 * PURO e DETERMINISTA: sem rede, banco, IO, `Date` ou `Math.random`.
 */

import { PUBLISHED_LOCALES } from "@screena/config";

/** Nome da politica de indexabilidade vigente. */
export const SEO_POLICY = "total-indexing" as const;

/**
 * Versao da politica. Bump manual quando a regra de precedencia muda. Repassado
 * na resolucao para rastrear qual politica decidiu cada pagina.
 */
export const SEO_POLICY_VERSION = "2026-07" as const;

/**
 * Locales publicados/indexaveis (invariante 7). Fonte de verdade:
 * PUBLISHED_LOCALES em @screena/config. Fora deste conjunto -> `draft`.
 */
const PUBLISHED_LOCALE_SET: ReadonlySet<string> = new Set(PUBLISHED_LOCALES);

/**
 * Rating exibido na pagina, com o flag de licenca relevante para a decisao.
 * Espelha `external_ratings.display_allowed` / `source_licenses.display_allowed`.
 */
export interface DisplayedRating {
  /** Mapeia display_allowed. `false` => pagina inteira vira `blocked`. */
  licenseDisplayAllowed: boolean;
}

/**
 * Decisao final de indexabilidade (superset com `stale`).
 * Espelha `page_indexability_decisions.decision`.
 */
export type IndexDecision = "index" | "noindex" | "draft" | "stale" | "blocked";

/**
 * Qual FATO PERSISTIDO governou a decisao. Torna a resolucao auditavel: o
 * consumidor sabe exatamente por que a pagina indexa ou nao.
 */
export type DecisionSource =
  | "explicit-exclusion"
  | "license-blocked"
  | "news-attribution-missing"
  | "language-not-published"
  | "stale-invalidation"
  | "entity-not-published"
  | "technical-invalid"
  | "total-indexing"
  | "persisted-decision";

/**
 * Gate de atribuicao/linkback de noticia (invariante 6, regras de ratings/news).
 * Quando a licenca exige credito/linkback e ele nao esta presente, a noticia NAO
 * pode aparecer em pagina indexavel — mesmo tratamento de dado sem licenca.
 */
export interface NewsAttributionFacts {
  /** A pagina e uma noticia (aplica o gate de atribuicao). */
  isNews: boolean;
  /** A licenca exige texto de atribuicao. */
  requiresAttribution: boolean;
  /** Ha `attribution_text` presente. */
  hasAttributionText: boolean;
  /** A licenca exige linkback. */
  requiresLinkback: boolean;
  /** Ha `attribution_url` presente. */
  hasAttributionUrl: boolean;
}

/**
 * Fatos ja lidos do PostgreSQL (nenhuma consulta acontece aqui). O chamador
 * resolve tudo a partir do banco/cache local e passa o snapshot.
 */
export interface PageSeoFacts {
  /** Codigo de idioma da pagina, ex.: 'pt-BR', 'pt', 'en', 'es'. */
  language: string;
  /**
   * Dados estruturados confiaveis (slug/traducao/schema.org validos). `false` =
   * caso tecnico -> `noindex`.
   */
  hasReliableStructuredData: boolean;
  /**
   * A entidade/pagina esta publicada. `false` => nao indexa (entidade ainda nao
   * publicada). Default: `true`.
   */
  isPublished?: boolean;
  /**
   * Decisao persistida EXPLICITA de exclusao (editorial/juridica) em
   * `page_indexability_decisions`. Tem a maior precedencia. Default: `false`.
   */
  explicitlyExcluded?: boolean;
  /**
   * Conteudo marcado como obsoleto por invalidacao posterior. Sai do indice ate
   * revalidacao. Default: `false`.
   */
  isStale?: boolean;
  /** Ratings exibidos na pagina, cada um com seu flag de licenca. */
  displayedRatings: DisplayedRating[];
  /** Gate de atribuicao de noticia. Omitido => nao e noticia. */
  newsAttribution?: NewsAttributionFacts;
  /** URL canonica ja resolvida (slugs/redirects). Repassada na resolucao. */
  canonicalUrl?: string | null;
  /** Sinal informativo de qualidade (nao gate). Default: 0. */
  valueBlocksCount?: number;
  /** Sinal informativo de conteudo fino 0..1 (nao gate). Default: 0. */
  thinContentScore?: number;
  /** Blocos de IA em estado publicavel (informativo p/ exibicao). Default: true. */
  reviewStatusOk?: boolean;
}

/** Resolucao completa e unica consumida por metadata, sitemap e validadores. */
export interface PageSeoResolution {
  /** Decisao final aplicavel a pagina. */
  decision: IndexDecision;
  /** Diretivas `robots` prontas para `Metadata.robots` do Next. */
  robots: { index: boolean; follow: boolean };
  /** Regra unica: entra no sitemap se e somente se `decision === 'index'`. */
  includeInSitemap: boolean;
  /** URL canonica repassada (ou null quando o chamador nao resolveu). */
  canonical: string | null;
  /** Motivo legivel (pt-BR) — auditoria/log. */
  reason: string;
  /** Qual fato persistido governou a decisao. */
  decisionSource: DecisionSource;
  /** Politica aplicada. */
  policy: typeof SEO_POLICY;
  /** Versao da politica aplicada. */
  policyVersion: typeof SEO_POLICY_VERSION;
  /** Informativo: pagina "rica" (>= 2 blocos de valor). NAO gate. */
  hasUniqueValue: boolean;
  /** Informativo: nenhum rating exibido tem licenca bloqueada. */
  allRatingsLicensed: boolean;
}

/** Blocos de valor a partir dos quais a pagina e considerada "rica". */
const MIN_VALUE_BLOCKS = 2;

/** Idioma esta em PUBLISHED_LOCALES (invariante 7). */
export function isPublishedLocale(language: string): boolean {
  return PUBLISHED_LOCALE_SET.has(language);
}

/**
 * Gate de atribuicao de noticia: `true` quando a noticia NAO pode ser exibida
 * por faltar atribuicao/linkback exigidos pela licenca.
 */
function newsAttributionBlocks(facts: NewsAttributionFacts | undefined): boolean {
  if (facts === undefined || !facts.isNews) return false;
  if (facts.requiresAttribution && !facts.hasAttributionText) return true;
  if (facts.requiresLinkback && !facts.hasAttributionUrl) return true;
  return false;
}

/**
 * FONTE UNICA: resolve a decisao completa de SEO de uma pagina.
 *
 * Precedencia (do mais restritivo ao menos):
 *  1. Exclusao explicita persistida        -> `noindex` (nofollow, fora do sitemap).
 *  2. Rating com licenca bloqueada          -> `blocked` (invariante 6).
 *  3. Noticia sem atribuicao/linkback       -> `blocked` (invariante 6/news).
 *  4. Idioma fora de PUBLISHED_LOCALES       -> `draft`  (invariante 7).
 *  5. Conteudo invalidado (stale)            -> `stale`.
 *  6. Entidade nao publicada                 -> `noindex` (entity-not-published).
 *  7. Caso tecnico (sem dados estruturados)  -> `noindex` (technical-invalid).
 *  8. Caso contrario                         -> `index`   (indexacao total).
 *
 * `includeInSitemap` e sempre `decision === 'index'`: sitemap e meta robots
 * nunca podem discordar, porque derivam da MESMA resolucao.
 */
export function resolvePageSeo(facts: PageSeoFacts): PageSeoResolution {
  const canonical = facts.canonicalUrl ?? null;
  const valueBlocksCount = facts.valueBlocksCount ?? 0;
  const hasUniqueValue = valueBlocksCount >= MIN_VALUE_BLOCKS;
  const allRatingsLicensed = facts.displayedRatings.every(
    (rating) => rating.licenseDisplayAllowed,
  );
  const isPublished = facts.isPublished ?? true;

  const base = {
    canonical,
    policy: SEO_POLICY,
    policyVersion: SEO_POLICY_VERSION,
    hasUniqueValue,
    allRatingsLicensed,
  } as const;

  // 1. Exclusao explicita: decisao editorial/juridica persistida vence tudo.
  if (facts.explicitlyExcluded === true) {
    return {
      ...base,
      decision: "noindex",
      robots: { index: false, follow: false },
      includeInSitemap: false,
      decisionSource: "explicit-exclusion",
      reason:
        "Exclusao explicita persistida em page_indexability_decisions; a pagina fica fora do indice e do sitemap por decisao registrada.",
    };
  }

  // 2. Licenca bloqueada: qualquer rating sem display_allowed derruba a pagina.
  if (!allRatingsLicensed) {
    return {
      ...base,
      decision: "blocked",
      robots: { index: false, follow: false },
      includeInSitemap: false,
      decisionSource: "license-blocked",
      reason:
        "Ha ao menos um rating exibido sem permissao de exibicao (display_allowed=false); invariante 6 bloqueia a pagina indexavel.",
    };
  }

  // 3. Noticia sem atribuicao/linkback exigidos: mesmo tratamento de dado sem
  //    licenca (invariante 6).
  if (newsAttributionBlocks(facts.newsAttribution)) {
    return {
      ...base,
      decision: "blocked",
      robots: { index: false, follow: false },
      includeInSitemap: false,
      decisionSource: "news-attribution-missing",
      reason:
        "Noticia com licenca que exige atribuicao/linkback ausente; nao pode aparecer em pagina indexavel ate credito/linkback presentes.",
    };
  }

  // 4. Idioma ainda nao publicado (fora de PUBLISHED_LOCALES).
  if (!isPublishedLocale(facts.language)) {
    return {
      ...base,
      decision: "draft",
      robots: { index: false, follow: true },
      includeInSitemap: false,
      decisionSource: "language-not-published",
      reason: `Idioma '${facts.language}' ainda nao esta em PUBLISHED_LOCALES; resolve em draft/noindex ate estar completo e revisado (invariante 7).`,
    };
  }

  // 5. Conteudo obsoleto (invalidado apos publicacao): sai do indice ate revalidar.
  if (facts.isStale === true) {
    return {
      ...base,
      decision: "stale",
      robots: { index: false, follow: true },
      includeInSitemap: false,
      decisionSource: "stale-invalidation",
      reason:
        "Conteudo marcado como stale por invalidacao posterior; sai do indice e do sitemap ate ser revalidado.",
    };
  }

  // 6. Entidade nao publicada: nao indexa (nao e caso de licenca nem idioma).
  if (!isPublished) {
    return {
      ...base,
      decision: "noindex",
      robots: { index: false, follow: true },
      includeInSitemap: false,
      decisionSource: "entity-not-published",
      reason:
        "Entidade ainda nao publicada; nao indexa ate a publicacao (decisao registrada fora do render).",
    };
  }

  // 7. Caso tecnico: sem dados estruturados/slug/traducao confiaveis.
  if (!facts.hasReliableStructuredData) {
    return {
      ...base,
      decision: "noindex",
      robots: { index: false, follow: true },
      includeInSitemap: false,
      decisionSource: "technical-invalid",
      reason:
        "Caso tecnico: entidade sem dados estruturados/slug/traducao confiaveis — nao indexa (invariante 5).",
    };
  }

  // 8. Indexacao total (invariante 5, politica 2026-07).
  return {
    ...base,
    decision: "index",
    robots: { index: true, follow: true },
    includeInSitemap: true,
    decisionSource: "total-indexing",
    reason:
      "Entidade sincronizada, licenciada e em idioma publicado — indexacao total (invariante 5, politica 2026-07). Conteudo editorial e alavanca de ranqueamento, nao pre-requisito.",
  };
}

/**
 * Decisao VIGENTE persistida em `page_indexability_decisions` (is_current=true),
 * ja lida do PostgreSQL pelo chamador. Espelha a coluna `decision` mais os
 * metadados de auditoria (`decision_origin`, `policy_version`, `reason`).
 */
export interface PersistedDecisionFacts {
  /** page_indexability_decisions.decision da linha vigente. */
  decision: IndexDecision;
  /** decision_origin (ex.: 'human_override', 'seo_policy_engine', 'sync_worker'). */
  decisionOrigin: string | null;
  /** policy_version registrada na decisao. */
  policyVersion: string | null;
  /** reason persistido, quando houver. */
  reason?: string | null;
}

/**
 * Severidade de restricao de cada decisao (maior = mais restritivo):
 * index < stale < draft < noindex < blocked. Ordena a fusao entre a decisao
 * viva (fatos do banco) e a decisao persistida.
 */
const DECISION_SEVERITY: Readonly<Record<IndexDecision, number>> = {
  index: 0,
  stale: 1,
  draft: 2,
  noindex: 3,
  blocked: 4,
};

/** Diretivas robots para uma decisao persistida que governa a pagina. */
function robotsForPersistedDecision(decision: IndexDecision): {
  index: boolean;
  follow: boolean;
} {
  switch (decision) {
    case "index":
      return { index: true, follow: true };
    case "blocked":
      return { index: false, follow: false };
    case "noindex":
      // Uma linha persistida de noindex e uma decisao REGISTRADA (override
      // editorial/motor de politica) — trata-se como exclusao explicita: nofollow.
      return { index: false, follow: false };
    default:
      // draft / stale: fora do indice, mas o crawler ainda segue os links.
      return { index: false, follow: true };
  }
}

/**
 * Funde a resolucao viva (derivada dos fatos do banco por `resolvePageSeo`) com
 * a decisao VIGENTE persistida em `page_indexability_decisions`.
 *
 * Regra unica e fail-closed: prevalece sempre a decisao MAIS RESTRITIVA. Uma
 * decisao persistida pode RESTRINGIR (override humano/motor -> noindex, blocked,
 * stale, draft), mas NUNCA relaxa um bloqueio vivo — um `index` persistido
 * desatualizado jamais reabre uma pagina que a licenca (invariante 6), o idioma
 * (invariante 7) ou o caso tecnico ja bloquearam ao vivo. Sem decisao persistida
 * (`null`), devolve a resolucao viva inalterada (politica de indexacao total).
 *
 * `includeInSitemap === (decision === 'index')` continua valendo apos a fusao —
 * metadata e sitemap nunca discordam.
 */
export function mergePersistedDecision(
  live: PageSeoResolution,
  persisted: PersistedDecisionFacts | null,
): PageSeoResolution {
  if (persisted === null) return live;

  const liveSeverity = DECISION_SEVERITY[live.decision];
  const persistedSeverity = DECISION_SEVERITY[persisted.decision];

  // Persistida nao e mais restritiva que a viva: os fatos vivos governam.
  if (persistedSeverity <= liveSeverity) return live;

  const decision = persisted.decision;
  const persistedReason = persisted.reason?.trim();
  return {
    ...live,
    decision,
    robots: robotsForPersistedDecision(decision),
    includeInSitemap: decision === "index",
    decisionSource: "persisted-decision",
    reason:
      persistedReason && persistedReason.length > 0
        ? persistedReason
        : `Decisao vigente persistida em page_indexability_decisions (decision='${decision}', origin='${persisted.decisionOrigin ?? "?"}') e mais restritiva que a resolucao viva; prevalece (fail-closed).`,
  };
}
