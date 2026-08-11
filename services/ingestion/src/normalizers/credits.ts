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
  /**
   * true quando a FONTE trouxe a lista de elenco (um array), mesmo VAZIO.
   *
   * Distingue "a fonte nao falou sobre elenco" de "a fonte disse que nao ha
   * elenco" — sem isso as duas chegam ao store como `cast: []` e um payload
   * sem o append `credits` (raw antigo, corpo truncado) apaga o elenco ja
   * gravado. Mesmo motivo pelo qual `streaming-availability/mapping.ts` marca
   * `recognized: false` num corpo anomalo em vez de deixar o replace rodar.
   */
  readonly castPresent: boolean
  /** Idem para a lista de equipe (`crew`). */
  readonly crewPresent: boolean
}

/** Normaliza cast e crew, descartando entradas sem id de pessoa. */
export function normalizeCredits(credits: TmdbCredits | undefined): NormalizedCredits {
  // Array (mesmo vazio) = a fonte afirmou a lista. Ausente ou nao-array
  // (bloco `credits` sem append, corpo truncado) = nao sabemos nada.
  const rawCast = credits?.cast
  const rawCrew = credits?.crew

  const cast = (Array.isArray(rawCast) ? rawCast : [])
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

  const crew = (Array.isArray(rawCrew) ? rawCrew : [])
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

  return { cast, crew, castPresent: Array.isArray(rawCast), crewPresent: Array.isArray(rawCrew) }
}
