/**
 * Teste de governanca — a COBERTURA do painel usa os MESMOS portoes da pagina.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE TESTE IMPEDE
 * ============================================================================
 * A tela Cobertura conta "com trailer", "com nota exibivel" e "indexavel" em SQL
 * (`services/sync/src/scheduler/runtime/coverage.ts`), porque um servico nao
 * importa `apps/web`. Os portoes de verdade vivem la, em TypeScript. Uma copia de
 * gate que diverge do original produz exatamente o numero que o painel existe
 * para nao mostrar: um "80% com trailer" quando a pagina mostra 3%.
 *
 * Aqui cada constante do SQL e confrontada com o COMPORTAMENTO do gate da
 * pagina, nao com uma lista copiada. A prova linha a linha contra PostgreSQL real
 * (a contagem SQL igual a contagem do gate TypeScript) fica no validador do painel.
 */

import { describe, expect, it } from 'vitest'

import { RATING_STALE_POLICY } from '@screena/config'
import { YOUTUBE_VIDEO_ID_PATTERN } from '@screena/public-contracts'

import { isDisplayableTrailerRow, type TrailerRow } from '../../apps/web/src/lib/trailer-presenter'
import { PUBLISHED_LOCALES } from '../../apps/web/src/lib/synopsis-language'
import { SUSPENDED_PAGE_TYPES } from '../../apps/web/src/server/seo/suspended-pages'
import { toPublicRating, type RatingRow } from '../../apps/web/src/server/entity-ratings'
import {
  COVERAGE_KINDS,
  COVERAGE_TITLE_LANGUAGES,
  coverageSql,
  DISPLAYABLE_LICENSE_STATUSES,
  RATING_DISPLAY_TERRITORY,
  RATING_DISPLAY_USE_CASE,
  SUSPENDED_INDEX_KINDS,
  TRAILER_VIDEO_TYPES,
  YOUTUBE_VIDEO_ID_SQL_PATTERN,
} from '../../services/sync/src/scheduler/runtime/coverage'

const HORA = 60 * 60 * 1000

function trailer(overrides: Partial<TrailerRow>): TrailerRow {
  return {
    site: 'YouTube',
    videoKey: 'dQw4w9WgXcQ',
    name: 'Trailer oficial',
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt',
    publishedAt: null,
    displayAllowed: true,
    licenseStatus: 'licensed',
    ...overrides,
  } as TrailerRow
}

describe('trailer: SQL x isDisplayableTrailerRow', () => {
  it('o padrao de id do YouTube e o MESMO', () => {
    expect(YOUTUBE_VIDEO_ID_SQL_PATTERN).toBe(YOUTUBE_VIDEO_ID_PATTERN.source)
  })

  it.each(['Trailer', 'Teaser', 'Clip', 'Featurette', 'Behind the Scenes', 'Bloopers'])(
    'tipo %s: a pagina exibe exatamente quando o SQL conta',
    (tipo) => {
      expect(isDisplayableTrailerRow(trailer({ videoType: tipo }))).toBe(TRAILER_VIDEO_TYPES.includes(tipo))
    },
  )

  it.each(['official', 'licensed', 'third_party', 'unknown', 'blocked'])(
    'licenca %s do video: mesma resposta (o SQL recusa unknown e blocked)',
    (status) => {
      expect(isDisplayableTrailerRow(trailer({ licenseStatus: status }))).toBe(!['unknown', 'blocked'].includes(status))
    },
  )
})

const AGORA = new Date('2026-09-15T12:00:00.000Z')

function nota(overrides: Partial<RatingRow> & { decision?: Partial<NonNullable<RatingRow['dataUsageDecision']>>; license?: Partial<NonNullable<RatingRow['dataUsageDecision']>['sourceLicense']> }): RatingRow {
  const { decision, license, ...rest } = overrides
  return {
    ratingSource: 'imdb',
    ratingLabel: 'IMDb',
    scoreType: 'audience',
    ratingValue: 8.1,
    ratingScale: 10,
    ratingCount: 1000,
    fetchedAt: new Date(AGORA.getTime() - HORA),
    attributionText: 'Nota via IMDb',
    attributionUrl: 'https://www.imdb.com/title/tt0000001/',
    requiresAttribution: true,
    requiresLinkback: true,
    dataUsageDecision: {
      useCase: RATING_DISPLAY_USE_CASE,
      isCurrent: true,
      stage: 'approved_for_display',
      displayAllowed: true,
      territory: null,
      validFrom: new Date(AGORA.getTime() - 24 * HORA),
      validUntil: null,
      sourceLicense: {
        isCurrent: true,
        licenseStatus: 'third_party',
        displayAllowed: true,
        scoreAllowed: true,
        contentType: 'rating',
        ratingSourceKey: 'imdb',
        ...license,
      },
      ...decision,
    },
    ...rest,
  }
}

describe('nota exibivel: SQL x toPublicRating', () => {
  it('CONTROLE POSITIVO: a linha de referencia E exibivel na pagina', () => {
    expect(toPublicRating(nota({}), AGORA)).not.toBeNull()
  })

  it.each(['official', 'licensed', 'third_party', 'unknown', 'blocked'])(
    'licenca-mae %s: exibe exatamente quando o SQL aceita',
    (status) => {
      const exibe = toPublicRating(nota({ license: { licenseStatus: status } }), AGORA) !== null
      expect(exibe).toBe(DISPLAYABLE_LICENSE_STATUSES.includes(status))
    },
  )

  it.each([
    [null, true],
    [RATING_DISPLAY_TERRITORY, true],
    ['PT', false],
  ])('territorio da decisao %s -> exibe %s', (territorio, esperado) => {
    expect(toPublicRating(nota({ decision: { territory: territorio } }), AGORA) !== null).toBe(esperado)
  })

  it('o caso de uso e o do SQL', () => {
    expect(toPublicRating(nota({ decision: { useCase: 'outro_uso' } }), AGORA)).toBeNull()
  })

  it.each(Object.entries(RATING_STALE_POLICY))(
    'frescor de %s: a fronteira de expiracao e a mesma que o SQL usa',
    (fonte, politica) => {
      const expiraMs = politica.expireAfterHours * HORA
      const base = { ratingSource: fonte, license: { ratingSourceKey: fonte } }
      expect(toPublicRating(nota({ ...base, fetchedAt: new Date(AGORA.getTime() - expiraMs + 1) }), AGORA)).not.toBeNull()
      expect(toPublicRating(nota({ ...base, fetchedAt: new Date(AGORA.getTime() - expiraMs) }), AGORA)).toBeNull()
    },
  )
})

describe('indexavel e titulo', () => {
  it('os tipos suspensos sao os mesmos da valvula da pagina', () => {
    expect([...SUSPENDED_INDEX_KINDS].sort()).toEqual([...SUSPENDED_PAGE_TYPES].sort())
  })

  it('o titulo traduzido conta nos MESMOS idiomas publicados', () => {
    expect([...COVERAGE_TITLE_LANGUAGES]).toEqual([...PUBLISHED_LOCALES])
  })
})

describe('o SQL da cobertura so LE', () => {
  it.each(COVERAGE_KINDS)('%s: nenhum verbo de escrita e so o parametro $1', (tipo) => {
    const sql = coverageSql(tipo)
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i)
    expect([...new Set(sql.match(/\$\d+/g) ?? [])]).toEqual(tipo === 'movie' || tipo === 'tv' ? ['$1'] : tipo === 'person' ? [] : [])
  })

  it('filme e serie saem por idioma original; os demais so com o total', () => {
    expect(coverageSql('movie')).toContain('GROUPING SETS')
    expect(coverageSql('tv')).toContain('GROUPING SETS')
    for (const tipo of ['season', 'episode', 'person'] as const) expect(coverageSql(tipo)).not.toContain('GROUPING SETS')
  })
})
