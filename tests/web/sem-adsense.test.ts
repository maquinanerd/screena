/**
 * sem-adsense.test.ts — o Google AdSense saiu do app publico, por inteiro.
 *
 * Em 2026-10-30 o dono trocou o AdSense pelo OpaPreco Ads (ofertas afiliadas,
 * `docs/opapreco/`). Saiu tudo que o AdSense tinha no repositorio: a metatag de
 * verificacao `google-adsense-account`, o `/ads.txt` e o slot que imitava os
 * formatos IAB. Este guarda reprova a volta de qualquer peca:
 *  - o runtime de anuncios do Google (`adsbygoogle`, `googlesyndication`,
 *    `doubleclick`) — carregaria script e cookie de terceiro que a Politica de
 *    Privacidade (item 6) diz nao existir;
 *  - a metatag de verificacao e qualquer id de cliente `ca-pub-`;
 *  - uma rota ou arquivo `ads.txt`.
 *
 * Substitui `adsense-verification.test.ts`, que travava o contrario (a
 * verificacao de propriedade, PR #332).
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web')

/** Qualquer peca do AdSense, em qualquer das formas que o painel entrega. */
const ADSENSE = /adsbygoogle|googlesyndication|doubleclick|google-adsense-account|ca-pub-\d/i

/** Todo codigo e folha do app publico: `app/`, `src/` e os modulos da raiz. */
function arquivosDoAppPublico(): string[] {
  const arquivos: string[] = []
  const andar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = path.join(dir, entrada)
      if (statSync(caminho).isDirectory()) {
        if (entrada === 'node_modules' || entrada === '.next' || entrada === '__tests__') continue
        andar(caminho)
        continue
      }
      if (/\.(ts|tsx|js|jsx|mjs|css)$/.test(entrada) && !/\.test\./.test(entrada)) arquivos.push(caminho)
    }
  }
  andar(path.join(WEB_DIR, 'app'))
  andar(path.join(WEB_DIR, 'src'))
  for (const entrada of readdirSync(WEB_DIR)) {
    if (/\.(ts|mjs)$/.test(entrada)) arquivos.push(path.join(WEB_DIR, entrada))
  }
  return arquivos
}

describe('AdSense removido do app publico', () => {
  it('(1) CONTROLE: o detector reconhece o snippet, a metatag e o id de cliente', () => {
    expect(
      '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1"></script>',
    ).toMatch(ADSENSE)
    expect('other: { "google-adsense-account": X }').toMatch(ADSENSE)
    expect('ca-pub-9994816010226342').toMatch(ADSENSE)
    expect(arquivosDoAppPublico().length).toBeGreaterThan(100)
  })

  it('(2) nenhum arquivo do app publico carrega peca do AdSense', () => {
    const comAdsense = arquivosDoAppPublico()
      // Comentario nao conta: o historico pode citar o AdSense pelo nome.
      .filter((arquivo) => ADSENSE.test(readSourceWithoutComments(arquivo)))
      .map((arquivo) => path.relative(REPO_ROOT, arquivo))
    expect(comAdsense, 'o AdSense saiu em 2026-10-30; anuncio agora e OpaPreco (docs/opapreco/)').toEqual([])
  })

  it('(3) nao existe rota nem arquivo `ads.txt`', () => {
    expect(existsSync(path.join(WEB_DIR, 'app', 'ads.txt'))).toBe(false)
    expect(existsSync(path.join(WEB_DIR, 'public', 'ads.txt'))).toBe(false)
  })

  it('(4) o layout raiz nao declara metatag de verificacao do AdSense', () => {
    const layout = readSourceWithoutComments(path.join(WEB_DIR, 'app', 'layout.tsx'))
    expect(layout).not.toMatch(ADSENSE)
  })
})
