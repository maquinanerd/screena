/**
 * Cabecalhos de seguranca do app publico — os quatro inocuos.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO (2026-08-25)
 * ============================================================================
 * `https://cinerie.com/pt/` e `https://cinerie.com/api/health/` respondiam 200
 * com ZERO de sete cabecalhos de seguranca. Este teste trava os quatro que a
 * PR entrega e recusa os dois que ela deliberadamente NAO entrega (CSP e HSTS,
 * que exigem PR propria).
 *
 * ============================================================================
 * POR QUE O TESTE IMPORTA O `next.config.ts` DE VERDADE
 * ============================================================================
 * Um guard textual sobre o arquivo casaria com o proprio comentario que explica
 * a regra — o defeito que `tests/support/source-text.ts` existe para tornar
 * impossivel. Aqui nao ha esse risco para a parte principal: o teste CHAMA
 * `nextConfig.headers()` e mede a saida. So a derivacao da lista de arvores de
 * rota le fonte, e le pela porta unica.
 *
 * ============================================================================
 * A PARTE QUE QUASE PASSOU DESPERCEBIDA
 * ============================================================================
 * `source: '/:path*'` com `strict: true` NAO casa `/pt/` nem `/api/health/` —
 * e este repositorio usa `trailingSlash: true`, ou seja, TODA URL canonica
 * termina em barra. O que salva e o `regexModifier` que o Next aplica a rota
 * customizada (`modifyRouteRegex` acrescenta `(?:\/)?$`). Por isso a suite
 * abaixo nao confia no padrao: ela constroi o matcher com as MESMAS opcoes de
 * `buildCustomRoute` e prova o casamento em URL com barra final.
 */

import { createRequire } from 'node:module'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import nextConfig from '../../apps/web/next.config'
import { TMDB_IMAGE_HOST } from '@screena/public-contracts'

import { middleware } from '../../apps/web/middleware'
import { BASE_SECURITY_HEADERS } from '../../apps/web/next.config'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text.js'

// ---------------------------------------------------------------------------
// Saida real da configuracao
// ---------------------------------------------------------------------------

type HeaderPair = { key: string; value: string }
type HeaderRule = { source: string; headers: HeaderPair[] }

async function headerRules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers
  if (typeof headers !== 'function') {
    throw new Error('apps/web/next.config.ts nao define headers() — os quatro cabecalhos sumiram')
  }
  return (await headers()) as unknown as HeaderRule[]
}

const GLOBAL_SOURCE = '/:path*'

function valueOf(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
}

// ---------------------------------------------------------------------------
// (1) Os quatro cabecalhos, na regra que cobre tudo
// ---------------------------------------------------------------------------

describe('os quatro cabecalhos inocuos saem na regra global', () => {
  it('existe UMA regra que cobre todo path', async () => {
    const rules = await headerRules()
    const globais = rules.filter((r) => r.source === GLOBAL_SOURCE)
    expect(
      globais,
      `esperava exatamente uma regra com source ${GLOBAL_SOURCE}; sources vistos: ` +
        rules.map((r) => r.source).join(', '),
    ).toHaveLength(1)
  })

  it('a regra global carrega EXATAMENTE os cinco, com os valores decididos', async () => {
    const rules = await headerRules()
    const global = rules.find((r) => r.source === GLOBAL_SOURCE)
    expect(global).toBeDefined()

    expect(global?.headers).toEqual([
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: expect.any(String) },
      // O quinto entrou em 2026-09-02. A lista continua EXATA de proposito:
      // um cabecalho a mais que ninguem decidiu e tao ruim quanto um a menos,
      // e este teste e o unico lugar onde a lista precisa ser lida inteira.
      {
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      },
    ])
  })

  it('X-Frame-Options e DENY, nao SAMEORIGIN', async () => {
    // MEDIDO: o unico elemento `<iframe>` do repositorio e o player do YouTube
    // (`apps/web/app/_components/youtube-frame.tsx`), que e SAIDA. Nada enquadra
    // uma pagina da Cinerie — `apps/admin` nao tem um `<iframe>` sequer e o CMS
    // nao configura live preview. Sem enquadramento de MESMA origem,
    // `SAMEORIGIN` nao compraria nada alem do que `DENY` ja da.
    const rules = await headerRules()
    const global = rules.find((r) => r.source === GLOBAL_SOURCE)
    expect(valueOf(global as HeaderRule, 'X-Frame-Options')).toBe('DENY')
  })
})

// ---------------------------------------------------------------------------
// (2) Permissions-Policy: o que desliga e, sobretudo, o que NAO desliga
// ---------------------------------------------------------------------------

/** Features medidas como ausentes de `apps/**` e por isso desligadas. */
const FEATURES_DESLIGADAS = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'browsing-topics',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'idle-detection',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'screen-wake-lock',
  'serial',
  'usb',
  'xr-spatial-tracking',
] as const

/**
 * Features que NAO podem entrar na politica. As tres primeiras sao delegadas ao
 * player de trailer via `allow=`; desliga-las no documento de topo revogaria a
 * delegacao e quebraria tela cheia e video com DRM. A quarta (WebAuthn) fica de
 * fora porque a borda de autenticacao esta viva e passkey e adicao plausivel.
 */
const FEATURES_QUE_NAO_PODEM_ENTRAR = [
  'fullscreen',
  'picture-in-picture',
  'encrypted-media',
  'publickey-credentials-get',
] as const

describe('Permissions-Policy desliga o que o app nao usa e nada alem disso', () => {
  it('cada feature medida como nao usada aparece com allowlist VAZIA', async () => {
    const rules = await headerRules()
    const politica = valueOf(
      rules.find((r) => r.source === GLOBAL_SOURCE) as HeaderRule,
      'Permissions-Policy',
    )
    expect(politica).toBeTypeOf('string')
    const faltando = FEATURES_DESLIGADAS.filter((f) => !(politica ?? '').includes(`${f}=()`))
    expect(faltando, `features sem allowlist vazia: ${faltando.join(', ')}`).toEqual([])
  })

  it('a politica NAO cita as tres features que o player de trailer delega', async () => {
    const rules = await headerRules()
    const politica =
      valueOf(rules.find((r) => r.source === GLOBAL_SOURCE) as HeaderRule, 'Permissions-Policy') ??
      ''
    const intrusas = FEATURES_QUE_NAO_PODEM_ENTRAR.filter((f) =>
      new RegExp(`(^|[,\\s])${f}\\s*=`).test(politica),
    )
    expect(
      intrusas,
      'estas features estao delegadas ao iframe do player (ou reservadas a borda de auth) ' +
        `e nao podem ter allowlist vazia no documento de topo: ${intrusas.join(', ')}`,
    ).toEqual([])
  })

  it('o player realmente pede as tres features que a politica poupa', () => {
    // Se o `allow=` do player mudar, a justificativa acima deixa de valer e
    // este teste avisa — em vez de a excecao virar folclore.
    const player = readSourceWithoutComments('apps/web/app/_components/youtube-frame.tsx')
    for (const feature of ['encrypted-media', 'picture-in-picture', 'fullscreen']) {
      expect(player, `o player deixou de pedir ${feature}`).toContain(feature)
    }
  })
})

// ---------------------------------------------------------------------------
// (3) CSP e HSTS — a "PR propria" que a leva anterior prometeu
// ---------------------------------------------------------------------------
//
// Ate 2026-09-02 esta secao RECUSAVA os dois, com o motivo escrito: "CSP mal
// calibrado quebra a pagina e HSTS e quase irreversivel: os dois exigem PR
// propria". Esta e a PR propria, e a recusa virou exigencia.
//
// Os dois entram por CAMINHOS DIFERENTES, e isso nao e arbitrario:
//   HSTS  vai no `next.config`, com os outros quatro. O valor nao tem `:`.
//   CSP   vai no MIDDLEWARE. O valor e cheio de `:` (`https://image.tmdb.org`,
//         `data:`), e a regra `/:path*` do config passa chave e valor por
//         `compileNonPath()` — que so devolve cedo quando NAO ha `:`.

describe('HSTS entra pelo next.config, com os outros quatro', () => {
  it('emite Strict-Transport-Security na regra que cobre todo path', async () => {
    const rules = await headerRules()
    const hsts = rules
      .flatMap((r) => r.headers)
      .find((h) => h.key.toLowerCase() === 'strict-transport-security')

    expect(hsts, 'nenhuma regra emite HSTS').toBeDefined()
    // Os tres pedacos que a lista de preload exige. `max-age` de 2 anos e o
    // piso; menos que isso e recusado pela lista.
    expect(hsts!.value).toContain('max-age=63072000')
    expect(hsts!.value).toContain('includeSubDomains')
    expect(hsts!.value).toContain('preload')
  })

  it('o valor do HSTS nao contem `:` — senao `compileNonPath` o corromperia', () => {
    // A MESMA armadilha que mantem `Permissions-Policy` sem dois-pontos. Um
    // HSTS corrompido nao avisa: ele simplesmente deixa de proteger.
    const rules = [...BASE_SECURITY_HEADERS]
    for (const h of rules) {
      expect(h.value, `${h.key} contem ':' e seria corrompido`).not.toContain(':')
    }
  })
})

describe('CSP entra pelo middleware, e em REPORT-ONLY', () => {
  function request(pathname: string): Parameters<typeof middleware>[0] {
    const url = new URL(`https://cinerie.com${pathname}`)
    return {
      nextUrl: {
        pathname: url.pathname,
        origin: url.origin,
        clone: () => new URL(url.toString()),
      },
      headers: new Headers(),
    } as unknown as Parameters<typeof middleware>[0]
  }

  it('a resposta normal carrega Content-Security-Policy-Report-Only', async () => {
    const original = globalThis.fetch
    // Sem rede: o lookup de redirect nao e o assunto aqui.
    globalThis.fetch = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch
    const response = await middleware(request('/pt/filmes/a-odisseia/'))
    globalThis.fetch = original

    const csp = response.headers.get('content-security-policy-report-only')
    expect(csp, 'o middleware nao emitiu CSP').not.toBeNull()

    // REPORT-ONLY, e nao bloqueante: promover e decisao separada, depois de
    // olhar os relatos. O teste trava a decisao de HOJE.
    expect(response.headers.get('content-security-policy')).toBeNull()

    // As diretivas que fecham as portas que nao usamos.
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    // E as origens que a pagina REALMENTE usa — sem elas o CSP relataria a
    // pagina inteira como violacao e o relato viraria ruido.
    // O host vem da FONTE UNICA, aqui tambem: repetir o literal no teste
    // burlaria a mesma regra que o codigo passou a respeitar.
    expect(csp).toContain(`https://${TMDB_IMAGE_HOST}`)
    expect(csp).toContain('https://www.youtube-nocookie.com')
  })

  it('o REDIRECT da raiz tambem carrega a politica', async () => {
    // Um caminho de saida sem CSP nao quebra nada e nao avisa nada — e por isso
    // que os tres caminhos passam pela mesma funcao.
    const response = await middleware(request('/'))
    expect(response.status).toBe(307)
    expect(response.headers.get('content-security-policy-report-only')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (4) A borda de autenticacao nao pode ser REBAIXADA em silencio
// ---------------------------------------------------------------------------

/**
 * MEDIDO em `next/dist/server/lib/router-server.js` + `send-response.js` (15.5):
 * o cabecalho do `next.config` e aplicado com `res.setHeader` ANTES do handler,
 * e o handler so consegue acrescentar o seu "if it is either not present in the
 * outbound response". Ou seja: um `Referrer-Policy` global SUPRIMIRIA o
 * `no-referrer` que `AUTH_SECURITY_HEADERS` emite nas rotas do user-platform.
 */
const REFERRER_DA_BORDA_DE_AUTH = 'no-referrer'

/** Extrai a arvore de `/api/<arvore>/:path*`. */
function arvoreDe(source: string): string | null {
  const m = /^\/api\/([^/]+)\/:path\*$/.exec(source)
  return m?.[1] ?? null
}

describe('a borda de autenticacao mantem o Referrer-Policy mais restrito', () => {
  it('cada regra de arvore de auth pina no-referrer, e vem DEPOIS da global', async () => {
    const rules = await headerRules()
    const indiceGlobal = rules.findIndex((r) => r.source === GLOBAL_SOURCE)
    const bordas = rules.filter((r) => arvoreDe(r.source) !== null)
    expect(bordas.length, 'nenhuma regra de borda de auth').toBeGreaterThan(0)

    for (const borda of bordas) {
      expect(valueOf(borda, 'Referrer-Policy')).toBe(REFERRER_DA_BORDA_DE_AUTH)
      expect(
        rules.indexOf(borda),
        `${borda.source} precisa vir depois de ${GLOBAL_SOURCE}: o Next faz ` +
          'resHeaders[key] = value e a ULTIMA regra que casa vence',
      ).toBeGreaterThan(indiceGlobal)
    }
  })

  it('a chave e grafada IGUAL a da regra global (a colisao e na chave literal)', async () => {
    const rules = await headerRules()
    const global = rules.find((r) => r.source === GLOBAL_SOURCE) as HeaderRule
    const grafiaGlobal = global.headers.find((h) => h.key.toLowerCase() === 'referrer-policy')?.key
    for (const borda of rules.filter((r) => arvoreDe(r.source) !== null)) {
      const grafia = borda.headers.find((h) => h.key.toLowerCase() === 'referrer-policy')?.key
      expect(
        grafia,
        `${borda.source} usa outra grafia da chave; a sobreposicao nao aconteceria`,
      ).toBe(grafiaGlobal)
    }
  })

  it('TODA arvore de /api que responde pelo runtime de auth esta coberta', async () => {
    const rules = await headerRules()
    const cobertas = new Set(
      rules.map((r) => arvoreDe(r.source)).filter((t): t is string => t !== null),
    )

    const apiDir = path.join(REPO_ROOT, 'apps', 'web', 'app', 'api')
    const emitemNoReferrer = new Set<string>()
    const andar = (dir: string, arvore: string | null): void => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const cheio = path.join(dir, entrada.name)
        if (entrada.isDirectory()) {
          andar(cheio, arvore ?? entrada.name)
          continue
        }
        if (entrada.name !== 'route.ts' || arvore === null) continue
        const codigo = readSourceWithoutComments(path.relative(REPO_ROOT, cheio))
        if (codigo.includes('src/server/auth/runtime')) emitemNoReferrer.add(arvore)
      }
    }
    andar(apiDir, null)

    expect(emitemNoReferrer.size, 'a varredura nao achou nenhuma rota de auth').toBeGreaterThan(0)
    const descobertas = [...emitemNoReferrer].filter((t) => !cobertas.has(t)).sort()
    expect(
      descobertas,
      'estas arvores de /api respondem pelo runtime de auth (que emite ' +
        `${REFERRER_DA_BORDA_DE_AUTH}) mas nao tem regra propria em next.config.ts — ` +
        'o Referrer-Policy global as rebaixaria em silencio: ' +
        descobertas.join(', '),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// (5) O casamento de rota, com o matcher REAL do Next
// ---------------------------------------------------------------------------

/**
 * Reconstroi o matcher exatamente como `buildCustomRoute`
 * (next/dist/server/lib/router-utils/filesystem.js) faz: `strict: true`,
 * `removeUnnamedParams: true` e o `regexModifier` que acrescenta a barra final
 * opcional. Sem esse modificador, `'/:path*'` nao casaria NENHUMA URL canonica
 * deste site (todas terminam em `/`, por `trailingSlash: true`).
 *
 * `next` nao esta no node_modules da raiz — a resolucao e ancorada em apps/web.
 */
function construirMatcher(source: string): (pathname: string) => unknown {
  const requireFromWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url))
  let getPathMatch: (s: string, o: unknown) => (p: string) => unknown
  let modifyRouteRegex: (r: string, restricted?: string[]) => string
  try {
    ;({ getPathMatch } = requireFromWeb('next/dist/shared/lib/router/utils/path-match.js'))
    ;({ modifyRouteRegex } = requireFromWeb('next/dist/lib/redirect-status.js'))
  } catch (erro) {
    throw new Error(
      'os internos do Next usados por buildCustomRoute mudaram de lugar. Reveja se ' +
        "`source: '/:path*'` ainda casa URL com barra final antes de relaxar este teste. " +
        String(erro),
    )
  }
  return getPathMatch(source, {
    strict: true,
    removeUnnamedParams: true,
    regexModifier: (regex: string) => modifyRouteRegex(regex, undefined),
    sensitive: false,
  })
}

describe('o source da regra global cobre as URLs que o site realmente serve', () => {
  const canonicas = [
    '/',
    '/pt/',
    '/pt/filmes/duna-parte-dois/',
    '/pt/series/severance/',
    '/api/health/',
    '/api/auth/login',
    '/robots.txt',
    '/sitemap.xml',
    '/media/editorial/ab/cd.jpg',
  ]

  it('casa todas elas — inclusive as de barra final', () => {
    const casa = construirMatcher(GLOBAL_SOURCE)
    const nao = canonicas.filter((p) => casa(p) === false)
    expect(
      nao,
      'estas URLs ficariam SEM cabecalho de seguranca (o site usa trailingSlash: true): ' +
        nao.join(', '),
    ).toEqual([])
  })

  it('as regras de borda casam so a propria arvore', async () => {
    const rules = await headerRules()
    for (const borda of rules.filter((r) => arvoreDe(r.source) !== null)) {
      const arvore = arvoreDe(borda.source) as string
      const casa = construirMatcher(borda.source)
      expect(
        casa(`/api/${arvore}/qualquer/`),
        `${borda.source} deveria casar a propria arvore`,
      ).not.toBe(false)
      expect(casa('/api/health/'), `${borda.source} nao pode casar /api/health/`).toBe(false)
      expect(casa('/pt/'), `${borda.source} nao pode casar pagina publica`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// (6) Por que aqui e nao no middleware
// ---------------------------------------------------------------------------

describe('a escolha do lugar tem base: o middleware nao alcanca /api', () => {
  it('o matcher do middleware exclui api — por isso os cabecalhos vivem no next.config', () => {
    const middleware = readSourceWithoutComments('apps/web/middleware.ts')
    const matcher = /matcher:\s*\[([^\]]*)\]/.exec(middleware)?.[1] ?? ''
    expect(matcher, 'o matcher do middleware sumiu do arquivo').not.toBe('')
    expect(
      matcher,
      'se o middleware passar a cobrir /api, reveja se next.config.headers() continua ' +
        'sendo o unico lugar necessario — mas nao mova os cabecalhos para la sem medir ' +
        'o custo do subrequest de redirect persistido em toda chamada de API',
    ).toContain('api')
  })
})
