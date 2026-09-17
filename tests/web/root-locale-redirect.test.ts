/**
 * P0-13: a raiz "/" nao tem page.tsx proprio e deve redirecionar para o locale
 * publicado. Enquanto so pt esta publicado, pt/es/en/vazio caem em /pt/.
 *
 * MUDOU EM 2026-09-11: o status passou de 307 para 308 (decisao do dono,
 * `docs/seo/DECISOES-DO-DONO-2026-09-11.md`). O 307 afirmava que o destino era
 * temporario, e ele nao e: `PUBLISHED_LOCALES` tem UM idioma, e
 * `rootRedirectPath` devolve `/pt/` para qualquer `Accept-Language` — inclusive
 * `en`, como os proprios casos abaixo provam. Destino que nao varia e
 * permanente.
 *
 * Os dois status preservam metodo e corpo; o que muda e o sinal de cache e de
 * consolidacao para o indice. Quando um segundo idioma publicar, o 307 volta no
 * mesmo movimento em que a negociacao passar a ter mais de uma saida.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { middleware } from '../../apps/web/middleware'
import {
  PUBLISHED_LOCALES,
  rootRedirectPath,
  resolveLocale,
  resolvePreferredLocale,
  resolveRootRedirectLocale,
} from '../../apps/web/src/lib/root-locale'

const ORIGIN = 'https://cinerie.com'

/**
 * Request minimo com a superficie que o middleware consome (`nextUrl.pathname`,
 * `nextUrl.clone()` e `headers.get()`). Evita importar `next/server` aqui: o
 * pacote `next` so resolve a partir de `apps/web/`, nunca da raiz do monorepo.
 */
function createRequest(
  pathname: string,
  acceptLanguage: string | null = null,
): Parameters<typeof middleware>[0] {
  const url = new URL(`${ORIGIN}${pathname}`)
  const headers = new Headers()
  if (acceptLanguage !== null) headers.set('accept-language', acceptLanguage)

  return {
    nextUrl: { pathname: url.pathname, clone: () => new URL(url.toString()) },
    headers,
  } as unknown as Parameters<typeof middleware>[0]
}

describe('root locale redirect', () => {
  it('nao cria page.tsx na raiz', () => {
    expect(existsSync(resolve(process.cwd(), 'apps', 'web', 'app', 'page.tsx'))).toBe(false)
  })

  it('mantem apenas pt publicado para a raiz enquanto en/es nao tem conteudo', () => {
    expect(PUBLISHED_LOCALES).toEqual(['pt'])
  })

  it.each([
    ['pt-BR,pt;q=0.9', 'pt'],
    ['es-ES,es;q=0.9', 'es'],
    ['en-US,en;q=0.9', 'en'],
    [null, 'en'],
    ['fr-FR,fr;q=0.9', 'en'],
  ])('detecta preferencia %s -> %s', (header, expected) => {
    expect(resolvePreferredLocale(header)).toBe(expected)
  })

  it.each([['pt-BR,pt;q=0.9'], ['es-ES,es;q=0.9'], ['en-US,en;q=0.9'], [null]])(
    'resolve GET / para /pt/ com Accept-Language %s',
    (header) => {
      expect(rootRedirectPath(header)).toBe('/pt/')
    },
  )

  it('helper de redirect aplica fallback para locale nao publicado', () => {
    expect(resolveRootRedirectLocale('pt-BR')).toBe('pt')
    expect(resolveRootRedirectLocale('es-ES')).toBe('pt')
    expect(resolveRootRedirectLocale('en-US')).toBe('pt')
    expect(resolveRootRedirectLocale(null)).toBe('pt')
  })

  it('resolve locale por segmento sem chamar API externa', () => {
    expect(resolveLocale('/pt/series/')).toBe('pt')
    expect(resolveLocale('/en/movies/')).toBe('en')
    expect(resolveLocale('/es/peliculas/')).toBe('es')
    expect(resolveLocale('/filmes/')).toBe('pt')
  })

  it('middleware redireciona somente a raiz, com 308 permanente', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps', 'web', 'middleware.ts'), 'utf8')
    expect(source).toContain('request.nextUrl.pathname === "/"')
    expect(source).toContain('NextResponse.redirect(url, 308)')
    // CONTROLE NEGATIVO: 301 tambem e permanente, mas permite ao cliente trocar
    // POST por GET. A raiz nao recebe POST hoje; mesmo assim, 308 e o par
    // correto de 307 (preserva metodo) e e o que esta declarado.
    expect(source).not.toContain('NextResponse.redirect(url, 301)')
    expect(source).not.toContain('permanentRedirect')
  })

  it('matcher continua excluindo media, _next, api e assets publicos', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps', 'web', 'middleware.ts'), 'utf8')
    const matcher = source
    expect(matcher).toContain('_next/static')
    expect(matcher).toContain('_next/image')
    expect(matcher).toContain('api')
    expect(matcher).toContain('media')
    expect(matcher).toContain('brand')
    expect(matcher).toContain('uploads')
  })

  it('home pt declara hreflang pt-BR e x-default para /pt/', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'apps', 'web', 'app', 'pt', 'page.tsx'),
      'utf8',
    )
    expect(source).toMatch(/["']pt-BR["']:\s*homeCanonicalUrl/)
    expect(source).toMatch(/["']x-default["']:\s*homeCanonicalUrl/)
  })
})

/**
 * Comportamento HTTP real: executa `middleware()` em vez de inspecionar o
 * fonte. Os testes de `toContain` acima continuam verdes se alguem trocar o
 * destino do redirect por um literal (ex.: "/en/"); estes aqui falham.
 */
describe('middleware da raiz (comportamento)', () => {
  // O middleware agora e assincrono (Fase 3: resolve redirects persistidos via
  // um route handler Node). O request mock nao expoe `nextUrl.origin`, entao a
  // resolucao de redirect persistido falha-fecha (sem rede) e o fluxo segue
  // normal — exatamente o comportamento esperado para /pt/*.
  it.each([['pt-BR,pt;q=0.9'], ['es-ES,es;q=0.9'], ['en-US,en;q=0.9'], [null]])(
    'GET / com Accept-Language %s responde 308 para /pt/',
    async (acceptLanguage) => {
      const response = await middleware(createRequest('/', acceptLanguage))

      expect(response.status).toBe(308)
      expect(response.headers.get('location')).toBe(`${ORIGIN}/pt/`)
    },
  )

  /**
   * O que ESTE teste protege, e por que ele inverteu em 2026-09-11.
   *
   * Ate aqui ele afirmava "nunca emite redirect permanente na raiz". A premissa
   * era que a negociacao por idioma tornava o destino variavel. Ela era falsa
   * desde sempre: os quatro casos acima mostram `en`, `es` e ausencia de
   * cabecalho caindo todos em `/pt/`. Um redirect que nao varia com a entrada
   * nao e negociacao — e um destino fixo.
   *
   * O que continua travado e o que realmente importa: 301 permite ao cliente
   * trocar o metodo, 308 nao. Trocar um pelo outro por engano seria regressao
   * silenciosa.
   */
  it('emite 308 (permanente E preservando metodo), nunca 301', async () => {
    const response = await middleware(createRequest('/', 'pt-BR'))

    expect(response.status).toBe(308)
    expect(response.status).not.toBe(301)
    expect(response.status).not.toBe(302)
  })

  it.each([['/pt/'], ['/pt/filmes/'], ['/filmes/'], ['/pt/series/interstellar/']])(
    'nao redireciona a rota ja prefixada %s',
    async (pathname) => {
      const response = await middleware(createRequest(pathname, 'en-US,en;q=0.9'))

      expect(response.status).toBe(200)
      expect(response.headers.get('location')).toBeNull()
    },
  )

  it('anota o locale resolvido nas rotas nao-raiz', async () => {
    expect(
      (await middleware(createRequest('/pt/filmes/'))).headers.get('x-screena-locale'),
    ).toBe('pt')
    expect(
      (await middleware(createRequest('/en/movies/'))).headers.get('x-screena-locale'),
    ).toBe('en')
  })
})
