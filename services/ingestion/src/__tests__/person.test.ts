/**
 * Testes de contrato/mapeamento do normalizer de pessoa.
 */

import { describe, expect, it } from 'vitest'
import type { TmdbPersonDetail } from '@screena/tmdb-client'
import { normalizePerson } from '../normalizers/person.js'
import { NormalizationError } from '../types.js'

const PERSON: TmdbPersonDetail = {
  id: 287,
  name: 'Brad Pitt',
  known_for_department: 'Acting',
  gender: 2,
  birthday: '1963-12-18',
  deathday: null,
  place_of_birth: 'Shawnee, Oklahoma, USA',
  profile_path: '/brad.jpg',
  external_ids: { imdb_id: 'nm0000093' },
}

describe('normalizePerson', () => {
  it('mapeia campos canonicos', () => {
    const { person } = normalizePerson(PERSON)
    expect(person.tmdbId).toBe(287)
    expect(person.name).toBe('Brad Pitt')
    expect(person.knownForDepartment).toBe('Acting')
    expect(person.birthday).toBe('1963-12-18')
    expect(person.deathday).toBeNull()
    expect(person.placeOfBirth).toBe('Shawnee, Oklahoma, USA')
  })

  it('gera external id imdb de pessoa com /name/', () => {
    const { externalIds } = normalizePerson(PERSON)
    expect(externalIds).toContainEqual({
      source: 'imdb',
      externalId: 'nm0000093',
      url: 'https://www.imdb.com/name/nm0000093/',
    })
  })

  it('lanca NormalizationError sem nome', () => {
    expect(() => normalizePerson({ id: 1, name: '' })).toThrow(NormalizationError)
  })
})
