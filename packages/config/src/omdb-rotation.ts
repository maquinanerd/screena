/**
 * omdb-rotation.ts — Como o orcamento DIARIO da OMDb e repartido (PURO).
 *
 * `omdb-budget.ts` responde "quantas requisicoes eu posso gastar hoje?".
 * Este modulo responde a pergunta seguinte, que nunca tinha dono:
 * **"gastar em QUEM?"**.
 *
 * ============================================================================
 * AUSENCIA NAO E DEFASAGEM
 * ============================================================================
 * Ate 2026-08-31 havia UM trabalho so, e ele era o de REATUALIZAR: a fila
 * `ratings_omdb` girava a cada 168h porque 168h e o menor `refreshAfterHours`
 * das tres fontes que a OMDb entrega (`RATING_STALE_POLICY`). O relogio estava
 * certo — para a pergunta errada.
 *
 * Um titulo com ZERO notas nao esta DEFASADO. Ele nunca foi perguntado. Nenhuma
 * janela de frescor tem o que dizer sobre ele: `now - never` nao e um intervalo.
 * Aplicar a janela de refresh a ele foi o que manteve 99,13% dos filmes sem nota
 * enquanto o worker rodava, verde, todo dia.
 *
 * Logo, DOIS trabalhos, com orcamentos separados:
 *
 *   COBERTURA   — titulo com zero notas externas. Sem janela; so existe
 *                 "ainda nao foi perguntado". E o trabalho FINITO: ele acaba.
 *   ATUALIZACAO — titulo que ja tem nota. Aqui sim vale `RATING_STALE_POLICY`
 *                 e as 168h. E o trabalho PERPETUO: ele nunca acaba.
 *
 * ============================================================================
 * POR QUE 85 / 15, E QUANDO ISSO DEIXA DE VALER
 * ============================================================================
 * Medido em producao em 2026-08-31: 424 titulos de ~83.300 tem alguma nota
 * externa. O conjunto a REATUALIZAR tem 424 elementos; o conjunto a COBRIR tem
 * dezenas de milhares. Um rateio meio a meio daria a 424 titulos o mesmo
 * orcamento que a 65 mil.
 *
 * A conta que fixa os 15%, com o envelope de fundo de 700/dia:
 *
 *   atualizacao = 700 x 0,15 = 105 requisicoes/dia
 *   em 168h (a janela que a politica exige) = 105 x 7 = 735 reatualizacoes
 *
 * Ou seja: 15% honram a janela de 168h para TODO titulo ja coberto enquanto o
 * conjunto coberto couber em **735 titulos**. Hoje sao 424 — folga de 1,7x. O
 * numero nao e uma proporcao estetica: e o ponto em que a politica de frescor
 * ainda fecha.
 *
 * **O GATILHO DE REVISAO E ESSE, e nao "quando parecer pouco":** no dia em que
 * o conjunto coberto passar de `refreshCapacityPerWindow()`, a atualizacao
 * comeca a estourar as 168h e a divisao precisa mudar. `planOmdbRotation`
 * devolve `refreshWindowFits` justamente para que isso apareca no relatorio em
 * vez de ser descoberto meses depois.
 *
 * ============================================================================
 * POR QUE 58 / 42 ENTRE FILME E SERIE, E NAO METADE A METADE
 * ============================================================================
 * `perType = Math.floor(slots / 2)` dava a mesma fatia aos dois tipos. Parece
 * neutro e nao e: os dois conjuntos tem TAMANHOS diferentes, entao fatias iguais
 * terminam a volta em DIAS diferentes — e quem termina primeiro nao libera a
 * fatia, porque a janela de frescor barra a reconsulta. A fatia do tipo menor
 * vira slot ocioso enquanto o tipo maior ainda tem dezenas de milhares na fila.
 *
 * Consultavel = tem `imdb_id` (a OMDb resolve por IMDb id; sem ele o titulo e
 * inalcancavel — ver `TITLES_WITHOUT_IMDB_ID` abaixo). Medido no banco de
 * PRODUCAO em 2026-08-31:
 *
 *   filmes  48.611 - 10.660 sem imdb_id = 37.951  (58,0%)
 *   series  34.700 -  7.229 sem imdb_id = 27.471  (42,0%)
 *   total                                 65.422
 *
 * Proporcional ao conjunto CONSULTAVEL, os dois tipos terminam a volta no MESMO
 * dia e nenhum slot fica ocioso. E o unico rateio que nao desperdica.
 *
 * Estes numeros sao DEFAULTS declarados, nao literais enterrados: todo consumidor
 * pode injeta-los, e `planOmdbRotation` aceita override para que o dono ajuste
 * sem recompilar a intencao.
 */

/**
 * Envelope diario da fila de FUNDO da OMDb.
 *
 * NAO e a cota (1.000) nem a cota menos a reserva do leitor (850): e o teto que
 * a fila de fundo se impoe, e a diferenca e folga deliberada.
 *
 * 700 deixa 150 de folga sobre o limite de 850 — exatamente uma reserva do
 * leitor inteira. Isso compra um ciclo completo de retry (e um dia em que a
 * medicao do gasto esteja atrasada) sem cruzar o teto do fornecedor. Subir para
 * 800 compraria ~12 dias de volta e derrubaria a folga a um terco disso.
 *
 * O numero importa porque a OMDb **nao publica cabecalho de cota**: nao ha
 * `X-RateLimit-Remaining` para conferir. `api_sync_logs.quota_cost` e o unico
 * contador que existe, e ele conta o que NOS emitimos — nao o que o fornecedor
 * contabilizou. Folga e o unico substituto de observabilidade que temos.
 */
export const OMDB_BACKGROUND_DAILY_ENVELOPE = 700

/** Fatia do envelope de fundo destinada a COBERTURA (titulo com zero notas). */
export const OMDB_COVERAGE_RATIO = 0.85

/**
 * Fatia do conjunto consultavel que e FILME. O complemento e serie.
 *
 * Ver o cabecalho: proporcional ao consultavel, nao meio a meio.
 */
export const OMDB_MOVIE_SHARE = 0.58

/**
 * Titulos que a OMDb NAO alcanca, por tipo.
 *
 * A OMDb consulta por IMDb id (`?i=tt...`); nao ha busca por TMDB id. Um titulo
 * sem `imdb_id` local e estruturalmente inalcancavel, e nenhuma cadencia
 * conserta isso. Registrado aqui porque e o PISO do problema: o denominador
 * honesto da cobertura nao e o catalogo, e o catalogo menos estes.
 *
 * ============================================================================
 * MEDIDO NO BANCO EM 2026-08-31 — e o PISO E REAL, nao um backlog
 * ============================================================================
 * A PR #258 trouxe estes numeros de um enunciado (8.114 / 6.461). A medicao
 * direta devolveu **10.660 filmes e 7.229 series** — 3.314 a mais.
 *
 * E, mais importante que o tamanho, a NATUREZA deles:
 *
 *   SELECT COUNT(*) FILTER (WHERE imdb_id IS NULL AND last_synced_at IS NULL)
 *   -> 0, nos DOIS tipos.
 *
 * Ou seja: **todos ja passaram pelo sync de detalhe**. Nao ha bucket
 * "recuperavel rodando o detalhe de novo" — ele e vazio. E o extrator nao e o
 * culpado: `external_ids` esta no append rico dos DOIS tipos
 * (`MOVIE_APPEND`/`TV_APPEND` em `api-clients/tmdb`), o normalizador de filme le
 * `detail.imdb_id ?? detail.external_ids?.imdb_id` e o de serie le
 * `detail.external_ids?.imdb_id` (serie nao tem o campo no topo). Pedimos,
 * recebemos, lemos — e o TMDB simplesmente nao tem o id para eles.
 *
 * Consequencia: **17.889 titulos (21,5% do catalogo) nunca poderao ter nota
 * externa via OMDb**, com qualquer cadencia. Este e o piso do problema, e ele
 * so muda com uma fonte que resolva por TMDB id.
 */
export const TITLES_WITHOUT_IMDB_ID = { movie: 10_660, tv: 7_229 } as const

/** Os dois trabalhos que disputam o envelope diario. */
export const OMDB_ROTATION_MODES = ['coverage', 'refresh'] as const

/**
 * O trabalho de um lote.
 *
 * `coverage` — titulo sem NENHUMA nota externa; ignora a janela de frescor,
 *              porque nao ha o que estar fresco.
 * `refresh`  — titulo que ja tem nota; aplica `RATING_STALE_POLICY`.
 */
export type OmdbRotationMode = (typeof OMDB_ROTATION_MODES)[number]

/** Um lote planejado: um trabalho, um tipo, um numero de requisicoes. */
export interface OmdbRotationSlice {
  readonly mode: OmdbRotationMode
  readonly entityType: 'movie' | 'tv'
  readonly slots: number
}

/** O plano do dia. */
export interface OmdbRotationPlan {
  /** Envelope efetivamente repartido (soma de `slices`). */
  readonly total: number
  readonly coverageSlots: number
  readonly refreshSlots: number
  readonly slices: readonly OmdbRotationSlice[]
  /**
   * A fatia de atualizacao ainda honra as 168h para o conjunto ja coberto?
   *
   * `null` quando o chamador nao informou `coveredTitles` — e ausencia de
   * medicao, nunca um "sim" por omissao.
   */
  readonly refreshWindowFits: boolean | null
  /** Quantas reatualizacoes cabem numa janela de 168h com esta fatia. */
  readonly refreshCapacityPerWindow: number
}

/** Overrides do plano (tudo opcional; o default e a politica declarada acima). */
export interface OmdbRotationOptions {
  readonly coverageRatio?: number
  readonly movieShare?: number
  /** Horas da janela de frescor; default 168 (`RATING_STALE_POLICY`, minimo). */
  readonly refreshWindowHours?: number
  /** Quantos titulos ja tem nota (para aferir `refreshWindowFits`). */
  readonly coveredTitles?: number
}

const DEFAULT_REFRESH_WINDOW_HOURS = 168

/** Prende `value` em [0, 1]; NaN vira `fallback` (fail-closed, nunca silencioso). */
function ratio(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

/**
 * Reparte `envelope` requisicoes entre os quatro lotes do dia.
 *
 * PURO e total: `envelope <= 0` devolve um plano de zeros (nao lanca) — um dia
 * sem cota e um resultado legitimo, nao um erro.
 *
 * O arredondamento e feito UMA vez, no fim, por subtracao: `coverage` recebe o
 * arredondado e `refresh` recebe o RESTO. Arredondar os dois independentemente
 * perderia (ou inventaria) uma requisicao por ciclo, e um erro de 1/dia e
 * exatamente o tipo de coisa que ninguem nota e que estoura a cota num dia de
 * borda.
 */
export function planOmdbRotation(
  envelope: number,
  options: OmdbRotationOptions = {},
): OmdbRotationPlan {
  const total = Math.max(0, Math.trunc(envelope))
  const coverageRatio = ratio(options.coverageRatio, OMDB_COVERAGE_RATIO)
  const movieShare = ratio(options.movieShare, OMDB_MOVIE_SHARE)
  const windowHours = options.refreshWindowHours ?? DEFAULT_REFRESH_WINDOW_HOURS

  const coverageSlots = Math.round(total * coverageRatio)
  const refreshSlots = total - coverageSlots

  // Mesmo raciocinio do arredondamento acima, agora entre filme e serie.
  const split = (slots: number): readonly [number, number] => {
    const movie = Math.round(slots * movieShare)
    return [movie, slots - movie]
  }
  const [coverageMovie, coverageTv] = split(coverageSlots)
  const [refreshMovie, refreshTv] = split(refreshSlots)

  const windowDays = windowHours / 24
  const refreshCapacityPerWindow = Math.floor(refreshSlots * windowDays)
  const refreshWindowFits =
    options.coveredTitles === undefined
      ? null
      : options.coveredTitles <= refreshCapacityPerWindow

  return {
    total,
    coverageSlots,
    refreshSlots,
    slices: [
      { mode: 'coverage', entityType: 'movie', slots: coverageMovie },
      { mode: 'coverage', entityType: 'tv', slots: coverageTv },
      { mode: 'refresh', entityType: 'movie', slots: refreshMovie },
      { mode: 'refresh', entityType: 'tv', slots: refreshTv },
    ],
    refreshWindowFits,
    refreshCapacityPerWindow,
  }
}

/**
 * Dias para uma volta completa de COBERTURA sobre `titles` titulos.
 *
 * `Infinity` quando nao ha fatia de cobertura: sem slots a volta nunca fecha, e
 * dizer "0 dias" ali seria a mentira mais confortavel possivel.
 */
export function coverageLapDays(titles: number, coverageSlotsPerDay: number): number {
  const remaining = Math.max(0, Math.trunc(titles))
  if (remaining === 0) return 0
  if (coverageSlotsPerDay <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(remaining / coverageSlotsPerDay)
}
