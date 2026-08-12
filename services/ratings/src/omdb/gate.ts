/**
 * gate.ts — Gate FAIL-CLOSED do worker OMDb. Modulo PURO.
 *
 * Espelha `film-show-ratings/gate.ts`. Precedencia (do mais restritivo ao menos):
 *  1. producao SEM autorizacao explicita do provedor -> bloqueado;
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
 * o PLANO, sem tocar rede nem gastar cota.
 *
 * AUTORIZACAO DO PROVEDOR: a variavel e a MESMA do provedor anterior,
 * `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true`, e isso e deliberado. A decisao
 * humana de licenca e uma so por eixo de produto (ratings); um segundo
 * interruptor criaria dois estados que podem divergir, e desligar "o de ratings"
 * deixaria o outro provedor consultando. Registro da decisao:
 * docs/legal/ratings-streaming-provider-authorization.md.
 *
 * Autorizar a COLETA nunca foi autorizar a EXIBICAO: `validateRating`, a licenca
 * de `source_licenses` e o trigger do banco continuam governando o que aparece.
 */

/** Entrada do gate (booleans ja derivados do ambiente pelo bin). */
export interface OmdbGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly sample: boolean
  readonly hasKey: boolean
  readonly hasDb: boolean
  /**
   * `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true`. OPCIONAL de proposito: um
   * chamador que nao passe o campo recebe `undefined`, que NAO e `true` — e o
   * gate segue bloqueando. Fail-closed por omissao.
   */
  readonly providerAuthorized?: boolean
}

/** Motivo do bloqueio, ou `null` quando liberado. */
export type OmdbGateReason = 'production-unauthorized' | 'no-api-key' | 'no-database-url'

/** Resultado do gate. */
export interface OmdbGateResult {
  readonly allowed: boolean
  readonly reason: OmdbGateReason | null
}

/** A execucao precisa de rede? (`--sample` busca payload; `--apply` tambem). */
export function omdbNeedsNetwork(input: Pick<OmdbGateInput, 'apply' | 'sample'>): boolean {
  return input.apply || input.sample
}

/** Avalia se a execucao pode prosseguir (fail-closed). */
export function evaluateOmdbGate(input: OmdbGateInput): OmdbGateResult {
  // `!== true` e nao `!`: `undefined` de um chamador que nao conhece o campo
  // tem que bloquear, igual a `false`.
  if (input.isProd && input.providerAuthorized !== true) {
    return { allowed: false, reason: 'production-unauthorized' }
  }
  if (omdbNeedsNetwork(input) && !input.hasKey) return { allowed: false, reason: 'no-api-key' }
  if (omdbNeedsNetwork(input) && !input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR do bloqueio (nunca cita valor de segredo). */
export function describeOmdbGateReason(reason: OmdbGateReason): string {
  switch (reason) {
    case 'production-unauthorized':
      return (
        'Bloqueado: consultar a OMDb em producao exige ' +
        'CINERIE_RATINGS_PROVIDER_AUTHORIZED=true. A autorizacao e decisao humana de ' +
        'licenca e fica registrada em docs/legal/ratings-streaming-provider-authorization.md.'
      )
    case 'no-api-key':
      return (
        'Bloqueado: --sample/--apply exigem OMDB_API_KEY no ambiente. ' +
        'Defina a variavel (nunca versionada) e repita.'
      )
    case 'no-database-url':
      return (
        'Bloqueado: --sample/--apply exigem DATABASE_URL: toda chamada externa ' +
        'grava api_cache e api_sync_logs (nenhuma ingestao silenciosa).'
      )
  }
}
