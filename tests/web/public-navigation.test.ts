import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  HOME_HREF,
  isActiveNavigationPath,
  NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from '../../apps/web/src/lib/navigation'
import { PRIVACY_PATH, TERMS_PATH } from '../../apps/web/src/lib/routes'

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
  it('expõe o menu primário do canônico, na ordem da tela 02', () => {
    // Guard ATUALIZADO DELIBERADAMENTE: o menu primário do design canônico é
    // Início/Filmes/Séries/Listas/Notícias/Onde assistir. Pessoas e Explorar
    // NÃO saíram do produto — mudaram de superfície (rodapé + menu mobile),
    // e o teste abaixo continua provando que nenhuma rota virou link morto.
    expect(HOME_HREF).toBe('/pt/')
    expect(NAV_ITEMS).toEqual([
      { label: 'Início', href: '/pt/' },
      { label: 'Filmes', href: '/pt/filmes/' },
      { label: 'Séries', href: '/pt/series/' },
      { label: 'Listas', href: '/pt/listas/' },
      { label: 'Notícias', href: '/pt/noticias/' },
      { label: 'Onde assistir', href: '/pt/onde-assistir/' },
    ])
    expect(SECONDARY_NAV_ITEMS).toEqual([
      { label: 'Pessoas', href: '/pt/pessoas/' },
      { label: 'Explorar', href: '/pt/explorar/' },
    ])
  })

  it('mantém Pessoas e Explorar navegáveis fora do header', () => {
    const header = read('apps/web/app/_components/site-header.tsx')
    const footer = read('apps/web/app/_components/site-footer.tsx')
    // Menu mobile e rodapé carregam primário + secundário: sair do header
    // nunca pode significar sumir do site.
    expect(header).toContain('...NAV_ITEMS, ...SECONDARY_NAV_ITEMS')
    expect(footer).toContain('...NAV_ITEMS, ...SECONDARY_NAV_ITEMS')
  })

  it('não contém link morto e mantém caminhos internos pt-BR', () => {
    for (const href of [
      HOME_HREF,
      ...NAV_ITEMS.map((item) => item.href),
      ...SECONDARY_NAV_ITEMS.map((item) => item.href),
    ]) {
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

  it('usa a wordmark aprovada com nome acessível e menu mobile de verdade', () => {
    // Guard ATUALIZADO DELIBERADAMENTE: o design canônico usa a wordmark
    // aprovada do handoff (uploads/5a–5j) com sublinhado por contexto. A marca
    // continua NOMEADA para leitores de tela via aria-label do link; o menu
    // mobile usa <dialog> nativo (foco preso + Escape).
    const header = read('apps/web/app/_components/site-header.tsx')
    expect(header).toContain('aria-label="Cinerie — início"')
    expect(header).toMatch(/cinerie-wordmark-(?:black|white)/)
    expect(header).toContain('NAV_ITEMS.map')
    expect(header).toContain('<dialog')
    expect(header).toContain("aria-current={active ? 'page' : undefined}")
    // Wordmark é imagem decorativa DENTRO de link nomeado: alt vazio.
    expect(header).toMatch(/alt=""/)
  })

  it('rodapé contém apenas rotas reais e a atribuição do TMDB', () => {
    const footer = read('apps/web/app/_components/site-footer.tsx')
    expect(footer).toContain('...NAV_ITEMS, ...SECONDARY_NAV_ITEMS].map')
    expect(footer).toContain('usa a API do TMDB')
    // Guard ATUALIZADO DELIBERADAMENTE: a regra deste teste sempre foi "só rota
    // real". Termos e Privacidade eram proibidos aqui porque davam 404 — agora
    // as duas páginas existem, e o link é obrigatório (o aceite do cadastro
    // aponta para elas). Continuam proibidos os destinos que seguem sem rota.
    expect(footer).not.toMatch(/newsletter|social|Vagas/)
  })

  it('rodapé linka os documentos legais e as duas páginas existem de fato', () => {
    const footer = read('apps/web/app/_components/site-footer.tsx')
    expect(footer).toContain('TERMS_PATH')
    expect(footer).toContain('PRIVACY_PATH')
    // Anti-vacuidade: o link só vale se a rota existir. Um href bonito para uma
    // página inexistente é exatamente o defeito que originou estas páginas.
    for (const href of [TERMS_PATH, PRIVACY_PATH]) {
      expect(href).toMatch(/^\/pt\/[a-z-]+\/$/)
      expect(existsSync(pageFileForPublicPath(href)), `rota ausente: ${href}`).toBe(true)
    }
  })

  it('o aceite obrigatório do cadastro aponta para as rotas legais reais', () => {
    // O formulário exige o aceite para habilitar o botão; se o link quebrar, a
    // pessoa é obrigada a concordar com um documento que não consegue ler.
    const form = read('apps/web/app/pt/criar-conta/signup-form.tsx')
    expect(form).toContain('href={TERMS_PATH}')
    expect(form).toContain('href={PRIVACY_PATH}')
    expect(form).not.toMatch(/href="\/pt\/(?:termos|privacidade)"/)
  })

  it('preview técnica permanece noindex sem entidade ou JSON-LD fictícios', () => {
    const preview = read('apps/web/app/dev/movie-page-preview/page.tsx')
    expect(preview).toContain('index: false')
    expect(preview).toContain('follow: false')
    expect(preview).not.toMatch(/Interestelar|application\/ld\+json|"@type"/)
  })
})
