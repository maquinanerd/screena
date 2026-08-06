/**
 * media-usability.ts — "Da para usar esta imagem?", respondido NO SELETOR.
 *
 * O DEFEITO QUE ISTO RESOLVE: hoje da para vincular uma midia bloqueada a uma
 * materia e so descobrir na publicacao, quando o gate recusa com
 * `unauthorized_media`. O redator escolhe a foto, escreve a legenda, tenta
 * publicar, e ai aprende que aquela imagem nunca poderia ter sido usada. O
 * trabalho ja foi feito.
 *
 * A resposta precisa estar onde a escolha acontece.
 *
 * PURO e num `.ts` de proposito: o vitest deste app nao coleta `.tsx`. A decisao
 * mora aqui; o componente so a desenha.
 *
 * NAO decide nada de novo: delega a `mediaBlockReason`, que ja e a fonte usada
 * pelo aviso de licenca da tela de materia. Uma segunda regra aqui divergiria da
 * primeira no primeiro caso novo — e as duas falariam sobre a MESMA foto.
 */

import { mediaBlockReason } from './editorial-vocabulary.js'

export type MediaUsabilityTone = 'ok' | 'partial' | 'blocked'

export interface MediaUsability {
  readonly tone: MediaUsabilityTone
  /** Frase curta, em pt-BR, para caber numa celula de lista. */
  readonly label: string
  /** O porque, quando ha porque. */
  readonly detail: string | null
}

/** Os fatos de licenca que a lista carrega para cada midia. */
export interface MediaUsabilityFacts {
  readonly licenseStatus: unknown
  readonly allowedForEditorial: unknown
  readonly allowedForHero: unknown
}

/**
 * Como a midia deve aparecer no seletor.
 *
 * Tres desfechos, e nao dois, porque "liberada para o corpo mas nao para capa" e
 * um estado real e frequente: dizer so "bloqueada" faria o redator descartar uma
 * foto que ele PODE usar no texto.
 *
 * FAIL-CLOSED: fato ausente ou de tipo errado vira `false`, nao `true`. Uma
 * leitura incompleta da lista nao pode transformar midia sem licenca em midia
 * liberada — o erro seguro e recusar demais, nunca de menos.
 */
export function mediaUsability(facts: MediaUsabilityFacts): MediaUsability {
  const licenseStatus = typeof facts.licenseStatus === 'string' ? facts.licenseStatus : 'unknown'
  const allowedForEditorial = facts.allowedForEditorial === true
  const allowedForHero = facts.allowedForHero === true

  // Pergunta primeiro pelo uso mais exigente (capa). Se ele passa, o corpo
  // tambem passa, e a midia esta liberada para tudo.
  const asHero = mediaBlockReason({
    licenseStatus,
    allowedForEditorial,
    allowedForHero,
    usedAsHero: true,
  })
  if (asHero === null) return { tone: 'ok', label: 'Liberada', detail: null }

  // Nao serve de capa. Serve para o corpo?
  const inBody = mediaBlockReason({
    licenseStatus,
    allowedForEditorial,
    allowedForHero,
    usedAsHero: false,
  })
  if (inBody === null) {
    return { tone: 'partial', label: 'Só no corpo', detail: 'Não liberada para capa.' }
  }

  return { tone: 'blocked', label: 'Bloqueada', detail: inBody }
}
