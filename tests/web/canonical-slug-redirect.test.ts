/**
 * Redirect canonico de entidade — /pt/{filmes,series,pessoas}/[slug]/.
 *
 * Bug de origem: os slugs canonicos de filme/serie carregavam o ano de
 * lancamento (`a-origem-2010`). Ao corrigir o canonico no banco, a linha antiga
 * foi DESPROMOVIDA (`is_canonical = false`), nao apagada — e o loader resolve a
 * entidade por QUALQUER slug. Resultado: `/pt/filmes/a-origem-2010/` respondia
 * 200, servindo a mesma ficha de `/pt/filmes/a-origem/` sob duas URLs.
 *
 * A regra: so o slug canonico responde 200; alias antigo redireciona permanente.
 *
 * COBERTURA: a decisao (`canonicalRedirectPath`) e testada de verdade abaixo. A
 * ligacao dela com `permanentRedirect()` nas 3 paginas e verificada por leitura
 * do FONTE — importar `page.tsx` daqui quebraria `pnpm typecheck` (a raiz nao
 * habilita `jsx`) e `next/navigation` so resolve a partir de `apps/web/`. Guarda
 * textual e mais fraca que execucao: ela prova que a chamada existe, no lugar
 * certo, com o path certo — nao que o Next devolva 308.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { canonicalRedirectPath } from '../../apps/web/src/lib/canonical-redirect'
import {
  MOVIES_INDEX_PATH,
  PEOPLE_INDEX_PATH,
  SERIES_INDEX_PATH,
} from '../../apps/web/src/lib/routes'

function pageSource(...segments: string[]): string {
  return readFileSync(resolve(process.cwd(), 'apps', 'web', 'app', ...segments), 'utf8')
}

const MOVIE_PAGE = pageSource('pt', 'filmes', '[slug]', 'page.tsx')
const SERIES_PAGE = pageSource('pt', 'series', '[slug]', 'page.tsx')
const PERSON_PAGE = pageSource('pt', 'pessoas', '[slug]', 'page.tsx')

describe('canonicalRedirectPath — slug canonico renderiza', () => {
  it('devolve null quando o slug pedido JA e o canonico', () => {
    expect(canonicalRedirectPath(MOVIES_INDEX_PATH, 'a-origem', 'a-origem')).toBeNull()
    expect(
      canonicalRedirectPath(SERIES_INDEX_PATH, 'game-of-thrones', 'game-of-thrones'),
    ).toBeNull()
    expect(canonicalRedirectPath(PEOPLE_INDEX_PATH, 'john-smith', 'john-smith')).toBeNull()
  })

  it('numero que faz parte do TITULO continua canonico (nao e ano pendurado)', () => {
    expect(
      canonicalRedirectPath(MOVIES_INDEX_PATH, 'blade-runner-2049', 'blade-runner-2049'),
    ).toBeNull()
    expect(canonicalRedirectPath(SERIES_INDEX_PATH, 'espaco-1999', 'espaco-1999')).toBeNull()
  })
})

describe('canonicalRedirectPath — alias antigo redireciona', () => {
  it('slug com ano de lancamento aponta para o canonico limpo', () => {
    expect(canonicalRedirectPath(MOVIES_INDEX_PATH, 'a-origem-2010', 'a-origem')).toBe(
      '/pt/filmes/a-origem/',
    )
    expect(
      canonicalRedirectPath(SERIES_INDEX_PATH, 'game-of-thrones-2011', 'game-of-thrones'),
    ).toBe('/pt/series/game-of-thrones/')
  })

  it('vale para pessoa (defesa contra troca futura de slug)', () => {
    expect(canonicalRedirectPath(PEOPLE_INDEX_PATH, 'jonh-smith', 'john-smith')).toBe(
      '/pt/pessoas/john-smith/',
    )
  })

  it('o destino sempre termina com barra final (trailingSlash: true)', () => {
    const target = canonicalRedirectPath(MOVIES_INDEX_PATH, 'duna-2021', 'duna')
    expect(target).toBe('/pt/filmes/duna/')
    expect(target?.endsWith('/')).toBe(true)
  })

  it('nunca redireciona para outra vertical (o indexPath fixa filme vs serie)', () => {
    expect(canonicalRedirectPath(MOVIES_INDEX_PATH, 'duna-2021', 'duna')).toContain('/pt/filmes/')
    expect(canonicalRedirectPath(SERIES_INDEX_PATH, 'lost-2004', 'lost')).toContain('/pt/series/')
  })
})

describe('canonicalRedirectPath — canonico invalido nao vira redirect', () => {
  /**
   * Um canonico vazio/quebrado nao pode virar `Location:` — a pagina atual e
   * servida em vez de mandar o crawler para um path invalido ou para fora do
   * site. `detailPath` ja rejeita separadores de path/URL e travessia.
   */
  it.each([[''], ['a/b'], ['a\\b'], ['..'], ['x?y'], ['x#y'], ['http://evil.com']])(
    'canonico %j => null (renderiza a pagina atual)',
    (canonicalSlug) => {
      expect(canonicalRedirectPath(MOVIES_INDEX_PATH, 'a-origem-2010', canonicalSlug)).toBeNull()
    },
  )
})

describe('paginas publicas ligam a decisao ao permanentRedirect', () => {
  const PAGES: ReadonlyArray<[string, string, string]> = [
    ['filme', MOVIE_PAGE, 'MOVIES_INDEX_PATH'],
    ['serie', SERIES_PAGE, 'SERIES_INDEX_PATH'],
    ['pessoa', PERSON_PAGE, 'PESSOAS_INDEX_PATH'],
  ]

  it.each(PAGES)('pagina de %s importa permanentRedirect de next/navigation', (_kind, source) => {
    expect(source).toMatch(
      /import\s*\{[^}]*permanentRedirect[^}]*\}\s*from\s*["']next\/navigation["']/,
    )
  })

  it.each(PAGES)(
    'pagina de %s chama canonicalRedirectPath com o indexPath da propria rota',
    (_kind, source, indexConst) => {
      expect(source).toMatch(
        new RegExp(
          `canonicalRedirectPath\\(\\s*${indexConst},\\s*slug,\\s*data\\.canonicalSlug,?\\s*\\)`,
        ),
      )
      expect(source).toMatch(/if\s*\(redirectPath !== null\)\s*permanentRedirect\(redirectPath\)/)
    },
  )

  it.each(PAGES)(
    'pagina de %s redireciona depois do notFound e antes de renderizar',
    (_kind, source) => {
      const notFoundAt = source.indexOf('if (data === null) notFound()')
      const redirectAt = source.indexOf('permanentRedirect(redirectPath)')
      const renderAt = source.indexOf('return (', redirectAt)

      expect(notFoundAt).toBeGreaterThan(-1)
      expect(redirectAt).toBeGreaterThan(notFoundAt)
      expect(renderAt).toBeGreaterThan(redirectAt)
    },
  )

  /**
   * `permanentRedirect()` sinaliza por excecao (NEXT_REDIRECT). Um `try/catch`
   * ao redor engoliria o redirect e a pagina voltaria a responder 200 no alias —
   * exatamente o bug que este arquivo trava.
   */
  it.each(PAGES)('pagina de %s nao envolve o redirect em try/catch', (_kind, source) => {
    expect(source).not.toMatch(/\btry\s*\{/)
  })
})

describe('constantes de rota usadas pelas paginas', () => {
  it('PESSOAS_INDEX_PATH da pagina de pessoa e o mesmo PEOPLE_INDEX_PATH das rotas', () => {
    expect(PERSON_PAGE).toMatch(/const\s+PESSOAS_INDEX_PATH\s*=\s*["']\/pt\/pessoas\/["']/)
    expect(PEOPLE_INDEX_PATH).toBe('/pt/pessoas/')
  })

  it('SERIES_INDEX_PATH da pagina de serie e o mesmo das rotas', () => {
    expect(SERIES_PAGE).toMatch(/const\s+SERIES_INDEX_PATH\s*=\s*["']\/pt\/series\/["']/)
    expect(SERIES_INDEX_PATH).toBe('/pt/series/')
  })
})
