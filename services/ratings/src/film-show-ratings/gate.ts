/**
 * gate.ts — Gate FAIL-CLOSED do worker de ratings. Modulo PURO.
 *
 * Precedencia (do mais restritivo ao menos), espelhando `raw-sync/gate.ts`:
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
 * o PLANO (o que SERIA chamado), sem tocar rede nem gastar cota.
 *
 * ================= AUTORIZACAO DO PROVEDOR (2026-08-11) =================
 * O bloqueio em producao era INCONDICIONAL: nenhuma chamada de rede acontecia
 * sob `NODE_ENV=production`, mesmo com chave valida e `--apply`. O motivo era
 * licenciamento, e a decisao de licenca e sempre humana.
 *
 * QUEM AUTORIZOU: Pablo Eduardo, dono do projeto.
 * QUANDO: 2026-08-11.
 * O QUE FOI AUTORIZADO: uso JORNALISTICO das notas, com credito visivel a fonte
 * em toda exibicao. A decisao foi tomada com ciencia do licenciamento.
 * REGISTRO: docs/legal/ratings-streaming-provider-authorization.md
 *
 * O bloqueio nao foi APAGADO — virou autorizacao explicita, uma por provedor:
 *
 *   CINERIE_RATINGS_PROVIDER_AUTHORIZED=true
 *
 * Sem a variavel, o comportamento em producao continua EXATAMENTE o de antes.
 * Com ela, a autorizacao fica auditavel (esta no ambiente, nao no codigo) e
 * reversivel sem deploy — desligar a variavel devolve o fail-closed.
 *
 * A autorizacao NAO afrouxa nada a jusante: `validateRating` continua recusando
 * cross-label e `provider_api === rating_source`, a licenca de `source_licenses`
 * continua governando a exibicao, e o presenter continua descartando nota sem
 * atribuicao. Autorizar a COLETA nunca foi autorizar a EXIBICAO.
 */

/** Entrada do gate (booleans ja derivados do ambiente pelo bin). */
export interface RatingsGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly sample: boolean
  readonly hasKey: boolean
  readonly hasDb: boolean
  /**
   * `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true`: o operador declarou que este
   * provedor esta autorizado a ser consultado em producao.
   *
   * OPCIONAL de proposito: um chamador antigo que nao passe o campo recebe
   * `undefined`, que NAO e `true` — e o gate segue bloqueando. Fail-closed por
   * omissao, nao por lembrança de quem escreve o chamador.
   */
  readonly providerAuthorized?: boolean
}

/** Motivo do bloqueio, ou `null` quando liberado. */
export type RatingsGateReason = 'production-unauthorized' | 'no-api-key' | 'no-database-url'

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
  // `!== true` e nao `!`: `undefined` de um chamador que nao conhece o campo
  // tem que bloquear, igual a `false`.
  if (input.isProd && input.providerAuthorized !== true) {
    return { allowed: false, reason: 'production-unauthorized' }
  }
  if (needsNetwork(input) && !input.hasKey) return { allowed: false, reason: 'no-api-key' }
  if (needsNetwork(input) && !input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR do bloqueio (nunca cita valor de segredo). */
export function describeRatingsGateReason(reason: RatingsGateReason): string {
  switch (reason) {
    case 'production-unauthorized':
      return (
        'Bloqueado: consultar o provedor de ratings em producao exige ' +
        'CINERIE_RATINGS_PROVIDER_AUTHORIZED=true. A autorizacao e decisao humana de ' +
        'licenca e fica registrada em docs/legal/ratings-streaming-provider-authorization.md.'
      )
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
