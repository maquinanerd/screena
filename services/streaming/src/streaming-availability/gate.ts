/**
 * gate.ts — Gate FAIL-CLOSED do worker de disponibilidade. Modulo PURO.
 *
 * Precedencia (do mais restritivo ao menos):
 *  1. producao -> bloqueado SEMPRE;
 *  2. rede necessaria (`--sample`/`--apply`) sem chave -> bloqueado;
 *  3. banco necessario (`--apply`, ou qualquer selecao de entidades) sem
 *     DATABASE_URL -> bloqueado;
 *  4. caso contrario -> liberado.
 *
 * Diferenca em relacao ao worker de ratings: aqui `--sample` tambem precisa do
 * banco, porque as entidades a consultar VEM do PostgreSQL (nao ha lista fixa).
 */

/** Entrada do gate. */
export interface StreamingGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly sample: boolean
  readonly hasKey: boolean
  readonly hasDb: boolean
}

/** Motivo do bloqueio, ou `null`. */
export type StreamingGateReason = 'production' | 'no-api-key' | 'no-database-url'

/** Resultado do gate. */
export interface StreamingGateResult {
  readonly allowed: boolean
  readonly reason: StreamingGateReason | null
}

/** A execucao precisa de rede? */
export function needsNetwork(input: Pick<StreamingGateInput, 'apply' | 'sample'>): boolean {
  return input.apply || input.sample
}

/** Avalia se a execucao pode prosseguir (fail-closed). */
export function evaluateStreamingGate(input: StreamingGateInput): StreamingGateResult {
  if (input.isProd) return { allowed: false, reason: 'production' }
  if (needsNetwork(input) && !input.hasKey) return { allowed: false, reason: 'no-api-key' }
  if (needsNetwork(input) && !input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR do bloqueio (nunca cita valor de segredo). */
export function describeStreamingGateReason(reason: StreamingGateReason): string {
  switch (reason) {
    case 'production':
      return 'Bloqueado: worker de disponibilidade nao roda em producao (NODE_ENV/VERCEL_ENV production-like).'
    case 'no-api-key':
      return (
        'Bloqueado: --sample/--apply exigem RAPIDAPI_STREAMING_AVAILABILITY_KEY no ambiente. ' +
        'Defina a variavel (nunca versionada) e repita.'
      )
    case 'no-database-url':
      return (
        'Bloqueado: --sample/--apply exigem DATABASE_URL (dev/staging): as entidades a consultar ' +
        'vem do PostgreSQL, e api_cache/api_sync_logs sao gravados.'
      )
  }
}
