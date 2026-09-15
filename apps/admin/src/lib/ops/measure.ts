/**
 * measure.ts — Toda medida do painel operacional carrega PROCEDENCIA.
 *
 * ============================================================================
 * A REGRA DE PROJETO QUE ESTE TIPO IMPOE
 * ============================================================================
 * Este projeto pagou vinte vezes por um numero na tela que nao era o que dizia
 * ser: `CINERIE_BUILD_SHA` mentiu por 38 commits, o `screen-cron` ficou amarelo
 * para sempre, `quota_cost` registrava o planejado. No painel, o defeito tem
 * forma propria: um numero sem fonte, sem hora, ou um ZERO no lugar de "nao
 * consegui medir".
 *
 * `Measured<T>` torna os dois impossiveis por construcao:
 *   - todo valor chega com `source` (de onde veio) e `measuredAt` (de quando e);
 *   - uma consulta que falha vira `{ ok: false, reason }` — e a tela escreve
 *     "nao determinado" com o motivo. Nunca zero, nunca o ultimo valor conhecido.
 *
 * O motivo e SEGURO: classe e codigo do erro, nunca a mensagem crua (que pode
 * trazer SQL com parametro, e-mail de usuario ou connection string).
 */

/** Uma medida com procedencia. */
export type Measured<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly source: string;
      readonly measuredAt: Date;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly source: string;
      readonly measuredAt: Date;
    };

/** Codigos do PostgreSQL que o painel sabe traduzir. */
const PG_REASONS: Readonly<Record<string, string>> = {
  "57014": "a consulta passou do tempo limite e foi cancelada",
  "42P01": "tabela ausente (a migration ainda nao foi aplicada neste banco?)",
  "42703": "coluna ausente (schema diferente do esperado)",
  "25006": "tentativa de escrita numa leitura somente-leitura",
  "08006": "conexao com o banco caiu",
  "08001": "o banco nao aceitou a conexao",
  "53300": "o banco recusou por excesso de conexoes",
};

/** Motivo SEGURO de uma falha de medida. */
export function describeMeasureError(error: unknown): string {
  if (error === null || typeof error !== "object") return "falha desconhecida ao medir";
  const record = error as { code?: unknown; meta?: { code?: unknown }; name?: unknown };
  const pgCode =
    typeof record.meta?.code === "string"
      ? record.meta.code
      : typeof record.code === "string" && /^[0-9A-Z]{5}$/.test(record.code)
        ? record.code
        : null;
  if (pgCode !== null && PG_REASONS[pgCode] !== undefined) return PG_REASONS[pgCode] as string;
  const name = typeof record.name === "string" ? record.name : "Error";
  const code = typeof record.code === "string" && /^[A-Za-z0-9_]{1,20}$/.test(record.code) ? `:${record.code}` : "";
  if (name.startsWith("PrismaClientInitialization")) return "o painel nao conseguiu conectar no banco";
  return `a consulta falhou (${name}${code})`;
}

/** Mede com procedencia. Nunca lanca. */
export async function measure<T>(
  source: string,
  run: () => Promise<T>,
  now: () => Date = () => new Date(),
): Promise<Measured<T>> {
  const measuredAt = now();
  try {
    const value = await run();
    return { ok: true, value, source, measuredAt };
  } catch (error) {
    return { ok: false, reason: describeMeasureError(error), source, measuredAt };
  }
}

/** Uma medida que nao pode existir por falta de dado anterior (ex.: sem linha). */
export function undetermined(source: string, reason: string, measuredAt: Date): Measured<never> {
  return { ok: false, reason, source, measuredAt };
}
