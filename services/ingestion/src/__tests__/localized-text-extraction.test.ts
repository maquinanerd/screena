/**
 * localized-text-extraction.test.ts — A SINOPSE E A BIOGRAFIA SAO EXTRAIDAS DO
 * BLOCO `translations` QUANDO O CAMPO DE TOPO VEM VAZIO.
 *
 * SUBSTITUI `display-fields-synopsis-loss.test.ts` (2026-08-27), que era um
 * teste de CARACTERIZACAO: ele descrevia o defeito — "o extrator devolve null
 * mesmo com a sinopse presente em `translations`" — e o proprio cabecalho previa
 * "quando alguem consumir o bloco, ESTES TESTES VAO FICAR VERMELHOS".
 *
 * ELES NAO FICARAM, E ISSO E O ACHADO QUE ESTE ARQUIVO REGISTRA. O fixture
 * daquele teste tinha uma unica traducao, `en`/`US`. A extracao nova aceita
 * `pt`/`BR` e SO ela, entao continuou devolvendo `null` para aquele payload —
 * corretamente. Um teste que so exercita o idioma que a regra recusa passa nos
 * dois mundos e nao mede nada. Por isso os casos abaixo vem em pares: o que a
 * cadeia RECUPERA e o que ela continua RECUSANDO.
 *
 * A regra, uma vez (`localized-text.ts` e a fonte executavel):
 *   1. campo de topo (`overview` / `biography`), quando nao vazio
 *   2. entrada `pt`/`BR` dentro de `translations`, quando nao vazia
 *   3. `null` — sem inventar, sem cair em outro idioma
 *
 * `pt-PT` NAO entra: e decisao editorial do dono, nao conserto de bug.
 */

import { describe, expect, it } from 'vitest'

import { MOVIE_APPEND, PERSON_APPEND, TV_APPEND } from '@screena/tmdb-client'

import {
  readMovieDisplayFields,
  readPersonBiography,
  readTvDisplayFields,
} from '../display-fields.js'
import { pickOverview } from '../localized-text.js'

/** Uma entrada do bloco `translations` do TMDB. */
function traducao(
  iso639: string,
  iso3166: string,
  data: Record<string, string>,
): Record<string, unknown> {
  return { iso_639_1: iso639, iso_3166_1: iso3166, name: `${iso639}-${iso3166}`, data }
}

/** Payload de filme como o TMDB responde `?language=pt-BR` para um titulo sem pt-BR. */
function filme(traducoes: readonly Record<string, unknown>[], overviewTopo = ''): unknown {
  return {
    id: 1234,
    title: 'Um Filme Qualquer',
    original_title: 'Some Movie',
    overview: overviewTopo,
    translations: { translations: [...traducoes] },
  }
}

/** Payload de serie, mesma forma. */
function serie(traducoes: readonly Record<string, unknown>[], overviewTopo = ''): unknown {
  return {
    id: 5678,
    name: 'Uma Serie Qualquer',
    original_name: 'Some Show',
    overview: overviewTopo,
    translations: { translations: [...traducoes] },
  }
}

const SINOPSE_PT_BR = 'Sinopse em portugues do Brasil, que o TMDB tinha o tempo todo.'

const PT_BR = traducao('pt', 'BR', {
  title: 'Um Filme Qualquer',
  name: 'Uma Serie Qualquer',
  overview: SINOPSE_PT_BR,
})
const EN_US = traducao('en', 'US', { title: 'Some Movie', overview: 'An English synopsis.' })
const PT_PT = traducao('pt', 'PT', {
  title: 'Um Filme Qualquer',
  overview: 'Sinopse em portugues europeu.',
})

/**
 * O EXTRATOR ANTIGO, reproduzido aqui letra por letra.
 *
 * E o CONTROLE NEGATIVO permanente: cada recuperacao provada abaixo e provada
 * DUAS vezes — que a cadeia nova acha o texto, e que a leitura de topo sozinha
 * NAO acha. Sem o gemeo, um fixture com o campo de topo preenchido por descuido
 * passaria verde sem medir diferenca nenhuma.
 */
function soCampoDeTopo(payload: unknown): string | null {
  const obj =
    payload !== null && typeof payload === 'object' ? (payload as { overview?: unknown }) : {}
  return typeof obj.overview === 'string' && obj.overview !== '' ? obj.overview : null
}

describe('extracao de texto localizado (sinopse e biografia)', () => {
  it('(0) o bloco `translations` e pedido em toda requisicao de detalhe dos tres tipos', () => {
    // A cota ja foi paga. Nao ha requisicao NOVA a fazer para recuperar o texto.
    expect(MOVIE_APPEND).toContain('translations')
    expect(TV_APPEND).toContain('translations')
    expect(PERSON_APPEND).toContain('translations')
  })

  it('(1) FILME: overview de topo vazio + pt-BR no bloco -> sinopse preenchida', () => {
    const payload = filme([EN_US, PT_BR])
    const display = readMovieDisplayFields(payload)

    expect(display.overview).toBe(SINOPSE_PT_BR)
    expect(display.overviewSource).toBe('translations')
    // CONTROLE NEGATIVO: o extrator antigo perde este mesmo texto.
    expect(soCampoDeTopo(payload)).toBeNull()
  })

  it('(2) SERIE: mesmo caso (a serie e o maior balde do censo de 2026-08-28)', () => {
    const payload = serie([PT_BR])
    const display = readTvDisplayFields(payload)

    expect(display.overview).toBe(SINOPSE_PT_BR)
    expect(display.overviewSource).toBe('translations')
    expect(soCampoDeTopo(payload)).toBeNull()
  })

  it('(3) o campo de TOPO tem precedencia sobre o bloco (e a proveniencia diz isso)', () => {
    const display = readMovieDisplayFields(filme([PT_BR], 'Sinopse ja no campo principal.'))
    expect(display.overview).toBe('Sinopse ja no campo principal.')
    expect(display.overviewSource).toBe('detail')
  })

  it('(4) SEM nenhum dos dois -> null, sem inventar', () => {
    expect(readMovieDisplayFields(filme([])).overview).toBeNull()
    expect(readMovieDisplayFields(filme([])).overviewSource).toBeNull()
    expect(readMovieDisplayFields({ title: 'X' }).overview).toBeNull()
    expect(readMovieDisplayFields(null).overview).toBeNull()
    expect(readTvDisplayFields(undefined).overview).toBeNull()
  })

  it('(5) so `en` no bloco -> continua null (nao ha fallback de idioma)', () => {
    // Este era o UNICO caso do teste antigo, e por isso ele passava verde nos
    // dois mundos. Fica aqui como guarda: recuperar pt-BR nao pode ter aberto a
    // porta para servir ingles numa pagina pt-BR (invariante 7).
    expect(readMovieDisplayFields(filme([EN_US])).overview).toBeNull()
  })

  it('(6) so `pt-PT` no bloco -> continua null (Item E e medicao, nao implementacao)', () => {
    // Aceitar portugues europeu em pagina pt-BR e escolha EDITORIAL do dono.
    // Se um dia entrar, ESTE teste fica vermelho — e e assim que se percebe.
    expect(readMovieDisplayFields(filme([PT_PT])).overview).toBeNull()
    expect(pickOverview(filme([PT_PT])).source).toBeNull()
  })

  it('(7) o titulo NAO regride: a cadeia `title` -> `original_title` continua', () => {
    expect(readMovieDisplayFields(filme([PT_BR])).title).toBe('Um Filme Qualquer')
    expect(readMovieDisplayFields({ original_title: 'Only Original' }).title).toBe('Only Original')
    expect(readTvDisplayFields({ original_name: 'Only Original' }).title).toBe('Only Original')
  })

  it('(8) PESSOA: biografia de topo vazia + pt-BR no bloco -> biografia preenchida', () => {
    const pessoa = {
      id: 99,
      name: 'Fernanda Montenegro',
      biography: '',
      translations: {
        translations: [
          traducao('en', 'US', { biography: 'An English biography.' }),
          traducao('pt', 'BR', { biography: 'Biografia em portugues do Brasil.' }),
        ],
      },
    }
    const lido = readPersonBiography(pessoa)
    expect(lido.biography).toBe('Biografia em portugues do Brasil.')
    expect(lido.biographySource).toBe('translations')
  })

  it('(9) PESSOA: sem biografia em lugar nenhum -> null', () => {
    expect(readPersonBiography({ name: 'X', biography: '' }).biography).toBeNull()
    expect(readPersonBiography({ name: 'X' }).biographySource).toBeNull()
  })

  it('(10) payload malformado nao derruba a varredura de centenas de milhares de linhas', () => {
    const malformados: unknown[] = [
      { overview: '', translations: null },
      { overview: '', translations: { translations: null } },
      { overview: '', translations: { translations: [null, 42, 'x'] } },
      { overview: '', translations: { translations: [{ iso_639_1: 'pt', iso_3166_1: 'BR' }] } },
      {
        overview: '',
        translations: { translations: [{ iso_639_1: 'pt', iso_3166_1: 'BR', data: 7 }] },
      },
      { overview: 42 },
    ]
    for (const payload of malformados) {
      expect(() => readMovieDisplayFields(payload)).not.toThrow()
      expect(readMovieDisplayFields(payload).overview).toBeNull()
    }
  })

  it('(11) espaco em branco nao conta como texto (nem no topo, nem no bloco)', () => {
    expect(readMovieDisplayFields(filme([], '   ')).overview).toBeNull()
    const soEspaco = traducao('pt', 'BR', { overview: '  \n ' })
    expect(readMovieDisplayFields(filme([soEspaco])).overview).toBeNull()
  })
})
