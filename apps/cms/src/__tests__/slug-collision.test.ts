/**
 * Colisao de slug: o sufixo, o limite do sufixo, e a mensagem que sobra.
 *
 * O caminho feliz ja era coberto. O que NAO era — e e o que este arquivo
 * protege — e o que acontece quando o sufixo NAO resolve. Ate agora esse ramo
 * caia num `catch` vazio e a publicacao seguia com a slug colidida: 2xx aqui e
 * falha la na frente, na projecao, com erro de outro sistema. Com o indice
 * unico `(language, slug)` no lugar, o mesmo ramo passaria a estourar no
 * proprio INSERT com mensagem do PostgreSQL nomeando o indice, nao a materia.
 */

import { describe, expect, it } from 'vitest'

import {
  describeArticleHolder,
  resolveSlugCollision,
  SlugCollisionError,
} from '../canonical-slug.js'

describe('resolveSlugCollision', () => {
  it('slug livre passa intacta', () => {
    expect(resolveSlugCollision('estreia-da-temporada', new Set())).toBe('estreia-da-temporada')
  })

  it('COLISAO REAL: a segunda materia recebe sufixo, nao a mesma slug', () => {
    const taken = new Set(['estreia-da-temporada'])
    const resolved = resolveSlugCollision('estreia-da-temporada', taken)
    expect(resolved).toBe('estreia-da-temporada-2')
    expect(resolved).not.toBe('estreia-da-temporada')
  })

  it('pula os sufixos ja tomados em vez de reusar', () => {
    const taken = new Set([
      'estreia-da-temporada',
      'estreia-da-temporada-2',
      'estreia-da-temporada-3',
    ])
    expect(resolveSlugCollision('estreia-da-temporada', taken)).toBe('estreia-da-temporada-4')
  })

  it('e DETERMINISTICO: mesmo conjunto, mesma escolha', () => {
    // Um sorteio aqui produziria duas URLs para a mesma materia no retry.
    const taken = new Set(['a', 'a-2'])
    expect(resolveSlugCollision('a', taken)).toBe(resolveSlugCollision('a', taken))
  })

  it('esgotado o teto, devolve null em vez de reusar a slug tomada', () => {
    // Este e o ramo que o `catch` vazio escondia. `null` e o sinal de que
    // ninguem tem resposta automatica — quem chama precisa PARAR, nao seguir.
    const taken = new Set(['x'])
    for (let n = 2; n <= 50; n += 1) taken.add(`x-${String(n)}`)
    expect(resolveSlugCollision('x', taken)).toBeNull()
  })

  it('CONTROLE NEGATIVO: com uma vaga no meio, NAO devolve null', () => {
    // Sem isto, um `resolveSlugCollision` quebrado que devolvesse `null` sempre
    // passaria no teste acima e o erro humano dispararia para todo mundo.
    const taken = new Set(['x'])
    for (let n = 2; n <= 50; n += 1) if (n !== 37) taken.add(`x-${String(n)}`)
    expect(resolveSlugCollision('x', taken)).toBe('x-37')
  })
})

describe('describeArticleHolder', () => {
  it('nomeia a materia por titulo E id — titulo se repete, id abre no painel', () => {
    expect(describeArticleHolder({ id: 42, title: 'Estreia da temporada' })).toBe(
      '"Estreia da temporada" (id 42)',
    )
  })

  it('rascunho sem titulo ainda e identificavel pelo id', () => {
    expect(describeArticleHolder({ id: 7, title: '   ' })).toBe('materia sem titulo (id 7)')
  })

  it('sem titulo e sem id, degrada sem quebrar a frase', () => {
    expect(describeArticleHolder({})).toBe('outra materia')
  })
})

describe('SlugCollisionError', () => {
  it('a mensagem diz QUAL slug, em QUE idioma e POR QUEM', () => {
    const error = new SlugCollisionError('estreia', 'pt-BR', '"Outra materia" (id 9)')
    expect(error.message).toContain('estreia')
    expect(error.message).toContain('pt-BR')
    expect(error.message).toContain('"Outra materia" (id 9)')
    // Nada de vocabulario de banco: quem le isso e a redacao.
    expect(error.message).not.toMatch(/constraint|unique|index|violation/i)
  })

  it('sem dono conhecido, ainda diz o que fazer', () => {
    const error = new SlugCollisionError('estreia', 'pt-BR', null)
    expect(error.message).toContain('Escolha outro titulo')
    expect(error.message).not.toContain('null')
  })

  it('carrega os campos para quem precisa decidir o status HTTP', () => {
    const error = new SlugCollisionError('estreia', 'pt-BR', null)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SlugCollisionError')
    expect(error.slug).toBe('estreia')
    expect(error.language).toBe('pt-BR')
  })
})
