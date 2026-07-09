/**
 * gate.ts — Decisao PURA de "pode rodar?" do raw sync (P0-00d). Sem IO.
 *
 * O maior risco do P0-00d nao e o codigo, e rodar o piloto no banco errado ou com
 * ambiente frouxo. Por isso a decisao de permitir/bloquear e uma funcao pura e
 * TESTADA (o CLI so coleta os booleans do ambiente e aplica a mensagem).
 *
 * Precedencia (fail-closed, do mais restritivo ao menos):
 *  1. producao real            -> bloqueia (nunca raw sync em prod);
 *  2. fila ausente             -> bloqueia (nada a processar com seguranca);
 *  3. dry-run                  -> permitido (so precisa de fila + nao-prod);
 *  4. apply sem DATABASE_URL   -> bloqueia (aponte para dev/staging);
 *  5. apply sem token TMDB     -> bloqueia;
 *  6. caso contrario           -> permitido.
 *
 * A checagem do idioma base (pt-BR) fica no CLI, apos montar o client (so entao o
 * idioma efetivo e conhecido) — ver `bin/sync-tmdb-raw.ts`.
 */

/** Motivo de bloqueio (null = permitido). */
export type RawSyncGateReason =
  | 'production'
  | 'queue-missing'
  | 'no-database-url'
  | 'no-token'

/** Sinais do ambiente que decidem a execucao. */
export interface RawSyncGateInput {
  /** --apply presente (grava) vs dry-run. */
  readonly apply: boolean
  /** NODE_ENV/VERCEL_ENV = production. */
  readonly isProd: boolean
  /** DATABASE_URL presente. */
  readonly hasDb: boolean
  /** Token TMDB (v4/v3) presente. */
  readonly hasToken: boolean
  /** Fila NDJSON resolvida e existente. */
  readonly queueFound: boolean
}

/** Resultado da decisao. */
export interface RawSyncGateResult {
  readonly allowed: boolean
  readonly reason: RawSyncGateReason | null
}

/** Avalia se a execucao pode prosseguir (fail-closed). */
export function evaluateRawSyncGate(input: RawSyncGateInput): RawSyncGateResult {
  if (input.isProd) return { allowed: false, reason: 'production' }
  if (!input.queueFound) return { allowed: false, reason: 'queue-missing' }
  if (!input.apply) return { allowed: true, reason: null }
  if (!input.hasDb) return { allowed: false, reason: 'no-database-url' }
  if (!input.hasToken) return { allowed: false, reason: 'no-token' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR para um motivo de bloqueio (piloto real nunca simula sucesso). */
export function describeRawSyncGateReason(reason: RawSyncGateReason): string {
  switch (reason) {
    case 'production':
      return 'Abortado: producao real detectada — raw sync so em local/staging.'
    case 'queue-missing':
      return 'Abortado: fila NAO encontrada. Rode `discover-ids.ts --apply` ou passe --queue=<arquivo.ndjson>.'
    case 'no-database-url':
      return 'Piloto real NAO executado: DATABASE_URL ausente (aponte para banco dev/staging).'
    case 'no-token':
      return 'Piloto real NAO executado: defina TMDB_READ_ACCESS_TOKEN (v4) ou TMDB_API_KEY (v3) no .env da raiz.'
  }
}
