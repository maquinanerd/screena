/**
 * slug-derivation.test.ts — a geracao de slug nao pode derrubar o admin.
 *
 * LIMITE DESTE TESTE, dito com todas as letras: ele NAO renderiza o componente.
 * Nao ha testing-library nem DOM neste repositorio — `apps/cms/vitest.config.ts`
 * roda em `environment: 'node'` e coleta so `src/**\/__tests__/**\/*.test.ts`,
 * entao um `.tsx` nao chega a ser coletado. O que este arquivo cobre e a REGRA
 * que causou a queda, extraida para `admin/slug-derivation.ts`: "devo escrever a
 * slug agora?". A fiacao React (o efeito que chama a regra) continua sem teste
 * automatizado e precisa de olho humano no navegador.
 *
 * O defeito em uma frase: a politica antiga escrevia SEMPRE, inclusive quando a
 * slug calculada era identica a que ja estava no formulario. Cada escrita inutil
 * agendava outro render, que rodava o efeito de novo, que escrevia de novo.
 */

import { describe, expect, it } from 'vitest'

import {
  decideSlugFromTitle,
  type SlugDecision,
  type SlugDerivationInput,
} from '../admin/slug-derivation.js'
import { canonicalizeSlug } from '../canonical-slug.js'

/** O titulo exato que derrubou o admin em producao (71 caracteres). */
const CRASHING_TITLE = 'Festival de Brasília anuncia mostra dedicada ao horror latino-americano'

/**
 * CONTROLE NEGATIVO — a politica ANTIGA, como estava em `SlugField.tsx` antes
 * desta correcao (`3ab9af4`, linhas 60-80).
 *
 * Reproduzida aqui de proposito: sem ela o teste novo passaria com qualquer
 * implementacao, e nao haveria prova de que ele pega o defeito que motivou a
 * correcao. Ela nao e exportada e nao roda em producao.
 */
function legacyDecide(input: SlugDerivationInput): SlugDecision {
  if (input.readOnly) return { action: 'idle' }
  if (!input.manual && !input.following) return { action: 'idle' }
  if (input.title.trim() === '') return { action: 'idle' }
  const result = canonicalizeSlug(input.title)
  if (!result.ok) {
    return input.manual ? { action: 'reject', reason: result.reason } : { action: 'idle' }
  }
  // A LINHA QUE FALTAVA e a comparacao com `input.currentSlug`. Sem ela: escreve
  // sempre, mesmo sem nada para mudar.
  return { action: 'write', slug: result.slug }
}

type Decider = (input: SlugDerivationInput) => SlugDecision

/**
 * Modelo do ciclo render -> efeito -> setValue -> render.
 *
 * Nao e o React: e o que o React faz com este efeito. Enquanto a decisao mandar
 * escrever, ha uma atualizacao de estado do formulario, logo um novo render,
 * logo o efeito roda de novo com a slug recem-escrita. `cap` existe para o teste
 * terminar mesmo quando a politica NAO converge — que e precisamente o que
 * precisamos medir. Uma politica sa assenta; a antiga bate no teto.
 */
function runUntilSettled(
  decide: Decider,
  seed: { readonly title: string; readonly currentSlug: string },
  cap = 1_000,
): { readonly writes: number; readonly settled: boolean; readonly slug: string } {
  let slug = seed.currentSlug
  let writes = 0
  for (let pass = 0; pass < cap; pass += 1) {
    const decision = decide({
      title: seed.title,
      currentSlug: slug,
      following: true,
      readOnly: false,
      manual: false,
    })
    if (decision.action !== 'write') return { writes, settled: true, slug }
    slug = decision.slug
    writes += 1
  }
  return { writes, settled: false, slug }
}

/** Digitacao caractere a caractere, carregando a slug de um prefixo ao proximo. */
function typeBurst(
  decide: Decider,
  title: string,
  cap = 1_000,
): { readonly writes: number; readonly settled: boolean; readonly slug: string } {
  let slug = ''
  let writes = 0
  for (let length = 1; length <= title.length; length += 1) {
    const pass = runUntilSettled(decide, { title: title.slice(0, length), currentSlug: slug }, cap)
    writes += pass.writes
    slug = pass.slug
    if (!pass.settled) return { writes, settled: false, slug }
  }
  return { writes, settled: true, slug }
}

describe('decideSlugFromTitle — o laco de render', () => {
  it('assenta em UMA escrita: a segunda passagem ja nao tem o que fazer', () => {
    const settled = runUntilSettled(decideSlugFromTitle, {
      title: CRASHING_TITLE,
      currentSlug: '',
    })

    expect(settled.settled).toBe(true)
    expect(settled.writes).toBe(1)
    expect(settled.slug).toBe('festival-de-brasilia-anuncia-mostra-dedicada-ao-horror-latino-americano')
  })

  it('CONTROLE NEGATIVO: a politica antiga nunca assenta — escreve ate o teto', () => {
    const settled = runUntilSettled(legacyDecide, { title: CRASHING_TITLE, currentSlug: '' })

    // Sem a guarda de ponto fixo, o ciclo nao fecha. No navegador quem
    // interrompe e o React, com "Maximum update depth exceeded" (#185).
    expect(settled.settled).toBe(false)
    expect(settled.writes).toBe(1_000)
  })

  it('rajada de 71 caracteres: no maximo UMA escrita por tecla', () => {
    const burst = typeBurst(decideSlugFromTitle, CRASHING_TITLE)

    expect(burst.settled).toBe(true)
    // O limite que importa nao e "poucas escritas", e "escritas LIMITADAS pelo
    // numero de teclas". Uma por tecla e o comportamento normal de um campo
    // derivado; o defeito era escrita sem teto DENTRO de uma unica tecla.
    expect(burst.writes).toBeLessThanOrEqual(CRASHING_TITLE.length)
  })

  it('CONTROLE NEGATIVO: a politica antiga trava ja na rajada', () => {
    const burst = typeBurst(legacyDecide, CRASHING_TITLE)

    expect(burst.settled).toBe(false)
  })

  it('tecla que nao muda a slug nao escreve nada', () => {
    // Canonicalizacao e muitos-para-um: pontuacao e espaco no fim somem. Estas
    // teclas custavam um render cada na politica antiga.
    for (const title of ['Festival de Brasília', 'Festival de Brasília ', 'Festival de Brasília!']) {
      expect(
        decideSlugFromTitle({
          title,
          currentSlug: 'festival-de-brasilia',
          following: true,
          readOnly: false,
          manual: false,
        }),
      ).toEqual({ action: 'idle' })
    }
  })
})

describe('decideSlugFromTitle — o que ja estava certo continua certo', () => {
  const base = { readOnly: false, manual: false } as const

  it('preenche enquanto a slug esta vazia', () => {
    expect(
      decideSlugFromTitle({ ...base, title: 'Festival de Brasília', currentSlug: '', following: true }),
    ).toEqual({ action: 'write', slug: 'festival-de-brasilia' })
  })

  it('para de seguir depois de edicao a mao', () => {
    expect(
      decideSlugFromTitle({
        ...base,
        title: 'Outro título completamente diferente',
        currentSlug: 'endereco-escrito-a-mao',
        following: false,
      }),
    ).toEqual({ action: 'idle' })
  })

  it('nao sobrescreve slug ja salva', () => {
    // `following` nasce desligado em documento que ja tem endereco — mudar o
    // titulo de algo publicado nao pode mudar a URL.
    expect(
      decideSlugFromTitle({
        ...base,
        title: 'Título editado depois de publicar',
        currentSlug: 'slug-publicada',
        following: false,
      }),
    ).toEqual({ action: 'idle' })
  })

  it('"Regenerar do título" religa o acompanhamento mesmo desligado', () => {
    expect(
      decideSlugFromTitle({
        title: 'Festival de Brasília',
        currentSlug: 'endereco-antigo',
        following: false,
        readOnly: false,
        manual: true,
      }),
    ).toEqual({ action: 'write', slug: 'festival-de-brasilia' })
  })

  it('campo somente leitura nunca escreve', () => {
    expect(
      decideSlugFromTitle({
        title: 'Festival de Brasília',
        currentSlug: '',
        following: true,
        readOnly: true,
        manual: true,
      }),
    ).toEqual({ action: 'idle' })
  })

  it('titulo que nao produz slug: reclama so quando a geracao foi PEDIDA', () => {
    const impossible = { title: '???', currentSlug: '', following: true, readOnly: false } as const

    // Digitando: silencio. "Ainda nao da para gerar" e ruido, nao erro.
    expect(decideSlugFromTitle({ ...impossible, manual: false })).toEqual({ action: 'idle' })
    // Pedindo: explica o motivo.
    expect(decideSlugFromTitle({ ...impossible, manual: true })).toEqual({
      action: 'reject',
      reason: 'empty_after_normalization',
    })
  })

  it('slug reservada e recusada quando pedida a geracao', () => {
    expect(
      decideSlugFromTitle({
        title: 'Notícias',
        currentSlug: '',
        following: true,
        readOnly: false,
        manual: true,
      }),
    ).toEqual({ action: 'reject', reason: 'reserved' })
  })
})
