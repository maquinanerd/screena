/**
 * describe.ts — Os julgamentos do painel em PALAVRAS. PURO.
 *
 * Toda celula vermelha do painel diz o que esta vermelho por extenso ("VOLTA DE
 * 352,7 DIAS", "3 COMMITS ATRAS"): cor nunca e o unico sinal. As funcoes aqui so
 * traduzem o que o agendador e `health.ts` ja julgaram — nenhum limiar novo.
 */

import type { LapResult, QueueSchedule, Rhythm } from "@screena/sync";

import { formatDateTimeBrt, formatDays, formatDecimal, formatInt, formatRelative } from "./format";
import type { Liveness, VersionVerdict } from "./health";

/** `24` -> `1 dia`; `6` -> `6 h`; `720` -> `30 dias`. */
export function describeInterval(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "intervalo inválido";
  if (hours < 24) return `${formatDecimal(hours, hours % 1 === 0 ? 0 : 1)} h`;
  const days = hours / 24;
  if (days % 1 === 0) return `${formatInt(days)} ${days === 1 ? "dia" : "dias"}`;
  return `${formatDecimal(days, 1)} dias`;
}

/** A cadencia de uma fila, em uma linha. */
export function describeCadence(rhythm: Pick<Rhythm, "cadence">, intervalHours: number, seasonNote: string): string {
  if (rhythm.cadence === "event") return `por evento; no máximo ${describeInterval(intervalHours)} sem rodar`;
  if (rhythm.cadence === "seasonal") return `a cada ${describeInterval(intervalHours)} (${seasonNote})`;
  return `a cada ${describeInterval(intervalHours)}`;
}

/** A volta de uma fila, pronta para a tela. */
export interface LapView {
  readonly text: string;
  readonly detail: string;
  readonly red: boolean;
  readonly undetermined: boolean;
}

export function describeLap(lap: LapResult): LapView {
  switch (lap.kind) {
    case "days":
      return {
        text: formatDays(lap.days),
        detail: `${formatDecimal(lap.perDay, lap.perDay < 10 ? 1 : 0)} itens por dia`,
        red: lap.alert,
        undetermined: false,
      };
    case "never":
      return { text: "não fecha", detail: lap.reason, red: true, undetermined: false };
    case "not_applicable":
      return { text: "não se aplica", detail: lap.reason, red: false, undetermined: false };
    case "undeterminable":
      return { text: "não determinado", detail: lap.reason, red: false, undetermined: true };
  }
}

/** Quando a fila roda de novo. */
export function describeNextRun(
  schedule: Pick<QueueSchedule, "lastSuccessAt" | "dueAt" | "due">,
  now: Date,
): { readonly text: string; readonly overdue: boolean } {
  if (schedule.lastSuccessAt === null || schedule.dueAt === null) {
    return { text: "agora: nunca rodou com sucesso (próximo tique do screen-cron)", overdue: true };
  }
  if (schedule.due) {
    return {
      text: `vencida desde ${formatDateTimeBrt(schedule.dueAt)} (${formatRelative(schedule.dueAt, now)}): roda no próximo tique do screen-cron`,
      overdue: true,
    };
  }
  return { text: `${formatDateTimeBrt(schedule.dueAt)} (${formatRelative(schedule.dueAt, now)})`, overdue: false };
}

/** O sinal de vida de um servico. */
export function describeLiveness(liveness: Liveness | null, now: Date): { readonly text: string; readonly red: boolean } {
  if (liveness === null) return { text: "não determinado: este serviço não grava sinal de vida no banco deste painel", red: false };
  if (liveness.kind === "nunca") return { text: "NUNCA deu sinal de vida", red: true };
  if (liveness.kind === "sem_sinal") return { text: `SEM SINAL: último ${formatRelative(liveness.lastSeenAt, now)}`, red: true };
  return { text: `no ar (sinal ${formatRelative(liveness.lastSeenAt, now)})`, red: false };
}

/** O veredito de versao de um servico. */
export function describeVersion(version: VersionVerdict | null): { readonly text: string; readonly red: boolean; readonly undetermined: boolean } {
  if (version === null) return { text: "não determinado: o serviço não grava impressão digital", red: false, undetermined: true };
  switch (version.kind) {
    case "em_dia":
      return { text: "igual à cabeça do main", red: false, undetermined: false };
    case "atras":
      return { text: `${formatInt(version.behindBy)} COMMIT(S) ATRÁS DO MAIN`, red: true, undetermined: false };
    case "distancia_pendente":
      return { text: `commit do main; ${version.reason}`, red: false, undetermined: true };
    case "sem_correspondencia":
      return { text: `SEM COMMIT CORRESPONDENTE: ${version.reason}`, red: true, undetermined: false };
    case "nao_determinado":
      return { text: `não determinado: ${version.reason}`, red: false, undetermined: true };
  }
}

/** Os ultimos `days` dias (UTC), do mais antigo ao de hoje, como `YYYY-MM-DD`. */
export function utcDayList(now: Date, days: number): readonly string[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    out.push(new Date(start - offset * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Os codigos de erro que as acoes devolvem na URL, em frase. */
export const ACTION_ERROR_TEXT: Readonly<Record<string, string>> = {
  pedido_invalido: "o pedido chegou incompleto ou com valor inválido; nada foi enfileirado",
  acoes_desligadas: "as ações do painel estão desligadas (ADMIN_OPS_ACTIONS_ENABLED=false); nada foi enfileirado",
  titulo_inexistente: "o título não existe mais no banco; nada foi enfileirado",
  falha_ao_enfileirar: "o banco recusou a gravação; nada foi enfileirado (a transação desfaz auditoria e job juntos)",
};

/** O texto de um `?erro=`. Codigo desconhecido nao vira texto (nada da URL vai cru para a tela). */
export function actionErrorText(code: string | string[] | undefined): string | null {
  const value = Array.isArray(code) ? code[0] : code;
  if (value === undefined) return null;
  return ACTION_ERROR_TEXT[value] ?? null;
}
