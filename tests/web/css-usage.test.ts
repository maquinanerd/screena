/**
 * css-usage.test.ts — quando uma classe de CSS conta como USADA pelo codigo.
 *
 * O erro caro aqui e o falso "sem uso": a limpeza de CSS removeria a regra de uma
 * classe que a pagina escreve composta. O caso real que motivou o detector:
 * `list-card__media--g${index % CAPAS}` em `lists-panel.tsx`.
 */

import { describe, expect, it } from 'vitest'

import { classUsedInSource } from '../../apps/web/scripts/lab/css-usage'

describe('classUsedInSource', () => {
  it('literal, com fronteira de palavra', () => {
    expect(classUsedInSource('topinfo__title', '<h1 className="topinfo__title">')).toBe(true)
    expect(classUsedInSource('btn', "cx('btn', active && 'btn--on')")).toBe(true)
  })

  it('CONTROLE NEGATIVO: classe maior que contem o nome nao e uso', () => {
    expect(classUsedInSource('btn', '<button className="site-header__menu-btn">')).toBe(false)
    expect(classUsedInSource('field', '<div className="auth-field__label">')).toBe(false)
  })

  it('composta por interpolacao — o caso real da listagem de listas', () => {
    const source = 'className={`list-card__media list-card__media--g${index % CAPAS}`}'
    for (const n of [0, 1, 2, 3, 4, 5]) expect(classUsedInSource(`list-card__media--g${n}`, source)).toBe(true)
  })

  it('composta por concatenacao', () => {
    expect(classUsedInSource('badge--movie', "const cls = 'badge--' + kind")).toBe(true)
  })

  it('CONTROLE NEGATIVO: o prefixo composto tem de incluir bloco e separador', () => {
    expect(classUsedInSource('btn--accent', 'const x = `btn${variant}`')).toBe(false)
    expect(classUsedInSource('score-box__value', 'const x = `score${kind}`')).toBe(false)
  })

  it('CONSERVADOR: `btn${x}` conta como uso de `btn` (com x vazio a classe e essa)', () => {
    expect(classUsedInSource('btn', 'const x = `btn${suffix}`')).toBe(true)
  })
})
