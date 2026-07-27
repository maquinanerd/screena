/**
 * metrics.ts — Metricas e sentinela do pipeline editorial. PURO.
 *
 * Segue a MESMA convencao do catalogo (`services/ingestion/src/metrics`):
 * nomes canonicos numa constante unica, `MetricsSink` com counter/gauge/
 * histograma, labels de baixa cardinalidade (NUNCA id de artigo ou de item).
 */

/** Nomes canonicos das metricas editoriais. */
export const EDITORIAL_METRIC_NAMES = {
  sourceItemsReceivedTotal: 'editorial_source_items_received_total',
  sourceItemsDuplicateTotal: 'editorial_source_items_duplicate_total',
  sourceItemsRelatedTotal: 'editorial_source_items_related_total',
  sourceItemsDiscardedTotal: 'editorial_source_items_discarded_total',
  ingestFailuresTotal: 'editorial_ingest_failures_total',
  articlesDraftTotal: 'editorial_articles_draft_total',
  articlesPublishedTotal: 'editorial_articles_published_total',
  articlesScheduledPendingTotal: 'editorial_articles_scheduled_pending_total',
  articlesWithoutProvenanceTotal: 'editorial_articles_without_provenance_total',
  articlesWithoutEntityTotal: 'editorial_articles_without_entity_total',
  searchProjectionStaleTotal: 'editorial_search_projection_stale_total',
  indexabilityStaleTotal: 'editorial_indexability_stale_total',
  publishDurationSeconds: 'editorial_publish_duration_seconds',
} as const

export type EditorialMetricName =
  (typeof EDITORIAL_METRIC_NAMES)[keyof typeof EDITORIAL_METRIC_NAMES]

export const ALL_EDITORIAL_METRIC_NAMES: readonly EditorialMetricName[] =
  Object.values(EDITORIAL_METRIC_NAMES)

export type MetricLabels = Readonly<Record<string, string>>

export interface EditorialMetricsSink {
  increment(name: EditorialMetricName, value?: number, labels?: MetricLabels): void
  gauge(name: EditorialMetricName, value: number, labels?: MetricLabels): void
  observe(name: EditorialMetricName, value: number, labels?: MetricLabels): void
}

/** Sink que descarta tudo (default seguro: metrica nunca derruba o worker). */
export function createNoopEditorialMetricsSink(): EditorialMetricsSink {
  return { increment: () => {}, gauge: () => {}, observe: () => {} }
}

/* ------------------------------------------------------------------ */
/* Sentinela editorial                                                */
/* ------------------------------------------------------------------ */

/** Severidade de um achado da sentinela. */
export type EditorialAlertSeverity = 'critical' | 'warning' | 'info'

export interface EditorialAlert {
  readonly code: string
  readonly severity: EditorialAlertSeverity
  readonly message: string
}

/** Censo lido do PostgreSQL para a sentinela avaliar. */
export interface EditorialCensus {
  readonly activeSources: number
  readonly sourceItemsTotal: number
  readonly sourceItemsLast24h: number
  readonly publishedArticles: number
  readonly publishedArticleSearchDocs: number
  readonly publishedArticleIndexDecisions: number
  readonly publishedArticlesWithoutProvenance: number
  readonly scheduledOverdue: number
  readonly ingestFailures: number
}

/**
 * Avalia o censo editorial e devolve os alertas.
 *
 * Cada regra existe para pegar uma INCOERENCIA entre camadas — o tipo de falha
 * que nao aparece em teste unitario porque cada camada, isolada, esta correta:
 * itens entrando sem virar artigo; artigo publicado sem documento de busca;
 * artigo publicado sem decisao de indexabilidade; agendamento que passou da
 * hora e ninguem republicou a projecao.
 *
 * Ruido e evitado de proposito: nao ha alerta por materia publicada.
 */
export function evaluateEditorialSentinel(census: EditorialCensus): EditorialAlert[] {
  const alerts: EditorialAlert[] = []

  if (census.activeSources > 0 && census.sourceItemsLast24h === 0) {
    alerts.push({
      code: 'ingest_stalled',
      severity: 'warning',
      message: 'ha fonte ativa mas nenhum item recebido nas ultimas 24h',
    })
  }

  if (census.sourceItemsTotal > 0 && census.publishedArticles === 0) {
    alerts.push({
      code: 'items_without_articles',
      severity: 'info',
      message: 'itens recebidos existem, mas nenhum artigo foi publicado',
    })
  }

  if (census.publishedArticles > 0 && census.publishedArticleSearchDocs === 0) {
    alerts.push({
      code: 'search_projection_broken',
      severity: 'critical',
      message: 'ha artigo publicado e nenhum documento de busca: projecao quebrada',
    })
  } else if (census.publishedArticleSearchDocs < census.publishedArticles) {
    alerts.push({
      code: 'search_projection_stale',
      severity: 'warning',
      message: 'artigos publicados sem documento de busca correspondente',
    })
  }

  if (census.publishedArticles > 0 && census.publishedArticleIndexDecisions < census.publishedArticles) {
    alerts.push({
      code: 'indexability_stale',
      severity: 'warning',
      message: 'artigos publicados sem decisao de indexabilidade vigente',
    })
  }

  if (census.publishedArticlesWithoutProvenance > 0) {
    alerts.push({
      code: 'article_without_provenance',
      severity: 'critical',
      message: 'artigo publicado sem nenhuma fonte ligada (proveniencia perdida)',
    })
  }

  if (census.scheduledOverdue > 0) {
    alerts.push({
      code: 'scheduled_overdue',
      severity: 'warning',
      message: 'materia agendada passou da data e a projecao publica nao foi atualizada',
    })
  }

  if (census.ingestFailures > 0) {
    alerts.push({
      code: 'ingest_failures',
      severity: 'warning',
      message: 'itens em estado `failed` aguardando reprocessamento',
    })
  }

  return alerts
}
