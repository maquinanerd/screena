/**
 * cost-model.ts — Modelo PURO de custo de um bootstrap de catalogo.
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * `--limit` mede TITULOS, e titulo nao e a unidade de custo. Medido em execucao
 * real (ver `docs/backend/catalog-bootstrap-evidence-2026-07.md`): **3 series da
 * lista `popular` produziram 639 temporadas e 33.178 episodios**. A lista de
 * populares inclui novelas e series diarias de decadas.
 *
 * Consequencia: `--limit 100` nao custa ~33x mais que `--limit 3` — pode custar
 * ordens de grandeza mais, dependendo de QUAIS series cairem na lista. Um
 * operador que so olha `--limit` transforma um bootstrap de minutos em um de
 * horas, e descobre isso no meio da execucao.
 *
 * Este modulo transforma fatos JA CONHECIDOS de cada titulo (para serie: numero
 * de temporadas e episodios, que o proprio TMDB informa em `/tv/{id}`) em uma
 * estimativa de jobs, chamadas de API, midia e duracao — ANTES de persistir
 * qualquer coisa.
 *
 * MODULO PURO: sem rede, sem Prisma, sem relogio. Quem coleta os fatos e o
 * comando `plan-bootstrap`; aqui so mora a aritmetica, que e o que precisa de
 * teste.
 *
 * MODELO DE JOBS (espelha a cascata real do `bootstrap-handler`):
 *
 *   filme: sync_details + sync_media                        = 2 jobs
 *   serie: sync_details + sync_media + sync_seasons
 *          + 1 sync_episodes por temporada                  = 3 + S jobs
 *   + 1 discover_ids por tipo de entidade
 *   + 1 sync_lists por lista de descoberta
 *
 * MODELO DE CHAMADAS TMDB (1 por job que busca upstream, + paginas de lista):
 *   o detalhe ja vem com `append_to_response=external_ids,credits`, entao
 *   creditos e ids externos NAO custam chamada propria — por isso o
 *   `sync-details-handler` deliberadamente nao os enfileira.
 */

/** Tipos de entidade que o bootstrap descobre. */
export type PlannedEntityKind = 'movie' | 'tv'

/** Fatos de UM titulo candidato, ja coletados do provider. */
export interface PlannedTitle {
  readonly kind: PlannedEntityKind
  readonly tmdbId: number
  /** Titulo de exibicao, so para o relatorio humano. */
  readonly title: string
  /**
   * Temporadas (serie). Para filme e sempre 0.
   *
   * Vem de `number_of_seasons` do `/tv/{id}` — e o numero EXATO, nao estimativa.
   * Quando ausente no payload, o coletor marca `factsMissing` e o modelo cai
   * para o default conservador.
   */
  readonly seasons: number
  /** Episodios (serie). Para filme e sempre 0. Vem de `number_of_episodes`. */
  readonly episodes: number
  /** true quando o provider nao devolveu os contadores e usamos default. */
  readonly factsMissing?: boolean
}

/** Premissas ajustaveis do modelo (todas com default justificado). */
export interface CostAssumptions {
  /**
   * Temporadas presumidas quando o provider nao informou. 1 subestimaria; o
   * default usa a mediana observada de series populares.
   */
  readonly fallbackSeasons: number
  /** Episodios presumidos por temporada quando o provider nao informou. */
  readonly fallbackEpisodesPerSeason: number
  /** Itens de midia (imagens + videos) por titulo. Medido: ~208 img + ~27 vid. */
  readonly mediaItemsPerTitle: number
  /** Itens de midia por temporada (posters de temporada). */
  readonly mediaItemsPerSeason: number
  /** Bytes medios por item de midia REFERENCIADO (metadado, nao binario). */
  readonly bytesPerMediaRow: number
  /** Requisicoes por segundo efetivas (teto do provider). */
  readonly requestsPerSecond: number
  /** Loops paralelos do worker. */
  readonly concurrency: number
  /**
   * Fator de overhead sobre o tempo de rede. Cobre normalizacao e o que nao e
   * escrita de episodio (a escrita tem termo proprio — ver `episodesPerSecond`).
   */
  readonly overheadFactor: number
  /**
   * Episodios PERSISTIDOS por segundo.
   *
   * CALIBRADO com as duas execucoes reais (ver
   * `docs/backend/catalog-bootstrap-evidence-2026-07.md`):
   *
   *   3+3  -> 33.178 episodios, worker 253 s  => ~131 ep/s
   *   10+10 -> 60.436 episodios, worker ~430 s => ~140 ep/s
   *
   * Adotamos **120 ep/s**, abaixo das duas medicoes, porque as duas rodaram em
   * PostgreSQL efemero local (disco rapido, zero latencia de rede ate o banco).
   * Um Postgres remoto e mais lento; o modelo nao deve ser otimista sobre um
   * regime que nunca mediu.
   *
   * ORIGEM DO NUMERO: duas amostras, mesmo hardware, mesmo tipo de banco. E
   * pouco. Por isso a estimativa reporta `confidence` — ver `CostEstimate`.
   */
  readonly episodesPerSecond: number
  /** Linhas de midia persistidas por segundo (mesma origem, mesma ressalva). */
  readonly mediaRowsPerSecond: number
}

/**
 * Defaults ancorados nas DUAS execucoes reais de 2026-07 (3+3 e 10+10).
 * Cada coeficiente com origem declarada — nenhum inventado.
 */
export const DEFAULT_ASSUMPTIONS: CostAssumptions = Object.freeze({
  fallbackSeasons: 3,
  fallbackEpisodesPerSeason: 10,
  mediaItemsPerTitle: 200,
  mediaItemsPerSeason: 2,
  bytesPerMediaRow: 512,
  requestsPerSecond: 20,
  concurrency: 4,
  overheadFactor: 1.6,
  episodesPerSecond: 120,
  mediaRowsPerSecond: 400,
})

/** Quao confiavel e a estimativa de duracao. */
export type DurationConfidence = 'low' | 'medium'

/**
 * Detalhe da duracao: os fatores que a compoem, para o operador saber ONDE o
 * tempo vai — e nao receber um numero unico sem explicacao.
 */
export interface DurationBreakdown {
  readonly networkMinutes: number
  readonly episodeWriteMinutes: number
  readonly mediaWriteMinutes: number
  readonly totalMinutes: number
  /** Qual termo domina: 'network' | 'episodes' | 'media'. */
  readonly dominantFactor: string
  readonly confidence: DurationConfidence
  /** O que NAO foi medido o bastante para confiar. */
  readonly caveats: readonly string[]
}

/** Contexto da descoberta (o que foi consultado para achar os candidatos). */
export interface DiscoveryCost {
  /** Listas de descoberta capturadas (cada uma vira 1 `sync_lists`). */
  readonly listCount: number
  /** Paginas de lista efetivamente lidas para montar os candidatos. */
  readonly listPagesFetched: number
  /** Tipos de entidade descobertos (cada um vira 1 `discover_ids`). */
  readonly entityKinds: number
}

/** Estimativa final. Todos os campos sao inteiros, exceto `durationMinutes`. */
export interface CostEstimate {
  readonly movies: number
  readonly series: number
  readonly titles: number
  readonly seasons: number
  readonly episodes: number
  readonly jobsByType: Readonly<Record<string, number>>
  readonly jobsTotal: number
  readonly apiCalls: number
  readonly mediaItems: number
  readonly mediaBytes: number
  readonly durationMinutes: number
  /** Decomposicao da duracao + confianca. */
  readonly duration: DurationBreakdown
  /** Titulos cujos contadores vieram do fallback (estimativa menos confiavel). */
  readonly titlesWithMissingFacts: number
}

/** Tres cenarios: o modelo direto, um piso otimista e um teto pessimista. */
export interface CostScenarios {
  readonly expected: CostEstimate
  readonly optimistic: CostEstimate
  readonly conservative: CostEstimate
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * Resolve temporadas/episodios de um titulo, aplicando fallback quando o
 * provider nao informou. Filme sempre resolve para 0/0.
 */
function resolveCounts(
  title: PlannedTitle,
  a: CostAssumptions,
): { seasons: number; episodes: number } {
  if (title.kind === 'movie') return { seasons: 0, episodes: 0 }
  const seasons = title.seasons > 0 ? title.seasons : a.fallbackSeasons
  const episodes =
    title.episodes > 0 ? title.episodes : seasons * a.fallbackEpisodesPerSeason
  return { seasons, episodes }
}

/**
 * Estima o custo de um bootstrap a partir dos titulos candidatos.
 *
 * Nao "adivinha" o numero de episodios quando o provider o informa: usa o valor
 * real. O fallback so entra para titulo com contador ausente, e o numero de
 * titulos nessa situacao e reportado em `titlesWithMissingFacts` — porque uma
 * estimativa que esconde sua propria incerteza e pior que nenhuma.
 */
export function estimateBootstrapCost(
  titles: readonly PlannedTitle[],
  discovery: DiscoveryCost,
  assumptions: CostAssumptions = DEFAULT_ASSUMPTIONS,
): CostEstimate {
  const movies = titles.filter((t) => t.kind === 'movie').length
  const series = titles.filter((t) => t.kind === 'tv').length
  const resolved = titles.map((t) => resolveCounts(t, assumptions))
  const seasons = sum(resolved.map((r) => r.seasons))
  const episodes = sum(resolved.map((r) => r.episodes))

  const jobsByType: Record<string, number> = {
    discover_ids: discovery.entityKinds,
    sync_lists: discovery.listCount,
    sync_details: titles.length,
    sync_media: titles.length,
    sync_seasons: series,
    sync_episodes: seasons,
  }
  const jobsTotal = sum(Object.values(jobsByType))

  // Chamadas: 1 por job que busca upstream + as paginas de lista ja lidas.
  // `discover_ids` por daily-export nao gasta cota (arquivo publico), mas por
  // lista gasta — contamos como 1 para nao subestimar.
  const apiCalls =
    discovery.listPagesFetched +
    discovery.entityKinds +
    titles.length + // sync_details
    titles.length + // sync_media
    series + // sync_seasons
    seasons // sync_episodes (1 por temporada: /tv/{id}/season/{n})

  const mediaItems =
    titles.length * assumptions.mediaItemsPerTitle +
    seasons * assumptions.mediaItemsPerSeason
  const mediaBytes = mediaItems * assumptions.bytesPerMediaRow

  // ---- Duracao: rede + ESCRITA -----------------------------------------
  // O modelo anterior so contava chamadas de API e subestimou por 3x na
  // execucao de 60.436 episodios: o custo real e dominado pela PERSISTENCIA,
  // nao pela rede. Cada termo agora e explicito.
  const effectiveRps = Math.max(
    1,
    Math.min(assumptions.requestsPerSecond, assumptions.concurrency * 2),
  )
  const networkSeconds = (apiCalls / effectiveRps) * assumptions.overheadFactor
  const episodeWriteSeconds = episodes / Math.max(1, assumptions.episodesPerSecond)
  const mediaWriteSeconds = mediaItems / Math.max(1, assumptions.mediaRowsPerSecond)
  const totalSeconds = networkSeconds + episodeWriteSeconds + mediaWriteSeconds
  const durationMinutes = totalSeconds / 60

  const parts: readonly [string, number][] = [
    ['network', networkSeconds],
    ['episodes', episodeWriteSeconds],
    ['media', mediaWriteSeconds],
  ]
  const dominantFactor = parts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]

  const caveats: string[] = []
  if (titles.some((t) => t.factsMissing === true)) {
    caveats.push('ha titulos sem contadores do provider: o volume usa fallback')
  }
  caveats.push(
    'coeficientes de escrita vem de 2 execucoes em PostgreSQL efemero LOCAL; ' +
      'banco remoto e mais lento',
  )

  const round1 = (n: number): number => Math.round((n / 60) * 10) / 10

  return {
    movies,
    series,
    titles: titles.length,
    seasons,
    episodes,
    jobsByType: Object.freeze(jobsByType),
    jobsTotal,
    apiCalls,
    mediaItems,
    mediaBytes,
    durationMinutes: Math.round(durationMinutes * 10) / 10,
    duration: {
      networkMinutes: round1(networkSeconds),
      episodeWriteMinutes: round1(episodeWriteSeconds),
      mediaWriteMinutes: round1(mediaWriteSeconds),
      totalMinutes: Math.round(durationMinutes * 10) / 10,
      dominantFactor,
      // Duas amostras, um so tipo de banco: nunca "high".
      confidence: titles.some((t) => t.factsMissing === true) ? 'low' : 'medium',
      caveats,
    },
    titlesWithMissingFacts: titles.filter((t) => t.factsMissing === true).length,
  }
}

/**
 * Tres cenarios. O conservador nao e um numero inventado: ele reaplica o modelo
 * com premissas piores (mais overhead, menos vazao, mais midia), que e o que
 * acontece quando o provider degrada ou o banco esta mais lento.
 */
export function estimateScenarios(
  titles: readonly PlannedTitle[],
  discovery: DiscoveryCost,
  assumptions: CostAssumptions = DEFAULT_ASSUMPTIONS,
): CostScenarios {
  return {
    expected: estimateBootstrapCost(titles, discovery, assumptions),
    optimistic: estimateBootstrapCost(titles, discovery, {
      ...assumptions,
      overheadFactor: 1,
      mediaItemsPerTitle: Math.round(assumptions.mediaItemsPerTitle / 2),
    }),
    conservative: estimateBootstrapCost(titles, discovery, {
      ...assumptions,
      overheadFactor: assumptions.overheadFactor * 2,
      requestsPerSecond: Math.max(1, Math.round(assumptions.requestsPerSecond / 2)),
      mediaItemsPerTitle: assumptions.mediaItemsPerTitle * 2,
    }),
  }
}

// ---------------------------------------------------------------------------
// Orcamento
// ---------------------------------------------------------------------------

/** Tetos operacionais. Campo ausente = sem teto para aquela dimensao. */
export interface BootstrapBudget {
  readonly maxTitles?: number
  readonly maxSeries?: number
  readonly maxSeasons?: number
  readonly maxEpisodes?: number
  readonly maxJobs?: number
  readonly maxApiCalls?: number
  readonly maxDurationMinutes?: number
  readonly maxMediaItems?: number
}

/** Uma dimensao estourada. */
export interface BudgetViolation {
  readonly dimension: string
  readonly limit: number
  readonly estimated: number
  readonly overBy: number
}

/** Veredito do orcamento. */
export interface BudgetDecision {
  readonly withinBudget: boolean
  readonly violations: readonly BudgetViolation[]
  /** Frase estavel para log/alerta. */
  readonly summary: string
}

/**
 * Confronta a estimativa com o orcamento.
 *
 * Avalia o cenario ESPERADO, nao o otimista: um orcamento que so cabe no melhor
 * caso nao e orcamento. Dimensao sem teto declarado nunca viola.
 */
export function evaluateBudget(
  estimate: CostEstimate,
  budget: BootstrapBudget,
): BudgetDecision {
  const checks: readonly { dimension: string; limit?: number; estimated: number }[] = [
    { dimension: 'titles', limit: budget.maxTitles, estimated: estimate.titles },
    { dimension: 'series', limit: budget.maxSeries, estimated: estimate.series },
    { dimension: 'seasons', limit: budget.maxSeasons, estimated: estimate.seasons },
    { dimension: 'episodes', limit: budget.maxEpisodes, estimated: estimate.episodes },
    { dimension: 'jobs', limit: budget.maxJobs, estimated: estimate.jobsTotal },
    { dimension: 'apiCalls', limit: budget.maxApiCalls, estimated: estimate.apiCalls },
    { dimension: 'mediaItems', limit: budget.maxMediaItems, estimated: estimate.mediaItems },
    {
      dimension: 'durationMinutes',
      limit: budget.maxDurationMinutes,
      estimated: estimate.durationMinutes,
    },
  ]

  const violations: BudgetViolation[] = []
  for (const c of checks) {
    if (c.limit === undefined) continue
    if (c.estimated > c.limit) {
      violations.push({
        dimension: c.dimension,
        limit: c.limit,
        estimated: c.estimated,
        overBy: Math.round((c.estimated - c.limit) * 10) / 10,
      })
    }
  }

  return {
    withinBudget: violations.length === 0,
    violations,
    summary:
      violations.length === 0
        ? 'dentro do orcamento'
        : `orcamento estourado em ${violations.length} dimensao(oes): ${violations
            .map((v) => `${v.dimension} ${v.estimated}>${v.limit}`)
            .join(', ')}`,
  }
}

/**
 * Maior prefixo de titulos que ainda cabe no orcamento.
 *
 * Existe para o operador nao ter que adivinhar `--limit` por tentativa e erro:
 * dado o orcamento, o planejador responde QUANTOS titulos cabem. Preserva a
 * ordem recebida (a lista ja vem ordenada por relevancia do provider).
 */
export function largestAffordablePrefix(
  titles: readonly PlannedTitle[],
  discovery: DiscoveryCost,
  budget: BootstrapBudget,
  assumptions: CostAssumptions = DEFAULT_ASSUMPTIONS,
): { readonly titles: readonly PlannedTitle[]; readonly estimate: CostEstimate } {
  let lo = 0
  let hi = titles.length
  // Busca binaria: o custo e monotonico crescente no prefixo.
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const slice = titles.slice(0, mid)
    const decision = evaluateBudget(estimateBootstrapCost(slice, discovery, assumptions), budget)
    if (decision.withinBudget) lo = mid
    else hi = mid - 1
  }
  const chosen = titles.slice(0, lo)
  return { titles: chosen, estimate: estimateBootstrapCost(chosen, discovery, assumptions) }
}
