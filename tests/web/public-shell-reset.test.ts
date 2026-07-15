import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

const REMOVED_VISUAL_FILES = [
  'apps/web/app/_components/ad-slot.tsx',
  'apps/web/app/_components/cast-strip.tsx',
  'apps/web/app/_components/category-home.module.css',
  'apps/web/app/_components/category-home.tsx',
  'apps/web/app/_components/certification-badge.tsx',
  'apps/web/app/_components/coming-soon-rail.tsx',
  'apps/web/app/_components/entity-card.tsx',
  'apps/web/app/_components/hero-carousel.tsx',
  'apps/web/app/_components/news-card.tsx',
  'apps/web/app/_components/rating-stars.tsx',
  'apps/web/app/_components/related-news-section.tsx',
  'apps/web/app/_components/screen-logo.tsx',
  'apps/web/src/lib/canonical-ad-inventory.ts',
  'apps/web/src/lib/canonical-image-inventory.ts',
  'apps/web/src/lib/home-placeholder-governance.ts',
] as const

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('shell público neutro', () => {
  const css = read('apps/web/app/globals.css')

  it('mantém Montserrat local sobre superfícies brancas', () => {
    expect(css).toContain("url('/fonts/montserrat-latin-variable.woff2')")
    expect(css).toContain('font-weight: 100 900')
    expect(css).toContain('background: #fff')
    expect(css).toContain('color: #111')
    expect(css).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i)
  })

  it('não carrega linguagem visual cinematográfica ou decorativa', () => {
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/i)
    expect(css).not.toMatch(/box-shadow|backdrop-filter/i)
    expect(css).not.toMatch(/\.sc-hero|\.entity-card|\.news-card|\.ad-slot/)
    expect(css).not.toMatch(/--accent-|--bg-/)
  })

  it('preserva os fundamentos de acessibilidade', () => {
    expect(css).toContain('.skip-link')
    expect(css).toContain('.visually-hidden')
    expect(css).toContain(':focus-visible')
    expect(css).not.toMatch(/#main-content:focus\s*\{[^}]*outline\s*:\s*none/is)
  })

  it('remove componentes e inventários pertencentes apenas ao design anterior', () => {
    for (const relativePath of REMOVED_VISUAL_FILES) {
      expect(existsSync(path.join(ROOT, relativePath)), relativePath).toBe(false)
    }
  })
})
