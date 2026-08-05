import { describe, expect, it } from 'vitest'

import {
  authorInitials,
  heroCropOf,
  sectionCrumbLabel,
} from '../../apps/web/src/lib/article-hero'

/**
 * Decisoes puras do hero da materia (tela 05).
 *
 * Sao as tres regras que decidem o que a capa mostra, o que o avatar mostra e o
 * que a trilha mostra quando o dado chega imperfeito — e o dado editorial chega
 * imperfeito o tempo todo, porque parte dele e texto livre de feed RSS.
 */

describe('heroCropOf', () => {
  it('classifica pela proporcao declarada', () => {
    expect(heroCropOf(1280, 720)).toBe('landscape') // 16:9
    expect(heroCropOf(1600, 900)).toBe('landscape')
    expect(heroCropOf(1200, 900)).toBe('standard') // 4:3
    expect(heroCropOf(1000, 1000)).toBe('portrait') // quadrado
    expect(heroCropOf(800, 1200)).toBe('portrait') // retrato
  })

  it('o fallback do presenter (1280x720) cai no comportamento NEUTRO', () => {
    /*
     * `heroImageAsset` usa `HERO_IMAGE_SPEC` (1280x720) quando o asset governado
     * nao esta vinculado. Se esse caso caisse numa ancora deslocada, estariamos
     * recortando a foto com base num numero que ninguem mediu. Caindo em
     * `landscape` — a ancora neutra —, a regra so desloca alguma coisa quando ha
     * dimensao REAL de arquivo alto ou quadrado.
     */
    expect(heroCropOf(1280, 720)).toBe('landscape')
  })

  it('dimensao impossivel nao inventa recorte', () => {
    for (const [w, h] of [
      [0, 900],
      [1600, 0],
      [-1600, 900],
      [Number.NaN, 900],
      [Number.POSITIVE_INFINITY, 900],
    ] as const) {
      expect(heroCropOf(w, h), `${w}x${h}`).toBe('landscape')
    }
  })
})

describe('authorInitials', () => {
  it('usa a primeira e a ULTIMA palavra', () => {
    // Sobrenome identifica mais que nome do meio.
    expect(authorInitials('Pablo Eduardo Gameleira')).toBe('PG')
    expect(authorInitials('Redacao Cinerie')).toBe('RC')
  })

  it('nome unico vira uma letra so', () => {
    expect(authorInitials('Redacao')).toBe('R')
  })

  it('preserva acento e normaliza caixa', () => {
    expect(authorInitials('ana lima')).toBe('AL')
    expect(authorInitials('Ítalo Álvares')).toBe('ÍÁ')
  })

  it('ignora pontuacao e espaco extra em vez de virar inicial', () => {
    expect(authorInitials('  Maria   —   Silva  ')).toBe('MS')
    expect(authorInitials('J. R. R. Tolkien')).toBe('JT')
  })

  it('devolve null quando nao sobra letra — ai nao existe circulo', () => {
    // O ponto: um avatar vazio e exatamente o defeito que a funcao remove.
    // Voltar a desenhar o circulo aqui reintroduziria o buraco cinza.
    expect(authorInitials('')).toBeNull()
    expect(authorInitials('   ')).toBeNull()
    expect(authorInitials('--- ///')).toBeNull()
  })
})

describe('sectionCrumbLabel', () => {
  it('some quando a secao apenas repete o degrau "Noticias"', () => {
    // O defeito observado: `Inicio > Noticias > news`.
    for (const alias of ['news', 'News', 'NEWS', 'noticias', 'Notícias', 'notícia']) {
      expect(sectionCrumbLabel(alias), alias).toBeNull()
    }
  })

  it('capitaliza token cru de feed', () => {
    expect(sectionCrumbLabel('cinema')).toBe('Cinema')
    expect(sectionCrumbLabel('streaming')).toBe('Streaming')
  })

  it('preserva rotulo que ja passou por gente', () => {
    // Nao cabe a esta funcao reescrever secao aprovada na revisao editorial.
    expect(sectionCrumbLabel('Séries de TV')).toBe('Séries de TV')
    expect(sectionCrumbLabel('Cinema')).toBe('Cinema')
    expect(sectionCrumbLabel('games e cultura pop')).toBe('games e cultura pop')
  })

  it('trata ausencia e vazio como ausencia', () => {
    expect(sectionCrumbLabel(null)).toBeNull()
    expect(sectionCrumbLabel('   ')).toBeNull()
  })

  it('nao engole secao legitima que apenas CONTEM a palavra', () => {
    // A lista de aliases e fechada de proposito: heuristica de "parece tecnico"
    // acabaria removendo secao de verdade.
    expect(sectionCrumbLabel('newsletter')).toBe('Newsletter')
    expect(sectionCrumbLabel('Notícias da indústria')).toBe('Notícias da indústria')
  })
})
