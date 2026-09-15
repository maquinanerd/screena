/**
 * prerendered-routes-robots-runtime.test.ts — rota PRERENDERIZADA no build nao
 * decide o `<meta robots>` pelo ambiente.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * Medido em 15/09/2026, durante a remediacao da auditoria de SEO de 11/09/2026:
 * `/pt/creditos-de-dados/`, `/pt/termos/` e `/pt/privacidade/` eram
 * `public-static` prerenderizadas. O `generateMetadata` delas chama um helper de
 * robots que le a chave de indexacao do AMBIENTE — e o release constroi sem env
 * publica (ver o `Dockerfile`). O HTML que o build grava em
 * `.next/server/app/pt/*.html` saia com `noindex, nofollow`, e nenhuma env de
 * runtime o alcancava. A pagina que o codigo mandava indexar nao podia ser
 * indexada, e a chave propria dos documentos legais nao fazia nada.
 *
 * Nada acusava: o teste de conteudo passava, o registro de cache concordava com
 * o build, e o `robots.txt` (dinamico) dizia outra coisa que o HTML.
 *
 * ============================================================================
 * A REGRA
 * ============================================================================
 * Rota `public-static` com `revalidateSeconds === null` — prerenderizada no
 * build, ver `BUILD_PRERENDERED` — nao chama helper de robots que le ambiente.
 * ISR (janela numerica) fica de fora: a pagina nasce na primeira visita, em
 * runtime, com a env de runtime.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ROUTE_CACHE_POLICY } from '../../apps/web/src/lib/route-cache-policy'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

/** Os helpers cujo resultado depende da env de indexacao lida na hora da chamada. */
const ENV_ROBOTS_HELPERS = [
  'publicRobots',
  'legalDocRobots',
  'gatePublicRobots',
  'isOfficialIndexableEnvironment',
  'isOfficialLegalDocsIndexableEnvironment',
] as const

/** Rotas que o framework cria sem arquivo neste app. */
const FRAMEWORK_ROUTES = new Set(['/_not-found'])

/** O arquivo que define a rota, ou `null`. Grupo `(x)` nao aparece nas rotas prerenderizadas. */
function routeSourceFile(route: string): string | null {
  const segments = route.split('/').filter((segment) => segment !== '')
  const dir = path.join(REPO_ROOT, 'apps', 'web', 'app', ...segments)
  for (const name of ['page.tsx', 'page.ts', 'route.ts', 'route.tsx']) {
    const file = path.join(dir, name)
    if (existsSync(file)) return file
  }
  return null
}

/** Quais helpers de robots de ambiente o codigo CHAMA (fonte ja sem comentarios). */
function envRobotsCalls(source: string): string[] {
  return ENV_ROBOTS_HELPERS.filter((helper) => new RegExp(`\\b${helper}\\s*\\(`).test(source))
}

const prerendered = Object.entries(ROUTE_CACHE_POLICY)
  .filter(([, policy]) => policy.cls === 'public-static' && policy.revalidateSeconds === null)
  .map(([route]) => route)

describe('rota prerenderizada no build nao le a env de indexacao', () => {
  it('CONTROLE: toda rota prerenderizada com arquivo e encontrada e lida', () => {
    const semArquivo = prerendered.filter(
      (route) => !FRAMEWORK_ROUTES.has(route) && routeSourceFile(route) === null,
    )
    expect(semArquivo, 'rota prerenderizada sem arquivo resolvido: o guard ficaria cego a ela').toEqual([])
    expect(prerendered.filter((route) => !FRAMEWORK_ROUTES.has(route)).length).toBeGreaterThan(0)
  })

  it('nenhuma chama helper de robots que depende do ambiente', () => {
    const ofensoras = prerendered.flatMap((route) => {
      const file = routeSourceFile(route)
      if (file === null) return []
      const calls = envRobotsCalls(readSourceWithoutComments(file))
      return calls.length === 0 ? [] : [`${route}: ${calls.join(', ')}`]
    })
    expect(
      ofensoras,
      'o HTML prerenderizado grava o robots da env do BUILD, e o release constroi sem env publica: ' +
        'declare `export const dynamic = "force-dynamic"` e reclassifique a rota como `public-dynamic` (motivo d)',
    ).toEqual([])
  })

  it('CONTROLE NEGATIVO: o detector casa a CHAMADA, e nao a mencao', () => {
    expect(envRobotsCalls('robots: legalDocRobots(),')).toEqual(['legalDocRobots'])
    expect(envRobotsCalls('robots: publicRobots(true),')).toEqual(['publicRobots'])
    expect(envRobotsCalls("robots: { index: false, follow: false },")).toEqual([])
    // Um comentario citando o helper nao chega ate aqui: a porta de leitura o apaga.
    expect(envRobotsCalls(readSourceWithoutComments('apps/web/app/pt/termos/page.tsx'))).toEqual([
      'legalDocRobots',
    ])
  })

  it('os tres documentos renderizam por requisicao e o registro concorda', () => {
    for (const route of ['/pt/creditos-de-dados', '/pt/termos', '/pt/privacidade']) {
      expect(ROUTE_CACHE_POLICY[route]?.cls, route).toBe('public-dynamic')
      const file = routeSourceFile(route)
      expect(file, route).not.toBeNull()
      expect(readSourceWithoutComments(file as string), route).toMatch(
        /export const dynamic = ['"]force-dynamic['"]/,
      )
    }
  })
})
