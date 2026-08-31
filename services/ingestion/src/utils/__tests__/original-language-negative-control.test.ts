/**
 * original-language-negative-control.test.ts — CONTROLE NEGATIVO do A.5.
 *
 * ============================================================================
 * O QUE UM CONTROLE NEGATIVO PRECISA PROVAR
 * ============================================================================
 * Que o teste de A.5 (`original-language.test.ts`) fica VERMELHO quando o
 * defeito volta. Sem isso ele poderia estar verde por qualquer motivo — inclusive
 * pelo motivo errado, que e um desfecho que este projeto ja pagou.
 *
 * ============================================================================
 * POR QUE ELE NAO REIMPLEMENTA O FILTRO ANTIGO
 * ============================================================================
 * Escrever aqui uma copia do filtro (`new Set(['pt-BR','en','es']).has(code)`) e
 * conferir que ela devolve `null` provaria apenas que a COPIA filtra. Guard
 * textual so pega a grafia: passaria verde com o defeito de pe se a producao
 * filtrasse de outro jeito.
 *
 * Este teste roda a FUNCAO DE PRODUCAO — `normalizeOriginalLanguage`, importada
 * de `../normalize.js`, a mesma que os normalizadores usam — com o dado antigo
 * por baixo. O filtro nunca foi um literal no arquivo: era a consequencia de
 * `LANGUAGE_SEED` ter tres linhas. Entao o jeito fiel de reintroduzir o defeito
 * e restaurar `LANGUAGE_SEED` ao que era em 2026-08-30, e observar a funcao real
 * voltar a devolver `null`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

/** `LANGUAGE_SEED` exatamente como estava antes desta leva. */
const SEED_ANTIGO = [
  {
    code: 'pt-BR',
    namePt: 'Portugues (Brasil)',
    nameEn: 'Portuguese (Brazil)',
    isPublished: true,
    indexDefault: true,
  },
  { code: 'en', namePt: 'Ingles', nameEn: 'English', isPublished: false, indexDefault: false },
  { code: 'es', namePt: 'Espanhol', nameEn: 'Spanish', isPublished: false, indexDefault: false },
] as const

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('@screena/db')
})

describe('controle negativo: com o seed antigo, o A.5 fica vermelho', () => {
  it('`te` volta a virar null quando `languages` tem so tres linhas', async () => {
    vi.resetModules()
    vi.doMock('@screena/db', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@screena/db')>()),
      LANGUAGE_SEED: SEED_ANTIGO,
    }))

    // Import DINAMICO depois do mock: `normalize.ts` monta `KNOWN_LANGUAGE_CODES`
    // no topo do modulo, entao so um modulo recem-avaliado ve o seed trocado.
    const { normalizeOriginalLanguage } = await import('../normalize.js')

    // A ASSERCAO DO CONTROLE: sob o dado antigo, a funcao de PRODUCAO descarta.
    // Se um dia isto passar a devolver `'te'`, o controle perdeu a capacidade de
    // detectar a regressao e precisa ser refeito — nao relaxado.
    expect(normalizeOriginalLanguage('te')).toBeNull()
  })

  it('`ja`, `ko` e `pt` — tres dos CINCO que ficam — tambem caiam', async () => {
    vi.resetModules()
    vi.doMock('@screena/db', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@screena/db')>()),
      LANGUAGE_SEED: SEED_ANTIGO,
    }))
    const { normalizeOriginalLanguage } = await import('../normalize.js')

    // Este e o numero que torna a ordem das partes obrigatoria: sob o defeito,
    // titulo japones, coreano e brasileiro chegam a Parte D com a coluna NULA.
    // Apagar "quem nao esta na lista" antes de recuperar apagaria os tres.
    expect(normalizeOriginalLanguage('ja')).toBeNull()
    expect(normalizeOriginalLanguage('ko')).toBeNull()
    expect(normalizeOriginalLanguage('pt')).toBeNull()

    // E o contraste que prova que o mock pegou de verdade (e nao que a funcao
    // passou a devolver null para tudo): `en` e `es` continuavam entrando.
    expect(normalizeOriginalLanguage('en')).toBe('en')
    expect(normalizeOriginalLanguage('es')).toBe('es')
  })

  it('sem o mock, a MESMA funcao grava `te` — o controle isola a causa', async () => {
    vi.resetModules()
    const { normalizeOriginalLanguage } = await import('../normalize.js')
    expect(normalizeOriginalLanguage('te')).toBe('te')
  })
})
