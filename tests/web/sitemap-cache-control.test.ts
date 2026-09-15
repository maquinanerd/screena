/**
 * sitemap-cache-control.test.ts — os sitemaps dizem a borda por quanto tempo
 * guardar, e a falha nunca e guardada.
 *
 * O DEFEITO (auditoria de SEO, 11/09/2026, M2): nenhum `Cache-Control`, borda
 * `DYNAMIC`, 11,8 a 19,6 s por arquivo a cada leitura.
 *
 * As rotas nao sao chamadas aqui DE PROPOSITO: chama-las abriria o cliente do
 * banco, e o `.env` local aponta para producao. O comportamento e provado na
 * funcao pura, e a ligacao das rotas, na fonte.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DEGRADED_SITEMAP_CACHE_CONTROL,
  NEWS_SITEMAP_CACHE_CONTROL,
  SITEMAP_CACHE_CONTROL,
  sitemapCacheControl,
} from '../../apps/web/src/lib/sitemap-cache-control'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

function route(...segments: string[]): string {
  return readSourceWithoutComments(path.join(REPO_ROOT, 'apps', 'web', 'app', ...segments, 'route.ts'))
}

describe('Cache-Control dos sitemaps', () => {
  it('(1) indice e shard: borda por 15 min, copia anterior enquanto refaz; navegador sempre revalida', () => {
    expect(sitemapCacheControl('sitemap', false)).toBe(SITEMAP_CACHE_CONTROL)
    expect(SITEMAP_CACHE_CONTROL).toMatch(/s-maxage=900/)
    expect(SITEMAP_CACHE_CONTROL).toMatch(/stale-while-revalidate=\d+/)
    expect(SITEMAP_CACHE_CONTROL).toMatch(/max-age=0/)
  })

  it('(2) noticias: janela mais curta, porque a lista de 48 h muda a cada materia', () => {
    expect(sitemapCacheControl('news', undefined)).toBe(NEWS_SITEMAP_CACHE_CONTROL)
    expect(NEWS_SITEMAP_CACHE_CONTROL).toMatch(/s-maxage=300/)
  })

  it('(3) o fail-closed de uma falha NUNCA fica na borda', () => {
    expect(sitemapCacheControl('sitemap', true)).toBe(DEGRADED_SITEMAP_CACHE_CONTROL)
    expect(sitemapCacheControl('news', true)).toBe('no-store')
  })

  it('(4) as tres rotas usam a regra — e passam adiante o sinal de falha', () => {
    expect(route('sitemap.xml')).toContain('sitemapCacheControl("sitemap", degraded)')
    expect(route('news-sitemap.xml')).toContain('sitemapCacheControl("news", degraded)')
    expect(route('sitemaps', '[shard]')).toContain('sitemapCacheControl("sitemap", result.degraded)')
  })
})
