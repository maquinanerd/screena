/**
 * slug-derivation.ts — A slug deve ser ESCRITA agora? PURO: sem React, sem rede.
 *
 * Este modulo existe por causa de um defeito de producao: digitar o titulo em
 * ritmo normal derrubava o painel inteiro com "Maximum update depth exceeded"
 * (React #185), perdendo todo o texto nao salvo.
 *
 * A causa nao era a geracao automatica da slug — ela esta certa e o pessoal da
 * redacao gosta dela. Era o fato de a geracao **escrever sempre**: o efeito de
 * `SlugField` chamava `setValue(...)` a cada passagem, mesmo quando a slug
 * calculada era IDENTICA a que ja estava no formulario. Uma escrita que nao muda
 * nada ainda assim agenda uma atualizacao de estado do formulario, que provoca
 * um novo render, que roda o efeito de novo — e o ciclo so termina quando o
 * React desiste e derruba a tela.
 *
 * A correcao e uma guarda de ponto fixo: `write` so quando a slug calculada
 * DIFERE da atual. Com ela, a primeira passagem escreve e a segunda observa que
 * nao ha o que fazer — o ciclo fecha em duas iteracoes em vez de nao fechar.
 *
 * Por que a decisao vive aqui, fora do componente: `apps/cms` roda os testes em
 * `environment: 'node'` e coleta apenas `src/**\/__tests__/**\/*.test.ts` (ver
 * `vitest.config.ts`). Nao ha testing-library nem DOM no repositorio, entao um
 * `.tsx` nao e testavel aqui. Extraindo a decisao para um `.ts` puro, a regra
 * que causou a queda passa a ter teste de regressao de verdade.
 */

import { canonicalizeSlug, type SlugRejection } from '../canonical-slug.js'

/**
 * O que o campo deve fazer nesta passagem.
 *
 * `idle` cobre os tres "nao faca nada" que antes se misturavam: campo somente
 * leitura, acompanhamento desligado e — o que faltava — slug ja correta.
 */
export type SlugDecision =
  | { readonly action: 'write'; readonly slug: string }
  | { readonly action: 'idle' }
  | { readonly action: 'reject'; readonly reason: SlugRejection }

export interface SlugDerivationInput {
  /** Titulo como esta no formulario agora. */
  readonly title: string
  /** Slug como esta no formulario agora — a referencia da comparacao. */
  readonly currentSlug: string
  /** O acompanhamento automatico ainda esta ligado? */
  readonly following: boolean
  readonly readOnly: boolean
  /**
   * A pessoa PEDIU a geracao (botao "Regenerar do titulo")?
   *
   * Muda duas coisas: ignora o acompanhamento (o pedido explicito o religa) e
   * permite reclamar de um titulo que nao produz slug. Enquanto o titulo esta
   * sendo digitado, "ainda nao da para gerar" e ruido, nao erro.
   */
  readonly manual: boolean
}

export function decideSlugFromTitle(input: SlugDerivationInput): SlugDecision {
  if (input.readOnly) return { action: 'idle' }
  if (!input.manual && !input.following) return { action: 'idle' }
  if (input.title.trim() === '') return { action: 'idle' }

  const result = canonicalizeSlug(input.title)
  if (!result.ok) {
    return input.manual ? { action: 'reject', reason: result.reason } : { action: 'idle' }
  }

  /*
   * A GUARDA QUE FALTAVA.
   *
   * Sem esta linha, cada passagem do efeito reescreve o mesmo valor e agenda
   * outro render — o laco que derrubava o admin. Com ela a derivacao vira ponto
   * fixo: escreve uma vez, e a passagem seguinte reconhece que ja chegou.
   *
   * Vale tambem para o caso mais comum de todos: canonicalizacao e MUITOS-PARA-UM.
   * "Festival de Brasilia", "Festival de Brasilia " e "Festival de Brasilia!"
   * produzem a mesma slug, entao a maior parte das teclas digitadas no fim de uma
   * palavra nao muda a slug em nada.
   */
  if (result.slug === input.currentSlug) return { action: 'idle' }

  return { action: 'write', slug: result.slug }
}
