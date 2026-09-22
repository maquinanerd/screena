/**
 * titulo-sem-marca-duplicada.test.ts — a aba nunca diz "Cinerie | Cinerie".
 *
 * O layout raiz aplica o template `%s | Cinerie` a todo `title` de pagina. Tres
 * paginas ja escreviam a marca no proprio titulo, e a conferencia de producao de
 * 22/09/2026 mediu o resultado:
 *
 *   "Sobre a Cinerie | Cinerie"
 *   "Contato da Cinerie | Cinerie"
 *   "Pablo Gameleira: matérias na Cinerie | Cinerie"
 *
 * O conserto e `title.absolute`: o template do Next NAO se aplica a titulo
 * absoluto. Este arquivo chama o `generateMetadata` real de cada pagina e aplica o
 * template como o Next aplica — o que se mede e a string que iria para a aba.
 */

import { describe, expect, it, vi } from 'vitest'

import type { Metadata } from 'next'

vi.mock('../../../src/server/news-pages', () => ({
  getAuthorDirectoryData: async () => ({
    authors: [
      {
        slug: 'pablo-gameleira',
        name: 'Pablo Gameleira',
        href: '/pt/autores/pablo-gameleira/',
        articleCount: 381,
        latestDateIso: '2026-09-14',
        latestDateLabel: '14 de setembro de 2026',
        articles: [],
      },
    ],
  }),
}))

/** O template do layout raiz (`apps/web/app/layout.tsx`). */
const TEMPLATE = '%s | Cinerie'

/** A string da aba, como o Next monta: `absolute` ignora o template; string o recebe. */
function tituloDaAba(title: Metadata['title']): string {
  if (typeof title === 'string') return TEMPLATE.replace('%s', title)
  if (title !== null && typeof title === 'object' && 'absolute' in title && title.absolute) {
    return title.absolute
  }
  throw new Error(`forma de title nao prevista: ${JSON.stringify(title)}`)
}

function contaMarca(aba: string): number {
  return aba.split('Cinerie').length - 1
}

describe('titulo da aba sem a marca duplicada', () => {
  it('(1) Sobre', async () => {
    const { generateMetadata } = await import('../sobre/page')
    const aba = tituloDaAba(generateMetadata().title)
    expect(aba).toBe('Sobre a Cinerie')
    expect(contaMarca(aba)).toBe(1)
  })

  it('(2) Contato', async () => {
    const { generateMetadata } = await import('../contato/page')
    const aba = tituloDaAba(generateMetadata().title)
    expect(aba).toBe('Contato da Cinerie')
    expect(contaMarca(aba)).toBe(1)
  })

  it('(3) Autor', async () => {
    const { generateMetadata } = await import('../autores/[slug]/page')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'pablo-gameleira' }) })
    const aba = tituloDaAba(meta.title)
    expect(aba).toBe('Pablo Gameleira: matérias na Cinerie')
    expect(contaMarca(aba)).toBe(1)
  })

  it('(4) CONTROLE: com o titulo em string, o template duplicaria a marca', () => {
    // Prova que o instrumento mede: e exatamente o que producao mostrava.
    expect(tituloDaAba('Sobre a Cinerie')).toBe('Sobre a Cinerie | Cinerie')
    expect(contaMarca(tituloDaAba('Sobre a Cinerie'))).toBe(2)
  })
})
