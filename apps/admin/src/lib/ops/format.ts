/**
 * format.ts — Numero e data no jeito do dono, sem depender do ICU do container.
 *
 * Tudo manual e deterministico de proposito: `Intl` depende da build de ICU do
 * runtime, e a mesma data poderia sair diferente entre a maquina de teste e o
 * container. O Brasil nao tem horario de verao desde 2019, entao BRT e UTC-3 fixo.
 */

const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/**
 * `12.345` (separador de milhar pt-BR). Negativos preservados.
 *
 * Valor nao finito nunca vira traco: a regra da tela e "nao determinado", e um
 * traco se le como "nada" — que e outra afirmacao.
 */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return "não determinado";
  const sign = value < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(value)));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** `12,3` com `casas` decimais e virgula. */
export function formatDecimal(value: number, casas = 1): string {
  if (!Number.isFinite(value)) return "não determinado";
  const fixed = Math.abs(value).toFixed(casas);
  const [inteiro, fracao] = fixed.split(".") as [string, string | undefined];
  const sign = value < 0 ? "-" : "";
  return `${sign}${formatInt(Number(inteiro))}${fracao === undefined ? "" : `,${fracao}`}`;
}

/**
 * `87,5%`. Total zero NAO vira `0%` nem `NaN%`: sem denominador nao ha
 * percentual, e dizer isso e diferente de dizer zero.
 */
export function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "sem base (total zero)";
  return `${formatDecimal((part / total) * 100, 1)}%`;
}

/** `15/09/2026 09:03 BRT`. */
export function formatDateTimeBrt(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "data invalida";
  const brt = new Date(date.getTime() + BRT_OFFSET_MS);
  return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}/${brt.getUTCFullYear()} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())} BRT`;
}

/** `15/09` — rotulo curto de dia, em BRT. */
export function formatDayBrt(date: Date): string {
  const brt = new Date(date.getTime() + BRT_OFFSET_MS);
  return `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth() + 1)}`;
}

/** `ha 3 min`, `ha 2 h`, `ha 5 d`, `em 20 min`. */
export function formatRelative(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  let text: string;
  if (min < 1) text = "menos de 1 min";
  else if (min < 60) text = `${String(min)} min`;
  else if (min < 48 * 60) text = `${formatDecimal(min / 60, min < 600 ? 1 : 0)} h`;
  else text = `${formatDecimal(min / (60 * 24), 1)} d`;
  return future ? `em ${text}` : `há ${text}`;
}

/** `352,7 dias` / `1 dia` / `6,0 h` / `menos de 0,1 h`. */
export function formatDays(days: number): string {
  if (!Number.isFinite(days)) return "não determinado";
  // Volta positiva pequena NAO vira "0,0 h": isso se le como zero, e zero e outra
  // afirmacao (universo vazio). Abaixo do que uma casa decimal mostra, diz o limite.
  if (days > 0 && days * 24 < 0.05) return "menos de 0,1 h";
  if (days > 0 && days < 1) return `${formatDecimal(days * 24, 1)} h`;
  const rounded = Math.round(days * 10) / 10;
  return `${formatDecimal(rounded, rounded % 1 === 0 ? 0 : 1)} ${rounded === 1 ? "dia" : "dias"}`;
}

/** `1,2 GB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "não determinado";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatDecimal(value, unit === 0 ? 0 : 1)} ${units[unit] as string}`;
}

/** Os primeiros 7 caracteres de um sha, como o GitHub mostra. */
export function shortSha(sha: string | null): string {
  if (sha === null) return "não determinado";
  return sha.slice(0, 7);
}
