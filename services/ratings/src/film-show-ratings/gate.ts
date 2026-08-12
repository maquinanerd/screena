/**
 * gate.ts — Gate FAIL-CLOSED do worker de ratings. Modulo PURO.
 *
 * Precedencia (do mais restritivo ao menos), espelhando `raw-sync/gate.ts`:
 *  0. provedor DESLIGADO por configuracao -> bloqueado (ver abaixo);
 *  1. producao SEM autorizacao explicita do provedor -> bloqueado;
 *  2. rede necessaria (`--sample` ou `--apply`) sem chave -> bloqueado;
 *  3. rede necessaria sem DATABASE_URL -> bloqueado;
 *  4. caso contrario -> liberado.
 *
 * ============ PROVEDOR DESLIGADO (2026-08-12) — por que o passo 0 ============
 *
 * A Film & Show Ratings API (`film-show-ratings.p.rapidapi.com`) responde
 * **HTTP 403 — "You are not subscribed to this API"**. A conta nao tem
 * assinatura, e a assinatura nao pode ser feita. O provedor de ratings passou a
 * ser a OMDb (`services/ratings/src/omdb/**`, `bin/sync-omdb-ratings.ts`).
 *
 * Este adapter NAO foi apagado, de proposito: ele esta correto, testado e cobre
 * um payload (formato por fonte, com `links` e portanto com linkback para TODAS
 * as fontes) que a OMDb nao entrega. Se a assinatura acontecer um dia, voltar e
 * ligar uma variavel — nao reescrever nada.
 *
 * COMO ESTA DESLIGADO: por configuracao, fail-closed por omissao.
 *
 *   CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true
 *
 * Sem a variavel, `--sample`/`--apply` sao bloqueados com mensagem explicita.
 * Dry-run PURO continua liberado: relatar o plano nao gasta cota nem toca a
 * rede, e continua util para inspecao.
 *
 * O QUE REATIVA-LO EXIGE (nesta ordem):
 *  1. assinatura ATIVA do plano na RapidAPI para a conta cuja chave esta em
 *     `RAPIDAPI_FILM_SHOW_RATINGS_KEY` — sem isso, o 403 volta na primeira
 *     chamada;
 *  2. `CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true` no ambiente do worker;
 *  3. em producao, tambem `CINERIE_RATINGS_PROVIDER_AUTHORIZED=true` (o gate de
 *     licenca, que este passo NAO substitui);
 *  4. decidir o que fazer com a colisao de `metric`: os dois adapters escrevem
 *     `audience`/`critics`, entao rodar os DOIS sobre a mesma entidade faz um
 *     sobrescrever o outro no unique
 *     `(entity_type, entity_id, rating_source, metric)`. Rodar os dois ao mesmo
 *     tempo nao e suportado — escolha um provedor por eixo.
 *
 * Runbook: docs/operations/ratings-provider-runbook.md.
 * =============================================================================
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
  /**
   * `CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true`: este provedor esta ligado.
   *
   * OPCIONAL de proposito, e a omissao significa DESLIGADO — o oposto do
   * default de um campo booleano comum. E isso que faz o desligamento valer
   * para todo chamador existente sem que nenhum deles precise ser editado.
   */
  readonly providerEnabled?: boolean
}

/** Motivo do bloqueio, ou `null` quando liberado. */
export type RatingsGateReason =
  | 'provider-disabled'
  | 'production-unauthorized'
  | 'no-api-key'
  | 'no-database-url'

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
  // Passo 0: provedor desligado. Vem ANTES de tudo porque e o fato mais
  // basico — nao adianta discutir chave ou licenca de uma API que responde 403
  // por falta de assinatura. So bloqueia execucao que TOCA a rede: o dry-run
  // puro nao gasta cota e continua util.
  if (needsNetwork(input) && input.providerEnabled !== true) {
    return { allowed: false, reason: 'provider-disabled' }
  }
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
    case 'provider-disabled':
      return (
        'Bloqueado: o provedor Film & Show Ratings esta DESLIGADO. Ele responde HTTP 403 ' +
        '("You are not subscribed to this API") — a conta nao tem assinatura. O provedor de ' +
        'ratings ativo e a OMDb: use services/ratings/bin/sync-omdb-ratings.ts. ' +
        'Para reativar este adapter e preciso, nesta ordem: (1) assinatura ATIVA do plano na ' +
        'RapidAPI para a conta da chave; (2) CINERIE_RATINGS_FILM_SHOW_RATINGS_ENABLED=true; ' +
        '(3) em producao, CINERIE_RATINGS_PROVIDER_AUTHORIZED=true. Runbook: ' +
        'docs/operations/ratings-provider-runbook.md.'
      )
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
