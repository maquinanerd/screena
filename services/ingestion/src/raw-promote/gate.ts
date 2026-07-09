/**
 * gate.ts — Decisao PURA de "pode promover?" (P0-00f). Sem IO.
 *
 * A promocao le `tmdb_raw` e escreve nas tabelas tipadas — nunca chama TMDB.
 * Logo, diferente do raw sync, NAO exige token TMDB; exige apenas ambiente
 * nao-produtivo e DATABASE_URL (a fonte e o proprio banco, inclusive em dry-run,
 * que le/conta filmes sem escrever).
 *
 * Precedencia (fail-closed, do mais restritivo ao menos):
 *  1. producao real          -> bloqueia (nunca promocao em prod);
 *  2. sem DATABASE_URL       -> bloqueia (le tmdb_raw do banco dev/staging);
 *  3. caso contrario         -> permitido (dry-run ou apply).
 */

/** Motivo de bloqueio (null = permitido). */
export type PromoteGateReason = 'production' | 'no-database-url'

/** Sinais do ambiente que decidem a execucao. */
export interface PromoteGateInput {
  /** --apply presente (grava) vs dry-run (so conta). */
  readonly apply: boolean
  /** NODE_ENV/VERCEL_ENV = production. */
  readonly isProd: boolean
  /** DATABASE_URL presente. */
  readonly hasDb: boolean
}

/** Resultado da decisao. */
export interface PromoteGateResult {
  readonly allowed: boolean
  readonly reason: PromoteGateReason | null
}

/** Avalia se a promocao pode prosseguir (fail-closed). */
export function evaluatePromoteGate(input: PromoteGateInput): PromoteGateResult {
  if (input.isProd) return { allowed: false, reason: 'production' }
  if (!input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR para um motivo de bloqueio. */
export function describePromoteGateReason(reason: PromoteGateReason): string {
  switch (reason) {
    case 'production':
      return 'Abortado: producao real detectada — promocao so em local/staging.'
    case 'no-database-url':
      return 'Abortado: DATABASE_URL ausente (aponte para o banco dev/staging que tem tmdb_raw).'
  }
}
