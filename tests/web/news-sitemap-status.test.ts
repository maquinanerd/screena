/**
 * news-sitemap-status.test.ts — o /news-sitemap.xml diz no STATUS o que o XML
 * não tem como dizer.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * MEDIDO no Search Console em 29/09/2026, com a redação parada havia 15 dias:
 *
 *     "O sitemap pode ser lido, mas contém erros"
 *     Tag XML ausente — Linha 4 · tag pai: urlset · tag: url
 *     Páginas encontradas: 0
 *
 * A rota respondia 200 com `<urlset>` sem nenhum filho. O XSD do protocolo
 * declara `url` sem `minOccurs`, e o padrão de `minOccurs` é 1 — ou seja, aquele
 * documento era inválido, não "válido e vazio". O formato simplesmente não tem
 * estado vazio; a resposta HTTP tem.
 *
 * Aqui se trava o mapeamento dos TRÊS desfechos, inclusive o 503 do banco fora,
 * que não dá para exercitar pela rota sem um PostgreSQL de verdade.
 */

import { describe, expect, it } from 'vitest'

import { GET } from '../../apps/web/app/news-sitemap.xml/route'
import { newsSitemapResponse } from '../../apps/web/src/lib/news-sitemap-response'
import {
  DEGRADED_SITEMAP_CACHE_CONTROL,
  NEWS_SITEMAP_CACHE_CONTROL,
} from '../../apps/web/src/lib/sitemap-cache-control'

describe('/news-sitemap.xml: status por desfecho', () => {
  it('(1) há matéria na janela: 200, XML, cache curto', () => {
    const r = newsSitemapResponse({
      kind: 'urlset',
      xml: '<urlset><url><loc>x</loc></url></urlset>',
      contentType: 'application/xml; charset=utf-8',
    })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('application/xml; charset=utf-8')
    expect(r.headers['cache-control']).toBe(NEWS_SITEMAP_CACHE_CONTROL)
    expect(r.body).toContain('<url>')
  })

  it('(2) nada a anunciar: 404 — nunca um urlset sem url', () => {
    const r = newsSitemapResponse({ kind: 'no-entries' })
    expect(r.status).toBe(404)
    // O que o Google reprovou não pode voltar por outro caminho.
    expect(r.body).not.toContain('<urlset')
    expect(r.body).not.toContain('<url>')
    // Janela curta: a primeira matéria publicada aparece em minutos.
    expect(r.headers['cache-control']).toBe(NEWS_SITEMAP_CACHE_CONTROL)
  })

  it('(3) banco fora: 503 com Retry-After, e a falha não fica na borda', () => {
    // 503 e não 404: "não dá para saber" preserva o estado anterior no buscador.
    // O 200 com lista vazia que existia antes AFIRMAVA zero matéria — e o próprio
    // código já dizia que ausência parece despublicação.
    const r = newsSitemapResponse({ kind: 'unavailable' })
    expect(r.status).toBe(503)
    expect(r.headers['retry-after']).toBe('300')
    expect(r.headers['cache-control']).toBe(DEGRADED_SITEMAP_CACHE_CONTROL)
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('(4) os três desfechos têm status DIFERENTES entre si', () => {
    // O defeito era justamente os três colapsarem em 200 + arquivo vazio.
    const status = (['urlset', 'no-entries', 'unavailable'] as const).map((kind) =>
      newsSitemapResponse(
        kind === 'urlset' ? { kind, xml: '<urlset/>', contentType: 'application/xml' } : { kind },
      ).status,
    )
    expect(new Set(status).size).toBe(3)
  })

  it('(5) na rota real, ambiente que não indexa (este) responde 404', async () => {
    // Mesmo precedente do /llms.txt: não se apresenta em vez de se apresentar
    // vazio. Não toca no banco — o gate de ambiente decide antes.
    const resposta = await GET()
    expect(resposta.status).toBe(404)
    expect(await resposta.text()).not.toContain('<urlset')
  })
})
