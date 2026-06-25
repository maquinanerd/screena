/**
 * Teste de governanca (meta) — render puro de IO externo (invariante 3).
 *
 * Varre `apps/web/app` (o caminho de render do app publico) procurando:
 *   - `fetch(...)` apontando para um host externo (http/https absoluto);
 *   - imports de `api-clients/...` ou de `@screena/db`.
 *
 * Afirma que NAO existe nenhum. Paginas publicas indexaveis leem apenas
 * PostgreSQL/cache local — nunca rede no render, nunca acesso direto a clients
 * de API externa nem ao pacote de banco a partir do caminho de render.
 *
 * Se `apps/web/app` ainda nao existir, o teste passa trivialmente (Fase 0).
 *
 * Importante: este teste deve PASSAR agora. Se um dia falhar, significa que algo
 * reintroduziu API externa (ou DB) no render — a correcao e remover essa chamada,
 * nao relaxar o teste.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

/** Diretorio de render do app publico, relativo a raiz do repo (process.cwd()). */
const RENDER_DIR = resolve(process.cwd(), 'apps', 'web', 'app')

/** Extensoes de codigo que entram na varredura. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * `fetch("http://...")` ou `fetch('https://...')` — chamada de rede para host
 * externo absoluto dentro do render. Caminhos relativos (`fetch('/api/...')`)
 * nao casam aqui de proposito.
 */
const EXTERNAL_FETCH = /\bfetch\s*\(\s*[`'"]https?:\/\//i

/** import/require de qualquer modulo sob `api-clients/`. */
const API_CLIENT_IMPORT = /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"][^`'"]*api-clients\//i

/** import/require do pacote de banco `@screena/db`. */
const DB_IMPORT = /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"]@screena\/db[`'"/]/i

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
  if (!(await pathExists(RENDER_DIR))) return []

  const files = await collectCodeFiles(RENDER_DIR)
  const violations: Violation[] = []

  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
      const checks: ReadonlyArray<[RegExp, string]> = [
        [EXTERNAL_FETCH, 'fetch para host externo no render'],
        [API_CLIENT_IMPORT, 'import de api-clients/ no render'],
        [DB_IMPORT, 'import de @screena/db no render'],
      ]
      for (const [pattern, rule] of checks) {
        if (pattern.test(line)) {
          violations.push({
            file: relative(process.cwd(), file),
            rule,
            line: index + 1,
            snippet: line.trim(),
          })
        }
      }
    })
  }

  return violations
}

describe('governanca: render de apps/web/app e puro de IO externo (invariante 3)', () => {
  let violations: Violation[] = []

  beforeAll(async () => {
    violations = await findViolations()
  })

  it('nao chama fetch para host externo no render', () => {
    const offenders = violations.filter((v) => v.rule.startsWith('fetch'))
    expect(
      offenders,
      `Render nao pode chamar API externa. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa api-clients/ no render', () => {
    const offenders = violations.filter((v) => v.rule.includes('api-clients'))
    expect(
      offenders,
      `Render nao pode importar clients de API externa. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao importa @screena/db no render', () => {
    const offenders = violations.filter((v) => v.rule.includes('@screena/db'))
    expect(
      offenders,
      `Render nao acessa o banco diretamente; le via camada de dados/cache. Ocorrencias: ${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([])
  })

  it('nao acumula nenhuma violacao de pureza de render', () => {
    expect(violations).toEqual([])
  })
})
