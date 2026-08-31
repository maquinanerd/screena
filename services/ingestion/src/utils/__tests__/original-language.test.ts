/**
 * original-language.test.ts — A.5 da leva do recorte de idioma.
 *
 * TRAVA A REGRESSAO: um payload com `original_language: "te"` grava `te`.
 *
 * Ate 2026-08-31 este teste era IMPOSSIVEL de passar. `normalizeOriginalLanguage`
 * validava contra `LANGUAGE_SEED`, que tinha tres linhas (`pt-BR`, `en`, `es`),
 * entao `te` — telugo, o idioma de "ధృవ", um dos casos que o dono trouxe medido
 * do `api_cache` — virava `null` em silencio. Junto com ele caiam `ja`, `ko` e
 * `pt`: TRES dos CINCO idiomas que a decisao manda MANTER.
 *
 * O controle negativo esta em `original-language-negative-control.test.ts`, num
 * arquivo separado de proposito: ele reintroduz o filtro antigo e prova que ESTE
 * teste ficaria vermelho. Um controle negativo que mora no mesmo arquivo do
 * teste que ele protege tende a ser lido como parte dele e apagado junto.
 */

import { describe, expect, it } from 'vitest'

import { LANGUAGE_VOCABULARY } from '@screena/db'
import { CATALOG_LANGUAGE_ALLOWLIST_DEFAULT } from '@screena/config'

import { normalizeMovie } from '../../normalizers/movie.js'
import { normalizeTvShow } from '../../normalizers/tv.js'
import { normalizeOriginalLanguage, readOriginalLanguage } from '../normalize.js'

/** Detalhe minimo de filme, com o idioma sob teste. */
function movieDetail(originalLanguage: string): Parameters<typeof normalizeMovie>[0] {
  return {
    id: 1,
    title: 'Titulo',
    original_title: 'ధృవ',
    original_language: originalLanguage,
  } as Parameters<typeof normalizeMovie>[0]
}

/** Detalhe minimo de serie, com o idioma sob teste. */
function tvDetail(originalLanguage: string): Parameters<typeof normalizeTvShow>[0] {
  return {
    id: 2,
    name: 'Nome',
    original_name: '血まみれスケバンチェーンソー',
    original_language: originalLanguage,
  } as Parameters<typeof normalizeTvShow>[0]
}

describe('original_language: gravado como vem, sem lista fechada', () => {
  it('A.5 — payload com `original_language: "te"` grava `te` (filme)', () => {
    expect(normalizeMovie(movieDetail('te')).movie.originalLanguage).toBe('te')
  })

  it('A.5 — payload com `original_language: "te"` grava `te` (serie)', () => {
    expect(normalizeTvShow(tvDetail('te')).tvShow.originalLanguage).toBe('te')
  })

  it('os codigos exatos que o dono mediu no api_cache sobrevivem', () => {
    // A tabela que o dono colou: coluna vazia, payload com o idioma real.
    const medidos = ['te', 'ja', 'ml', 'ru', 'pt', 'kk'] as const
    for (const code of medidos) {
      expect(normalizeOriginalLanguage(code), `codigo ${code}`).toBe(code)
    }
  })

  it('`pt` sobrevive — era o pior caso: a tabela tinha `pt-BR`, o TMDB manda `pt`', () => {
    expect(normalizeOriginalLanguage('pt')).toBe('pt')
    // As duas grafias coexistem: `pt-BR` e locale de AUTORIA, `pt` e idioma da
    // OBRA. Foi a confusao entre as duas que apagou o cinema brasileiro da
    // coluna. Ver `CONTENT_AUTHORING_LOCALES` em @screena/config.
    expect(normalizeOriginalLanguage('pt-BR')).toBe('pt-BR')
  })

  it('os CINCO idiomas do recorte sao todos gravaveis', () => {
    // Se um deles nao fosse, o recorte apagaria titulo que devia ficar — que e
    // exatamente o acidente que a ordem das Partes A -> B -> D existe para evitar.
    for (const code of CATALOG_LANGUAGE_ALLOWLIST_DEFAULT) {
      expect(normalizeOriginalLanguage(code), `recorte: ${code}`).toBe(code)
    }
  })

  it('os desvios do TMDB (`cn`, `sh`, `xx`) tambem entram', () => {
    // Nenhum e ISO 639-1 valido hoje, e os tres aparecem no catalogo real.
    for (const code of ['cn', 'sh', 'xx']) {
      expect(normalizeOriginalLanguage(code), `desvio: ${code}`).toBe(code)
    }
  })

  it('o vocabulario cobre o alfabeto ISO 639-1 inteiro, sem duplicata', () => {
    const codes = LANGUAGE_VOCABULARY.map((entry) => entry.code)
    expect(new Set(codes).size).toBe(codes.length)
    // Sem este piso, alguem poderia "consertar" o defeito adicionando so os
    // cinco idiomas do recorte — e o backfill voltaria a nao conseguir gravar
    // `te`, tornando a Parte B incapaz de medir o que sai.
    expect(codes.length).toBeGreaterThan(180)
  })
})

describe('readOriginalLanguage: o descarte deixa de ser silencioso', () => {
  it('ausencia e recusa sao desfechos DIFERENTES', () => {
    // Colapsar os dois em `null` foi o que deixou 41.505 titulos mudos sem
    // ninguem perceber: "o TMDB nao mandou" e fato sobre o payload, "nao
    // conhecemos o codigo" e fato sobre nos.
    expect(readOriginalLanguage(null)).toEqual({ code: null, rejected: null })
    expect(readOriginalLanguage('   ')).toEqual({ code: null, rejected: null })
    expect(readOriginalLanguage('zzz')).toEqual({ code: null, rejected: 'zzz' })
  })

  it('o codigo aceito volta intacto, sem reescrita', () => {
    expect(readOriginalLanguage('ko')).toEqual({ code: 'ko', rejected: null })
  })
})
