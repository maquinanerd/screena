import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const PAGE_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/page.tsx')
const CSS_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/explore-canonical.module.css')

const pageSource = readFileSync(PAGE_PATH, 'utf8')

describe('contrato textual da rota Explorar', () => {
  it('mantém a agenda real e o empty state honesto', () => {
    expect(pageSource).toContain('getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT })')
    expect(pageSource).toContain('takeUpcomingWeek(')
    expect(pageSource).toContain('upcomingMovies.map')
    expect(pageSource).toContain('{movie.weekday}')
    expect(pageSource).toContain('{movie.date}')
    expect(pageSource).toContain('Nenhum lançamento publicado')
  })

  it('oferece somente links para áreas públicas existentes', () => {
    for (const destination of [
      'MOVIES_INDEX_PATH',
      'SERIES_INDEX_PATH',
      'PEOPLE_INDEX_PATH',
      'NEWS_INDEX_PATH',
    ]) {
      expect(pageSource).toContain(`href={${destination}}`)
    }
    expect(pageSource).not.toMatch(/<form|type="search"|watchlist|continuar assistindo/i)
  })

  it('preserva metadata, indexabilidade e os dois schemas', () => {
    expect(pageSource).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(pageSource).toContain('canonicalPublicUrl(EXPLORE_PATH)')
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]CollectionPage['"]/)
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(pageSource.match(/application\/ld\+json/g)).toHaveLength(2)
  })

  it('não mantém anúncios, imagens ou CSS da composição anterior', () => {
    expect(pageSource).not.toMatch(/AdSlot|<img|styles\./)
    expect(existsSync(CSS_PATH)).toBe(false)
    expect(pageSource.match(/<h1[\s>]/g)).toHaveLength(1)
  })
})
