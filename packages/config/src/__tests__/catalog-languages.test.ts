/**
 * catalog-languages.test.ts — O RECORTE COMO CONFIGURACAO (C.3).
 *
 * A exigencia do dono: "o dono precisa poder acrescentar um idioma sem PR".
 * Estes testes travam as tres propriedades que fazem isso ser verdade:
 *
 *   1. o default e exatamente os cinco idiomas decididos;
 *   2. a variavel de ambiente SOBRESCREVE o default;
 *   3. configuracao malformada NAO abre o catalogo — cai para o default.
 */

import { describe, expect, it } from 'vitest'

import {
  baseLanguageSubtag,
  CATALOG_LANGUAGE_ALLOWLIST_DEFAULT,
  CATALOG_LANGUAGE_ENV_VAR,
  classifyCatalogLanguage,
  resolveCatalogLanguageAllowlist,
} from '../catalog-languages.js'

describe('recorte default', () => {
  it('sao exatamente pt, en, es, ja, ko', () => {
    // A decisao, por escrito: "pt, en, es, ja, ko — o resto exclua!"
    expect([...CATALOG_LANGUAGE_ALLOWLIST_DEFAULT].sort()).toEqual(['en', 'es', 'ja', 'ko', 'pt'])
  })

  it('`pt` (e nao `pt-BR`) — o TMDB emite o subtag base', () => {
    // Trocar por `pt-BR` aqui reproduziria o defeito original: a tabela tinha
    // `pt-BR`, o TMDB manda `pt`, e todo titulo brasileiro caia fora.
    expect(CATALOG_LANGUAGE_ALLOWLIST_DEFAULT).toContain('pt')
    expect(CATALOG_LANGUAGE_ALLOWLIST_DEFAULT).not.toContain('pt-BR')
  })
})

describe('subtag base', () => {
  it('reduz BCP-47 ao idioma, em minusculas', () => {
    expect(baseLanguageSubtag('pt-BR')).toBe('pt')
    expect(baseLanguageSubtag('pt_BR')).toBe('pt')
    expect(baseLanguageSubtag('ZH-Hant')).toBe('zh')
    expect(baseLanguageSubtag('  ja  ')).toBe('ja')
  })

  it('ausencia e vazio viram null (nunca string vazia)', () => {
    expect(baseLanguageSubtag(null)).toBeNull()
    expect(baseLanguageSubtag(undefined)).toBeNull()
    expect(baseLanguageSubtag('')).toBeNull()
    expect(baseLanguageSubtag('   ')).toBeNull()
    expect(baseLanguageSubtag('-BR')).toBeNull()
  })
})

describe('CINERIE_CATALOG_LANGUAGES sobrescreve sem PR', () => {
  it('acrescentar um idioma e uma variavel de ambiente', () => {
    const env = { [CATALOG_LANGUAGE_ENV_VAR]: 'pt,en,es,ja,ko,fr' }
    expect([...resolveCatalogLanguageAllowlist(env)].sort()).toEqual([
      'en',
      'es',
      'fr',
      'ja',
      'ko',
      'pt',
    ])
  })

  it('normaliza grafia, espaco e duplicata', () => {
    const env = { [CATALOG_LANGUAGE_ENV_VAR]: ' PT-BR , pt , JA ' }
    expect(resolveCatalogLanguageAllowlist(env)).toEqual(['pt', 'ja'])
  })

  it('variavel AUSENTE usa o default', () => {
    expect(resolveCatalogLanguageAllowlist({})).toEqual(CATALOG_LANGUAGE_ALLOWLIST_DEFAULT)
  })

  it('variavel VAZIA/malformada cai para o default — nao abre o catalogo', () => {
    // Um erro de digitacao no painel nao pode virar "aceite qualquer idioma".
    // Recorte vazio de verdade nao existe: sempre sobra um idioma publicado.
    for (const raw of ['', '   ', ',,,', ' , , ']) {
      expect(resolveCatalogLanguageAllowlist({ [CATALOG_LANGUAGE_ENV_VAR]: raw })).toEqual(
        CATALOG_LANGUAGE_ALLOWLIST_DEFAULT,
      )
    }
  })
})

describe('classificacao', () => {
  it('os cinco passam, com ou sem regiao', () => {
    for (const code of ['pt', 'pt-BR', 'en', 'es', 'ja', 'ko']) {
      expect(classifyCatalogLanguage(code), code).toBe('allowed')
    }
  })

  it('o resto e recusado', () => {
    for (const code of ['te', 'ml', 'ru', 'kk', 'fr', 'de', 'zh', 'cn', 'xx']) {
      expect(classifyCatalogLanguage(code), code).toBe('rejected')
    }
  })

  it('ausencia de idioma NAO e sinonimo de recusa', () => {
    // A distincao e a diferenca entre um log util e um log que mente: sem ela,
    // extrator quebrado (payload sem idioma) se esconde dentro da decisao do
    // dono e ninguem nunca ve o defeito.
    expect(classifyCatalogLanguage(null)).toBe('unknown_language')
    expect(classifyCatalogLanguage('')).toBe('unknown_language')
    expect(classifyCatalogLanguage(undefined)).toBe('unknown_language')
  })

  it('respeita um recorte customizado', () => {
    expect(classifyCatalogLanguage('fr', ['fr'])).toBe('allowed')
    expect(classifyCatalogLanguage('pt', ['fr'])).toBe('rejected')
  })
})
