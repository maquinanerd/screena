/**
 * gate.ts — Gate FAIL-CLOSED do worker de ratings. Modulo PURO.
 *
 * Precedencia (do mais restritivo ao menos), espelhando `raw-sync/gate.ts`:
 *  1. producao -> bloqueado SEMPRE (mesmo em dry-run: nada de rede em prod);
 *  2. rede necessaria (`--sample` ou `--apply`) sem chave -> bloqueado;
 *  3. rede necessaria sem DATABASE_URL -> bloqueado;
 *  4. caso contrario -> liberado.
 *
 * Por que `--sample` tambem exige banco: qualquer execucao que TOCA a rede grava
 * `api_cache` e `api_sync_logs` ("todo sync externo gera log"). Deixar `--sample`
 * passar sem `DATABASE_URL` produziria uma chamada externa sem cache e sem log —
 * exatamente a ingestao silenciosa que a regra proibe.
 *
 * Dry-run puro (sem `--sample`) nao precisa de chave nem de banco: ele so relata
 * o PLANO (o que SERIA chamado), sem tocar rede nem gastar cota.
 */

/** Entrada do gate (booleans ja derivados do ambiente pelo bin). */
export interface RatingsGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly sample: boolean
  readonly hasKey: boolean
  readonly hasDb: boolean
}

/** Motivo do bloqueio, ou `null` quando liberado. */
export type RatingsGateReason = 'production' | 'no-api-key' | 'no-database-url'

/** Resultado do gate. */
export interface RatingsGateResult {
  readonly allowed: boolean
  readonly reason: RatingsGateReason | null
}

/** A execucao precisa de rede? (`--sample` busca payload; `--apply` tambem). */
export function needsNetwork(input: Pick<RatingsGateInput, 'apply' | 'sample'>): boolean {
  return input.apply || input.sample
}

/** Avalia se a execucao pode prosseguir (fail-closed). */
export function evaluateRatingsGate(input: RatingsGateInput): RatingsGateResult {
  if (input.isProd) return { allowed: false, reason: 'production' }
  if (needsNetwork(input) && !input.hasKey) return { allowed: false, reason: 'no-api-key' }
  if (needsNetwork(input) && !input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR do bloqueio (nunca cita valor de segredo). */
export function describeRatingsGateReason(reason: RatingsGateReason): string {
  switch (reason) {
    case 'production':
      return 'Bloqueado: worker de ratings nao roda em producao (NODE_ENV/VERCEL_ENV production-like).'
    case 'no-api-key':
      return (
        'Bloqueado: --sample/--apply exigem RAPIDAPI_FILM_SHOW_RATINGS_KEY no ambiente. ' +
        'Defina a variavel (nunca versionada) e repita.'
      )
    case 'no-database-url':
      return (
        'Bloqueado: --sample/--apply exigem DATABASE_URL (dev/staging): toda chamada externa ' +
        'grava api_cache e api_sync_logs (nenhuma ingestao silenciosa).'
      )
  }
}
