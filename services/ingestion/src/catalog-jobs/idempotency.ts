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
