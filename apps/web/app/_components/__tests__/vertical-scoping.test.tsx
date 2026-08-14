/**
 * vertical-scoping.test.tsx — `/pt/filmes` mostra só filmes. `/pt/series` só
 * séries. A home é a união.
 *
 * ============ COMO ESTE ARQUIVO MEDE ============
 *
 * `visibleText()` remove as TAGS INTEIRAS, com atributos. Um título que morasse
 * em `aria-label`, `data-*` ou `alt` desaparece dessa string e a asserção
 * reprova. É deliberado: na #165 quatro asserções passaram pelo motivo errado
 * porque casavam markup CRU, onde atributo e conteúdo são indistinguíveis.
 *
 * ============ POR QUE ESTADO VAZIO NÃO PROVA NADA ============
 *
 * "Destaques de hoje" mostrava "Ainda não há destaques de filmes publicados" em
 * `/pt/filmes` e "...de séries" em `/pt/series`, e isso PARECIA filtro. Com zero
 * matéria publicada, uma seção filtrada e uma seção que só troca o texto são
 * indistinguíveis de fora. Todas as fixtures aqui têm conteúdo dos DOIS tipos —
 * é o único estado em que a diferença aparece.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomeEditorialHighlights } from '../home-editorial-highlights'
import { PopularThisWeek, type PopularRankingPanel } from '../popular-this-week'
import type { HomeEditorialHighlights as Highlights } from '../../../src/lib/home-editorial-presenter'
import { restrictEditorialHighlights } from '../../../src/lib/home-editorial-presenter'
import { RANKING_TABS } from '../../../src/lib/popular-rankings'
import {
  filterNewsCardsByVertical,
  type NewsCardView,
} from '../../../src/lib/news-presenter'

/** Texto que o leitor VÊ: sem tags, sem atributos. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const MOVIE_ARTICLE_TITLE = 'Retrospectiva do diretor em cartaz'
const SERIES_ARTICLE_TITLE = 'A temporada final estreou ontem'

const HIGHLIGHTS: Highlights = {
  movies: [
    {
      articleId: '1',
      slug: 'retrospectiva',
      href: '/pt/noticias/retrospectiva/',
      vertical: 'movies',
      eyebrow: 'Especial',
      title: MOVIE_ARTICLE_TITLE,
      deck: 'Um panorama da filmografia.',
      imagePath: null,
      imageAlt: MOVIE_ARTICLE_TITLE,
      publishedAtIso: '2026-08-12T10:00:00.000Z',
    },
  ],
  series: [
    {
      articleId: '2',
      slug: 'temporada-final',
      href: '/pt/noticias/temporada-final/',
      vertical: 'series',
      eyebrow: 'Notícia',
      title: SERIES_ARTICLE_TITLE,
      deck: 'O que ficou em aberto.',
      imagePath: null,
      imageAlt: SERIES_ARTICLE_TITLE,
      publishedAtIso: '2026-08-12T11:00:00.000Z',
    },
  ],
}

function renderHighlights(vertical: 'home' | 'movies' | 'series'): string {
  const restricted =
    vertical === 'home' ? HIGHLIGHTS : restrictEditorialHighlights(HIGHLIGHTS, vertical)
  return visibleText(
    renderToStaticMarkup(
      <HomeEditorialHighlights
        headingId="t"
        highlights={restricted}
        initialVertical={vertical === 'series' ? 'series' : 'movies'}
        verticals={vertical === 'home' ? ['movies', 'series'] : [vertical]}
      />,
    ),
  )
}

describe('Destaques de hoje — a matéria da outra vertical não existe na página', () => {
  it('(1) /pt/filmes mostra a matéria de filme e NÃO a de série', () => {
    const text = renderHighlights('movies')
    expect(text).toContain(MOVIE_ARTICLE_TITLE)
    expect(text).not.toContain(SERIES_ARTICLE_TITLE)
  })

  it('(2) /pt/series mostra a matéria de série e NÃO a de filme', () => {
    const text = renderHighlights('series')
    expect(text).toContain(SERIES_ARTICLE_TITLE)
    expect(text).not.toContain(MOVIE_ARTICLE_TITLE)
  })

  /**
   * CONTROLE POSITIVO. Sem ele, um bug que zerasse a seção inteira passaria nos
   * dois testes acima — "não contém a outra" é trivialmente verdadeiro quando
   * não contém nada.
   */
  it('(3) CONTROLE POSITIVO: a home é a união e mostra as DUAS', () => {
    const both = renderToStaticMarkup(
      <>
        <HomeEditorialHighlights
          headingId="a"
          highlights={HIGHLIGHTS}
          initialVertical="movies"
          verticals={['movies', 'series']}
        />
        <HomeEditorialHighlights
          headingId="b"
          highlights={HIGHLIGHTS}
          initialVertical="series"
          verticals={['movies', 'series']}
        />
      </>,
    )
    const text = visibleText(both)
    expect(text).toContain(MOVIE_ARTICLE_TITLE)
    expect(text).toContain(SERIES_ARTICLE_TITLE)
  })

  /**
   * O convite também é vazamento: uma tab "Séries" em `/pt/filmes` oferece a
   * outra vertical mesmo quando a lista dela chega vazia.
   */
  it('(4) NEGATIVO: a página de uma vertical não oferece a tab da outra', () => {
    expect(renderHighlights('movies')).not.toContain('Séries')
    expect(renderHighlights('series')).not.toContain('Filmes')
    // Na home as duas tabs continuam lá — ela é a união.
    const home = renderHighlights('home')
    expect(home).toContain('Filmes')
    expect(home).toContain('Séries')
  })

  it('(5) a lista da outra vertical não viaja nem no HTML', () => {
    const html = renderToStaticMarkup(
      <HomeEditorialHighlights
        headingId="t"
        highlights={restrictEditorialHighlights(HIGHLIGHTS, 'movies')}
        initialVertical="movies"
        verticals={['movies']}
      />,
    )
    // Markup CRU aqui é o ponto: o vazamento que interessa é o payload, não só
    // o que está visível.
    expect(html).not.toContain('temporada-final')
  })

  /**
   * As DUAS barreiras são cobradas separadamente, de propósito.
   *
   * Quando o controle negativo foi rodado (quebrar o filtro no código de
   * verdade), `restrictEditorialHighlights` pôde virar identidade sem UM teste
   * ficar vermelho: os testes acima passam a prop `verticals`, e o componente
   * já não renderiza o painel da outra vertical — a barreira do componente
   * mascarava a barreira do dado. Um teste que só reprova quando as DUAS caem
   * junto não guarda nenhuma das duas. Este cobra a do servidor sozinha.
   */
  it('(5b) a barreira do SERVIDOR sozinha: a lista da outra vertical vem vazia', () => {
    const forMovies = restrictEditorialHighlights(HIGHLIGHTS, 'movies')
    expect(forMovies.movies).toHaveLength(1)
    expect(forMovies.series).toEqual([])

    const forSeries = restrictEditorialHighlights(HIGHLIGHTS, 'series')
    expect(forSeries.series).toHaveLength(1)
    expect(forSeries.movies).toEqual([])
  })
})

// ---------------------------------------------------------------- ranking

function panelsFor(vertical: 'home' | 'movies' | 'series'): PopularRankingPanel[] {
  return RANKING_TABS[vertical].map((tab, index) => ({
    tab,
    // Uma lista DIFERENTE por aba: se o componente ignorasse a aba ativa, o
    // texto renderizado seria o mesmo nas três.
    items:
      tab.slug === 'em-cartaz' || tab.slug === 'cinema'
        ? []
        : [
            {
              id: `${vertical}:${tab.slug}`,
              rank: 1,
              title: `Título de ${tab.label}`,
              href: `/pt/${vertical === 'series' ? 'series' : 'filmes'}/t-${index}/`,
              posterUrl: null,
            },
          ],
  }))
}

function renderRanking(
  vertical: 'home' | 'movies' | 'series',
  activeSlug: string,
): string {
  return visibleText(
    renderToStaticMarkup(
      <PopularThisWeek
        headingId="pop"
        initialSlug={activeSlug as PopularRankingPanel['tab']['slug']}
        panels={panelsFor(vertical)}
      />,
    ),
  )
}

describe('Popular essa semana — a aba ativa manda na lista', () => {
  it('(6) /pt/filmes expõe EXATAMENTE Em cartaz · Streaming · Clássicos', () => {
    const text = renderRanking('movies', 'em-cartaz')
    for (const label of ['Em cartaz', 'Streaming', 'Clássicos']) {
      expect(text).toContain(label)
    }
    expect(text).not.toContain('Séries')
    expect(text).not.toContain('No ar')
    expect(text).not.toContain('Novas temporadas')
  })

  it('(7) /pt/series expõe EXATAMENTE No ar · Streaming · Novas temporadas', () => {
    const text = renderRanking('series', 'no-ar')
    for (const label of ['No ar', 'Streaming', 'Novas temporadas']) {
      expect(text).toContain(label)
    }
    expect(text).not.toContain('Em cartaz')
    expect(text).not.toContain('Clássicos')
  })

  /**
   * A TROCA. `?ranking=` é resolvido no servidor, então renderizar a mesma seção
   * com dois `initialSlug` é o mesmo caminho que um refresh com o link
   * compartilhado percorre — e a lista tem de mudar de verdade.
   */
  it('(8) trocar a aba ativa troca a LISTA, não só o estilo', () => {
    const streaming = renderRanking('movies', 'streaming')
    const classicos = renderRanking('movies', 'classicos')

    expect(streaming).toContain('Título de Streaming')
    expect(streaming).not.toContain('Título de Clássicos')
    expect(classicos).toContain('Título de Clássicos')
    expect(classicos).not.toContain('Título de Streaming')
  })

  it('(9) aba vazia mantém a seção, as abas e a mensagem — nunca some', () => {
    const text = renderRanking('movies', 'em-cartaz')
    expect(text).toContain('Nada por aqui esta semana.')
    // A seção e o resto das abas continuam na tela.
    expect(text).toContain('Popular essa semana')
    expect(text).toContain('Streaming')
    expect(text).toContain('Clássicos')
  })

  it('(10) "Ver tudo" segue a aba ativa (não é link fixo)', () => {
    const html = (slug: string) =>
      renderToStaticMarkup(
        <PopularThisWeek
          headingId="pop"
          initialSlug={slug as PopularRankingPanel['tab']['slug']}
          panels={panelsFor('movies')}
        />,
      )
    const seeAll = (markup: string) =>
      /<a class="see-all" href="([^"]+)"/.exec(markup)?.[1] ?? null

    expect(seeAll(html('streaming'))).toBe('/pt/onde-assistir/')
    expect(seeAll(html('classicos'))).toBe('/pt/filmes/')
  })

  it('(11) o número do rank entra no nome acessível (o card não tem texto)', () => {
    const text = renderRanking('movies', 'streaming')
    expect(text).toContain('1. Título de Streaming')
  })

  it('(12) NEGATIVO: "Bilheteria" e "Clássicas" não aparecem em vertical nenhuma', () => {
    for (const vertical of ['home', 'movies', 'series'] as const) {
      for (const tab of RANKING_TABS[vertical]) {
        const text = renderRanking(vertical, tab.slug)
        expect(text).not.toContain('Bilheteria')
        expect(text).not.toContain('Clássicas')
      }
    }
  })
})

// ------------------------------------------------------------------ notícias

const newsCard = (
  slug: string,
  title: string,
  linkedEntityTypes: Array<'movie' | 'tv' | 'person'>,
): NewsCardView => ({
  slug,
  title,
  href: `/pt/noticias/${slug}/`,
  category: null,
  dateIso: '2026-08-12T10:00:00.000Z',
  dateLabel: '12 de agosto de 2026',
  author: null,
  deck: null,
  readTimeLabel: null,
  image: null,
  linkedEntityTypes,
})

describe('Notícias & entrevistas — a seção compartilhada também segue a vertical', () => {
  const cards = [
    newsCard('so-filme', 'Só de filme', ['movie']),
    newsCard('so-serie', 'Só de série', ['tv']),
    newsCard('hibrida', 'Cita filme e série', ['movie', 'tv']),
    newsCard('so-pessoa', 'Entrevista sem título vinculado', ['person']),
    newsCard('sem-vinculo', 'Sem vínculo nenhum', []),
  ]

  it('(13) /pt/filmes lista a de filme e a híbrida — nunca a exclusiva de série', () => {
    const titles = filterNewsCardsByVertical(cards, 'movies').map((card) => card.title)
    expect(titles).toEqual(['Só de filme', 'Cita filme e série'])
  })

  it('(14) /pt/series lista a de série e a híbrida — nunca a exclusiva de filme', () => {
    const titles = filterNewsCardsByVertical(cards, 'series').map((card) => card.title)
    expect(titles).toEqual(['Só de série', 'Cita filme e série'])
  })

  it('(15) CONTROLE POSITIVO: a home é a união e lista as cinco', () => {
    expect(filterNewsCardsByVertical(cards, 'home')).toHaveLength(cards.length)
  })

  /**
   * Sem sinal persistido não há vertical. Classificar por palavra no título ou
   * por `articles.category` (texto livre, sem vocabulário controlado) é
   * exatamente a heurística que a regra proíbe — então a matéria sem vínculo
   * fica FORA das duas, nunca "na de filmes por padrão".
   */
  it('(16) NEGATIVO: matéria sem vínculo classificável não entra em vertical nenhuma', () => {
    for (const vertical of ['movies', 'series'] as const) {
      const slugs = filterNewsCardsByVertical(cards, vertical).map((card) => card.slug)
      expect(slugs).not.toContain('so-pessoa')
      expect(slugs).not.toContain('sem-vinculo')
    }
  })
})
