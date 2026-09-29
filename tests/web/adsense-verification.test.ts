/**
 * adsense-verification.test.ts — a verificacao de propriedade do AdSense, e so ela.
 *
 * O que se trava: a linha do `/ads.txt` no formato IAB, a metatag e o `ads.txt`
 * apontando para a MESMA conta, a rota servindo texto puro e prerenderizada, o
 * layout raiz declarando a metatag — e nenhum arquivo do app publico carregando
 * o script de anuncios, que segue fora ate decisao do dono (DIVERGENCIAS.md,
 * D-005; motivos em `apps/web/src/lib/adsense.ts`).
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { GET, dynamic } from '../../apps/web/app/ads.txt/route'
import {
  ADSENSE_CLIENT_ID,
  ADSENSE_PUBLISHER_ID,
  buildAdsTxt,
} from '../../apps/web/src/lib/adsense'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const WEB_DIR = path.join(REPO_ROOT, 'apps', 'web')

/** O runtime de anuncios do Google, em qualquer das formas do snippet. */
const RUNTIME_DE_ANUNCIO = /adsbygoogle|googlesyndication|doubleclick/i

/** Todo codigo do app publico: `app/`, `src/` e os modulos da raiz (middleware, config). */
function codigoDoAppPublico(): string[] {
  const arquivos: string[] = []
  const andar = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      const caminho = path.join(dir, entrada)
      if (statSync(caminho).isDirectory()) {
        if (entrada === 'node_modules' || entrada === '.next' || entrada === '__tests__') continue
        andar(caminho)
        continue
      }
      if (/\.(ts|tsx|js|jsx|mjs)$/.test(entrada) && !/\.test\./.test(entrada)) arquivos.push(caminho)
    }
  }
  andar(path.join(WEB_DIR, 'app'))
  andar(path.join(WEB_DIR, 'src'))
  for (const entrada of readdirSync(WEB_DIR)) {
    if (/\.(ts|mjs)$/.test(entrada)) arquivos.push(path.join(WEB_DIR, entrada))
  }
  return arquivos
}

describe('AdSense — verificacao de propriedade', () => {
  it('(1) o ads.txt e UMA linha IAB: dominio, conta, DIRECT, certificadora do Google', () => {
    const txt = buildAdsTxt()
    expect(txt.endsWith('\n')).toBe(true)
    expect(txt.trimEnd().split('\n')).toEqual([
      'google.com, pub-9994816010226342, DIRECT, f08c47fec0942fa0',
    ])
  })

  it('(2) a metatag e o ads.txt apontam para a MESMA conta', () => {
    expect(ADSENSE_PUBLISHER_ID).toMatch(/^pub-\d{16}$/)
    expect(ADSENSE_CLIENT_ID).toBe(`ca-${ADSENSE_PUBLISHER_ID}`)
    expect(buildAdsTxt()).toContain(`, ${ADSENSE_PUBLISHER_ID}, `)
  })

  it('(3) /ads.txt responde 200 em texto puro e e prerenderizado no build', async () => {
    const resposta = GET()
    expect(resposta.status).toBe(200)
    expect(resposta.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await resposta.text()).toBe(buildAdsTxt())
    expect(dynamic).toBe('force-static')
  })

  it('(4) o layout raiz declara a metatag da conta (vale para toda pagina)', () => {
    const layout = readSourceWithoutComments(path.join(WEB_DIR, 'app', 'layout.tsx'))
    expect(layout).toContain('other: { "google-adsense-account": ADSENSE_CLIENT_ID }')
  })

  it('(5) CONTROLE: o detector reconhece o snippet que o painel do AdSense entrega', () => {
    const snippet =
      '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js' +
      `?client=${ADSENSE_CLIENT_ID}" crossorigin="anonymous"></script>`
    expect(snippet).toMatch(RUNTIME_DE_ANUNCIO)
    expect(codigoDoAppPublico().length).toBeGreaterThan(100)
  })

  it('(6) nada no app publico carrega o runtime de anuncios (D-005 segue valendo)', () => {
    const comAnuncio = codigoDoAppPublico()
      .filter((arquivo) => RUNTIME_DE_ANUNCIO.test(readSourceWithoutComments(arquivo)))
      .map((arquivo) => path.relative(REPO_ROOT, arquivo))
    expect(
      comAnuncio,
      'carregar anuncio e decisao do dono: consentimento, Politica de Privacidade (item 6), ' +
        'Permissions-Policy e CSP mudam junto. Ver apps/web/src/lib/adsense.ts.',
    ).toEqual([])
  })
})
