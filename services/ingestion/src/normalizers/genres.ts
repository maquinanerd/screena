/**
 * genres.ts — Normaliza o `genres[]` do DETALHE do TMDB em vinculos de titulo.
 *
 * POR QUE ISTO NAO EXISTIA. A tabela `genres` (dicionario, normalizada de
 * `/genre/{movie,tv}/list` na Fase 6) nunca teve ligacao com titulo nenhum. O
 * `genres[]` vem no detalhe de filme e de serie — campo de PRIMEIRO NIVEL, nao
 * append —, chegava em toda requisicao que ja faziamos, e era descartado no
 * normalizador por nao ter onde ser gravado.
 *
 * Terceiro caso do mesmo padrao, depois de `watch/providers` (PR #181) e da
 * biografia de pessoa. Ver `tests/governance/tmdb-payload-consumption.test.ts`.
 *
 * PURO: sem rede, sem banco, sem `Date`.
 */

import type { TitleGenreLink } from '../types.js'

/** Resultado da normalizacao de generos de um titulo. */
export interface NormalizedTitleGenres {
  readonly links: TitleGenreLink[]
  /**
   * A fonte trouxe o ARRAY (mesmo vazio)?
   *
   * `false` significa "o payload nao falou de genero", e nunca "este titulo nao
   * tem genero". A diferenca decide se a escrita pode APAGAR os vinculos
   * existentes: um payload truncado que fosse lido como "lista vazia" limparia
   * os generos de um titulo que os tem. Foi exatamente assim que creditos foram
   * apagados por payload sem `credits`.
   */
  readonly present: boolean
}

/**
 * Normaliza, preservando a ORDEM do TMDB.
 *
 * A ordem e editorial: o TMDB devolve o genero mais representativo primeiro, e o
 * chip do hero mostra os primeiros. Reordenar por id ou por nome trocaria
 * "Ficcao cientifica" por "Acao" na vitrine sem que ninguem tivesse decidido.
 *
 * Item sem `id` numerico e descartado (nao ha o que ligar). Id repetido e
 * descartado na segunda ocorrencia — a PK e (titulo, genero), e duplicata
 * abortaria a escrita inteira.
 */
export function normalizeTitleGenres(raw: unknown): NormalizedTitleGenres {
  if (!Array.isArray(raw)) return { links: [], present: false }

  const links: TitleGenreLink[] = []
  const vistos = new Set<number>()
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const id = (item as { id?: unknown }).id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    if (vistos.has(id)) continue
    vistos.add(id)
    // `position` conta os ACEITOS, nao o indice cru: um item invalido no meio
    // do array nao pode deixar buraco na ordem exibida.
    links.push({ tmdbId: id, position: links.length })
  }
  return { links, present: true }
}
