/**
 * rhythms.ts — A TABELA DE RITMOS. Cada dado no tempo dele. Modulo PURO.
 *
 * ============================================================================
 * A REGRA QUE ESTA TABELA EXISTE PARA IMPEDIR
 * ============================================================================
 * Um intervalo unico para tudo. Oferta de streaming muda toda semana; ano de
 * lancamento nao muda nunca. Um agendador com um numero so ou queima cota
 * confirmando o que nao mudou, ou deixa envelhecer o que muda todo dia — e
 * costuma fazer as duas coisas ao mesmo tempo.
 *
 * Cada entrada carrega `rationale`: o DADO que justifica o intervalo, nao a
 * preferencia de quem escreveu. Intervalo sem motivo declarado e mudanca sem
 * dono, e o teste de governanca reprova.
 *
 * ============================================================================
 * O QUE E UMA "FILA" AQUI
 * ============================================================================
 * Uma fila e um TRABALHO RECORRENTE com nome proprio, intervalo proprio e
 * ultimo-sucesso proprio. Nao e uma tabela nem um endpoint: `watch_offers` e
 * `title_detail_ended` leem o MESMO fornecedor e ate a mesma entidade — o que
 * as separa e a velocidade com que o dado delas estraga.
 *
 * ============================================================================
 * ZERO REDE, ZERO BANCO, ZERO RELOGIO PROPRIO
 * ============================================================================
 * Este modulo so declara. Quem le o ultimo sucesso, quem trava, quem executa e
 * quem loga sao os adapters — e todos recebem `now` injetado.
 */

/** Um trabalho recorrente com ritmo proprio. */
export const SCHEDULER_QUEUES = [
  'discovery',
  'changes',
  'watch_offers',
  'trending',
  'airing_series',
  'title_detail_active',
  'title_detail_ended',
  'people',
  'ratings_omdb',
  'awards',
  'cinerie_score',
  'search_projection',
] as const

export type SchedulerQueue = (typeof SCHEDULER_QUEUES)[number]

/** Como o intervalo de uma fila e decidido. */
export type CadenceKind =
  /** Intervalo fixo em horas. */
  | 'fixed'
  /** Intervalo fixo, porem ENCURTADO dentro de uma janela do calendario. */
  | 'seasonal'
  /**
   * Sem relogio proprio: roda quando OUTRA fila muda a entrada dela. Derivado
   * nao tem ritmo — tem gatilho.
   */
  | 'event'

const HOUR = 1
const DAY = 24 * HOUR

/** Uma linha da tabela de ritmos. */
export interface Rhythm {
  readonly queue: SchedulerQueue
  readonly cadence: CadenceKind
  /**
   * Intervalo NORMAL, em horas. Para `event`, e o TETO DE SEGURANCA: mesmo sem
   * gatilho nenhum a fila roda pelo menos uma vez nesse intervalo — senao um
   * gatilho perdido congelaria o derivado para sempre, em silencio.
   */
  readonly intervalHours: number
  /** Intervalo dentro da janela sazonal. `null` fora de `seasonal`. */
  readonly seasonalIntervalHours: number | null
  /** O fornecedor tecnico que esta fila consome. `null` = nenhum (local). */
  readonly providerApi: string | null
  /** O que a fila faz, em uma linha, para o painel do dono. */
  readonly label: string
  /** O DADO que justifica o intervalo. Obrigatorio, sempre. */
  readonly rationale: string
}

/**
 * A tabela. A ordem e a de exibicao no painel: do que estraga mais rapido para
 * o que estraga mais devagar.
 */
export const RHYTHMS: readonly Rhythm[] = [
  {
    queue: 'watch_offers',
    cadence: 'fixed',
    intervalHours: 1 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Ofertas de streaming (onde assistir)',
    rationale:
      'E o dado que mais estraga: catalogo de plataforma entra e sai em ciclos de ' +
      'licenciamento curtos, e a pagina afirma disponibilidade com carimbo de data. ' +
      'Custa 1 requisicao por titulo no endpoint DEDICADO (/movie/{id}/watch/providers), ' +
      'nao o detalhe inteiro: ~2 kB contra os 130,6 kB (filme) e 648,3 kB (serie) medidos ' +
      'do payload de detalhe.',
  },
  {
    queue: 'trending',
    cadence: 'fixed',
    intervalHours: 6 * HOUR,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Em alta (trending day + week)',
    rationale:
      'O intervalo NAO e numero novo: discovery-snapshots/index.ts ja declara ' +
      'trending com TTL de 6 h ("sinal volatil"), e .claude/rules/ingestion.md diz ' +
      '6-12 h. 6 h alinha com a fila `changes`. O custo e O(1) por ciclo, nao por ' +
      'titulo: 4 requisicoes (movie|tv x day|week), 20 itens por pagina, uma pagina ' +
      'basta. O hash-noop do snapshot faz lista inalterada nao gerar linha.',
  },
  {
    queue: 'airing_series',
    cadence: 'fixed',
    intervalHours: 1 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Series em exibicao (episodio, temporada, status)',
    rationale:
      'Episodio que foi ao ar hoje tem que estar na pagina hoje. So entram as series com ' +
      'status em exibicao/producao; o resto cai nas filas de detalhe, que sao mais lentas ' +
      'e muito maiores.',
  },
  {
    queue: 'discovery',
    cadence: 'fixed',
    intervalHours: 1 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb-exports',
    label: 'Descoberta de novidades (Daily ID Exports)',
    rationale:
      'Os exports sao publicados UMA vez por dia (job ~07:00 UTC, disponiveis ~08:00 UTC). ' +
      'Descobrir com mais frequencia baixaria o mesmo arquivo de novo; com menos, titulo ' +
      'novo faltaria.',
  },
  {
    queue: 'changes',
    cadence: 'fixed',
    intervalHours: 6 * HOUR,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Mudancas incrementais (/changes)',
    rationale:
      'A janela default do /changes do TMDB e ~24h e o maximo e 14 dias. 6h da quatro ' +
      'tentativas dentro de uma janela de 24h: tres ciclos podem falhar seguidos sem que ' +
      'nada saia da janela e se perca.',
  },
  {
    queue: 'cinerie_score',
    cadence: 'event',
    intervalHours: 1 * DAY,
    seasonalIntervalHours: null,
    providerApi: null,
    label: 'Cinerie Score (recalculo)',
    rationale:
      'Derivado nao tem ritmo proprio: recalcula quando uma nota de entrada muda. O ' +
      'intervalo de 24h e teto de seguranca, nao cadencia — existe para que um gatilho ' +
      'perdido nao congele o numero para sempre.',
  },
  {
    queue: 'search_projection',
    cadence: 'event',
    intervalHours: 1 * DAY,
    seasonalIntervalHours: null,
    providerApi: null,
    label: 'Sitemap / projecao de busca / revalidacao de ISR',
    rationale:
      'Roda ao fim de qualquer lote que mudou alguma coisa. Sem isso a pagina nova existe ' +
      'e ninguem a acha — nem o leitor, nem o buscador.',
  },
  {
    queue: 'ratings_omdb',
    cadence: 'fixed',
    intervalHours: 7 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'omdb',
    label: 'Notas (IMDb, Rotten Tomatoes, Metacritic via OMDb)',
    rationale:
      'A janela sai de RATING_STALE_POLICY (@screena/config), nao de gosto: o MENOR ' +
      'refreshAfterHours das tres fontes que a OMDb entrega e 168h. Um payload traz as ' +
      'tres, entao a requisicao precisa acontecer quando a fonte mais impaciente pedir. O ' +
      'limite real e a COTA (1.000/dia), nao o relogio — por isso e rodizio, nunca varredura.',
  },
  {
    queue: 'title_detail_active',
    cadence: 'fixed',
    intervalHours: 7 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Detalhe de titulo em producao / nao lancado',
    rationale:
      'Data de estreia, elenco e sinopse ainda mudam antes do lancamento. Semanal e o lado ' +
      'CURTO da janela de catalogo geral declarada em .claude/rules/ingestion.md (7-14 dias), ' +
      'e o lado curto e de quem ainda muda.',
  },
  {
    queue: 'people',
    cadence: 'fixed',
    intervalHours: 30 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Pessoas',
    rationale:
      'Biografia e data de nascimento praticamente nao mudam. A pessoa que entra num titulo ' +
      'novo NAO espera este ciclo: ela chega pelos creditos, no MESMO request do titulo, ' +
      'imediatamente.',
  },
  {
    queue: 'title_detail_ended',
    cadence: 'fixed',
    intervalHours: 30 * DAY,
    seasonalIntervalHours: null,
    providerApi: 'tmdb',
    label: 'Detalhe de titulo encerrado (filme lancado, serie finalizada)',
    rationale:
      'Filme lancado e serie finalizada nao mudam mais de elenco, duracao nem ano. ' +
      'Sincronizar diario seria pagar requisicao para reconfirmar bytes identicos — e o que ' +
      'muda nesses titulos (a OFERTA) tem fila propria, diaria.',
  },
  {
    queue: 'awards',
    cadence: 'seasonal',
    intervalHours: 30 * DAY,
    seasonalIntervalHours: 1 * DAY,
    providerApi: 'omdb',
    label: 'Premiacao (Oscar, Emmy, Globo de Ouro)',
    rationale:
      'Fora da temporada de premiacao NAO ACONTECE NADA: o texto de premios da OMDb fica ' +
      'estavel por meses. Dentro das janelas de indicacao/cerimonia ele muda em horas, e um ' +
      'premio anunciado ontem aparecendo depois de amanha e a falha mais visivel que existe. ' +
      'Janelas em awards-window.ts.',
  },
]

/** Indice por nome. Fila desconhecida devolve `null` — nunca um default. */
export function findRhythm(queue: string): Rhythm | null {
  return RHYTHMS.find((r) => r.queue === queue) ?? null
}

/**
 * O intervalo VIGENTE de uma fila, em horas.
 *
 * `seasonal` encurta dentro da janela; todo o resto ignora `inSeason`. Esta
 * funcao e o unico lugar que sabe disso — quem agenda nao repete a regra.
 */
export function effectiveIntervalHours(rhythm: Rhythm, inSeason: boolean): number {
  if (rhythm.cadence !== 'seasonal') return rhythm.intervalHours
  return inSeason ? (rhythm.seasonalIntervalHours ?? rhythm.intervalHours) : rhythm.intervalHours
}
