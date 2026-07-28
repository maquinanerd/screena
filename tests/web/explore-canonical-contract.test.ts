import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const PAGE_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/page.tsx')
const RAILS_PATH = resolve(ROOT, 'apps/web/app/_components/discover-rails.tsx')
const CW_PATH = resolve(ROOT, 'apps/web/app/_components/continue-watching.tsx')
const CSS_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/explore-canonical.module.css')

const pageSource = readFileSync(PAGE_PATH, 'utf8')
const railsSource = readFileSync(RAILS_PATH, 'utf8')
const cwSource = readFileSync(CW_PATH, 'utf8')

describe('contrato canônico da rota Explorar (tela 11)', () => {
  it('segue a ordem canônica: busca → ad → rails filtráveis com seções fixas', () => {
    const order = [
      'className="disc-search"',
      '<AdSlot format="leaderboard" slotId="explore-top" />',
      '<DiscoverFilterableRails',
      'className="disc-feature disc-section"',
      '<ContinueWatching />',
      'className="disc-agenda"',
      'disc-soon-title',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = pageSource.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('busca é um form REAL para /pt/busca/ (nunca barra decorativa)', () => {
    expect(pageSource).toContain('action="/pt/busca/"')
    expect(pageSource).toContain('method="get"')
    expect(pageSource).toContain('name="q"')
  })

  it('mantém a agenda real e estados honestos', () => {
    expect(pageSource).toContain('getHomeUpcomingMovies({ limit: UPCOMING_SOURCE_LIMIT })')
    expect(pageSource).toContain('takeUpcomingWeek(')
    expect(pageSource).toContain('upcomingWeek.map')
    expect(pageSource).toContain('{movie.weekday}')
    expect(pageSource).toContain('Nenhum lançamento publicado')
    // Destaque só com entidade real; watchlist é o CardBookmark real
    expect(pageSource).toContain('featured !== null ?')
    expect(pageSource).toContain('<CardBookmark')
  })

  it('não inventa métricas: sem growth 24h, sem contagem de salvos, sem nota', () => {
    expect(pageSource).not.toMatch(/24h|crescimento|\+\d+%|Tomatometer|AggregateRating/i)
    expect(railsSource).not.toMatch(/24h|crescimento|\+\d+%|votes/i)
    // Rótulos honestos documentados nos trilhos
    expect(railsSource).toContain('Mais populares no catálogo agora')
    expect(railsSource).toContain('Mais avaliados no catálogo')
  })

  it('Continuar assistindo é fronteira autenticada real (/api/me/**)', () => {
    expect(cwSource).toContain("'use client'")
    expect(cwSource).toContain('/api/auth/session')
    expect(cwSource).toContain('/api/me/library?status=watching')
    expect(cwSource).toContain('/api/me/series-progress/')
    expect(cwSource).toContain('/api/catalog/summary')
    expect(cwSource).not.toMatch(/localStorage|sessionStorage/)
    // Anônimo → login real, nunca estado fake
    expect(cwSource).toContain('/pt/entrar/')
  })

  it('preserva metadata, indexabilidade e os dois schemas', () => {
    expect(pageSource).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(pageSource).toContain('canonicalPublicUrl(EXPLORE_PATH)')
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]CollectionPage['"]/)
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(pageSource.match(/application\/ld\+json/g)).toHaveLength(2)
  })

  it('um H1 por página (vive nos rails) e sem CSS module da composição antiga', () => {
    expect(existsSync(CSS_PATH)).toBe(false)
    expect(pageSource.match(/<h1[\s>]/g)).toBeNull()
    expect(railsSource.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(pageSource).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
  })
})
