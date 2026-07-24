/**
 * queue-health.mjs — Avaliação PURA da saúde de um ciclo de catálogo.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * --------------------------
 * O modo de falha mais perigoso do bootstrap não é o worker morrer — é ele
 * **parecer saudável**. Foi exatamente o que aconteceu na primeira execução do
 * Prompt 03: a fila reivindicava jobs, reportava `retry_wait`, o exit code era
 * 0, e **zero entidades persistiam** (faltavam `db:seed` e taxonomias, e toda
 * escrita morria em FK violation). Um operador olhando "jobs processados" veria
 * progresso onde não havia nenhum.
 *
 * Por isso o sinal central aqui é `zero_growth`: jobs concluíram E o catálogo
 * não cresceu. Nenhuma métrica de fila sozinha detecta isso.
 *
 * PURO: sem rede, sem banco, sem relógio. Recebe dois snapshots (antes/depois)
 * e devolve os problemas. Quem lê o banco é o wrapper; quem decide é aqui.
 */

/** @typedef {"critical"|"warning"|"info"} Severity */

/** Códigos de problema reconhecidos. */
export const HEALTH_ISSUES = Object.freeze([
  "zero_growth",
  "dead_letter_present",
  "dead_letter_growing",
  "backlog_high",
  "retry_storm",
  "checkpoint_stale",
  "no_slugs",
  "no_translations",
  "no_search_documents",
  "abnormal_people_growth",
  "queue_stuck",
]);

/** Limiares default. Todos ajustáveis pelo chamador. */
export const DEFAULT_THRESHOLDS = Object.freeze({
  /** Backlog (pending + retry_wait) acima disso vira alerta. */
  backlogHigh: 5000,
  /** Fração de retry_wait sobre o total da fila que caracteriza tempestade. */
  retryStormRatio: 0.3,
  /** Idade máxima de um checkpoint antes de ser considerado parado (segundos). */
  checkpointStaleSeconds: 86_400,
  /**
   * Pessoas por título acima disso é crescimento anormal.
   *
   * O catálogo real mede ~295 pessoas por título (5.901 pessoas / 20 títulos),
   * porque o detalhe traz o elenco inteiro. O limiar fica bem acima disso: o
   * alvo é detectar ingestão de pessoas por DESCOBERTA (que multiplicaria sem
   * relação com títulos), não o elenco normal.
   */
  peoplePerTitleMax: 1000,
});

/**
 * Snapshot do estado observável do catálogo.
 * @typedef {object} CatalogSnapshot
 * @property {number} entities        soma de filmes+séries+temporadas+episódios
 * @property {number} titles          filmes + séries
 * @property {number} people
 * @property {number} slugs
 * @property {number} translations
 * @property {number} searchDocuments
 * @property {number} deadLetter
 * @property {number} pending
 * @property {number} retryWait
 * @property {number} succeeded
 * @property {number} [oldestCheckpointAgeSeconds]
 */

/**
 * Um problema detectado.
 * @typedef {object} HealthIssue
 * @property {string} code
 * @property {Severity} severity
 * @property {string} message
 */

/**
 * Avalia a saúde comparando o estado ANTES e DEPOIS de um ciclo.
 *
 * @param {CatalogSnapshot} before
 * @param {CatalogSnapshot} after
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [overrides]
 * @returns {{healthy: boolean, issues: HealthIssue[], summary: string}}
 */
export function evaluateCycleHealth(before, after, overrides = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...overrides };
  /** @type {HealthIssue[]} */
  const issues = [];

  const jobsDone = after.succeeded - before.succeeded;
  const entitiesGrew = after.entities > before.entities;
  const backlog = after.pending + after.retryWait;

  // O sinal central: jobs concluíram e nada entrou no catálogo.
  if (jobsDone > 0 && !entitiesGrew) {
    issues.push({
      code: "zero_growth",
      severity: "critical",
      message:
        `${jobsDone} job(s) concluidos e o catalogo NAO cresceu ` +
        `(${before.entities} -> ${after.entities}). ` +
        "Causa tipica: falta db:seed/taxonomias e toda escrita morre em FK violation.",
    });
  }

  // Fila com trabalho pendente e nenhum job concluído: worker não avança.
  if (jobsDone === 0 && backlog > 0) {
    issues.push({
      code: "queue_stuck",
      severity: "critical",
      message: `nenhum job concluido com backlog de ${backlog}: o worker nao esta avancando.`,
    });
  }

  if (after.deadLetter > 0) {
    issues.push({
      code:
        after.deadLetter > before.deadLetter ? "dead_letter_growing" : "dead_letter_present",
      severity: after.deadLetter > before.deadLetter ? "critical" : "warning",
      message: `dead-letter com ${after.deadLetter} job(s) (antes: ${before.deadLetter}).`,
    });
  }

  if (backlog > t.backlogHigh) {
    issues.push({
      code: "backlog_high",
      severity: "warning",
      message: `backlog de ${backlog} acima do limite ${t.backlogHigh}.`,
    });
  }

  const queueTotal = after.pending + after.retryWait + after.succeeded;
  if (queueTotal > 0 && after.retryWait / queueTotal > t.retryStormRatio) {
    issues.push({
      code: "retry_storm",
      severity: "critical",
      message:
        `${after.retryWait} de ${queueTotal} jobs em retry_wait ` +
        `(> ${Math.round(t.retryStormRatio * 100)}%): o upstream ou o banco esta recusando.`,
    });
  }

  if (
    typeof after.oldestCheckpointAgeSeconds === "number" &&
    after.oldestCheckpointAgeSeconds > t.checkpointStaleSeconds
  ) {
    issues.push({
      code: "checkpoint_stale",
      severity: "warning",
      message: `checkpoint parado ha ${after.oldestCheckpointAgeSeconds}s (limite ${t.checkpointStaleSeconds}s).`,
    });
  }

  // Entidade sem slug/tradução não vira URL — o sintoma do elo que faltava.
  if (after.titles > 0 && after.slugs === 0) {
    issues.push({
      code: "no_slugs",
      severity: "critical",
      message: `${after.titles} titulo(s) e NENHUM slug: nada vira rota publica, busca ou sitemap.`,
    });
  }
  if (after.titles > 0 && after.translations === 0) {
    issues.push({
      code: "no_translations",
      severity: "warning",
      message: `${after.titles} titulo(s) e NENHUMA traducao.`,
    });
  }
  if (after.slugs > 0 && after.searchDocuments === 0) {
    issues.push({
      code: "no_search_documents",
      severity: "warning",
      message: `${after.slugs} slug(s) e NENHUM search_document: a projecao de busca nao rodou.`,
    });
  }

  if (after.titles > 0 && after.people / after.titles > t.peoplePerTitleMax) {
    issues.push({
      code: "abnormal_people_growth",
      severity: "warning",
      message:
        `${after.people} pessoas para ${after.titles} titulo(s) ` +
        `(> ${t.peoplePerTitleMax} por titulo): sinal de ingestao de pessoa por DESCOBERTA.`,
    });
  }

  const critical = issues.filter((i) => i.severity === "critical").length;
  return {
    healthy: critical === 0,
    issues,
    summary:
      issues.length === 0
        ? `ciclo saudavel: +${after.entities - before.entities} entidades, ${jobsDone} job(s)`
        : `${issues.length} problema(s) (${critical} critico(s)): ${issues.map((i) => i.code).join(", ")}`,
  };
}

/**
 * Converte o veredito num `outcome` para `buildAlert` de
 * `scripts/backup/lib/alert.mjs` — reusa a infra do Prompt 02 em vez de criar
 * outro cliente de webhook.
 *
 * @param {{healthy:boolean, issues:HealthIssue[], summary:string}} verdict
 * @param {{timestamp:string, host?:string, exitCode?:number}} context
 */
export function toAlertOutcome(verdict, context) {
  return {
    // `queue` já é uma ALERT_SOURCES válida da infra existente.
    source: "queue",
    status: verdict.healthy ? "success" : "failure",
    exitCode: context.exitCode ?? (verdict.healthy ? 0 : 1),
    message: verdict.summary,
    timestamp: context.timestamp,
    host: context.host ?? "",
  };
}
