/**
 * gate.ts — Gate FAIL-CLOSED do worker de disponibilidade. Modulo PURO.
 *
 * Precedencia (do mais restritivo ao menos):
 *  1. producao SEM autorizacao explicita do provedor -> bloqueado;
 *  2. rede necessaria (`--sample`/`--apply`) sem chave -> bloqueado;
 *  3. banco necessario (`--apply`, ou qualquer selecao de entidades) sem
 *     DATABASE_URL -> bloqueado;
 *  4. caso contrario -> liberado.
 *
 * Diferenca em relacao ao worker de ratings: aqui `--sample` tambem precisa do
 * banco, porque as entidades a consultar VEM do PostgreSQL (nao ha lista fixa).
 *
 * ================= AUTORIZACAO DO PROVEDOR (2026-08-11) =================
 * O bloqueio em producao era INCONDICIONAL, por motivo de licenciamento.
 *
 * QUEM AUTORIZOU: Pablo Eduardo, dono do projeto.
 * QUANDO: 2026-08-11.
 * O QUE FOI AUTORIZADO: uso JORNALISTICO da disponibilidade, com o nome do
 * provedor visivel em toda exibicao. Decisao tomada com ciencia do
 * licenciamento.
 * REGISTRO: docs/legal/ratings-streaming-provider-authorization.md
 *
 * O bloqueio virou autorizacao explicita, SEPARADA da de ratings — os dois
 * provedores tem licencas diferentes e desligar um nao pode desligar o outro:
 *
 *   CINERIE_STREAMING_PROVIDER_AUTHORIZED=true
 *
 * Sem a variavel, o comportamento em producao continua o de antes. Autorizar a
 * COLETA nao autoriza a EXIBICAO: `display_allowed`, `requires_attribution` e
 * `requires_linkback` de `watch_availability` seguem governando a tela, e o
 * presenter continua descartando oferta sem credito.
 *
 * SEM PIRATARIA (invariante 8): a autorizacao vale para o agregador legal
 * configurado. Nenhuma fonte que devolva torrent, IPTV, player ilegal ou embed
 * pirata entra — isso nao e uma decisao que uma variavel de ambiente possa
 * mudar.
 */

/** Entrada do gate. */
export interface StreamingGateInput {
  readonly isProd: boolean
  readonly apply: boolean
  readonly sample: boolean
  readonly hasKey: boolean
  readonly hasDb: boolean
  /**
   * `CINERIE_STREAMING_PROVIDER_AUTHORIZED=true`. OPCIONAL de proposito: um
   * chamador que nao passe o campo recebe `undefined`, que NAO e `true` — o
   * gate segue bloqueando. Fail-closed por omissao.
   */
  readonly providerAuthorized?: boolean
}

/** Motivo do bloqueio, ou `null`. */
export type StreamingGateReason = 'production-unauthorized' | 'no-api-key' | 'no-database-url'

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
  // `!== true` e nao `!`: `undefined` bloqueia igual a `false`.
  if (input.isProd && input.providerAuthorized !== true) {
    return { allowed: false, reason: 'production-unauthorized' }
  }
  if (needsNetwork(input) && !input.hasKey) return { allowed: false, reason: 'no-api-key' }
  if (needsNetwork(input) && !input.hasDb) return { allowed: false, reason: 'no-database-url' }
  return { allowed: true, reason: null }
}

/** Mensagem pt-BR do bloqueio (nunca cita valor de segredo). */
export function describeStreamingGateReason(reason: StreamingGateReason): string {
  switch (reason) {
    case 'production-unauthorized':
      return (
        'Bloqueado: consultar o provedor de disponibilidade em producao exige ' +
        'CINERIE_STREAMING_PROVIDER_AUTHORIZED=true. A autorizacao e decisao humana de ' +
        'licenca e fica registrada em docs/legal/ratings-streaming-provider-authorization.md.'
      )
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
