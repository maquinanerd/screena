/**
 * time.ts — Helpers de tempo PUROS do dominio de RECOMENDACOES (Backend C, C6B).
 *
 * PURO e DETERMINISTICO: NUNCA le o relogio. O instante corrente entra sempre
 * por `now` (epoch em MILISSEGUNDOS, inteiro) — nunca `Date.now()` nem
 * `new Date()`. O boundary test de recommendations proibe `new Date(` por
 * completo, entao a conversao epoch->ISO e feita por aritmetica de calendario
 * (algoritmo civil-from-days de Howard Hinnant), sem construir `Date`.
 *
 * Por que epoch-ms como unidade de dominio (e nao `Date`): a renovacao precisa
 * de aritmetica de TTL (`now + ttl`) e reconstruir um `Date` exigiria
 * `new Date(ms)` — proibido aqui. Numeros inteiros sao puros, determinsticos e
 * a conversao para ISO UTC (contrato persistivel) e feita so na fronteira.
 */

/** Menor epoch-ms aceito (1970-01-01T00:00:00.000Z). Fail-closed abaixo disso. */
export const MIN_EPOCH_MS = 0;

/** Maior epoch-ms aceito (9999-12-31T23:59:59.999Z) — teto do formato ISO 4-digitos. */
export const MAX_EPOCH_MS = 253_402_300_799_999;

/** Milissegundos por dia (aritmetica de calendario). */
const MS_PER_DAY = 86_400_000;

/**
 * `now`/timestamp valido: inteiro finito dentro da faixa suportada. Fail-closed
 * (NaN/Infinity/nao-inteiro/negativo/estouro => false). Nunca lanca.
 */
export function isValidEpochMillis(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_EPOCH_MS && value <= MAX_EPOCH_MS;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * Converte dias-desde-1970 em ano/mes/dia (civil_from_days de H. Hinnant).
 * Determinstico, sem `Date`. Valido para todo o intervalo suportado.
 */
function civilFromDays(z: number): { year: number; month: number; day: number } {
  const shifted = z + 719_468;
  const era = Math.floor((shifted >= 0 ? shifted : shifted - 146_096) / 146_097);
  const doe = shifted - era * 146_097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * Epoch-ms -> ISO UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`), determinstico e sem `Date`.
 * Igual, byte a byte, a `new Date(ms).toISOString()` no intervalo suportado.
 * Lanca `RangeError` para entrada fora da faixa (uso interno — a fronteira
 * valida com `isValidEpochMillis` antes e trata como dominio invalido).
 */
export function epochMillisToIsoUtc(ms: number): string {
  if (!isValidEpochMillis(ms)) {
    throw new RangeError("epoch-ms fora da faixa suportada");
  }
  const days = Math.floor(ms / MS_PER_DAY);
  let rem = ms - days * MS_PER_DAY; // [0, 86_399_999]
  const hh = Math.floor(rem / 3_600_000);
  rem -= hh * 3_600_000;
  const mm = Math.floor(rem / 60_000);
  rem -= mm * 60_000;
  const ss = Math.floor(rem / 1000);
  const milli = rem - ss * 1000;
  const { year, month, day } = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hh, 2)}:${pad(mm, 2)}:${pad(ss, 2)}.${pad(milli, 3)}Z`;
}
