/**
 * Governanca: o host do CDN de imagens do TMDB tem UMA fonte no repositorio.
 *
 * A implementacao canonica de `buildTmdbImageUrl` vive em
 * packages/public-contracts/src/media-url.ts — o UNICO arquivo de producao
 * autorizado a conter o literal `image.tmdb.org`. Este teste varre o repo
 * inteiro (mesma regra do audit `check-render-purity.mjs`, aqui como trava de
 * teste): qualquer segunda ocorrencia em codigo de producao e drift — duas
 * construcoes de URL divergem em validacao e viram bug de exibicao dificil de
 * rastrear (foi exatamente o caso de media/build.ts, que concatenava sem as
 * defesas do canonico).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildTmdbImageUrl } from '@screena/public-contracts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Unico arquivo de producao autorizado a conter o host (relativo a raiz, com '/'). */
const CANONICAL_HELPER = 'packages/public-contracts/src/media-url.ts'

/** Diretorios de producao varridos. */
const PRODUCTION_DIRS = ['apps', 'packages', 'services', 'api-clients', 'seo', 'workers']

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
])

/** Testes e validadores descartaveis citam o host em expects/fixtures. */
function isNonProduction(relPath: string): boolean {
  return (
    /(^|\/)__tests__\//.test(relPath) ||
    /\.test\.[cm]?[jt]sx?$/.test(relPath) ||
    /(^|\/)scripts\//.test(relPath)
  )
}

function collectFiles(absDir: string): string[] {
  const out: string[] = []
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const child = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      out.push(...collectFiles(child))
    } else if (entry.isFile() && CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(child)
    }
  }
  return out
}

function rel(absPath: string): string {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

describe('fonte unica do host de imagem TMDB', () => {
  it('o literal image.tmdb.org existe SO no helper canonico', () => {
    const offenders: string[] = []
    let helperSeen = false

    for (const dirName of PRODUCTION_DIRS) {
      const absDir = path.join(ROOT, dirName)
      try {
        if (!statSync(absDir).isDirectory()) continue
      } catch {
        continue
      }
      for (const absFile of collectFiles(absDir)) {
        const relPath = rel(absFile)
        if (isNonProduction(relPath)) continue
        const content = readFileSync(absFile, 'utf8')
        if (!/image\.tmdb\.org/i.test(content)) continue
        if (relPath === CANONICAL_HELPER) {
          helperSeen = true
          continue
        }
        offenders.push(relPath)
      }
    }

    expect(helperSeen, `helper canonico ausente em ${CANONICAL_HELPER}`).toBe(true)
    expect(offenders, 'arquivos de producao citando o host fora do canonico').toEqual([])
  })

  it('o reexport de apps/web NAO contem o host nem logica propria', () => {
    const reexport = readFileSync(
      path.join(ROOT, 'apps', 'web', 'src', 'lib', 'tmdb-image-url.ts'),
      'utf8',
    )
    expect(reexport).not.toMatch(/image\.tmdb\.org/i)
    expect(reexport).toMatch(/from ["']@screena\/public-contracts["']/)
    // Sem implementacao paralela: nenhuma declaracao de funcao no reexport.
    expect(reexport).not.toMatch(/function buildTmdbImageUrl/)
  })

  it('o helper canonico preserva as validacoes (sem fetch, sem segredo)', () => {
    // Comportamento (mesmos casos do teste original de apps/web):
    expect(buildTmdbImageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg')
    expect(buildTmdbImageUrl('/abc.jpg', 'w300')).toBe('https://image.tmdb.org/t/p/w300/abc.jpg')
    expect(buildTmdbImageUrl(null)).toBeNull()
    expect(buildTmdbImageUrl(undefined)).toBeNull()
    expect(buildTmdbImageUrl('')).toBeNull()
    expect(buildTmdbImageUrl('   ')).toBeNull()
    expect(buildTmdbImageUrl('abc.jpg')).toBeNull() // sem '/'
    expect(buildTmdbImageUrl('//evil.example/x.jpg')).toBeNull() // protocolo-relativo
    expect(buildTmdbImageUrl('/media/poster.jpg')).toBeNull() // asset local legado
    expect(buildTmdbImageUrl('/uploads/x.jpg')).toBeNull()
    expect(buildTmdbImageUrl('/brand/logo.jpg')).toBeNull()
    expect(buildTmdbImageUrl('/a/../etc/passwd')).toBeNull() // traversal
    expect(buildTmdbImageUrl('/a.jpg?x=1')).toBeNull() // query
    expect(buildTmdbImageUrl('/a.jpg#f')).toBeNull() // hash
    expect(buildTmdbImageUrl('/a b.jpg')).toBeNull() // espaco
    expect(buildTmdbImageUrl('/a\\b.jpg')).toBeNull() // backslash

    // Estrutural: o modulo canonico nao faz rede nem le segredo. A doc cita a
    // PALAVRA "token" ("sem token") — o que se proibe e o ACESSO: process.env e
    // os identificadores de credencial do repo (TMDB_*_TOKEN / TMDB_API_KEY).
    const source = readFileSync(path.join(ROOT, CANONICAL_HELPER), 'utf8')
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/process\.env/)
    expect(source).not.toMatch(/TMDB_[A-Z_]*(?:TOKEN|KEY)/)
  })
})
