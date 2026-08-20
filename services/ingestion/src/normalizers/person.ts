/**
 * person.ts — Normaliza o detalhe de pessoa do TMDB.
 *
 * PERSISTE a biografia desde 20/08/2026. Ate entao este cabecalho dizia "nao
 * persiste biografia (o schema nao tem coluna de bio)" — e era literalmente
 * verdade: `people` tinha a coluna de GOVERNANCA (`biography_source_status`) e
 * nao tinha a de TEXTO. O dado chegava no payload e era jogado fora.
 *
 * `biography_source_status` continua no default `unknown`: gravar o texto NAO
 * autoriza exibi-lo. A licenca (invariante 6) segue sendo o gate.
 */

import type { TmdbPersonDetail } from '@screena/tmdb-client'
import type { ExternalIdInput, PersonUpsert } from '../types.js'
import { NormalizationError } from '../types.js'
import {
  normalizeDate,
  normalizeImdbId,
  nullableNumber,
  nullableString,
} from '../utils/normalize.js'
import { buildExternalIds } from './external-ids.js'

/** Resultado da normalizacao de uma pessoa. */
export interface NormalizedPerson {
  readonly person: PersonUpsert
  readonly externalIds: ExternalIdInput[]
}

/** Normaliza uma pessoa; lanca NormalizationError sem id ou sem nome. */
export function normalizePerson(detail: TmdbPersonDetail): NormalizedPerson {
  if (typeof detail.id !== 'number') {
    throw new NormalizationError('Pessoa TMDB sem id numerico.')
  }
  const name = nullableString(detail.name)
  if (name === null) {
    throw new NormalizationError(`Pessoa TMDB ${detail.id} sem nome.`)
  }

  const imdbId = normalizeImdbId(detail.imdb_id ?? detail.external_ids?.imdb_id)
  const person: PersonUpsert = {
    tmdbId: detail.id,
    imdbId,
    name,
    knownForDepartment: nullableString(detail.known_for_department),
    gender: nullableNumber(detail.gender),
    birthday: normalizeDate(detail.birthday),
    deathday: normalizeDate(detail.deathday),
    placeOfBirth: nullableString(detail.place_of_birth),
    profilePath: nullableString(detail.profile_path),
    // `nullableString` colapsa "" em null: biografia vazia e ausencia, nunca um
    // paragrafo em branco que a pagina renderizaria como bloco vazio.
    biography: nullableString(detail.biography),
  }

  return { person, externalIds: buildExternalIds('person', detail.id, imdbId) }
}
