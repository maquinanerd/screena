/**
 * Teste de governanca (meta) — render puro de IO externo (invariante 3).
 *
 * DOIS BURACOS QUE ESTE GUARD JA TEVE, e por que a correcao e esta:
 *
 *  1. ESCOPO. A varredura cobria so `apps/web/app`. Mas a camada que realmente
 *     busca dado do render vive em `apps/web/src/server/**` — e ela ficava fora.
 *     Um `fetch` a TMDB colocado ali passava com o guard VERDE. O escopo agora
 *     inclui as duas raizes, cada uma com o seu conjunto de regras.
 *
 *  2. DESTINO NAO-LITERAL. A regra antiga era `fetch(` seguido de aspa e
 *     `http`. Ou seja: so pegava a URL escrita a mao. `fetch(url)`,
 *     `fetch(base + caminho)` e `fetch(new URL(...))` passavam batido — e sao
 *     justamente a forma que uma chamada externa toma quando alguem a extrai
 *     para uma constante. Agora o guard classifica o DESTINO: so passa o que ele
 *     consegue PROVAR ser mesma-origem (literal comecando com `/`). Qualquer
 *     destino que o guard nao consiga ler e violacao — nao porque seja
 *     necessariamente externo, mas porque e INDETERMINAVEL, e um render puro nao
 *     pode depender de um destino que ninguem consegue auditar lendo o arquivo.
 *
 * ESCOPOS E O QUE CADA UM PROIBE:
 *
 *   `apps/web/app`         — caminho de render e rotas. Proibe TUDO, inclusive
 *                            importar `@screena/db` direto (o banco entra pela
 *                            camada de dados, nunca no componente de pagina).
 *   `apps/web/src/server`  — camada de dados server-only. Proibe rede externa,
 *                            api-clients, Entity Writer e Gemini. `@screena/db`
 *                            e PERMITIDO aqui: esta e a porta sancionada pela
 *                            governanca de layering (web-render-layering.test.ts).
 *
 * COMENTARIO NAO E CODIGO: a leitura passa pela porta unica
 * (`readSourceWithoutComments`), entao um exemplo de URL externa escrito dentro
 * de um comentario — como os desta cabecalho — nao derruba o guard. Antes
 * derrubava, e isso empurrava quem escrevia documentacao a mentir no comentario.
 *
 * Se `apps/web` ainda nao existir, o teste passa trivialmente (Fase 0).
 *
 * Importante: este teste deve PASSAR agora. Se um dia falhar, significa que algo
 * reintroduziu API externa (ou DB fora de lugar) no render — a correcao e remover
 * essa chamada, nao relaxar o teste.
 */

import { readdir, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

import { readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

/** Extensoes de codigo que entram na varredura. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** Nomes de regra. Cada escopo declara quais valem para ele. */
type RuleName = 'fetch' | 'api-clients' | 'db' | 'entity-writer' | 'gemini'

interface Scope {
  /** Caminho relativo a raiz do repo. */
  readonly dir: string
  /** Regras aplicadas dentro deste escopo. */
  readonly rules: readonly RuleName[]
}

/**
 * As duas raizes varridas. A diferenca entre elas e deliberada e esta
 * documentada no cabecalho: `src/server` PODE falar com o PostgreSQL; e para
 * isso que ela existe. O que nenhuma das duas pode e falar com a rede.
 */
const SCOPES: readonly Scope[] = [
  { dir: join('apps', 'web', 'app'), rules: ['fetch', 'api-clients', 'db', 'entity-writer', 'gemini'] },
  { dir: join('apps', 'web', 'src', 'server'), rules: ['fetch', 'api-clients', 'entity-writer', 'gemini'] },
]

/** import/require de qualquer modulo sob `api-clients/`. */
const API_CLIENT_IMPORT = /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"][^`'"]*api-clients\//i

/** import/require do pacote de banco `@screena/db`. */
const DB_IMPORT = /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"]@screena\/db[`'"/]/i

/** import/require do Entity Writer worker-only. */
const ENTITY_WRITER_IMPORT =
  /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"][^`'"]*(?:services\/entity-writer|@screena\/entity-writer)/i

/** import/require de SDK/client Gemini. */
const GEMINI_IMPORT =
  /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"](?:@google\/(?:generative-ai|genai)|google-generativeai|[^`'"]*api-clients\/gemini|@screena\/gemini-client)/i

/**
 * Uma chamada `fetch(`, capturando o que vem DEPOIS do parenteses ate o fim da
 * linha. Casa `fetch(`, `await fetch(`, `globalThis.fetch(` e `window.fetch(`;
 * NAO casa `prefetch(` (nao ha fronteira de palavra antes de `fetch` ali).
 */
const FETCH_CALL = /\bfetch\s*\(\s*(.*)$/i

/** Veredicto da classificacao de destino de um `fetch(`. */
type FetchVerdict =
  | { readonly kind: 'same-origin' }
  | { readonly kind: 'external'; readonly why: string }
  | { readonly kind: 'unverifiable'; readonly why: string }

/**
 * Classifica o DESTINO de um `fetch(` a partir do texto que segue o parenteses.
 *
 * A regra e de prova, nao de suspeita: passa apenas o que se consegue LER como
 * mesma-origem. Tudo que nao se consegue ler cai em `unverifiable` — e
 * `unverifiable` reprova. E o unico jeito de o guard nao ser contornavel
 * extraindo a URL para uma variavel.
 */
export function classifyFetchTarget(afterParen: string): FetchVerdict {
  const arg = afterParen.trimStart()

  if (arg.length === 0) {
    return {
      kind: 'unverifiable',
      why: 'destino em outra linha: o guard nao consegue provar que e mesma-origem',
    }
  }

  const quote = arg.charAt(0)
  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return {
      kind: 'unverifiable',
      why: `destino nao-literal (${arg.slice(0, 40)}): variavel, concatenacao ou new URL()`,
    }
  }

  const body = arg.slice(1)

  // Template que ja comeca interpolando: o host pode ser qualquer coisa.
  if (quote === '`' && body.startsWith('${')) {
    return { kind: 'unverifiable', why: 'template literal comecando por interpolacao: host indeterminavel' }
  }

  // Esquema absoluto explicito.
  if (/^https?:/i.test(body)) {
    return { kind: 'external', why: `URL absoluta no render: ${body.slice(0, 60)}` }
  }

  // Protocolo-relativo (`//host/...`) tambem sai da origem.
  if (body.startsWith('//')) {
    return { kind: 'external', why: `URL protocolo-relativa no render: ${body.slice(0, 60)}` }
  }

  return { kind: 'same-origin' }
}

interface Violation {
  file: string
  rule: string
  line: number
  snippet: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Lista recursivamente arquivos de codigo sob `dir`. */
async function collectCodeFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...(await collectCodeFiles(full)))
    } else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = []

  for (const scope of SCOPES) {
    const absolute = resolve(REPO_ROOT, scope.dir)
    if (!(await pathExists(absolute))) continue

    const files = await collectCodeFiles(absolute)
    const active = new Set(scope.rules)

    for (const file of files) {
      // Porta unica: comentario nao e codigo. Ver cabecalho.
      const content = readSourceWithoutComments(file)
      const lines = content.split(/\r?\n/)

      lines.forEach((line, index) => {
        const record = (rule: string): void => {
          violations.push({
            file: relative(REPO_ROOT, file).split('\\').join('/'),
            rule,
            line: index + 1,
            snippet: line.trim(),
          })
        }

        if (active.has('fetch')) {
          const match = FETCH_CALL.exec(line)
          if (match) {
            const verdict = classifyFetchTarget(match[1] ?? '')
            if (verdict.kind === 'external') {
              record(`fetch para host externo no render — ${verdict.why}`)
            } else if (verdict.kind === 'unverifiable') {
              record(`fetch com destino nao-verificavel no render — ${verdict.why}`)
            }
          }
        }

        if (active.has('api-clients') && API_CLIENT_IMPORT.test(line)) {
          record('import de api-clients/ no render')
        }
        if (active.has('db') && DB_IMPORT.test(line)) {
          record('import de @screena/db no render')
        }
        if (active.has('entity-writer') && ENTITY_WRITER_IMPORT.test(line)) {
          record('import de services/entity-writer no render')
        }
        if (active.has('gemini') && GEMINI_IMPORT.test(line)) {
          record('import de SDK/client Gemini no render')
        }
      })
    }
  }

  return violations
}

describe('governanca: render de apps/web e puro de IO externo (invariante 3)', () => {
  let violations: Violation[] = []

  beforeAll(async () => {
    violations = await findViolations()
  })

  it('nao chama fetch para host externo no render', () => {
    const offenders = violations.filter((v) => v.rule.startsWith('fetch para host externo'))
    expect(
      offenders,
      `Render nao pode chamar API externa. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao chama fetch com destino que o guard nao consiga verificar', () => {
    const offenders = violations.filter((v) => v.rule.startsWith('fetch com destino nao-verificavel'))
    expect(
      offenders,
      'Um destino que o guard nao le e um destino que ninguem audita. Escreva o caminho ' +
        `literal de mesma-origem, ou mova a chamada para fora do render. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa api-clients/ no render', () => {
    const offenders = violations.filter((v) => v.rule.includes('api-clients'))
    expect(
      offenders,
      `Render nao pode importar clients de API externa. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa @screena/db no caminho de pagina (apps/web/app)', () => {
    const offenders = violations.filter((v) => v.rule.includes('@screena/db'))
    expect(
      offenders,
      `Render nao acessa o banco diretamente; le via apps/web/src/server/**. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa o Entity Writer (worker-only) no render', () => {
    const offenders = violations.filter((v) => v.rule.includes('entity-writer'))
    expect(
      offenders,
      `Render nao pode importar o Entity Writer (offline-only). Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa SDK/client Gemini no render', () => {
    const offenders = violations.filter((v) => v.rule.includes('Gemini'))
    expect(
      offenders,
      `Render nao pode importar Gemini (zero Gemini no render). Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao acumula nenhuma violacao de pureza de render', () => {
    expect(violations).toEqual([])
  })

  it('varre as DUAS raizes, e a camada de dados nao ficou de fora', async () => {
    // Controle de escopo: se alguem reduzir SCOPES de volta a `apps/web/app`,
    // este teste cai. Foi exatamente essa reducao que deixou passar um fetch
    // externo em src/server com o guard verde.
    const dirs = SCOPES.map((s) => s.dir.split('\\').join('/'))
    expect(dirs).toContain('apps/web/app')
    expect(dirs).toContain('apps/web/src/server')

    const serverScope = SCOPES.find((s) => s.dir.split('\\').join('/') === 'apps/web/src/server')
    expect(serverScope?.rules).toContain('fetch')
    // E a porta sancionada continua aberta: a camada de dados PODE ler o banco.
    expect(serverScope?.rules).not.toContain('db')

    const serverDir = resolve(REPO_ROOT, 'apps', 'web', 'src', 'server')
    if (await pathExists(serverDir)) {
      const files = await collectCodeFiles(serverDir)
      expect(files.length).toBeGreaterThan(0)
    }
  })

  describe('classificacao de destino de fetch (unidade)', () => {
    it('aprova caminho literal de mesma-origem', () => {
      expect(classifyFetchTarget(`'/api/auth/session', { credentials: 'same-origin' })`)).toEqual({
        kind: 'same-origin',
      })
      expect(classifyFetchTarget('`/api/me/lists/${id}?limit=100`, {')).toEqual({ kind: 'same-origin' })
    })

    it('reprova URL absoluta e protocolo-relativa', () => {
      expect(classifyFetchTarget(`'https://api.themoviedb.org/3/movie/1'`).kind).toBe('external')
      expect(classifyFetchTarget(`"http://exemplo.test/x"`).kind).toBe('external')
      expect(classifyFetchTarget(`'//exemplo.test/x'`).kind).toBe('external')
    })

    it('reprova o que NAO consegue ler — o buraco que existia', () => {
      // Estas quatro formas passavam batido no guard antigo.
      expect(classifyFetchTarget('url)').kind).toBe('unverifiable')
      expect(classifyFetchTarget('base + caminho)').kind).toBe('unverifiable')
      expect(classifyFetchTarget('new URL(caminho, origem))').kind).toBe('unverifiable')
      expect(classifyFetchTarget('`${TMDB_BASE}/movie/1`)').kind).toBe('unverifiable')
      // Destino quebrado em outra linha tambem e indeterminavel.
      expect(classifyFetchTarget('').kind).toBe('unverifiable')
    })
  })
})
