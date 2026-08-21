/**
 * entry.ts — A PORTA UNICA de cobertura de uma entidade.
 *
 * A REGRA QUE ESTE MODULO EXISTE PARA IMPOR: existe UM caminho para cobrir uma
 * entidade, e os tres chamadores passam por ele.
 *
 *   semente (bootstrap -> discover_ids)  \
 *   manutencao (/changes)                 >--- buildCoverageJob() ---> sync_details
 *   cobertura sob demanda                /                                  |
 *                                                                           v
 *                                              sync_media / sync_seasons -> sync_episodes
 *
 * `sync_details` e a RAIZ da cascata: ele busca o detalhe com
 * `append_to_response` maximo (creditos, ids externos, `watch/providers`,
 * `release_dates`, imagens de temporada) e so entao enfileira o que aquele
 * append NAO cobre. Quem enfileira um `sync_details` bem formado, portanto,
 * contrata a cobertura INTEIRA daquele titulo — nao um pedaco.
 *
 * POR QUE UM BUILDER, E NAO TRES BLOCOS PARECIDOS
 * ----------------------------------------------
 * Nao e preferencia de estilo: a divergencia JA ACONTECEU neste repositorio. O
 * caminho de `/changes` montava o job sem repetir `entityType`/`tmdbId` DENTRO
 * do payload — as colunas do job estavam certas, o payload nao. Como quem valida
 * e o handler, e o handler valida o PAYLOAD, todo `sync_details` vindo do
 * incremental reprovava na validacao e ia direto para dead-letter: o incremental
 * inteiro virava fila morta, em silencio. A cicatriz esta comentada em
 * `changes/run.ts`, no ponto exato onde o campo faltava.
 *
 * Um segundo caminho de ingestao nao falha no dia em que e escrito. Ele falha no
 * primeiro conserto que alguem aplica a um caminho e esquece no outro — e o
 * sintoma nao e um erro, e um catalogo com titulos de qualidades diferentes
 * conforme por onde entraram. Com um builder so, o conserto e unico por
 * construcao.
 *
 * ESTE MODULO E PURO: sem rede, sem Prisma, sem relogio. Ele MONTA o pedido de
 * cobertura; quem o enfileira e o chamador, com a sua propria porta de store.
 * Isso e deliberado — `changes/run.ts` precisa enfileirar DENTRO da transacao do
 * checkpoint, e um builder que enfileirasse sozinho tiraria essa escolha dele.
 */

import { buildIdempotencyKey } from '../catalog-jobs/idempotency.js'
import type { EnqueueCatalogJobInput } from '../catalog-jobs/store-port.js'

/** Tipos de entidade que a porta de cobertura aceita. */
export const COVERABLE_KINDS = ['movie', 'tv', 'person'] as const

/** Um tipo cobrivel. */
export type CoverableKind = (typeof COVERABLE_KINDS)[number]

/**
 * QUEM pediu a cobertura. Os chamadores autorizados, e so eles.
 *
 * Nao e rotulo decorativo: o motivo determina a PRIORIDADE na fila e entra no
 * payload, onde vira a resposta legivel de "por que este titulo foi buscado?".
 */
export const COVERAGE_REASONS = ['discovery', 'changes', 'on_demand', 'scheduled'] as const

/** Um motivo de cobertura. */
export type CoverageReason = (typeof COVERAGE_REASONS)[number]

/**
 * Prioridade por motivo (menor = roda antes).
 *
 * A ordem nao e arbitraria — ela reflete quem esta esperando:
 *
 *  - `on_demand` (10): ha uma PESSOA numa pagina agora, olhando um estado de
 *    "estamos buscando". E o unico caso com um leitor bloqueado, e por isso o
 *    unico que fura a fila;
 *  - `changes` (50): o upstream mudou. O dado publicado esta DESATUALIZADO —
 *    errado, nao ausente — e corrigir mentira vem antes de preencher lacuna;
 *  - `scheduled` (80): o AGENDADOR pediu porque o dado venceu a janela de
 *    frescor. Ninguem esta bloqueado e ninguem afirmou que mudou — mas o dado
 *    publicado esta VELHO, o que e pior que um id que ainda nao existe. Fica
 *    entre corrigir mentira e preencher lacuna;
 *  - `discovery` (100): backfill do universo. Nada quebra se este id entrar uma
 *    hora depois, entao ele cede a vez para todos os outros.
 */
export const COVERAGE_PRIORITY: Readonly<Record<CoverageReason, number>> = Object.freeze({
  on_demand: 10,
  changes: 50,
  scheduled: 80,
  discovery: 100,
})

/**
 * O AJUSTE FINO por popularidade, DENTRO de um motivo.
 *
 * Existe porque uma fila de manutencao com 10 mil titulos e um teto diario de
 * cota nao pode ser servida em ordem de insercao: o titulo mais aberto do site
 * esperaria dias atras de milhares que ninguem abriu. O sinal e `popularity` do
 * TMDB — medido, ja preenchido e ja indexado (ver
 * `services/sync/src/scheduler/priority.ts` para por que "pagina aberta pelo
 * leitor" NAO foi usado: essa medicao nao existe no banco).
 *
 * OS DESLOCAMENTOS SAO MENORES QUE A DISTANCIA ENTRE MOTIVOS, e isso e o
 * contrato: o maior ajuste (`+16`) e ESTRITAMENTE menor que o menor intervalo
 * entre dois motivos (`80 -> 100`, isto e 20). Popularidade NUNCA promove um
 * pedido para a faixa de outro motivo — ela so ordena dentro da propria faixa.
 *
 * O teto de 16 (e nao 20, o valor obvio) tem motivo: com 20, um `scheduled` de
 * cauda (80+20) EMPATARIA com um `discovery` sem rank (100+0), e empate no
 * `ORDER BY priority ASC` do claim faz o desempate cair em `available_at` — isto
 * e, em ordem de insercao, exatamente o criterio que este ajuste existe para
 * substituir. O teste `coverage-priority-by-popularity.test.ts` mede a distancia
 * real em vez de confiar no numero escrito aqui.
 *
 * Faixas (e nao um valor por titulo) porque o indice de claim e
 * `(status, priority, available_at)`: prioridade continua faria cada job virar
 * um valor distinto e a segunda coluna perderia poder de agrupamento.
 */
export const POPULARITY_PRIORITY_OFFSETS: readonly { readonly maxRank: number; readonly offset: number }[] =
  Object.freeze([
    { maxRank: 10, offset: 0 },
    { maxRank: 100, offset: 4 },
    { maxRank: 1_000, offset: 8 },
    { maxRank: 10_000, offset: 12 },
    { maxRank: Number.POSITIVE_INFINITY, offset: 16 },
  ])

/**
 * O deslocamento de um rank.
 *
 * `undefined` E `null` NAO SAO A MESMA COISA aqui, e a distincao e o ponto:
 *
 *   `undefined` — o chamador NAO ranqueia. E o caso dos tres chamadores
 *                 originais (discovery, changes, on_demand): eles nao tem
 *                 ranking e nunca tiveram. Deslocamento ZERO, para que a
 *                 prioridade deles continue sendo exatamente
 *                 `COVERAGE_PRIORITY[reason]` — acrescentar um offset uniforme
 *                 nao mudaria a ordem, mas faria a tabela de constantes mentir.
 *   `null`      — o chamador RANQUEIA, e ESTE item nao tem posicao medida (ex.:
 *                 `people`, que nao tem `popularity` no schema). Cai na faixa
 *                 mais baixa: fail-safe na direcao que so custa tempo, porque um
 *                 titulo sem posicao medida nao pode herdar a prioridade do topo.
 *
 * Colapsar os dois faria uma dessas duas coisas erradas: ou o chamador que nao
 * ranqueia perderia prioridade sem motivo, ou o item sem medicao furaria fila.
 */
export function popularityPriorityOffset(rank: number | null | undefined): number {
  if (rank === undefined) return 0
  const last = POPULARITY_PRIORITY_OFFSETS[POPULARITY_PRIORITY_OFFSETS.length - 1]!.offset
  if (rank === null || !Number.isFinite(rank) || rank <= 0) return last
  for (const band of POPULARITY_PRIORITY_OFFSETS) {
    if (rank <= band.maxRank) return band.offset
  }
  return last
}

/** Um pedido de cobertura de UMA entidade. */
export interface CoverageRequest {
  readonly kind: CoverableKind
  readonly tmdbId: number
  /** Idioma propagado a cascata inteira. */
  readonly locale: string
  readonly reason: CoverageReason
  /**
   * Escopo que distingue dois pedidos do MESMO alvo.
   *
   * `null` significa "o mesmo trabalho de sempre" — reenfileirar o mesmo id e
   * noop idempotente, que e o comportamento certo para backfill e para pedido
   * sob demanda repetido. O incremental passa a JANELA (`2026-08-10:2026-08-14`)
   * porque ali o mesmo id alterado numa janela nova E trabalho novo: sem o
   * discriminador, a segunda mudanca do mesmo titulo colidiria com a primeira e
   * seria descartada como duplicata — o titulo congelaria na primeira versao.
   */
  readonly scope?: string | null
  /** Corrida a que este job pertence (observabilidade). */
  readonly runId?: string | null
  /**
   * Posicao 1-based no ranking de popularidade da SELECAO que gerou este pedido.
   *
   * Ajusta a prioridade DENTRO do motivo (ver `POPULARITY_PRIORITY_OFFSETS`).
   * OMITIDO = o chamador nao ranqueia (deslocamento zero). `null` = ranqueia, mas
   * este item nao tem posicao medida (faixa mais baixa). Os dois NAO colapsam.
   */
  readonly rank?: number | null
}

/** Erro de pedido malformado. Recusa cedo, com o campo culpado nomeado. */
export class InvalidCoverageRequestError extends Error {
  constructor(readonly field: string, message: string) {
    super(message)
    this.name = 'InvalidCoverageRequestError'
  }
}

/**
 * Valida o pedido. Recusar aqui e barato; um job malformado so falha depois de
 * ser reivindicado, tentado e mandado para dead-letter.
 */
function assertValid(request: CoverageRequest): void {
  if (!(COVERABLE_KINDS as readonly string[]).includes(request.kind)) {
    throw new InvalidCoverageRequestError('kind', `tipo nao cobrivel: ${String(request.kind)}`)
  }
  if (!Number.isInteger(request.tmdbId) || request.tmdbId <= 0) {
    throw new InvalidCoverageRequestError(
      'tmdbId',
      `tmdbId tem de ser inteiro positivo: ${String(request.tmdbId)}`,
    )
  }
  if (typeof request.locale !== 'string' || request.locale.trim().length === 0) {
    throw new InvalidCoverageRequestError('locale', 'locale vazio')
  }
  if (!(COVERAGE_REASONS as readonly string[]).includes(request.reason)) {
    throw new InvalidCoverageRequestError('reason', `motivo desconhecido: ${String(request.reason)}`)
  }
}

/**
 * Monta o job que cobre UMA entidade por inteiro.
 *
 * O payload carrega `entityType` e `tmdbId` ALEM das colunas homonimas do job.
 * A repeticao e proposital e nao pode ser "limpa": as colunas servem a indice e
 * consulta, e o handler valida o PAYLOAD. Foi exatamente essa duplicidade
 * aparente que sumiu uma vez do caminho de `/changes` e mandou o incremental
 * inteiro para dead-letter.
 */
export function buildCoverageJob(request: CoverageRequest): EnqueueCatalogJobInput {
  assertValid(request)

  const externalId = String(request.tmdbId)
  const scope = request.scope ?? null

  return {
    jobType: 'sync_details',
    entityType: request.kind,
    externalId,
    idempotencyKey: buildIdempotencyKey({
      jobType: 'sync_details',
      entityType: request.kind,
      externalId,
      // O locale entra sempre; o escopo so quando existe. Sem o locale, duas
      // execucoes em idiomas diferentes colidiriam numa chave so.
      discriminator: scope === null ? request.locale : `${request.locale}:${scope}`,
    }),
    payload: {
      entityType: request.kind,
      tmdbId: request.tmdbId,
      locale: request.locale,
      reason: request.reason,
      // A cascata e o ponto: sem isto o titulo entraria so com o detalhe, sem
      // midia e sem temporadas — "parece completo mas nao e" (T0).
      enqueueDependencies: true,
      ...(scope === null ? {} : { window: scope }),
    },
    priority: COVERAGE_PRIORITY[request.reason] + popularityPriorityOffset(request.rank),
    runId: request.runId ?? null,
  }
}

/** Monta os jobs de cobertura de varios ids do mesmo tipo/motivo. */
export function buildCoverageJobs(
  requests: readonly CoverageRequest[],
): readonly EnqueueCatalogJobInput[] {
  return requests.map(buildCoverageJob)
}
