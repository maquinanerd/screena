/**
 * request-state.ts — O estado "BUSCANDO" da pagina sob demanda (PURO).
 *
 * A DECISAO DO DONO: o leitor vai direto para a URL DEFINITIVA do titulo, e
 * essa pagina diz que esta buscando e se completa sozinha. Nao e uma pagina de
 * espera que depois redireciona — e a pagina final, num estado inicial.
 *
 * O que isso impoe, e o que este modulo garante:
 *
 *  1. **A URL e definitiva desde o primeiro segundo.** Ela deriva de dados que
 *     ja temos no instante do casamento (kind + slug), nao de dados que ainda
 *     vao chegar. Um link copiado nesse instante funciona para quem recebe —
 *     e `viewFor` prova que uma segunda visita, de outra sessao, cai no MESMO
 *     estado em vez de numa pagina de erro.
 *  2. **Ela nao pode parecer pronta e vazia.** Um esqueleto mudo faz o leitor
 *     concluir que o site nao tem o filme e sair. `presentsAsComplete` e false
 *     enquanto o dado nao chegou, e ha teste para isso.
 *  3. **A busca TERMINA.** `pending` nao e um estado eterno: passado
 *     `HYDRATION_DEADLINE_MS`, `resolveState` o converte em `timed_out`
 *     sozinho, sem depender de alguem escrever o desfecho. "Buscando" eterno e
 *     mentira com temporizador.
 *  4. **O Google nunca ve uma pagina incompleta como definitiva.** Ver
 *     `indexDirectiveFor` e a justificativa la embaixo.
 *
 * PURO: sem relogio proprio, sem banco, sem rede. O `now` entra por parametro —
 * e o que torna o timeout testavel sem esperar dez minutos.
 */

/** Estados persistidos de um pedido de cobertura sob demanda. */
export const HYDRATION_STATES = ['pending', 'ready', 'failed', 'not_found', 'timed_out'] as const

/** Um estado de hidratacao. */
export type HydrationState = (typeof HYDRATION_STATES)[number]

/** Estados terminais: nao mudam mais sozinhos. */
export const TERMINAL_STATES: ReadonlySet<HydrationState> = new Set([
  'ready',
  'failed',
  'not_found',
  'timed_out',
])

/**
 * Prazo para a ingestao completar antes de a pagina parar de dizer "buscando".
 *
 * 90 s. O numero sai do custo real medido de UM titulo pelo caminho do T0:
 * `sync_details` + `sync_media` (2 chamadas para filme), mais o tempo de fila.
 * A prioridade de `on_demand` e 10 — ela fura backfill e changes —, entao o job
 * nao espera a fila drenar. 90 s da folga de uma ordem de grandeza sobre o
 * caminho feliz e ainda assim termina dentro da paciencia de um leitor.
 *
 * Serie e mais cara (temporadas + episodios), mas a PAGINA fica utilizavel
 * quando o detalhe chega; episodio continua entrando depois, e isso nao e
 * "buscando" — e catalogo se aprofundando.
 */
export const HYDRATION_DEADLINE_MS = 90_000

/** Registro persistido do pedido (a linha que a pagina le). */
export interface HydrationRequestRecord {
  readonly kind: 'movie' | 'tv'
  readonly tmdbId: number
  /** Slug canonico — derivado no casamento, e o que torna a URL definitiva. */
  readonly slug: string
  readonly state: HydrationState
  readonly requestedAt: Date
  /** Preenchido quando o estado virou terminal. */
  readonly settledAt?: Date | null
  /** Motivo legivel do desfecho terminal. */
  readonly detail?: string | null
}

/**
 * Estado EFETIVO agora.
 *
 * `pending` que estourou o prazo vira `timed_out` na LEITURA, sem depender de
 * um escritor. Se dependesse, um worker morto deixaria a pagina dizendo
 * "buscando" para sempre — exatamente o modo de falha que o dono proibiu.
 */
export function resolveState(record: HydrationRequestRecord, now: Date): HydrationState {
  if (TERMINAL_STATES.has(record.state)) return record.state
  const elapsed = now.getTime() - record.requestedAt.getTime()
  return elapsed >= HYDRATION_DEADLINE_MS ? 'timed_out' : 'pending'
}

/** Diretiva de indexacao. */
export type IndexDirective = 'index' | 'noindex'

/**
 * O que o Google recebe enquanto a pagina esta em cada estado.
 *
 * REGRA: `noindex` em tudo que nao esta `ready`.
 *
 * Por que `noindex` e nao um status HTTP diferente: a pagina ESTA disponivel —
 * o que falta e o dado. Um `503` mentiria sobre a disponibilidade e quebraria o
 * leitor, que e quem pediu o titulo; um `404` seria falso enquanto ainda ha
 * busca em andamento. `noindex` e a unica ferramenta que fala com o robo sem
 * atrapalhar a pessoa.
 *
 * Por que isso importa: uma pagina incompleta indexada como definitiva e divida
 * dificil de desfazer — o Google recrawleia no ritmo dele, e ate la o resultado
 * de busca mostra um titulo sem sinopse e sem nota. `ready` NAO forca `index`
 * por conta propria: ele apenas devolve a decisao ao motor de indexabilidade
 * que ja existe (`PageIndexabilityDecision`, cujo default e `noindex` por
 * invariante). Este modulo so garante que nada ANTES de `ready` chegue la.
 */
export function indexDirectiveFor(state: HydrationState): IndexDirective {
  return state === 'ready' ? 'index' : 'noindex'
}

/** O que a pagina mostra. */
export interface HydrationView {
  readonly state: HydrationState
  /** A pagina afirma estar completa? Falso enquanto o dado nao chegou. */
  readonly presentsAsComplete: boolean
  /** A pagina deve continuar se atualizando sozinha? */
  readonly shouldPoll: boolean
  /** Diretiva para o robo. */
  readonly index: IndexDirective
  /** Status HTTP da resposta. */
  readonly httpStatus: number
  /** Mensagem honesta ao leitor. Nunca vazia. */
  readonly message: string
}

/**
 * Deriva a view do estado. Uma linha por estado — nenhum colapsa no outro.
 *
 * `shouldPoll` so e verdadeiro em `pending`: continuar pedindo depois de um
 * desfecho terminal seria trafego infinito por uma resposta que nao muda mais.
 */
export function viewFor(record: HydrationRequestRecord, now: Date): HydrationView {
  const state = resolveState(record, now)
  const index = indexDirectiveFor(state)

  switch (state) {
    case 'ready':
      return {
        state,
        presentsAsComplete: true,
        shouldPoll: false,
        index,
        httpStatus: 200,
        message: 'Pronto.',
      }
    case 'pending':
      return {
        state,
        presentsAsComplete: false,
        shouldPoll: true,
        index,
        httpStatus: 200,
        message: 'Estamos buscando as informacoes deste titulo. A pagina se atualiza sozinha.',
      }
    case 'not_found':
      // O upstream confirmou que o id nao existe. 404 e a verdade.
      return {
        state,
        presentsAsComplete: false,
        shouldPoll: false,
        index,
        httpStatus: 404,
        message: 'Nao encontramos este titulo.',
      }
    case 'timed_out':
      return {
        state,
        presentsAsComplete: false,
        shouldPoll: false,
        index,
        httpStatus: 200,
        message:
          'A busca por este titulo demorou mais que o esperado. Tente de novo em alguns minutos.',
      }
    case 'failed':
      return {
        state,
        presentsAsComplete: false,
        shouldPoll: false,
        index,
        httpStatus: 200,
        message: 'Nao conseguimos carregar este titulo agora. Tente de novo em alguns minutos.',
      }
  }
}

/**
 * Como a pagina se completa sozinha: POLLING do estado, no cliente.
 *
 * Por que polling e nao streaming de RSC nem revalidacao por tag:
 *
 *  - **streaming de RSC** manteria a requisicao HTTP ABERTA esperando o worker.
 *    O leitor que abre e o que segura a conexao — e um titulo viral multiplica
 *    conexoes presas pelo numero de leitores simultaneos, exatamente quando o
 *    servidor tem menos folga. Alem disso a hidratacao roda em OUTRO processo
 *    (invariante 3: zero API externa no render), entao nao ha promessa local
 *    para o RSC aguardar;
 *  - **revalidacao por tag** (`revalidateTag`) atualiza o CACHE, nao a aba que
 *    ja esta aberta. O leitor continuaria vendo "buscando" ate apertar F5 — e o
 *    criterio do dono e exatamente que ele NAO precise apertar F5;
 *  - **polling** e o unico dos tres em que a aba aberta se atualiza sozinha sem
 *    segurar recurso do servidor entre as tentativas.
 *
 * O intervalo cresce (2 s, 3 s, 4,5 s, ...) ate um teto: os primeiros segundos
 * sao quando a resposta provavelmente muda, e depois disso insistir no mesmo
 * ritmo so gera carga.
 */
export const POLL_INITIAL_MS = 2_000
export const POLL_MAX_MS = 15_000
const POLL_GROWTH = 1.5

/** Intervalo ate a proxima checagem, a partir do numero de tentativas ja feitas. */
export function nextPollDelayMs(attempt: number): number {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1
  const raw = POLL_INITIAL_MS * POLL_GROWTH ** (n - 1)
  return Math.min(POLL_MAX_MS, Math.round(raw))
}
