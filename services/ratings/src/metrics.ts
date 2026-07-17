/**
 * metrics.ts — Contadores de observabilidade do Backend B. Modulo PURO.
 *
 * Sem Prometheus, sem StatsD, sem IO: um contador em memoria que o worker
 * incrementa e imprime/loga no fim do run. O repositorio ainda nao tem coletor;
 * amarrar estes numeros a um cliente concreto agora seria escolher o coletor
 * antes de precisar dele. O que importa e que os nomes ja sejam estaveis e que
 * o valor seja produzido no lugar certo — trocar a saida depois e trivial.
 *
 * Os nomes seguem a convencao Prometheus (`_total` para monotonicos).
 */

/** Nomes canonicos dos contadores (Backend B, §12). */
export const METRIC_NAMES = [
  /** Ciclos de sync de ratings iniciados. */
  'ratings_sync_total',
  /** Notas reconhecidas no payload (forma + invariantes 1/2 ok). */
  'ratings_recognized_total',
  /** Notas recusadas (qualquer motivo — ver labels no relatorio). */
  'ratings_rejected_total',
  /** Notas que estao efetivamente exibiveis apos a promocao. */
  'ratings_displayable_total',
  /** Ofertas de streaming vistas no snapshot. */
  'streaming_offers_total',
  /** Ofertas de streaming efetivamente exibiveis. */
  'streaming_offers_displayable_total',
  /** Links de oferta recusados por serem inseguros/ilegais. */
  'streaming_invalid_links_total',
  /** Calculos de Cinerie Score realizados. */
  'cinerie_score_calculation_total',
  /** Calculos de Cinerie Score bloqueados por falta de decisao. */
  'cinerie_score_blocked_total',
] as const

/** Um contador reconhecido. */
export type MetricName = (typeof METRIC_NAMES)[number]

/** Snapshot imutavel de todos os contadores. */
export type MetricsSnapshot = Readonly<Record<MetricName, number>>

/** Coletor de contadores. */
export interface MetricsCollector {
  /** Incrementa `name` em `by` (default 1). `by` negativo e erro. */
  increment(name: MetricName, by?: number): void
  /** Le todos os contadores. Sempre devolve TODOS os nomes, inclusive zerados. */
  snapshot(): MetricsSnapshot
  /** Linhas `nome valor`, ordenadas, para log/relatorio. */
  render(): readonly string[]
}

/**
 * Cria um coletor zerado.
 *
 * Todos os nomes comecam em 0 explicitamente — um contador AUSENTE e ambiguo
 * ("nao aconteceu" ou "nao instrumentei?"), e um zero e uma afirmacao.
 */
export function createMetricsCollector(): MetricsCollector {
  const counters = new Map<MetricName, number>()
  for (const name of METRIC_NAMES) counters.set(name, 0)

  return {
    increment(name: MetricName, by = 1): void {
      if (!Number.isFinite(by) || by < 0) {
        throw new Error(`metrics: incremento invalido para ${name}: ${by}`)
      }
      counters.set(name, (counters.get(name) ?? 0) + by)
    },
    snapshot(): MetricsSnapshot {
      return Object.fromEntries(counters) as MetricsSnapshot
    },
    render(): readonly string[] {
      return [...counters.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `${name} ${value}`)
    },
  }
}
