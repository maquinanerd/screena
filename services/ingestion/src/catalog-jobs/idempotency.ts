/**
 * idempotency.ts — Chave de idempotencia de enfileiramento (PURO).
 *
 * Dois enfileiramentos com a MESMA chave sao o mesmo trabalho: o segundo e um
 * noop (o unique de `idempotency_key` no banco garante isso; o adapter trata a
 * colisao como created=false). A chave e deterministica e legivel — reexecutar
 * o mesmo plano de bootstrap/sync nunca cria duplicatas.
 */

import type { CatalogEntityKind, CatalogJobType } from './types.js'

/** Entrada para derivar a chave de idempotencia de um job. */
export interface IdempotencyInput {
  readonly jobType: CatalogJobType
  /** Alvo do job (null para jobs sem alvo unico, ex.: bootstrap). */
  readonly entityType?: CatalogEntityKind | null
  /** ID externo (ex.: tmdb_id como texto). */
  readonly externalId?: string | null
  /**
   * Discriminador que distingue jobs do mesmo alvo/tipo mas escopo diferente
   * (ex.: janela de changes "2026-07-10:2026-07-16", pagina "p3", locale).
   * Sem discriminador, todos os jobs do mesmo (tipo, alvo) colapsam num so.
   */
  readonly discriminator?: string | null
}

/** Normaliza um segmento da chave: vazio/nulo vira "-"; espacos viram "_". */
function segment(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) return '-'
  return trimmed.replace(/\s+/g, '_')
}

/**
 * Deriva a chave de idempotencia deterministica de um job.
 *
 * Formato: `<jobType>:<entityType>:<externalId>:<discriminator>`. Puro e
 * estavel — a mesma entrada sempre produz a mesma chave.
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  return [
    segment(input.jobType),
    segment(input.entityType ?? null),
    segment(input.externalId ?? null),
    segment(input.discriminator ?? null),
  ].join(':')
}

/**
 * O discriminador de um job FILHO, com o escopo do pai embutido.
 *
 * ============================================================================
 * O DEFEITO QUE ESTA FUNCAO FECHA
 * ============================================================================
 * Ate 2026-08-28 os filhos de `sync_details` derivavam a chave so de
 * `input.locale`: `sync_media:movie:82856:pt-BR`. Essa chave e a MESMA em toda
 * execucao, para sempre. O pai tinha escopo (a janela do `/changes`, o dia do
 * agendador) e o filho nao — entao o pai voltava a rodar e o filho batia no
 * unique de `idempotency_key`, virava `created=false` e nao fazia nada.
 *
 * Efeito medido no produto: `tmdb_videos`, `tmdb_images`, `seasons` e
 * `episodes` eram escritos UMA vez, no primeiro ciclo que tocou o titulo, e
 * nunca mais. Trailer novo, poster novo e episodio novo nao entravam. O
 * catalogo congelava sem nenhum erro em lugar nenhum.
 *
 * ============================================================================
 * ESCOPO DEMAIS VIRA DUPLICATA — POR ISSO O ESCOPO E HERDADO, NAO INVENTADO
 * ============================================================================
 * A tentacao seria carimbar o RELOGIO no filho (`Date.now()`, um uuid, o
 * `runId`). Qualquer uma dessas faria cada tentativa gerar uma chave nova e a
 * idempotencia deixaria de existir: reenfileirar o MESMO trabalho criaria linha
 * nova, e um pai reprocessado (retry, retomada de checkpoint) multiplicaria os
 * filhos.
 *
 * O escopo herdado nao tem esse problema porque ele e uma propriedade do
 * TRABALHO, nao da tentativa: a janela `2026-08-27..2026-08-28` do `/changes` e
 * o dia `title_detail_active:2026-08-28` do agendador sao os mesmos em toda
 * retentativa daquele ciclo. Mesmo ciclo => mesma chave => noop. Ciclo seguinte
 * => chave nova => trabalho novo. E exatamente o contrato que o pai ja tinha.
 *
 * Travado por `catalog-jobs/__tests__/child-scope.test.ts`.
 */
export function scopedChildDiscriminator(
  locale: string,
  scope: string | null,
  ...extra: readonly string[]
): string {
  const prefix = extra.length === 0 ? '' : `${extra.join('')}:`
  const trimmed = (scope ?? '').trim()
  return trimmed.length === 0 ? `${prefix}${locale}` : `${prefix}${locale}:${trimmed}`
}


/**
 * Quantos DIAS de escopo a MIDIA DE FOLHA compartilha.
 *
 * 7 = a janela de "trailers / imagens (midia de catalogo)" declarada em
 * `.claude/rules/ingestion.md`. Nao e numero novo: e a mesma janela que o ritmo
 * `title_media` usa.
 */
export const LEAF_MEDIA_SCOPE_DAYS = 7

/** Data ISO (`YYYY-MM-DD`) em qualquer posicao do escopo. */
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})/

/**
 * ENGROSSA o escopo de um job de FOLHA para um balde de N dias.
 *
 * ============================================================================
 * POR QUE A FOLHA NAO PODE HERDAR O ESCOPO DO PAI CRU
 * ============================================================================
 * Dar escopo ao filho consertou o congelamento — mas trocou um extremo pelo
 * outro na ponta mais cara da arvore. Medido com o catalogo real (32.983
 * series, 136.650 temporadas, 3.921.368 episodios):
 *
 *   uma serie = 4,14 temporadas e 118,9 episodios
 *   uma passagem completa da cascata = 128,2 jobs e 254,2 requisicoes
 *   a midia de TEMPORADA + EPISODIO e **96,8%** desse custo
 *
 * `airing_series` roda DIARIO. Com o escopo cru do pai, ela reabria a cascata
 * inteira todo dia: 200 series/ciclo viravam **25.635 jobs e 50.842
 * requisicoes por dia** — um multiplicador de 128x sobre o volume anterior,
 * para buscar de novo o still de um episodio que foi ao ar em 2011.
 *
 * ============================================================================
 * A GRANULARIDADE DO ESCOPO ACOMPANHA A VOLATILIDADE DO DADO
 * ============================================================================
 * E o mesmo principio da tabela de ritmos, aplicado dentro de uma arvore de
 * jobs em vez de entre filas:
 *
 *   ENUMERAR (`sync_seasons`, `sync_episodes`) herda o escopo CRU do pai. E o
 *   que faz o episodio que estreou hoje aparecer hoje, e custa 1,6% do total.
 *
 *   A MIDIA DE FOLHA (temporada, episodio) usa o balde de 7 dias. Still de
 *   episodio nao muda todo dia; a janela de midia do projeto sempre disse 7.
 *
 * A midia de TITULO (o trailer, o poster) NAO passa por aqui: ela mantem o
 * escopo cru, porque e ela que responde ao sinal de `videos`/`images` do
 * `/changes` — engrossa-la atrasaria um trailer novo em ate uma semana.
 *
 * Resultado medido: 8.659 req/dia contra 50.842, **5,9x mais barato**, com a
 * promessa diaria intacta.
 *
 * ============================================================================
 * O BALDE E ANCORADO NA EPOCA, NAO NO "AGORA"
 * ============================================================================
 * `floor(diasDesdeEpoca / N)`. Ancorar no agora faria o balde deslizar a cada
 * reinicio do container, e duas replicas que subissem em dias diferentes veriam
 * baldes diferentes para o mesmo trabalho — ou seja, trabalho duplicado. E o
 * mesmo motivo pelo qual `windowSlot` ancora na meia-noite UTC.
 *
 * Escopo sem data reconhecivel volta INALTERADO: engrossar o que nao se sabe
 * ler produziria uma chave que colide com outra coisa. Sem data, o escopo ja e
 * um rotulo estavel (o backfill nao tem escopo nenhum), e mante-lo preserva o
 * contrato anterior.
 */
export function coarsenScopeToDays(
  scope: string | null,
  days: number = LEAF_MEDIA_SCOPE_DAYS,
): string | null {
  if (scope === null) return null
  const trimmed = scope.trim()
  if (trimmed.length === 0) return null
  const tamanho = Math.max(1, Math.trunc(days))

  const encontrado = ISO_DATE.exec(trimmed)
  if (encontrado === null) return trimmed

  const [iso, ano, mes, dia] = encontrado
  const epocaDias = Math.floor(
    Date.UTC(Number(ano), Number(mes) - 1, Number(dia)) / 86_400_000,
  )
  if (!Number.isFinite(epocaDias)) return trimmed
  const balde = Math.floor(epocaDias / tamanho) * tamanho

  // A data volta ao lugar em que estava: o resto do escopo (nome da fila,
  // janela do /changes) continua separando o que ele separava.
  const inicio = new Date(balde * 86_400_000).toISOString().slice(0, 10)
  return `${trimmed.slice(0, encontrado.index)}${inicio}~${tamanho}d${trimmed.slice(
    encontrado.index + (iso as string).length,
  )}`
}
