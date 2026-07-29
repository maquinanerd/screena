/**
 * Testes do Google News sitemap.
 *
 * Cada caso aqui corresponde a uma regra do protocolo cuja violacao NAO produz
 * erro visivel: o arquivo continua "valido", e o efeito aparece semanas depois
 * como perda de elegibilidade. Por isso a janela, o teto e o namespace tem
 * teste proprio.
 */

import { describe, expect, it } from 'vitest'

import {
  NEWS_SITEMAP_MAX_URLS,
  planNewsSitemap,
  renderNewsSitemap,
  type NewsSitemapCandidate,
} from './news-sitemap.js'

const NOW = '2026-07-29T12:00:00.000Z'

function candidate(overrides: Partial<NewsSitemapCandidate> = {}): NewsSitemapCandidate {
  return {
    loc: 'https://cinerie.com/pt/noticias/materia/',
    title: 'Estudio confirma data de estreia',
    publishedAtIso: '2026-07-29T10:00:00.000Z',
    language: 'pt-BR',
    decision: 'index',
    ...overrides,
  }
}

describe('planNewsSitemap — janela de 48 horas', () => {
  it('materia dentro da janela entra', () => {
    const plan = planNewsSitemap([candidate()], NOW)
    expect(plan.entries).toHaveLength(1)
  })

  it('materia com mais de 48h e descartada', () => {
    // Incluir materia antiga nao "ajuda um pouco": faz o arquivo inteiro ser
    // tratado como de baixa qualidade.
    const plan = planNewsSitemap(
      [candidate({ publishedAtIso: '2026-07-27T09:00:00.000Z' })],
      NOW,
    )
    expect(plan.entries).toHaveLength(0)
    expect(plan.dropped.outsideWindow).toBe(1)
  })

  it('exatamente 48h ainda entra; um milissegundo depois, nao', () => {
    const noBorder = planNewsSitemap(
      [candidate({ publishedAtIso: '2026-07-27T12:00:00.000Z' })],
      NOW,
    )
    expect(noBorder.entries).toHaveLength(1)

    const past = planNewsSitemap(
      [candidate({ publishedAtIso: '2026-07-27T11:59:59.999Z' })],
      NOW,
    )
    expect(past.entries).toHaveLength(0)
  })

  it('materia AGENDADA (futuro) nao entra', () => {
    // Anunciar ao buscador uma URL que ainda nao deve ser publica e o mesmo
    // vazamento que o gate de publicacao existe para impedir.
    const plan = planNewsSitemap(
      [candidate({ publishedAtIso: '2026-07-29T18:00:00.000Z' })],
      NOW,
    )
    expect(plan.entries).toHaveLength(0)
    expect(plan.dropped.outsideWindow).toBe(1)
  })
})

describe('planNewsSitemap — elegibilidade e limites', () => {
  it('so materia `index` entra', () => {
    const plan = planNewsSitemap(
      [
        candidate({ decision: 'noindex' }),
        candidate({ decision: 'draft' }),
        candidate({ decision: 'blocked' }),
        candidate({ decision: 'stale' }),
      ],
      NOW,
    )
    expect(plan.entries).toHaveLength(0)
    expect(plan.dropped.notIndexable).toBe(4)
  })

  it('data invalida e descartada e CONTADA', () => {
    // Silenciar aqui faria o numero de URLs divergir sem explicacao.
    const plan = planNewsSitemap([candidate({ publishedAtIso: 'ontem' })], NOW)
    expect(plan.entries).toHaveLength(0)
    expect(plan.dropped.invalidDate).toBe(1)
  })

  it('acima do teto, corta as MAIS ANTIGAS', () => {
    // O arquivo e recusado acima de 1.000, nao truncado. Se ha corte, o que se
    // perde deve ser o mais velho — que ja esta perto de sair da janela.
    const many = Array.from({ length: NEWS_SITEMAP_MAX_URLS + 5 }, (_unused, index) =>
      candidate({
        loc: `https://cinerie.com/pt/noticias/m-${String(index)}/`,
        // index 0 e a mais recente; as ultimas sao as mais antigas.
        publishedAtIso: new Date(Date.parse(NOW) - index * 60_000).toISOString(),
      }),
    )
    const plan = planNewsSitemap(many, NOW)

    expect(plan.entries).toHaveLength(NEWS_SITEMAP_MAX_URLS)
    expect(plan.dropped.overLimit).toBe(5)
    expect(plan.entries[0]?.loc).toBe('https://cinerie.com/pt/noticias/m-0/')
    expect(plan.entries.some((entry) => entry.loc.endsWith('m-1004/'))).toBe(false)
  })

  it('ordena da mais recente para a mais antiga', () => {
    const plan = planNewsSitemap(
      [
        candidate({ loc: 'https://cinerie.com/a/', publishedAtIso: '2026-07-29T08:00:00.000Z' }),
        candidate({ loc: 'https://cinerie.com/b/', publishedAtIso: '2026-07-29T11:00:00.000Z' }),
      ],
      NOW,
    )
    expect(plan.entries.map((entry) => entry.loc)).toEqual([
      'https://cinerie.com/b/',
      'https://cinerie.com/a/',
    ])
  })

  it('instante de referencia invalido devolve vazio (fail-closed)', () => {
    // Sitemap de noticias vazio e valido; um com materia fora da janela
    // desqualifica o arquivo inteiro.
    const plan = planNewsSitemap([candidate()], 'nao-e-data')
    expect(plan.entries).toHaveLength(0)
    expect(plan.dropped.invalidDate).toBe(1)
  })
})

describe('renderNewsSitemap', () => {
  it('declara o namespace `news`', () => {
    // Sem ele o arquivo e lido como sitemap comum e as tags `news:*` sao
    // ignoradas em silencio — o pior desfecho, porque continua "valido".
    const xml = renderNewsSitemap(planNewsSitemap([candidate()], NOW).entries, 'Cinerie')
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"')
  })

  it('usa o codigo CURTO do idioma', () => {
    const xml = renderNewsSitemap(planNewsSitemap([candidate()], NOW).entries, 'Cinerie')
    expect(xml).toContain('<news:language>pt</news:language>')
    expect(xml).not.toContain('pt-BR</news:language>')
  })

  it('usa a data de PUBLICACAO', () => {
    // Trocar por data de modificacao faria uma correcao de virgula parecer
    // materia nova.
    const xml = renderNewsSitemap(planNewsSitemap([candidate()], NOW).entries, 'Cinerie')
    expect(xml).toContain('<news:publication_date>2026-07-29T10:00:00.000Z</news:publication_date>')
  })

  it('escapa titulo e URL', () => {
    const xml = renderNewsSitemap(
      planNewsSitemap(
        [
          candidate({
            title: 'Estreia & "polemica" <ao vivo>',
            loc: 'https://cinerie.com/pt/noticias/a?b=1&c=2',
          }),
        ],
        NOW,
      ).entries,
      'Cinerie & Co',
    )
    expect(xml).toContain('&amp;')
    expect(xml).toContain('&quot;')
    expect(xml).toContain('&lt;ao vivo&gt;')
    expect(xml).not.toMatch(/<news:title>[^<]*<ao vivo>/)
  })

  it('lista vazia produz urlset valido', () => {
    const xml = renderNewsSitemap([], 'Cinerie')
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(xml).toContain('</urlset>')
    expect(xml).not.toContain('<url>')
  })
})
