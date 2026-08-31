/**
 * child-scope.test.ts — A CHAVE DE IDEMPOTENCIA DO JOB FILHO tem escopo.
 *
 * ============================================================================
 * O DEFEITO QUE ESTES TESTES TRAVAM
 * ============================================================================
 * Ate 2026-08-28 os filhos de `sync_details` (`sync_media`, `sync_seasons`) e os
 * netos (`sync_episodes`, a midia de temporada/episodio) derivavam a chave so de
 * `(jobType, entityType, externalId, locale)`. Essa chave e a MESMA em toda
 * execucao, para sempre. O PAI tinha escopo — a janela do `/changes`, o dia do
 * agendador — e o filho nao. Resultado: o pai voltava a rodar, o filho batia no
 * unique de `idempotency_key`, virava `created=false` e nao fazia nada.
 *
 * Efeito medido no produto: `tmdb_videos`, `tmdb_images`, `seasons` e `episodes`
 * eram escritos UMA vez, no primeiro ciclo que tocou o titulo, e nunca mais.
 * Trailer novo, poster novo e episodio novo nao entravam. O catalogo congelava
 * sem nenhum erro em lugar nenhum.
 *
 * ============================================================================
 * O RISCO SIMETRICO — E POR ISSO A METADE "NAO DUPLICA" E OBRIGATORIA
 * ============================================================================
 * Escopo demais transforma idempotencia em duplicata. Se o escopo carregasse o
 * relogio, um uuid ou o `runId`, cada TENTATIVA geraria chave nova: um pai
 * reprocessado (retry, retomada de checkpoint) multiplicaria os filhos.
 *
 * O escopo HERDADO nao tem esse problema porque e propriedade do TRABALHO, nao
 * da tentativa. Os dois lados sao testados abaixo, e o lado "nao duplica" e o
 * que impede a correcao de virar um defeito pior.
 */

import { describe, expect, it } from 'vitest'

import { buildIdempotencyKey, scopedChildDiscriminator } from '../idempotency.js'
import { validateSyncDetailsInput, validateSyncEpisodesInput, validateSyncSeasonsInput } from '../handlers/schemas.js'

/** A chave que o handler de detalhe monta para um filho. */
function chaveDoFilho(locale: string, scope: string | null, ...extra: string[]): string {
  return buildIdempotencyKey({
    jobType: 'sync_media',
    entityType: 'movie',
    externalId: '82856',
    discriminator: scopedChildDiscriminator(locale, scope, ...extra),
  })
}

describe('a chave do filho carrega o escopo do pai', () => {
  it('escopos DIFERENTES produzem chaves diferentes — trabalho novo', () => {
    const janelaA = chaveDoFilho('pt-BR', '2026-08-27T00')
    const janelaB = chaveDoFilho('pt-BR', '2026-08-28T00')
    expect(janelaA).not.toBe(janelaB)
  })

  it('o dia do agendador tambem separa: ciclo de ontem nao bloqueia o de hoje', () => {
    const ontem = chaveDoFilho('pt-BR', 'title_detail_active:2026-08-27')
    const hoje = chaveDoFilho('pt-BR', 'title_detail_active:2026-08-28')
    expect(ontem).not.toBe(hoje)
  })

  it('NAO DUPLICA: o MESMO escopo produz a MESMA chave, quantas vezes rodar', () => {
    const primeira = chaveDoFilho('pt-BR', '2026-08-28T06')
    const segunda = chaveDoFilho('pt-BR', '2026-08-28T06')
    const terceira = chaveDoFilho('pt-BR', '2026-08-28T06')
    expect(segunda).toBe(primeira)
    expect(terceira).toBe(primeira)
    // Uma chave so => o unique do banco aceita UMA linha => `created=false` nas
    // demais. E exatamente o comportamento que se quer DENTRO do ciclo.
    expect(new Set([primeira, segunda, terceira]).size).toBe(1)
  })

  it('NAO DUPLICA nem com filas diferentes lendo o mesmo escopo', () => {
    // Duas chamadas da MESMA fila no mesmo dia (reinicio de container, por
    // exemplo) tem de colidir. Sem isso, dois `sync_media` do mesmo titulo
    // gastariam duas vezes a cota do mesmo trabalho.
    const escopo = 'title_media:2026-08-28'
    expect(chaveDoFilho('pt-BR', escopo)).toBe(chaveDoFilho('pt-BR', escopo))
  })

  it('sem escopo (descoberta/backfill) a chave e a de antes — compatibilidade', () => {
    // A descoberta enfileira SEM escopo de proposito: o mesmo id descoberto de
    // novo e o mesmo trabalho. A chave dela nao pode mudar de forma, senao a
    // fila inteira do backfill vira trabalho novo de uma vez.
    expect(scopedChildDiscriminator('pt-BR', null)).toBe('pt-BR')
    expect(scopedChildDiscriminator('pt-BR', '')).toBe('pt-BR')
    expect(scopedChildDiscriminator('pt-BR', '   ')).toBe('pt-BR')
  })

  it('o prefixo de temporada/episodio continua separando irmaos', () => {
    const s1 = scopedChildDiscriminator('pt-BR', 'w1', 's1')
    const s2 = scopedChildDiscriminator('pt-BR', 'w1', 's2')
    expect(s1).not.toBe(s2)
    expect(s1).toBe('s1:pt-BR:w1')

    const e1 = scopedChildDiscriminator('pt-BR', 'w1', 's1e1')
    const e2 = scopedChildDiscriminator('pt-BR', 'w1', 's1e2')
    expect(e1).not.toBe(e2)
  })

  it('idiomas diferentes continuam separados dentro do mesmo escopo', () => {
    expect(scopedChildDiscriminator('pt-BR', 'w1')).not.toBe(scopedChildDiscriminator('en', 'w1'))
  })
})

describe('o payload carrega o escopo ate o filho', () => {
  it('`sync_details` LE o escopo do campo `window` — antes ele era descartado', () => {
    const comEscopo = validateSyncDetailsInput({
      entityType: 'movie',
      tmdbId: 82856,
      locale: 'pt-BR',
      window: '2026-08-27:2026-08-28',
    })
    expect(comEscopo.scope).toBe('2026-08-27:2026-08-28')
  })

  it('payload sem `window` => escopo nulo (a descoberta continua sem escopo)', () => {
    const semEscopo = validateSyncDetailsInput({ entityType: 'movie', tmdbId: 82856 })
    expect(semEscopo.scope).toBeNull()
  })

  it('`sync_seasons` e `sync_episodes` herdam o escopo pelo mesmo campo', () => {
    const temporadas = validateSyncSeasonsInput({ tmdbId: 1399, window: 'dia:2026-08-28' })
    expect(temporadas.scope).toBe('dia:2026-08-28')

    const episodios = validateSyncEpisodesInput({
      tmdbId: 1399,
      seasonNumber: 2,
      window: 'dia:2026-08-28',
    })
    expect(episodios.scope).toBe('dia:2026-08-28')
  })
})
