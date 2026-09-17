/**
 * home-hero-srcset.test.ts — o hero entrega a largura que a tela usa.
 *
 * O DEFEITO QUE ISTO TRAVA (auditoria de SEO, 11/09/2026): o hero da home servia
 * a arte em `w1280` fixo a qualquer tela; no celular, `w780` pesava 165 KB a menos
 * no slide medido.
 *
 * O cuidado que importa alem do peso: o `srcset` precisa ser da MESMA arte que o
 * `src`. Uma lista que misturasse backdrop e poster faria a tela trocar de imagem
 * ao mudar de largura.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveHeroImage, resolveHeroImageSrcSet } from '../../apps/web/src/lib/home-hero-presenter'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const TMDB = 'https://image.tmdb.org/t/p'

describe('srcset do hero', () => {
  it('(1) com backdrop: 780w e 1280w do BACKDROP', () => {
    expect(resolveHeroImageSrcSet('/bd.jpg', '/ps.jpg')).toBe(
      `${TMDB}/w780/bd.jpg 780w, ${TMDB}/w1280/bd.jpg 1280w`,
    )
  })

  it('(2) sem backdrop: 500w e 780w do POSTER', () => {
    expect(resolveHeroImageSrcSet(null, '/ps.jpg')).toBe(
      `${TMDB}/w500/ps.jpg 500w, ${TMDB}/w780/ps.jpg 780w`,
    )
  })

  it('(3) sem arte, ou com path local, nao ha srcset', () => {
    expect(resolveHeroImageSrcSet(null, null)).toBeNull()
    expect(resolveHeroImageSrcSet('/media/tmdb/x.jpg', null)).toBeNull()
  })

  it.each([
    ['/bd.jpg', '/ps.jpg'],
    [null, '/ps.jpg'],
  ] as const)('(4) o maior candidato do srcset E o src de sempre (backdrop=%s)', (backdrop, poster) => {
    // Mesma arte, e o src continua sendo o fallback exato de antes.
    const srcset = resolveHeroImageSrcSet(backdrop, poster) ?? ''
    const maior = srcset.split(',').map((c) => c.trim().split(' ')[0]).pop()
    expect(maior).toBe(resolveHeroImage(backdrop, poster))
  })

  it('(5) o carrossel entrega o srcset com sizes de largura cheia', () => {
    const fonte = readSourceWithoutComments(
      path.join(REPO_ROOT, 'apps', 'web', 'app', '_components', 'home-hero-carousel.tsx'),
    )
    expect(fonte).toContain('srcSet={slide.imageSrcSet ?? undefined}')
    expect(fonte).toContain('sizes="100vw"')
  })
})
