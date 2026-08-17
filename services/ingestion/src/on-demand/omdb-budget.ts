/**
 * omdb-budget.ts — Quem cede quando a cota da OMDb acaba (PURO).
 *
 * O PROBLEMA. A OMDb tem **1.000 requisicoes por dia** no plano gratuito, e
 * dois consumidores disputam esse mesmo teto:
 *
 *   SEMENTE (fila de fundo)  — os top ~10 mil, ~10 dias de passada inicial;
 *   SOB DEMANDA (leitor)     — o titulo que alguem acabou de pedir.
 *
 * A DECISAO: **o leitor esperando na tela vence a fila de fundo.** Ele esta
 * numa pagina agora, olhando um estado de "buscando"; a fila de fundo nao esta
 * olhando nada e volta amanha sem prejuizo. Por isso a reserva e do leitor, e
 * nao um rateio meio a meio — rateio protegeria o backfill de um custo que ele
 * nao sente.
 *
 * A FORMA DA RESERVA. Nao e "sob demanda tem prioridade" (isso e vago e vira
 * discussao no primeiro incidente): uma FATIA do teto diario e reservada e a
 * semente nao a alcanca. Enquanto sobrar cota geral, os dois consomem; quando o
 * saldo entra na reserva, so o leitor passa.
 *
 * ESTOURO NAO VIRA PAGINA MUDA. `denied` NAO e "este titulo nao tem nota" — e
 * "nao perguntamos hoje". Os dois desfechos sao distintos aqui de proposito,
 * porque colapsa-los gravaria "sem nota" num titulo que tem nota, e o titulo
 * nunca mais seria consultado. Quem recebe `denied` RE-ENFILEIRA e loga o
 * motivo; ver `shouldRequeue`.
 */

/** Quem esta pedindo cota. */
export const OMDB_CONSUMERS = ['on_demand', 'seed'] as const

/** Um consumidor de cota. */
export type OmdbConsumer = (typeof OMDB_CONSUMERS)[number]

/** Teto diario do plano gratuito. Propriedade do fornecedor. */
export const OMDB_DAILY_LIMIT = 1_000

/**
 * Fatia do teto reservada ao leitor (sob demanda).
 *
 * 15% = 150 pedidos/dia. O numero sai da forma do trafego, nao de gosto: a
 * cobertura sob demanda so gasta OMDb num titulo que ACABOU de ser ingerido —
 * titulo ja no catalogo nao repete a chamada. Ou seja, 150/dia e teto para
 * TITULOS NOVOS pedidos por leitores num unico dia, que e uma ordem de grandeza
 * acima do que 239 entidades de catalogo produzem hoje.
 *
 * Se um dia essa reserva encostar no teto, o sinal nao e "aumente a reserva" —
 * e que o catalogo esta pequeno demais para a demanda, e a semente e que
 * precisa crescer.
 */
export const ON_DEMAND_RESERVE_RATIO = 0.15

/** Pedidos reservados ao leitor, por dia. */
export const ON_DEMAND_RESERVE = Math.floor(OMDB_DAILY_LIMIT * ON_DEMAND_RESERVE_RATIO)

/** Estado do consumo do dia. */
export interface OmdbBudgetState {
  /** Requisicoes ja gastas hoje, por qualquer consumidor. */
  readonly spentToday: number
  /** Teto diario vigente (injetavel: um plano pago muda o numero). */
  readonly dailyLimit?: number
  /** Reserva do leitor (injetavel para teste). */
  readonly reserve?: number
}

/** Veredito de um pedido de cota. */
export type OmdbBudgetVerdict =
  | { readonly granted: true; readonly remaining: number; readonly detail: string }
  | {
      readonly granted: false
      /**
       * `quota_exhausted` — nao ha mais cota para NINGUEM hoje;
       * `reserved_for_reader` — ainda ha cota, mas ela e do leitor.
       *
       * Distintos porque a acao difere: o primeiro so melhora amanha (ou com
       * plano pago), o segundo melhora em minutos.
       */
      readonly reason: 'quota_exhausted' | 'reserved_for_reader'
      readonly remaining: number
      readonly detail: string
    }

/**
 * O pedido tem cota?
 *
 * O leitor so e barrado quando o teto INTEIRO acabou. A semente e barrada assim
 * que o saldo entra na reserva.
 */
export function checkOmdbBudget(
  consumer: OmdbConsumer,
  state: OmdbBudgetState,
): OmdbBudgetVerdict {
  const limit = state.dailyLimit ?? OMDB_DAILY_LIMIT
  const reserve = state.reserve ?? ON_DEMAND_RESERVE
  const spent = Math.max(0, state.spentToday)
  const remaining = Math.max(0, limit - spent)

  if (remaining <= 0) {
    return {
      granted: false,
      reason: 'quota_exhausted',
      remaining: 0,
      detail: `cota diaria da OMDb esgotada (${spent}/${limit}); ${consumer} nao consultado hoje`,
    }
  }

  if (consumer === 'seed' && remaining <= reserve) {
    return {
      granted: false,
      reason: 'reserved_for_reader',
      remaining,
      detail:
        `restam ${remaining} requisicoes, dentro da reserva de ${reserve} do leitor; ` +
        `a semente cede a vez`,
    }
  }

  return {
    granted: true,
    remaining: remaining - 1,
    detail: `${consumer} autorizado; restavam ${remaining} de ${limit}`,
  }
}

/**
 * Um pedido negado deve voltar para a fila?
 *
 * SEMPRE. Negacao por cota nunca e um fato sobre o TITULO — e um fato sobre o
 * DIA. Tratar como terminal gravaria "sem nota" num titulo que tem nota, e ele
 * nunca mais seria consultado: a pagina nasceria muda e permaneceria muda.
 */
export function shouldRequeue(verdict: OmdbBudgetVerdict): boolean {
  return !verdict.granted
}

/** Linha de log de uma negacao. Nunca vazia — estouro sem registro e invisivel. */
export function budgetLogFields(
  consumer: OmdbConsumer,
  tmdbId: number,
  verdict: OmdbBudgetVerdict,
): Record<string, unknown> {
  return {
    event: 'omdb_budget_decision',
    consumer,
    tmdbId,
    granted: verdict.granted,
    reason: verdict.granted ? 'granted' : verdict.reason,
    remaining: verdict.remaining,
    requeued: shouldRequeue(verdict),
    detail: verdict.detail,
  }
}
