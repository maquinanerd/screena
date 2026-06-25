/**
 * person.ts — Normaliza o detalhe de pessoa do TMDB.
 *
 * Nao persiste biografia (o schema nao tem coluna de bio); `biography_source_status`
 * permanece no default `unknown` (governanca de exibicao, fora desta fase).
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
  }

  return { person, externalIds: buildExternalIds('person', detail.id, imdbId) }
}
