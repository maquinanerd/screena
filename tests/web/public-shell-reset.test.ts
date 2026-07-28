import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrato do shell público — ATUALIZADO DELIBERADAMENTE para o design
 * canônico (Screen Screens v4, SHA-256 6936a341…), que substituiu o reset
 * neutro de julho/2026 com escopo humano explícito (superprompt do frontend
 * final). O guard não foi removido: ele passou a travar o NOVO contrato —
 * tokens do handoff presentes, fonte local, acessibilidade preservada e
 * AdSlot com as regras obrigatórias (rótulo + omissão por padrão).
 */

const ROOT = process.cwd()

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('shell público — design canônico', () => {
  const css = read('apps/web/app/globals.css')

  it('mantém Montserrat local (nunca Google Fonts)', () => {
    expect(css).toContain("url('/fonts/montserrat-latin-variable.woff2')")
    expect(css).toContain('font-weight: 100 900')
    expect(css).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i)
  })

  it('carrega os tokens do handoff (cores, radius, sombras, layout)', () => {
    // Paleta White Cinematic Editorial (06-COLOR-SYSTEM)
    expect(css).toContain('--c-bg-page: #fdfdfd')
    expect(css).toContain('--c-text-primary: #101010')
    expect(css).toContain('--c-border: #e3ded6')
    expect(css).toContain('--c-accent-movie: #f0443e')
    expect(css).toContain('--c-accent-series-dark: #395c42')
    // Radius sancionados (09) e sombras (7 tokens)
    expect(css).toContain('--r-card: 10px')
    expect(css).toContain('--r-media: 12px')
    expect(css).toContain('--sh-card: 0 3px 14px rgba(20, 18, 14, 0.05)')
    // Containers e ritmo (08)
    expect(css).toContain('--container-editorial: 1280px')
    expect(css).toContain('--section-rhythm: 56px')
    expect(css).toContain('--nav-height: 72px')
  })

  it('regras de contraste do inventário viram código (DD-02/03/04)', () => {
    // muted nunca vira corpo: existe só como token documentado
    expect(css).toMatch(/--c-text-muted: #9a958c;\s*\/\*[^*]*nunca corpo/i)
    // CTA de série usa o verde escuro (branco sobre verde claro falha AA)
    expect(css).toMatch(/\[data-vertical='series'\] \.btn--accent \{[^}]*--c-accent-series-dark/s)
    // amarelo editorial carrega texto escuro no ticker
    expect(css).toMatch(/\.ticker \{[^}]*--c-accent-editorial[^}]*--c-text-primary/s)
  })

  it('gradientes só em contexto de mídia/hero (DD-20), nunca decorativos soltos', () => {
    const gradientBlocks =
      css.match(/\.[a-z-]+(?:__[a-z-]+)?[^{]*\{[^}]*linear-gradient[^}]*\}/g) ?? []
    expect(gradientBlocks.length).toBeGreaterThan(0)
    for (const block of gradientBlocks) {
      // toda classe com gradiente é um SCRIM de mídia (hero, cards de
      // overlay, critic-band) ou uma CAPA de mídia (lista sem imagem própria)
      // — nunca decoração solta em superfície clara
      expect(block).toMatch(
        /scrim|nws-(?:feature__img|card__cover|rail__post)::after|art-byline__avatar|list-card__media--g/,
      )
    }
  })

  it('preserva os fundamentos de acessibilidade', () => {
    expect(css).toContain('.skip-link')
    expect(css).toContain('.visually-hidden')
    expect(css).toContain(':focus-visible')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).not.toMatch(/#main-content:focus\s*\{[^}]*outline\s*:\s*none/is)
  })

  it('AdSlot cumpre o contrato: rótulo obrigatório e omissão por padrão', () => {
    const adSlot = read('apps/web/app/_components/ad-slot.tsx')
    // Rótulo PUBLICIDADE sempre visível (25-ADVERTISEMENT-SLOTS)
    expect(adSlot).toContain('Publicidade')
    // Em produção sem configuração o slot é OMITIDO — sem propaganda falsa
    expect(adSlot).toMatch(/if \(adMode\(\) === 'omitted'\) return null/)
    // Placeholder só por flag pública explícita de dev/QA
    expect(adSlot).toContain("NEXT_PUBLIC_AD_SLOTS === 'placeholder'")
    // Nenhum anunciante fictício
    // Guard de anunciante ficticio: o arquivo continha 0x08 literais no
    // lugar do escape de word boundary (regex vacuo). Substring simples basta
    // e nao depende de word boundary.
    for (const marca of ['Netflix', 'Prime Video', 'Disney', 'advertiser']) {
      expect(adSlot).not.toContain(marca)
    }
  })
})
