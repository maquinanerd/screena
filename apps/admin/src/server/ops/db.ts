/**
 * db.ts — A conexao e as conversoes do painel operacional. SERVER-ONLY.
 *
 * O painel so LE por aqui, e so com `$queryRaw` parametrizado (template marcado).
 * A unica escrita do painel passa por `@screena/sync/admin-actions`, e a guarda
 * `tests/admin/readonly-guard.test.ts` reprova qualquer metodo de escrita neste
 * diretorio.
 */

import { getPrismaClient } from "@screena/db/server";

/** O cliente do banco. */
export type OpsPrisma = ReturnType<typeof getPrismaClient>;

/** O cliente do banco (singleton do pacote de dados). */
export function opsDb(): OpsPrisma {
  return getPrismaClient();
}

/** O cliente de uma transacao (o que `withStatementTimeout` entrega). */
export type OpsTx = Parameters<Parameters<OpsPrisma["$transaction"]>[0]>[0];

/**
 * Roda leituras com TETO DE TEMPO. Estourou, a consulta e cancelada pelo banco e
 * a medida vira "nao determinado" — nunca um painel travado nem um numero parcial.
 *
 * `set_config(..., true)` vale so para esta transacao: a conexao volta ao pool sem
 * o teto.
 */
export async function withStatementTimeout<T>(ms: number, run: (tx: OpsTx) => Promise<T>): Promise<T> {
  const budget = Math.max(1_000, Math.trunc(ms));
  return opsDb().$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(budget)}, true)`;
      return run(tx);
    },
    { timeout: budget + 5_000, maxWait: 10_000 },
  );
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** `bigint`, `number`, `Decimal` ou texto numerico -> number. Ausente -> 0. */
export function num(value: unknown): number {
  const parsed = numOrNull(value);
  return parsed ?? 0;
}

/** Como `num`, mas ausente continua ausente. */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Meia-noite UTC do dia de `now` — o corte do "gasto de hoje". */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** `YYYY-MM-DD` de uma data (UTC). */
export function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Os ultimos `days` dias (UTC), do mais antigo ao de hoje. */
export function lastUtcDays(now: Date, days: number): readonly string[] {
  const start = utcDayStart(now).getTime();
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) out.push(isoDay(new Date(start - offset * DAY_MS)));
  return out;
}
