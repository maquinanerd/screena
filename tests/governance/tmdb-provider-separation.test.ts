/**
 * Teste de governanca (Fase 2) — TMDB e provider_api, NUNCA rating_source.
 *
 * Reforca as invariantes 1 e 2 no codigo de ingestao:
 *  - TMDB e fornecedor tecnico (api_providers, kind=data), nao fonte editorial.
 *  - O importador TMDB NUNCA escreve em external_ratings nem trata
 *    `vote_average_tmdb` como nota editorial — o codigo de ingestao/TMDB nao
 *    referencia external_ratings/rating_source.
 *
 * Se este teste falhar, algo passou a misturar metadados TMDB com ratings
 * editoriais — corrija o codigo, nunca relaxe o teste.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RATING_SOURCES } from '@screena/config'
import { API_PROVIDER_SEED } from '@screena/db'
import { TMDB_PROVIDER_API } from '@screena/tmdb-client'

const SCAN_ROOTS = [
  resolve(process.cwd(), 'api-clients', 'tmdb', 'src'),
  resolve(process.cwd(), 'services', 'ingestion', 'src'),
]

/** Tokens que NAO podem aparecer no CODIGO de ingestao/TMDB (ratings sao outra fase). */
const FORBIDDEN: RegExp[] = [/external_ratings/i, /externalRating/, /rating_source/i, /ratingSource/]

/**
 * Remove comentarios (bloco e linha) para que a varredura mire CODIGO, nao a
 * prosa que justamente explica "nunca tratar TMDB como rating_source".
 */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//')
      // ignora '//' que faca parte de '://' (URLs em strings de codigo)
      if (idx > 0 && line[idx - 1] === ':') return line
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
}

async function collectTs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue
      }
      files.push(...(await collectTs(join(dir, entry.name))))
    } else if (entry.name.endsWith('.ts')) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

describe('governanca: TMDB provider_api != rating_source (invariantes 1, 2)', () => {
  it('TMDB_PROVIDER_API e "tmdb" e existe como provider tecnico kind=data', () => {
    expect(TMDB_PROVIDER_API).toBe('tmdb')
    const provider = API_PROVIDER_SEED.find((entry) => entry.key === TMDB_PROVIDER_API)
    expect(provider?.kind).toBe('data')
  })

  it('"tmdb" nunca e uma fonte editorial (RATING_SOURCES)', () => {
    expect([...RATING_SOURCES]).not.toContain(TMDB_PROVIDER_API)
  })

  it('o codigo de ingestao/TMDB nao referencia external_ratings/rating_source', async () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of await collectTs(root)) {
        const content = stripComments(await readFile(file, 'utf8'))
        content.split(/\r?\n/).forEach((line, index) => {
          for (const pattern of FORBIDDEN) {
            if (pattern.test(line)) {
              offenders.push(`${relative(process.cwd(), file)}:${index + 1} -> ${line.trim()}`)
            }
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
