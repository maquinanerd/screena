/**
 * metrics — Sink de metricas do catalogo (Backend A, §12).
 *
 * Interface + adapters MINIMOS e PUROS de dependencia: nao acopla Prometheus nem
 * OpenTelemetry, mas expoe o shape que os dois consomem (counter/gauge/histogram
 * com labels). O worker e os handlers emitem por esta porta; trocar o backend e
 * trocar o adapter.
 *
 * Nomes canonicos em CATALOG_METRIC_NAMES — a fonte unica; nunca escreva o nome
 * da metrica solto no codigo.
 */

/** Nomes canonicos das metricas do catalogo (§12). */
export const CATALOG_METRIC_NAMES = {
  jobsTotal: 'catalog_jobs_total',
  jobsFailedTotal: 'catalog_jobs_failed_total',
  jobsDeadLetterTotal: 'catalog_jobs_dead_letter_total',
  entitiesSyncedTotal: 'catalog_entities_synced_total',
  syncDurationSeconds: 'catalog_sync_duration_seconds',
  checkpointLagSeconds: 'catalog_checkpoint_lag_seconds',
  tmdbRequestsTotal: 'tmdb_requests_total',
  tmdbRateLimitTotal: 'tmdb_rate_limit_total',
  searchQueryDurationSeconds: 'search_query_duration_seconds',
  searchZeroResultsTotal: 'search_zero_results_total',
  searchDocumentsTotal: 'search_documents_total',
  discoverySnapshotAgeSeconds: 'discovery_snapshot_age_seconds',
  mediaCoverageRatio: 'media_coverage_ratio',
  trailerCoverageRatio: 'trailer_coverage_ratio',
} as const

/** Um nome de metrica valido. */
export type CatalogMetricName = (typeof CATALOG_METRIC_NAMES)[keyof typeof CATALOG_METRIC_NAMES]

/** Todos os nomes, para validacao/iteracao. */
export const ALL_CATALOG_METRIC_NAMES: readonly CatalogMetricName[] =
  Object.values(CATALOG_METRIC_NAMES)

/** Labels de uma amostra (baixa cardinalidade: nunca id de entidade). */
export type MetricLabels = Readonly<Record<string, string>>

/**
 * Porta de metricas. `increment` = counter monotonico; `gauge` = valor
 * instantaneo; `observe` = histograma (duracoes em SEGUNDOS, por convencao
 * Prometheus).
 */
export interface MetricsSink {
  increment(name: CatalogMetricName, value?: number, labels?: MetricLabels): void
  gauge(name: CatalogMetricName, value: number, labels?: MetricLabels): void
  observe(name: CatalogMetricName, value: number, labels?: MetricLabels): void
}

/** Uma amostra registrada (usada pelo sink em memoria/testes). */
export interface MetricSample {
  readonly name: CatalogMetricName
  readonly kind: 'counter' | 'gauge' | 'histogram'
  readonly value: number
  readonly labels: MetricLabels
}

/** Serializa labels de forma deterministica (chaves ordenadas) para agregacao. */
export function labelKey(labels: MetricLabels): string {
  const keys = Object.keys(labels).sort()
  return keys.map((k) => `${k}=${labels[k]}`).join(',')
}

/** Sink que descarta tudo (default seguro; nunca quebra o worker). */
export function createNoopMetricsSink(): MetricsSink {
  return {
    increment() {},
    gauge() {},
    observe() {},
  }
}

/** Sink em memoria: agrega counters/gauges e guarda amostras. Para testes/CLI. */
export interface InMemoryMetricsSink extends MetricsSink {
  /** Amostras na ordem de emissao. */
  samples(): readonly MetricSample[]
  /** Soma de um counter (ou ultimo valor de um gauge) por nome+labels. */
  read(name: CatalogMetricName, labels?: MetricLabels): number
  reset(): void
}

/** Cria um `InMemoryMetricsSink`. */
export function createInMemoryMetricsSink(): InMemoryMetricsSink {
  let recorded: MetricSample[] = []
  const aggregate = new Map<string, number>()
  const keyOf = (name: string, labels: MetricLabels) => `${name}|${labelKey(labels)}`

  const push = (
    kind: MetricSample['kind'],
    name: CatalogMetricName,
    value: number,
    labels: MetricLabels,
  ) => {
    recorded.push({ name, kind, value, labels })
    const key = keyOf(name, labels)
    if (kind === 'counter') aggregate.set(key, (aggregate.get(key) ?? 0) + value)
    else aggregate.set(key, value)
  }

  return {
    increment(name, value = 1, labels = {}) {
      push('counter', name, value, labels)
    },
    gauge(name, value, labels = {}) {
      push('gauge', name, value, labels)
    },
    observe(name, value, labels = {}) {
      push('histogram', name, value, labels)
    },
    samples() {
      return recorded
    },
    read(name, labels = {}) {
      return aggregate.get(keyOf(name, labels)) ?? 0
    },
    reset() {
      recorded = []
      aggregate.clear()
    },
  }
}

/** Linha estruturada emitida pelo sink de log. */
export interface MetricLogLine {
  readonly kind: MetricSample['kind']
  readonly metric: CatalogMetricName
  readonly value: number
  readonly labels: MetricLabels
}

/**
 * Sink que emite UMA linha estruturada por amostra (JSON), pronta para um
 * coletor (Promtail/Vector -> Prometheus, ou OTel log->metric). Nao faz rede.
 */
export function createStructuredLogMetricsSink(write: (line: MetricLogLine) => void): MetricsSink {
  return {
    increment(name, value = 1, labels = {}) {
      write({ kind: 'counter', metric: name, value, labels })
    },
    gauge(name, value, labels = {}) {
      write({ kind: 'gauge', metric: name, value, labels })
    },
    observe(name, value, labels = {}) {
      write({ kind: 'histogram', metric: name, value, labels })
    },
  }
}
