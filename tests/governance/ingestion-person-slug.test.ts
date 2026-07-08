/**
 * Teste de governanca (P0-10) — a ingestao NUNCA cria um credito de pessoa
 * (`cast_members`/`crew_members`) sem tambem prever o slug canonico dessa
 * pessoa. Sem slug de pessoa, `/pt/pessoas/{slug}` e os links de elenco morrem
 * na base real, e o sync em massa multiplica o buraco.
 *
 * A garantia e travada em dois niveis:
 *  1. Logico (puro): os `cast_members`/`crew_members` derivam de
 *     `normalizeCredits`; os slugs de pessoa derivam de `planCreditedPeople`.
 *     Todo `personTmdbId` do primeiro DEVE ter um slug NAO-vazio no segundo.
 *  2. Fiacao (estatico): o bin de ingestao realmente liga o plano a persistencia
 *     (planCreditedPeople -> upsert de slug `person` + finalizeCreditedPeople).
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import type { TmdbCredits } from '@screena/tmdb-client'

import { normalizeCredits } from '../../services/ingestion/src/normalizers/credits.js'
import { planCreditedPeople } from '../../services/ingestion/src/public-catalog-people.js'

const ROOT = process.cwd()
const BIN_REL = 'services/ingestion/bin/ingest-public-catalog.ts'

/** Creditos representativos, incluindo caso de nome vazio (nunca vira slug vazio). */
const CREDITS: TmdbCredits = {
  cast: [
    { id: 6384, name: 'Keanu Reeves', character: 'Neo', order: 0 },
    { id: 2975, name: 'Laurence Fishburne', character: 'Morpheus', order: 1 },
    { id: 999, name: '   ', character: 'Extra', order: 2 }, // nome ausente
  ],
  crew: [
    { id: 9339, name: 'Lilly Wachowski', department: 'Directing', job: 'Director' },
    { id: 6384, name: 'Keanu Reeves', department: 'Production', job: 'Producer' }, // tambem no cast
  ],
}

describe('governanca: ingestao nao cria cast_member sem slug de pessoa (P0-10)', () => {
  it('todo cast_member persistido tem um slug de pessoa NAO-vazio no plano', () => {
    const { cast } = normalizeCredits(CREDITS)
    const slugByTmdb = new Map(planCreditedPeople(CREDITS).map((p) => [p.tmdbId, p.baseSlug]))

    const orphans: number[] = []
    for (const member of cast) {
      const slug = slugByTmdb.get(member.personTmdbId)
      if (slug === undefined || slug === '') orphans.push(member.personTmdbId)
    }
    expect(orphans).toEqual([])
  })

  it('todo crew_member persistido tem um slug de pessoa NAO-vazio no plano', () => {
    const { crew } = normalizeCredits(CREDITS)
    const slugByTmdb = new Map(planCreditedPeople(CREDITS).map((p) => [p.tmdbId, p.baseSlug]))

    const orphans: number[] = []
    for (const member of crew) {
      const slug = slugByTmdb.get(member.personTmdbId)
      if (slug === undefined || slug === '') orphans.push(member.personTmdbId)
    }
    expect(orphans).toEqual([])
  })

  it('pessoa creditada sem nome ainda recebe slug (fallback tmdb-{id})', () => {
    const slugByTmdb = new Map(planCreditedPeople(CREDITS).map((p) => [p.tmdbId, p.baseSlug]))
    expect(slugByTmdb.get(999)).toBe('tmdb-999')
  })

  it('o bin de ingestao realmente liga o plano de pessoas a persistencia de slug', () => {
    const source = readFileSync(path.join(ROOT, BIN_REL), 'utf8')
    // Deriva os slugs de pessoa a partir dos creditos...
    expect(source).toMatch(/planCreditedPeople\(/)
    // ...persiste como slug canonico de pessoa...
    expect(source).toMatch(/upsertCanonicalSlug\(\s*prisma,\s*'person'/)
    // ...e chama a finalizacao de pessoas dentro do finalize do titulo.
    expect(source).toMatch(/finalizeCreditedPeople\(prisma, detail\.credits\)/)
  })
})
