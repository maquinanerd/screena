/**
 * inspect-format.ts — Apresentacao PURA do relatorio de inspecao.
 *
 * Duas saidas, ambas sem efeito colateral:
 *  - `formatInspectionSummary` — resumo legivel para humano (texto multilinha).
 *  - `toInspectionJson` — JSON estruturado e identado.
 *
 * NUNCA imprime API key, payload completo, resposta crua do Gemini, segredo nem
 * stack trace longo: o relatorio ja chega com mensagens RESUMIDAS e so com
 * campos seguros. Esta camada nao acessa env, banco nem rede.
 */

import type { CountBucket, InspectionReport } from "./inspect-entity-writer.js";
import { JOB_STATUS_ORDER, REVIEW_STATUS_ORDER } from "./inspect-entity-writer.js";

/** Padding a direita para alinhar rotulos no resumo. */
function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/** Busca a contagem de uma chave (0 se ausente). */
function valueOf(buckets: readonly CountBucket[], key: string): number {
  for (const bucket of buckets) {
    if (bucket.key === key) return bucket.count;
  }
  return 0;
}

/** Renderiza buckets em uma unica linha: "a=1, b=2" ou "(nenhum)". */
function inlineBuckets(buckets: readonly CountBucket[]): string {
  if (buckets.length === 0) return "(nenhum)";
  return buckets.map((bucket) => `${bucket.key}=${bucket.count}`).join(", ");
}

/**
 * Resumo legivel do estado operacional. Determinístico (mesma entrada -> mesma
 * saida), sem cores nem timestamps gerados localmente.
 */
export function formatInspectionSummary(report: InspectionReport): string {
  const lines: string[] = [];
  const entityType = report.filter.entityType ?? "todos";

  lines.push("Entity Writer — status operacional");
  lines.push(
    `Filtro: entityType=${entityType}  language=${report.filter.languageCode}  limit=${report.filter.limit}`,
  );

  // Jobs.
  lines.push("");
  lines.push(`Jobs (total ${report.jobs.total}):`);
  for (const status of JOB_STATUS_ORDER) {
    lines.push(`  ${padRight(status, 14)} ${valueOf(report.jobs.byStatus, status)}`);
  }
  lines.push(
    `  fila acumulada: ${report.jobs.hasBacklog ? "sim" : "nao"} (queued=${report.jobs.queued}, ativos=${report.jobs.active})`,
  );
  lines.push(`  por tipo:   ${inlineBuckets(report.jobs.byType)}`);
  lines.push(`  por entidade: ${inlineBuckets(report.jobs.byEntityType)}`);

  // Content blocks.
  lines.push("");
  lines.push(`Content blocks (total ${report.blocks.total}):`);
  for (const status of REVIEW_STATUS_ORDER) {
    lines.push(`  ${padRight(status, 16)} ${valueOf(report.blocks.byReviewStatus, status)}`);
  }
  lines.push(`  por tipo:   ${inlineBuckets(report.blocks.byBlockType)}`);
  lines.push(`  por origem: ${inlineBuckets(report.blocks.bySourceType)}`);

  // Entidades com blocos.
  lines.push("");
  lines.push(`Entidades com blocos (${report.entitiesWithBlocks.length}):`);
  if (report.entitiesWithBlocks.length === 0) {
    lines.push("  (nenhuma)");
  } else {
    for (const entity of report.entitiesWithBlocks) {
      lines.push(
        `  ${entity.entityType} #${entity.entityId} [${entity.languageCode}]: ${entity.blockCount} bloco(s)`,
      );
    }
  }

  // Falhas recentes.
  lines.push("");
  lines.push(`Falhas recentes (${report.recentFailedJobs.length}):`);
  if (report.recentFailedJobs.length === 0) {
    lines.push("  (nenhuma)");
  } else {
    for (const job of report.recentFailedJobs) {
      lines.push(
        `  job #${job.id} ${job.entityType}#${job.entityId} [${job.status}] attempts=${job.attempts} — ${job.lastError ?? "(sem mensagem)"}`,
      );
    }
  }

  // Logs recentes com erro.
  lines.push("");
  lines.push(`Logs recentes com erro (${report.recentLogErrors.length}):`);
  if (report.recentLogErrors.length === 0) {
    lines.push("  (nenhum)");
  } else {
    for (const log of report.recentLogErrors) {
      lines.push(
        `  log #${log.id} job#${log.jobId} ${log.entityType}#${log.entityId} [${log.validationStatus ?? "?"}] — ${log.errorMessage ?? "(sem mensagem)"}`,
      );
    }
  }

  // Concluidos recentes.
  lines.push("");
  lines.push(`Concluidos recentes (${report.recentCompletedJobs.length}):`);
  if (report.recentCompletedJobs.length === 0) {
    lines.push("  (nenhum)");
  } else {
    for (const job of report.recentCompletedJobs) {
      lines.push(
        `  job #${job.id} ${job.entityType}#${job.entityId} ${job.jobType} -> block ${job.resultBlockId ?? "?"} (${job.completedAt ?? "?"})`,
      );
    }
  }

  return lines.join("\n");
}

/** JSON estruturado e identado do relatorio (JSON-safe por construcao). */
export function toInspectionJson(report: InspectionReport): string {
  return JSON.stringify(report, null, 2);
}
