/**
 * display-fields-synopsis-loss.test.ts — ONDE A SINOPSE SE PERDE.
 * Teste de CARACTERIZACAO: descreve o comportamento ATUAL, nao o desejado.
 *
 * ESTE ARQUIVO NAO CONSERTA NADA. Ele existe para que a medida do relatorio de
 * 2026-08-27 fique executavel em vez de ficar so escrita: mais da metade do
 * catalogo (18.934 filmes + 19.679 series, medidos em producao) esta em
 * `noindex` por `no_synopsis`, e a pergunta era de qual dos dois mundos isso
 * vem — o TMDB nao tem, ou nos nao guardamos.
 *
 * A RESPOSTA, e ela e verificavel aqui sem tocar em rede:
 *
 *   1. `MOVIE_APPEND`/`TV_APPEND` JA PEDEM `translations` em toda requisicao de
 *      detalhe. O bloco com a sinopse de TODOS os idiomas chega, e a cota ja foi
 *      paga por ele. (`api_cache.payload` e `tmdb_raw.payload` guardam a
 *      resposta inteira, entao ele tambem ja esta no banco.)
 *   2. `readMovieDisplayFields`/`readTvDisplayFields` leem SO o `overview` de
 *      topo — que e o do idioma pedido (`TMDB_DEFAULT_LANGUAGE`, default
 *      `pt-BR`) e vem VAZIO quando aquele titulo nao tem traducao pt-BR.
 *   3. `''` vira `null`, `upsertTranslation` grava `summary = NULL`, e a
 *      politica decide `no_synopsis`.
 *
 * Ou seja: o dado nao se perde no fetch, nem no persistidor, nem na tabela. Ele
 * nunca e EXTRAIDO. `translations` esta classificado como `deferred` em
 * `api-clients/tmdb/src/append-consumption.ts` — pedido de proposito, ainda nao
 * consumido —, e este teste e a demonstracao do custo dessa pendencia.
 *
 * Quando alguem consumir o bloco, ESTES TESTES VAO FICAR VERMELHOS. E o
 * comportamento correto: e o sinal de que a caracterizacao mudou, e a hora de
 * reescrever este arquivo para o comportamento novo — nao de contorna-lo.
 */

import { describe, expect, it } from 'vitest'

import { MOVIE_APPEND, TV_APPEND } from '@screena/tmdb-client'

import { readMovieDisplayFields, readTvDisplayFields } from '../display-fields.js'

/**
 * Payload como o TMDB responde `/movie/{id}?language=pt-BR&append_to_response=...`
 * para um titulo SEM traducao pt-BR: `overview` de topo vazio, e o texto
 * existindo — em ingles — dentro de `translations`.
 */
const FILME_SEM_PT = {
  id: 1234,
  title: 'Um Filme Qualquer',
  original_title: 'Some Movie',
  overview: '',
  translations: {
    translations: [
      {
        iso_639_1: 'en',
        iso_3166_1: 'US',
        name: 'English',
        data: { title: 'Some Movie', overview: 'An English synopsis that TMDB does have.' },
      },
    ],
  },
}

const SERIE_SEM_PT = {
  id: 5678,
  name: 'Uma Serie Qualquer',
  original_name: 'Some Show',
  overview: '',
  translations: {
    translations: [
      {
        iso_639_1: 'en',
        iso_3166_1: 'US',
        name: 'English',
        data: { name: 'Some Show', overview: 'An English synopsis that TMDB does have.' },
      },
    ],
  },
}

describe('de onde vem a falta de sinopse (caracterizacao, 2026-08-27)', () => {
  it('(1) o bloco `translations` JA e pedido em toda requisicao de detalhe', () => {
    // A cota ja foi paga: o texto chega junto do resto do detalhe. Nao ha
    // requisicao NOVA a fazer para saber se o TMDB tem a sinopse.
    expect(MOVIE_APPEND).toContain('translations')
    expect(TV_APPEND).toContain('translations')
  })

  it('(2) CONTROLE POSITIVO: com overview de topo preenchido, o extrator o le', () => {
    // Sem esta linha, (3) passaria por vacuidade — um extrator quebrado
    // devolveria `null` para tudo e "provaria" a tese pelo motivo errado.
    const comPt = readMovieDisplayFields({ ...FILME_SEM_PT, overview: 'Sinopse em portugues.' })
    expect(comPt.overview).toBe('Sinopse em portugues.')
  })

  it('(3) FILME: o extrator devolve null mesmo com a sinopse presente em `translations`', () => {
    const display = readMovieDisplayFields(FILME_SEM_PT)

    // O titulo TEM fallback (`title` -> `original_title`) e sobrevive...
    expect(display.title).toBe('Um Filme Qualquer')
    // ...a sinopse nao tem fallback nenhum e morre aqui.
    expect(display.overview).toBeNull()

    // E o texto estava no payload o tempo todo — o teste afirma isso sobre o
    // MESMO objeto que acabou de virar `null`, para nao restar duvida sobre
    // qual elo perdeu o dado.
    const traducoes = FILME_SEM_PT.translations.translations
    expect(traducoes.some((t) => t.data.overview.length > 0)).toBe(true)
  })

  it('(4) SERIE: mesmo comportamento (a serie e o maior balde do censo real)', () => {
    const display = readTvDisplayFields(SERIE_SEM_PT)

    expect(display.title).toBe('Uma Serie Qualquer')
    expect(display.overview).toBeNull()
    expect(SERIE_SEM_PT.translations.translations.some((t) => t.data.overview.length > 0)).toBe(true)
  })

  it('(5) o elo que perde e o EXTRATOR — nao o fetch, nao o persistidor', () => {
    // `upsertTranslation(entityType, entityId, display.title, display.overview)`
    // grava exatamente o que o extrator devolveu. Com `null` chegando ali,
    // `entity_translations.summary` nasce NULL e a politica decide
    // `no_synopsis` — corretamente, sobre um dado que existia.
    const display = readMovieDisplayFields(FILME_SEM_PT)
    const summaryQueSeriaGravado = display.overview
    expect(summaryQueSeriaGravado).toBeNull()
  })
})
