import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { HOME_HREF, isActiveNavigationPath, NAV_ITEMS } from '../../apps/web/src/lib/navigation'

const ROOT = process.cwd()
const WEB_APP_DIR = path.join(ROOT, 'apps', 'web', 'app')

function pageFileForPublicPath(publicPath: string): string {
  const segments = publicPath.split('/').filter((part) => part !== '')
  return path.join(WEB_APP_DIR, ...segments, 'page.tsx')
}

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

describe('navegação pública global', () => {
  it('expõe somente as cinco áreas públicas reais', () => {
    expect(HOME_HREF).toBe('/pt/')
    expect(NAV_ITEMS).toEqual([
      { label: 'Filmes', href: '/pt/filmes/' },
      { label: 'Séries', href: '/pt/series/' },
      { label: 'Pessoas', href: '/pt/pessoas/' },
      { label: 'Notícias', href: '/pt/noticias/' },
      { label: 'Explorar', href: '/pt/explorar/' },
    ])
  })

  it('não contém link morto e mantém caminhos internos pt-BR', () => {
    for (const href of [HOME_HREF, ...NAV_ITEMS.map((item) => item.href)]) {
      expect(href).toMatch(/^\/pt\/(?:[a-z-]+\/)?$/)
      expect(existsSync(pageFileForPublicPath(href)), `rota ausente: ${href}`).toBe(true)
    }
  })

  it('marca índices e subrotas como ativos sem confundir prefixos', () => {
    expect(isActiveNavigationPath('/pt/', '/pt/')).toBe(true)
    expect(isActiveNavigationPath('/pt/filmes/', '/pt/filmes/')).toBe(true)
    expect(isActiveNavigationPath('/pt/filmes/duna/', '/pt/filmes/')).toBe(true)
    expect(isActiveNavigationPath('/pt/filmess/', '/pt/filmes/')).toBe(false)
    expect(isActiveNavigationPath('/pt/filmes/', '/pt/')).toBe(false)
    expect(isActiveNavigationPath(null, '/pt/')).toBe(false)
  })

  it('usa marca textual e não reintroduz chrome cinematográfico', () => {
    const header = read('apps/web/app/_components/site-header.tsx')
    // Regex tolerante a espaco/quebra de linha em vez de casar o trecho literal
    // com '\n': o arquivo lido do disco tem CRLF no checkout Windows
    // (core.autocrlf=true, repo sem .gitattributes), entao a versao literal
    // falhava so no Windows e passava no CI Linux. A intencao do teste e "a
    // marca e TEXTO, nao um logo" — nao a indentacao exata.
    expect(header).toMatch(/>\s*Cinerie\s*<\/a>/)
    expect(header).toContain('NAV_ITEMS.map')
    expect(header).not.toMatch(/CinerieLogo|ScreenLogo|<svg|hero|drawer|useEffect/)
  })

  it('rodapé contém apenas rotas reais e a atribuição do TMDB', () => {
    const footer = read('apps/web/app/_components/site-footer.tsx')
    expect(footer).toContain('NAV_ITEMS.map')
    expect(footer).toContain('usa a API do TMDB')
    expect(footer).not.toMatch(/newsletter|social|Termos|Privacidade|Vagas/)
  })

  it('preview técnica permanece noindex sem entidade ou JSON-LD fictícios', () => {
    const preview = read('apps/web/app/dev/movie-page-preview/page.tsx')
    expect(preview).toContain('index: false')
    expect(preview).toContain('follow: false')
    expect(preview).not.toMatch(/Interestelar|application\/ld\+json|"@type"/)
  })
})
