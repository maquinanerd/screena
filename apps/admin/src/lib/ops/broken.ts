/**
 * broken.ts — "O que esta quebrado agora", montado dos julgamentos das telas. PURO.
 *
 * Nenhuma regra nova: se Filas diz "PARADA", a visao geral diz "PARADA". E uma
 * medida inteira que falhou tambem entra na lista — um painel que nao consegue
 * medir esta quebrado, e dizer "nada quebrado" nesse caso seria o verde que nunca
 * fica vermelho.
 */

import type { ProviderQuotaRow } from "../../server/ops/quotas";
import type { QueuesPanel } from "../../server/ops/queues";
import type { ServicesPanel } from "../../server/ops/services";
import { formatDecimal, formatInt } from "./format";
import type { Measured } from "./measure";

/** Um item quebrado. */
export interface BrokenItem {
  readonly area: "Filas" | "Fila de jobs" | "Cotas" | "Serviços" | "Painel";
  readonly text: string;
  readonly href: string;
}

/** Junta os julgamentos das telas numa lista de quebrados. */
export function collectBroken(input: {
  readonly queues: Measured<QueuesPanel>;
  readonly quotas: Measured<readonly ProviderQuotaRow[]>;
  readonly services: Measured<ServicesPanel>;
}): readonly BrokenItem[] {
  const broken: BrokenItem[] = [];

  if (!input.queues.ok) {
    broken.push({ area: "Painel", text: `não foi possível medir as filas: ${input.queues.reason}`, href: "/filas" });
  } else {
    for (const row of input.queues.value.rows) {
      for (const reason of row.redReasons) {
        broken.push({ area: "Filas", text: `${row.queue}: ${reason}`, href: `/filas/${row.queue}` });
      }
    }
    const backlog = input.queues.value.backlog;
    if (!backlog.ok) {
      broken.push({ area: "Painel", text: `não foi possível medir catalog_jobs: ${backlog.reason}`, href: "/filas" });
    } else {
      for (const alert of backlog.value.alerts) {
        broken.push({
          area: "Fila de jobs",
          text: `${alert.jobType} REPRESADA: ${formatInt(alert.pending)} pendente(s), o mais antigo há ${formatDecimal(alert.oldestPendingHours, 1)} h`,
          href: `/logs?aba=jobs&status=pending&tipo=${alert.jobType}`,
        });
      }
      if (backlog.value.neverDrained) {
        broken.push({
          area: "Fila de jobs",
          text: "há jobs abertos e NENHUM concluído: produtor sem consumidor (o screen-catalog-worker está no ar?)",
          href: "/servicos",
        });
      }
    }
  }

  if (!input.quotas.ok) {
    broken.push({ area: "Painel", text: `não foi possível medir as cotas: ${input.quotas.reason}`, href: "/cotas" });
  } else {
    for (const row of input.quotas.value) {
      if (row.judgement.red) {
        broken.push({ area: "Cotas", text: `${row.key}: ${row.judgement.reasons.join("; ")}`, href: `/cotas#fornecedor-${row.key}` });
      }
    }
  }

  if (!input.services.ok) {
    broken.push({ area: "Painel", text: `não foi possível medir os serviços: ${input.services.reason}`, href: "/servicos" });
  } else {
    for (const row of input.services.value.rows) {
      for (const reason of row.redReasons) {
        broken.push({ area: "Serviços", text: `${row.service.label} (${row.service.key}): ${reason}`, href: "/servicos" });
      }
    }
  }

  return broken;
}
