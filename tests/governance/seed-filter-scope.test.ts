/**
 * Governanca (meta) — o filtro da SEMENTE nao pode alcancar o SOB DEMANDA.
 *
 * A REGRA: `discovery/seed-filter.ts` decide o que COPIAMOS antes de alguem
 * pedir. `on-demand/*` decide o que fazemos QUANDO pedem. Sao perguntas
 * diferentes, e compartilhar filtro entre elas e defeito, nao economia.
 *
 * O modo de falha concreto: se o caminho sob demanda importasse o filtro de
 * genero, um leitor buscando "Malhacao" nao acharia nada — e o site diria "nao
 * encontrei" sobre um titulo que existe, porque uma decisao de CUSTO DE
 * SEMENTE vazou para uma decisao de ATENDIMENTO AO LEITOR.
 *
 * Este teste deve PASSAR agora. Se falhar, a correcao e tirar o import do
 * caminho sob demanda — nunca adicionar o arquivo a uma lista de excecoes.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const REPO_ROOT = resolve(process.cwd())
const ON_DEMAND_DIR = resolve(REPO_ROOT, 'services', 'ingestion', 'src', 'on-demand')

/** Import do filtro de semente, em qualquer forma de caminho. */
const SEED_FILTER_IMPORT =
  /(?:import\b[^;]*?from\s*|require\s*\(\s*)[`'"][^`'"]*seed-filter(?:\.js)?[`'"]/

/** Simbolos do filtro, caso alguem os copie em vez de importar. */
const SEED_FILTER_SYMBOLS = /\b(?:DAILY_EMISSION_TV_GENRES|evaluateSeedSeries|summarizeSeedFilter)\b/

interface Offender {
  readonly file: string
  readonly line: number
  readonly snippet: string
}

async function collectTs(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectTs(full)))
      continue
    }
    if (entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

const toPosix = (p: string): string => p.split('\\').join('/')

let offenders: Offender[] = []
let scanned = 0

beforeAll(async () => {
  const found: Offender[] = []
  for (const file of await collectTs(ON_DEMAND_DIR)) {
    const rel = toPosix(relative(REPO_ROOT, file))
    scanned += 1
    const content = await readFile(file, 'utf8')
    content.split('\n').forEach((line, i) => {
      if (SEED_FILTER_IMPORT.test(line) || SEED_FILTER_SYMBOLS.test(line)) {
        found.push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 120) })
      }
    })
  }
  offenders = found
})

describe('escopo do filtro de semente', () => {
  it('a varredura encontrou os modulos sob demanda', () => {
    // Sem isto, um caminho errado faria o teste passar vazio.
    expect(scanned).toBeGreaterThanOrEqual(3)
  })

  it('nenhum modulo sob demanda conhece o filtro de semente', () => {
    const report = offenders.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join('\n')
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `O filtro da SEMENTE vazou para o caminho SOB DEMANDA:\n${report}\n` +
          `Uma serie excluida da semente tem de continuar achavel por quem a busca.`,
    ).toEqual([])
  })

  it('o filtro de semente tambem nao conhece o sob demanda (sem ciclo)', async () => {
    const seedFilter = await readFile(
      resolve(REPO_ROOT, 'services', 'ingestion', 'src', 'discovery', 'seed-filter.ts'),
      'utf8',
    )
    expect(seedFilter).not.toMatch(/from\s*[`'"][^`'"]*on-demand\//)
  })
})
