/**
 * tmdb-thumbnail-sizes.test.ts — `original` nao volta aos thumbnails.
 *
 * O DEFEITO QUE ISTO TRAVA (medido na auditoria de SEO de 11/09/2026): cinco
 * presenters pediam ao TMDB o arquivo `original` para imagens exibidas pequenas.
 * Na ficha medida, seis fotos de elenco somaram 951 KB — 61% do peso da pagina —,
 * a maior com 2000x3000 px para um quadrado de 64 px. Em `w300`, 101 KB.
 *
 * Os tamanhos nao sao "o menor que existe": sao o menor que ainda preserva
 * retina (>= 1,5x a largura renderizada). Retrato e card de pessoa cabem em
 * ~200 px -> `w300`. Still 16:9 da lista de episodios e mais largo -> `w500`.
 *
 * Dois dos cinco tambem sao provados pela SAIDA (a URL montada), em
 * `person-presenter.test.ts` e `series-presenter.test.ts`. Este arquivo cobre os
 * cinco, pela declaracao — que e onde o `original` voltaria.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const PRESENTERS = [
  ['elenco da ficha', 'cast-presenter.ts', 'PROFILE_IMAGE_SPEC', 'w300'],
  ['retrato da pagina de pessoa', 'person-presenter.ts', 'PROFILE_IMAGE_SPEC', 'w300'],
  ['card da listagem de pessoas', 'entity-index-presenter.ts', 'PROFILE_IMAGE_SPEC', 'w300'],
  ['still da ficha de serie', 'series-presenter.ts', 'STILL_IMAGE_SPEC', 'w500'],
  ['still da pagina de temporada', 'season-episode-presenter.ts', 'STILL_SPEC', 'w500'],
] as const

/** O `tmdbSize` declarado numa constante `const NOME: Tipo = { ... }`. */
function tamanhoDeclarado(fonte: string, constante: string): string | null {
  const re = new RegExp(`const ${constante}:[^=]*=\\s*\\{[^}]*tmdbSize:\\s*"([^"]+)"`)
  return re.exec(fonte)?.[1] ?? null
}

describe.each(PRESENTERS)('thumbnail do TMDB — %s', (_rotulo, arquivo, constante, esperado) => {
  const fonte = readSourceWithoutComments(path.join(REPO_ROOT, 'apps', 'web', 'src', 'lib', arquivo))

  it(`declara ${esperado}, nunca original`, () => {
    const tamanho = tamanhoDeclarado(fonte, constante)
    // CONTROLE: a constante foi achada. Sem isto, um rename faria `null` passar
    // pela asserção negativa abaixo.
    expect(tamanho, `${arquivo}: ${constante} nao encontrada`).not.toBeNull()
    expect(tamanho).toBe(esperado)
    expect(tamanho).not.toBe('original')
  })
})
