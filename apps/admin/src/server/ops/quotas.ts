/**
 * quotas.ts — Quanto cada fornecedor gastou, e se o fornecedor RECUSOU. SERVER-ONLY.
 *
 * "Gasto de hoje" = `SUM(api_sync_logs.quota_cost)` desde 00:00 UTC — o MESMO
 * corte que o agendador usa para decidir se a fila de fundo da OMDb ainda roda
 * (`readSpentToday`). Se a tela e o agendador cortassem o dia em horas
 * diferentes, a tela diria "sobra" enquanto a fila ja parou.
 */

import { evaluateQuota, type QuotaJudgement } from "../../lib/ops/health";
import { formatInt } from "../../lib/ops/format";
import { measure, type Measured } from "../../lib/ops/measure";
import { ALL_CERTAIN_REFUSAL_CODES, quotaPolicyFor, type ProviderQuotaPolicy } from "../../lib/ops/quota-policy";
import { DAY_MS, HOUR_MS, isoDay, lastUtcDays, num, opsDb, utcDayStart } from "./db";

/** Um dia da serie de um fornecedor. `spent: null` = nenhum registro naquele dia. */
export interface QuotaDay {
  readonly day: string;
  readonly spent: number | null;
  readonly runs: number;
  readonly refusals: number;
}

/** A linha de um fornecedor. */
export interface ProviderQuotaRow {
  readonly key: string;
  readonly name: string;
  readonly kind: string;
  readonly policy: ProviderQuotaPolicy | null;
  readonly spentToday: number;
  readonly runsToday: number;
  /** Recusas CERTAS do fornecedor hoje. `null` = o fornecedor nao tem codigo de recusa distinguivel. */
  readonly refusalsToday: number | null;
  readonly spentLastHour: number;
  readonly lastLogToday: Date | null;
  readonly judgement: QuotaJudgement;
  readonly series: readonly QuotaDay[];
}

function judge(policy: ProviderQuotaPolicy | null, row: { spentToday: number; runsToday: number; refusalsToday: number | null; spentLastHour: number }): QuotaJudgement {
  if (policy === null) {
    return { red: false, reasons: ["sem política de cota declarada para este fornecedor"] };
  }
  if (policy.status === "aposentado") {
    return row.runsToday > 0
      ? { red: true, reasons: [`fornecedor APOSENTADO registrou ${formatInt(row.runsToday)} execução(ões) hoje`] }
      : { red: false, reasons: [] };
  }
  if (policy.dailyLimit !== null) {
    return evaluateQuota({ dailyLimit: policy.dailyLimit, spentToday: row.spentToday, providerRefusalsToday: row.refusalsToday });
  }
  if (policy.hourlyLimit !== null) {
    const reasons: string[] = [];
    let red = false;
    if (row.spentLastHour >= policy.hourlyLimit) {
      red = true;
      reasons.push(`o teto da hora (${formatInt(policy.hourlyLimit)}) foi atingido pelo nosso contador`);
    }
    if (row.refusalsToday !== null && row.refusalsToday > 0) {
      red = true;
      reasons.push(`o fornecedor recusou por limite ${formatInt(row.refusalsToday)} vez(es) hoje`);
    }
    return { red, reasons };
  }
  return { red: false, reasons: [] };
}

/** A tela de cotas. */
export async function getQuotaPanel(now: Date, days = 30): Promise<Measured<readonly ProviderQuotaRow[]>> {
  return measure(
    "api_sync_logs.quota_cost + api_providers",
    async () => {
      const db = opsDb();
      const dayStart = utcDayStart(now).toISOString();
      const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();
      const since = new Date(utcDayStart(now).getTime() - (days - 1) * DAY_MS).toISOString();
      const codes = [...ALL_CERTAIN_REFUSAL_CODES];

      const providers = await db.$queryRaw<Array<{ key: string; name: string; kind: string }>>`
        SELECT key, name, kind::text AS kind FROM api_providers ORDER BY key`;

      const today = await db.$queryRaw<Array<{ provider_api: string; spent: unknown; runs: unknown; last_at: Date | null }>>`
        SELECT provider_api, COALESCE(SUM(quota_cost), 0) AS spent, COUNT(*) AS runs, MAX(created_at) AS last_at
          FROM api_sync_logs
         WHERE created_at >= ${dayStart}::timestamptz AT TIME ZONE 'UTC'
         GROUP BY provider_api`;

      const refusals = await db.$queryRaw<Array<{ provider_api: string; error_code: string; n: unknown }>>`
        SELECT provider_api, error_code, COUNT(*) AS n
          FROM api_sync_logs
         WHERE created_at >= ${dayStart}::timestamptz AT TIME ZONE 'UTC'
           AND error_code = ANY(${codes}::text[])
         GROUP BY provider_api, error_code`;

      const lastHour = await db.$queryRaw<Array<{ provider_api: string; spent: unknown }>>`
        SELECT provider_api, COALESCE(SUM(quota_cost), 0) AS spent
          FROM api_sync_logs
         WHERE created_at >= ${hourAgo}::timestamptz AT TIME ZONE 'UTC'
         GROUP BY provider_api`;

      const series = await db.$queryRaw<Array<{ provider_api: string; day: Date; spent: unknown; runs: unknown; refusals: unknown }>>`
        SELECT provider_api, date_trunc('day', created_at)::date AS day,
               COALESCE(SUM(quota_cost), 0) AS spent, COUNT(*) AS runs,
               COUNT(*) FILTER (WHERE error_code = ANY(${codes}::text[])) AS refusals
          FROM api_sync_logs
         WHERE created_at >= ${since}::timestamptz AT TIME ZONE 'UTC'
         GROUP BY 1, 2
         ORDER BY 1, 2`;

      const todayBy = new Map(today.map((row) => [row.provider_api, row]));
      const hourBy = new Map(lastHour.map((row) => [row.provider_api, num(row.spent)]));
      const dayList = lastUtcDays(now, days);

      // Fornecedor que gravou log e nao esta em api_providers nao existe (FK) —
      // mas fornecedor COM politica e sem linha em api_providers aparece como
      // ausente, para ninguem achar que ele esta "zerado".
      const keys = new Set([...providers.map((p) => p.key)]);
      return providers
        .map((provider): ProviderQuotaRow => {
          const policy = quotaPolicyFor(provider.key);
          const todayRow = todayBy.get(provider.key);
          const spentToday = todayRow === undefined ? 0 : num(todayRow.spent);
          const runsToday = todayRow === undefined ? 0 : num(todayRow.runs);
          const refusalsToday =
            policy === null || policy.certainRefusalCodes.length === 0
              ? null
              : refusals
                  .filter((row) => row.provider_api === provider.key && policy.certainRefusalCodes.includes(row.error_code))
                  .reduce((sum, row) => sum + num(row.n), 0);
          const spentLastHour = hourBy.get(provider.key) ?? 0;
          const byDay = new Map(
            series.filter((row) => row.provider_api === provider.key).map((row) => [isoDay(row.day), row]),
          );
          return {
            key: provider.key,
            name: provider.name,
            kind: provider.kind,
            policy,
            spentToday,
            runsToday,
            refusalsToday,
            spentLastHour,
            lastLogToday: todayRow?.last_at ?? null,
            judgement: judge(policy, { spentToday, runsToday, refusalsToday, spentLastHour }),
            series: dayList.map((day) => {
              const row = byDay.get(day);
              return row === undefined
                ? { day, spent: null, runs: 0, refusals: 0 }
                : { day, spent: num(row.spent), runs: num(row.runs), refusals: num(row.refusals) };
            }),
          };
        })
        .filter((row) => keys.has(row.key));
    },
    () => now,
  );
}
