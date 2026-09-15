/**
 * overview.ts — A visao geral: o que esta quebrado AGORA, e o resto em uma tela.
 * SERVER-ONLY.
 *
 * A lista de quebrados sai de `lib/ops/broken.ts` (puro, testado), montada dos
 * MESMOS julgamentos das telas de detalhe.
 */

import { collectBroken, type BrokenItem } from "../../lib/ops/broken";
import type { Measured } from "../../lib/ops/measure";
import { headlineCoverage, latestSnapshotDay, readCoverageSnapshots, type CoverageSnapshotRow, type HeadlineCoverage } from "./coverage";
import { getQueuesPanel, type QueuesPanel } from "./queues";
import { getQuotaPanel, type ProviderQuotaRow } from "./quotas";
import { getServicesPanel, type ServicesPanel } from "./services";

export type { BrokenItem };

/** A visao geral. */
export interface OverviewData {
  readonly queues: Measured<QueuesPanel>;
  readonly quotas: Measured<readonly ProviderQuotaRow[]>;
  readonly services: Measured<ServicesPanel>;
  readonly coverage: Measured<readonly CoverageSnapshotRow[]>;
  readonly headline: {
    readonly day: string;
    readonly capturedAt: Date;
    readonly methodVersion: string;
    readonly values: HeadlineCoverage;
  } | null;
  readonly broken: readonly BrokenItem[];
}

/** Monta a visao geral. */
export async function getOverview(now: Date): Promise<OverviewData> {
  const [queues, quotas, services, coverage] = await Promise.all([
    getQueuesPanel(now),
    getQuotaPanel(now, 7),
    getServicesPanel(now),
    readCoverageSnapshots(now, 3),
  ]);
  let headline: OverviewData["headline"] = null;
  if (coverage.ok) {
    const day = latestSnapshotDay(coverage.value);
    const values = headlineCoverage(day);
    const first = day[0];
    if (values !== null && first !== undefined) {
      headline = { day: first.capturedOn, capturedAt: first.capturedAt, methodVersion: first.methodVersion, values };
    }
  }
  return { queues, quotas, services, coverage, headline, broken: collectBroken({ queues, quotas, services }) };
}
