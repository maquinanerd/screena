/**
 * queues.ts — O que o painel precisa saber de cada fila ALEM da tabela de ritmos.
 * PURO.
 *
 * A tabela de ritmos (`@screena/sync`) diz cadencia, teto e fornecedor. Ela nao
 * diz qual e o UNIVERSO que a fila percorre — e e o universo que permite calcular
 * a volta — nem o que o "sucesso" dela significa. Esta tabela diz, e o teste
 * obriga que ela cubra TODA fila: fila nova sem linha aqui reprova.
 */

import type { SchedulerQueue } from "@screena/sync";
import type { QueueUniverseKey } from "@screena/sync/panel";

export type { QueueUniverseKey };

/** O que o sucesso de uma fila afirma. */
export type QueueRole = "produtora" | "executora" | "direta" | "derivada";

/** Rotulo e significado de cada papel, para a tela. */
export const QUEUE_ROLE_NOTES: Readonly<Record<QueueRole, string>> = {
  produtora:
    "enfileira em catalog_jobs: o sucesso no log é do ENFILEIRAMENTO. O trabalho sai no screen-catalog-worker e é medido abaixo.",
  executora: "roda uma CLI e espera: o sucesso é do trabalho.",
  direta: "busca e grava no próprio ciclo: o sucesso é do trabalho.",
  derivada: "não consome fornecedor: o último sucesso é o do ARTEFATO que ela grava.",
};

/** O universo de uma fila. */
export type QueueUniverseSpec =
  | { readonly kind: "counted"; readonly key: QueueUniverseKey; readonly label: string }
  | { readonly kind: "not_applicable"; readonly reason: string }
  | { readonly kind: "undeterminable"; readonly reason: string };

/** Como o teto por ciclo e apurado. */
export type QueuePerCycleSpec =
  | { readonly kind: "rhythm" }
  | { readonly kind: "fixed"; readonly items: number; readonly label: string }
  | { readonly kind: "omdb_coverage_slots" };

/** A ficha de uma fila para o painel. */
export interface QueuePanelSpec {
  readonly role: QueueRole;
  readonly universe: QueueUniverseSpec;
  readonly perCycle: QueuePerCycleSpec;
  /** O tipo de job RAIZ que a fila enfileira — para medir o trabalho que saiu. */
  readonly rootJobType: string | null;
}

export const QUEUE_PANEL_SPECS: Readonly<Record<SchedulerQueue, QueuePanelSpec>> = {
  deploy_reference: {
    role: "direta",
    universe: { kind: "not_applicable", reason: "não percorre universo: lê a cabeça do main a cada ciclo" },
    perCycle: { kind: "fixed", items: 1, label: "uma leitura do main" },
    rootJobType: null,
  },
  catalog_coverage: {
    role: "derivada",
    universe: { kind: "not_applicable", reason: "um retrato do catálogo inteiro por dia" },
    perCycle: { kind: "fixed", items: 1, label: "um retrato" },
    rootJobType: null,
  },
  discovery: {
    role: "produtora",
    universe: {
      kind: "undeterminable",
      reason: "o universo é o export diário do TMDB, que não é guardado no banco",
    },
    perCycle: { kind: "fixed", items: 3, label: "3 descobertas (filme, série, pessoa)" },
    rootJobType: "discover_ids",
  },
  changes: {
    role: "produtora",
    universe: { kind: "not_applicable", reason: "incremental: percorre a janela do /changes, não um universo" },
    perCycle: { kind: "fixed", items: 1, label: "uma janela" },
    rootJobType: "sync_changes",
  },
  watch_offers: {
    role: "direta",
    universe: { kind: "counted", key: "titles", label: "filmes + séries" },
    perCycle: { kind: "rhythm" },
    rootJobType: null,
  },
  trending: {
    role: "produtora",
    universe: { kind: "not_applicable", reason: "4 listas por ciclo (filme e série × dia e semana)" },
    perCycle: { kind: "fixed", items: 4, label: "4 listas" },
    rootJobType: "sync_lists",
  },
  airing_series: {
    role: "produtora",
    universe: { kind: "counted", key: "airing_series", label: "séries em exibição (status nulo incluso)" },
    perCycle: { kind: "rhythm" },
    rootJobType: "sync_details",
  },
  title_media: {
    role: "produtora",
    universe: { kind: "counted", key: "titles", label: "filmes + séries" },
    perCycle: { kind: "rhythm" },
    rootJobType: "sync_media",
  },
  cinerie_score: {
    role: "executora",
    universe: { kind: "not_applicable", reason: "recalcula todos os títulos com nota a cada ciclo" },
    perCycle: { kind: "fixed", items: 1, label: "uma passagem inteira" },
    rootJobType: null,
  },
  search_projection: {
    role: "executora",
    universe: { kind: "not_applicable", reason: "reprojeta a busca inteira a cada ciclo" },
    perCycle: { kind: "fixed", items: 1, label: "uma passagem inteira" },
    rootJobType: null,
  },
  ratings_omdb: {
    role: "executora",
    universe: { kind: "counted", key: "omdb_coverage", label: "títulos com imdb_id e nenhuma nota externa" },
    perCycle: { kind: "omdb_coverage_slots" },
    rootJobType: null,
  },
  title_detail_active: {
    role: "produtora",
    universe: { kind: "counted", key: "active_titles", label: "filmes não lançados + séries não encerradas" },
    perCycle: { kind: "rhythm" },
    rootJobType: "sync_details",
  },
  people: {
    role: "produtora",
    universe: { kind: "counted", key: "people", label: "todas as pessoas" },
    perCycle: { kind: "rhythm" },
    rootJobType: "sync_details",
  },
  title_detail_ended: {
    role: "produtora",
    universe: { kind: "counted", key: "ended_titles", label: "filmes lançados + séries encerradas" },
    perCycle: { kind: "rhythm" },
    rootJobType: "sync_details",
  },
  awards: {
    role: "executora",
    universe: { kind: "counted", key: "omdb_cache", label: "payloads da OMDb guardados em api_cache" },
    perCycle: { kind: "rhythm" },
    rootJobType: null,
  },
};

/** O `run_id` que o agendador carimba (e que o filho herda). */
export function schedulerRunId(queue: SchedulerQueue): string {
  return `scheduler:${queue}`;
}
