/**
 * credits.ts — Normaliza `credits` (cast/crew) de filme/serie.
 *
 * Cada credito carrega um `PersonStub` minimo (derivado do proprio credito)
 * para que a pessoa seja upsertada antes de ligar o credito. Creditos sem `id`
 * de pessoa sao descartados (nao inventamos pessoas).
 */

import type { TmdbCastCredit, TmdbCredits, TmdbCrewCredit } from '@screena/tmdb-client'
import type { CastMemberInput, CrewMemberInput, PersonStub } from '../types.js'
import { nullableNumber, nullableString } from '../utils/normalize.js'

function toPersonStub(credit: TmdbCastCredit | TmdbCrewCredit): PersonStub {
  return {
    tmdbId: credit.id,
    name: nullableString(credit.name) ?? '',
    knownForDepartment: nullableString(credit.known_for_department),
    gender: nullableNumber(credit.gender),
    profilePath: nullableString(credit.profile_path),
  }
}

/** Resultado da normalizacao de creditos. */
export interface NormalizedCredits {
  readonly cast: CastMemberInput[]
  readonly crew: CrewMemberInput[]
}

/** Normaliza cast e crew, descartando entradas sem id de pessoa. */
export function normalizeCredits(credits: TmdbCredits | undefined): NormalizedCredits {
  const cast = (credits?.cast ?? [])
    .filter((entry) => typeof entry.id === 'number')
    .map(
      (entry): CastMemberInput => ({
        personTmdbId: entry.id,
        person: toPersonStub(entry),
        character: nullableString(entry.character),
        billingOrder: nullableNumber(entry.order),
        creditId: nullableString(entry.credit_id),
      }),
    )

  const crew = (credits?.crew ?? [])
    .filter((entry) => typeof entry.id === 'number')
    .map(
      (entry): CrewMemberInput => ({
        personTmdbId: entry.id,
        person: toPersonStub(entry),
        department: nullableString(entry.department),
        job: nullableString(entry.job),
        creditId: nullableString(entry.credit_id),
      }),
    )

  return { cast, crew }
}
