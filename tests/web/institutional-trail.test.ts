/**
 * institutional-trail.test.ts — a trilha visivel e o `BreadcrumbList` das paginas
 * institucionais saem da MESMA lista de degraus.
 */

import { describe, expect, it } from 'vitest'

import { trailBreadcrumbJsonLd } from '../../apps/web/src/lib/institutional-trail'

describe('trailBreadcrumbJsonLd', () => {
  it('Inicio, os degraus, e o ultimo na canonical da pagina', () => {
    expect(
      trailBreadcrumbJsonLd(
        [
          { label: 'Autores', href: '/pt/autores/' },
          { label: 'Pablo Gameleira', href: null },
        ],
        'https://cinerie.com/',
        'https://cinerie.com/pt/autores/pablo-gameleira/',
      ),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://cinerie.com/pt/' },
        { '@type': 'ListItem', position: 2, name: 'Autores', item: 'https://cinerie.com/pt/autores/' },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Pablo Gameleira',
          item: 'https://cinerie.com/pt/autores/pablo-gameleira/',
        },
      ],
    })
  })

  it('sem canonical, o ultimo degrau sai sem endereco — nunca um inventado', () => {
    const jsonLd = trailBreadcrumbJsonLd([{ label: 'Sobre', href: null }], 'https://cinerie.com', null)
    expect(jsonLd.itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Início', item: 'https://cinerie.com/pt/' },
      { '@type': 'ListItem', position: 2, name: 'Sobre' },
    ])
  })
})
