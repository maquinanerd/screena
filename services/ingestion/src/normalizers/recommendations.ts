/**
 * recommendations.ts — Normaliza `recommendations` e `similar` do detalhe TMDB.
 *
 * TERCEIRO CASO DO MESMO PADRAO, e por isso este arquivo vem acompanhado de uma
 * trava (`tests/governance/tmdb-append-consumption.test.ts`). Os anteriores:
 *
 *   1. `watch/providers` — PR #181. Estava no append, chegava em toda
 *      requisicao de detalhe, e o normalizador o descartava.
 *   2. `biography` de pessoa — chegava no payload e nao havia coluna.
 *   3. `recommendations` / `similar` — este.
 *
 * Tres ocorrencias do mesmo defeito em tres semanas nao pedem tres consertos,
 * pedem UMA trava: nada obrigava a lista de `append_to_response` e a lista de
 * consumidores a concordarem. O tipo `TmdbMovieDetail` e um SUBSET declarado a
 * mao, entao o campo nao declarado simplesmente desaparece no limite do tipo —
 * sem erro, sem aviso, sem custo aparente. A cota ja foi paga.
 *
 * PURO: sem rede, sem banco, sem `Date`.
 */

import type { RecommendationKind, TitleRecommendationLink } from '../types.js'

/** Resultado da normalizacao de um bloco de recomendacao. */
export interface NormalizedRecommendations {
  readonly links: TitleRecommendationLink[]
  /**
   * A fonte trouxe o bloco (mesmo com `results` vazio)?
   *
   * Mesma disciplina de `castPresent`/`genresPresent`: ausencia NAO e lista
   * vazia. Raw antigo, gravado antes de alguem olhar para recomendacao, nao tem
   * o bloco — e uma repromocao dele nao pode apagar o que ja foi coletado.
   */
  readonly present: boolean
}

/** `movie`/`tv` a partir do `media_type` do item; default pelo tipo da origem. */
function readMediaType(item: Record<string, unknown>, fallback: 'movie' | 'tv'): 'movie' | 'tv' | null {
  const raw = item['media_type']
  if (raw === undefined || raw === null) return fallback
  if (raw === 'movie' || raw === 'tv') return raw
  // `person`, `collection` ou lixo: nao e titulo, nao entra. Nunca presumir o
  // fallback aqui — presumir transformaria uma pessoa num filme.
  return null
}

/**
 * Normaliza `{ results: [...] }` em vinculos, preservando a ORDEM do TMDB.
 *
 * A ordem e o proprio sinal: o TMDB devolve por forca de recomendacao. Ordenar
 * por id ou por titulo destruiria a unica informacao que o bloco carrega.
 */
export function normalizeRecommendations(
  raw: unknown,
  kind: RecommendationKind,
  sourceMediaType: 'movie' | 'tv',
  sourceTmdbId: number,
): NormalizedRecommendations {
  if (raw === null || typeof raw !== 'object') return { links: [], present: false }
  const results = (raw as { results?: unknown }).results
  if (!Array.isArray(results)) return { links: [], present: false }

  const links: TitleRecommendationLink[] = []
  const vistos = new Set<string>()
  for (const item of results) {
    if (item === null || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = obj['id']
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    const mediaType = readMediaType(obj, sourceMediaType)
    if (mediaType === null) continue
    // Um titulo nao se recomenda. O CHECK do banco tambem barra, mas barrar aqui
    // evita que uma linha invalida aborte a transacao inteira do upsert.
    if (mediaType === sourceMediaType && id === sourceTmdbId) continue
    const chave = `${mediaType}:${id}`
    // Duplicata violaria a PK e derrubaria a escrita do titulo junto.
    if (vistos.has(chave)) continue
    vistos.add(chave)
    // `position` conta os ACEITOS: um item invalido no meio nao deixa buraco.
    links.push({ kind, targetMediaType: mediaType, targetTmdbId: id, position: links.length })
  }
  return { links, present: true }
}

/**
 * Junta os DOIS blocos de um detalhe numa lista so.
 *
 * `recommendations` vem PRIMEIRO e `similar` depois, sempre: o primeiro e
 * comportamental (quem viu isto viu aquilo) e o segundo e por metadado (mesmo
 * genero, mesma palavra-chave). Sao qualidades diferentes de parentesco, e a
 * ordem aqui e a preferencia editorial — o `kind` continua gravado para que a
 * leitura possa separa-los quando quiser.
 *
 * `present` e `true` se QUALQUER um dos dois blocos veio. Um detalhe antigo, sem
 * nenhum dos dois, devolve `false` e o replace-set nao roda.
 */
export function collectRecommendations(
  detail: {
    readonly id?: unknown
    readonly recommendations?: unknown
    readonly similar?: unknown
  },
  sourceMediaType: 'movie' | 'tv',
): NormalizedRecommendations {
  const sourceTmdbId = typeof detail.id === 'number' ? detail.id : -1
  const rec = normalizeRecommendations(
    detail.recommendations,
    'recommendation',
    sourceMediaType,
    sourceTmdbId,
  )
  const sim = normalizeRecommendations(detail.similar, 'similar', sourceMediaType, sourceTmdbId)
  return {
    links: [...rec.links, ...sim.links],
    present: rec.present || sim.present,
  }
}
