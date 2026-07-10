/**
 * Teste de governanca — RapidAPI e OFFLINE-ONLY (invariantes 3, 4, 6, 8).
 *
 * Varredura de arquivos (espelha o estilo de tmdb-provider-separation.test.ts):
 *  - o render (`apps/web`) NUNCA importa os clients/workers RapidAPI, nem cita
 *    host/header RapidAPI — render puro le so PostgreSQL/cache (invariante 3);
 *  - nenhum arquivo do repo carrega uma chave RapidAPI hardcoded;
 *  - os stores nascem fail-closed (`display_allowed=false` estrutural), o delete
 *    do worker de streaming e escopado por `providerApi`, os workers nao baixam
 *    imagem e nao tocam `screen_score`.
 *
 * Se este teste falhar, uma dessas fronteiras vazou — corrija o codigo, nunca o
 * teste.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules', 'dist', '.next', '.turbo', 'build'])

/** Coleta recursivamente arquivos com as extensoes dadas. */
async function collectSource(dir: string, exts: readonly string[]): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await collectSource(join(dir, entry.name), exts)))
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

/** Remove comentarios de bloco e de linha (preservando `://` de URLs). */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//')
      if (idx > 0 && line[idx - 1] === ':') return line
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
}

function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const WEB_DIR = resolve(ROOT, 'apps', 'web')

describe('governanca: RapidAPI nunca alcanca o render (invariante 3)', () => {
  const FORBIDDEN_PACKAGES = [
    '@screena/rapidapi-core',
    '@screena/film-show-ratings-client',
    '@screena/streaming-availability-client',
    '@screena/ratings',
    '@screena/streaming',
  ] as const

  it('apps/web nunca importa clients/workers RapidAPI', async () => {
    const files = await collectSource(WEB_DIR, ['.ts', '.tsx'])
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const content = stripComments(await readFile(file, 'utf8'))
      for (const pkg of FORBIDDEN_PACKAGES) {
        const escaped = escapeRegExp(pkg)
        const pattern = new RegExp(
          `(?:from|import|require)\\s*\\(?\\s*['"]${escaped}['"]`,
        )
        if (pattern.test(content)) {
          offenders.push(`${rel(file)} -> importa ${pkg}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('apps/web nunca cita host/header RapidAPI', async () => {
    const files = await collectSource(WEB_DIR, ['.ts', '.tsx'])
    const forbiddenLiterals = [
      'film-show-ratings.p.rapidapi.com',
      'streaming-availability.p.rapidapi.com',
      'x-rapidapi-key',
    ]

    const offenders: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      for (const literal of forbiddenLiterals) {
        if (content.includes(literal)) offenders.push(`${rel(file)} -> "${literal}"`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('governanca: nenhuma chave RapidAPI hardcoded (invariante: chave so em env)', () => {
  const SCAN_ROOTS = ['api-clients', 'services', 'packages', 'apps', 'tests'].map((dir) =>
    resolve(ROOT, dir),
  )
  // Literais obviamente-fake usados em teste sao permitidos.
  const ALLOW = /test-key|redacted|xxxx|placeholder|example/i

  it('nenhum literal parecido com chave e atribuido a algo /rapidapi.*key/i', async () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of await collectSource(root, ['.ts', '.tsx'])) {
        const content = stripComments(await readFile(file, 'utf8'))
        content.split(/\r?\n/).forEach((line, index) => {
          if (!/rapidapi.*key/i.test(line)) return
          const literals = line.match(/['"`]([^'"`]+)['"`]/g) ?? []
          for (const raw of literals) {
            const value = raw.slice(1, -1)
            // "Parece uma chave real": 20+ caracteres hex/base62 puros (sem `_`/`-`).
            if (/^[A-Za-z0-9]{20,}$/.test(value) && !ALLOW.test(value)) {
              offenders.push(`${rel(file)}:${index + 1} -> ${value.slice(0, 8)}...`)
            }
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('governanca: stores nascem fail-closed', () => {
  const ratingsStore = resolve(
    ROOT,
    'services',
    'ratings',
    'src',
    'persistence',
    'external-ratings-store.ts',
  )
  const watchStore = resolve(
    ROOT,
    'services',
    'streaming',
    'src',
    'persistence',
    'watch-store.ts',
  )

  it('external-ratings-store fixa display/license e NAO os aceita como parametro', async () => {
    const content = await readFile(ratingsStore, 'utf8')
    expect(content).toContain('displayAllowed: false')
    expect(content).toContain("licenseStatus: 'unknown'")
    // O valor jamais vem da linha existente ou de input do chamador.
    expect(content).not.toContain('displayAllowed: row.')
    expect(content).not.toContain('displayAllowed: input.')
    expect(content).not.toContain('displayAllowed: true')
  })

  it('watch-store escopa TODO deleteMany por providerApi e nasce display_allowed=false', async () => {
    const raw = await readFile(watchStore, 'utf8')
    expect(raw).toContain('displayAllowed: false')

    // Comentarios podem MENCIONAR deleteMany; miramos so o codigo.
    const code = stripComments(raw)
    const parts = code.split('deleteMany')
    // Ha pelo menos um deleteMany real no codigo.
    expect(parts.length).toBeGreaterThan(1)
    // Cada deleteMany do codigo tem `providerApi` no seu bloco `where`.
    for (let i = 1; i < parts.length; i += 1) {
      const window = (parts[i] ?? '').slice(0, 300)
      expect(window).toContain('providerApi')
    }
  })
})

describe('governanca: workers offline nao baixam imagem nem tocam screen_score', () => {
  const WORKER_DIRS = [
    resolve(ROOT, 'services', 'streaming', 'src'),
    resolve(ROOT, 'services', 'ratings', 'src'),
  ]

  it('nenhum worker referencia download de imagem', async () => {
    const offenders: string[] = []
    let scanned = 0
    for (const dir of WORKER_DIRS) {
      for (const file of await collectSource(dir, ['.ts'])) {
        scanned += 1
        const content = stripComments(await readFile(file, 'utf8'))
        for (const pattern of [/downloadImage/i, /writeFile/i, /image\.tmdb\.org/i]) {
          if (pattern.test(content)) offenders.push(`${rel(file)} -> ${String(pattern)}`)
        }
      }
    }
    // Anti-vacuidade: um diretorio renomeado nao pode transformar esta guarda
    // num teste que passa sem varrer arquivo nenhum.
    expect(scanned).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  it('nenhum worker toca screen_score como codigo (identificador ou coluna)', async () => {
    // NOTA: report.ts de AMBOS os workers cita `screen_score` numa linha de
    // governanca (Markdown) afirmando que a coluna NAO e tocada. Por isso a
    // varredura mira USO DE CODIGO (identificador `screenScore` ou write
    // `screen_score:`), nao a prosa que reforca o invariante.
    const offenders: string[] = []
    let scanned = 0
    for (const dir of WORKER_DIRS) {
      for (const file of await collectSource(dir, ['.ts'])) {
        scanned += 1
        const content = stripComments(await readFile(file, 'utf8'))
        for (const pattern of [/\bscreenScore\b/, /screen_score\s*:/]) {
          if (pattern.test(content)) offenders.push(`${rel(file)} -> ${String(pattern)}`)
        }
      }
    }
    expect(scanned).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
