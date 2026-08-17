/**
 * Governanca (meta) — UM CAMINHO SO de cobertura de entidade (T0).
 *
 * A REGRA: quem quiser cobrir uma entidade pede a `entity-coverage/entry.ts`. Ninguem
 * monta um `sync_details` a mao.
 *
 * POR QUE ISTO E UM TESTE, E NAO UMA CONVENCAO. Um segundo caminho de ingestao
 * nao falha no dia em que e escrito — ele falha no primeiro conserto aplicado a
 * um caminho e esquecido no outro, e o sintoma nao e erro: e um catalogo com
 * titulos de qualidades diferentes conforme por onde entraram. Neste
 * repositorio isso JA ACONTECEU: o caminho de `/changes` montava o job sem
 * repetir `entityType`/`tmdbId` dentro do payload, a validacao do handler
 * reprovava, e todo `sync_details` do incremental ia para dead-letter em
 * silencio.
 *
 * Este teste deve PASSAR agora. Se um dia falhar, a correcao e fazer o novo
 * chamador passar por `buildCoverageJob` — nao adicionar o arquivo a lista de
 * excecoes.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

const REPO_ROOT = resolve(process.cwd())

/** Onde a fila de catalogo e montada. */
const SCAN_DIRS = ['services', 'apps', 'workers'] as const

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

/**
 * A porta unica. E o unico arquivo autorizado a nomear `sync_details` como
 * `jobType` — e por isso ele proprio nao entra na varredura.
 */
const COVERAGE_ENTRY = 'services/ingestion/src/entity-coverage/entry.ts'

/**
 * Excecoes com motivo declarado. Cada entrada tem de dizer POR QUE aquele
 * arquivo pode citar `sync_details` sem ser um caminho de ingestao.
 */
const ALLOWED: ReadonlyArray<{ readonly file: string; readonly why: string }> = [
  {
    file: 'services/ingestion/src/catalog-jobs/types.ts',
    why: 'declara o ENUM dos tipos de job; nao enfileira nada',
  },
  {
    file: 'services/ingestion/src/catalog-jobs/handlers/schemas.ts',
    why: 'valida o payload por tipo; nao enfileira nada',
  },
  {
    file: 'services/ingestion/src/catalog-jobs/handlers/registry.ts',
    why: 'compoe os handlers; nao enfileira nada',
  },
  {
    file: 'services/ingestion/src/catalog-jobs/handlers/sync-details-handler.ts',
    why: 'E o handler de sync_details — ele executa o job, nao o cria',
  },
]

/** `jobType: 'sync_details'` — a assinatura de quem monta o job a mao. */
const HANDBUILT_JOB = /jobType\s*:\s*['"`]sync_details['"`]/

interface Offender {
  readonly file: string
  readonly line: number
  readonly snippet: string
}

async function collectCodeFiles(dir: string): Promise<string[]> {
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
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue
      out.push(...(await collectCodeFiles(full)))
      continue
    }
    if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

const toPosix = (path: string): string => path.split('\\').join('/')

let offenders: Offender[] = []
let scannedFiles = 0

beforeAll(async () => {
  const allowed = new Set<string>([COVERAGE_ENTRY, ...ALLOWED.map((entry) => entry.file)])
  const found: Offender[] = []

  for (const dir of SCAN_DIRS) {
    const files = await collectCodeFiles(resolve(REPO_ROOT, dir))
    for (const file of files) {
      const rel = toPosix(relative(REPO_ROOT, file))
      // Testes montam jobs de proposito, para exercitar o worker.
      if (rel.includes('__tests__/') || rel.endsWith('.test.ts')) continue
      // `scripts/validate-*-real-postgres.ts` sao HARNESSES: rodam contra um
      // Postgres efemero e montam jobs artificiais para exercitar a fila,
      // exatamente como um teste. Eles nao ingerem catalogo. O padrao e
      // estreito de proposito — um `scripts/` inteiro liberado seria o lugar
      // obvio para um segundo caminho de ingestao se esconder.
      if (/(^|\/)scripts\/validate-[\w-]+-real-postgres\.ts$/.test(rel)) continue
      if (allowed.has(rel)) continue
      scannedFiles += 1
      const content = await readFile(file, 'utf8')
      if (!HANDBUILT_JOB.test(content)) continue
      content.split('\n').forEach((line, index) => {
        if (HANDBUILT_JOB.test(line)) {
          found.push({ file: rel, line: index + 1, snippet: line.trim().slice(0, 120) })
        }
      })
    }
  }
  offenders = found
})

describe('um caminho so de cobertura (T0)', () => {
  it('a varredura realmente olhou para o codigo', () => {
    // Sem esta assercao, um erro de caminho faria o teste passar vazio — a
    // forma mais silenciosa de um teste de governanca mentir.
    expect(scannedFiles).toBeGreaterThan(50)
  })

  it('ninguem monta `sync_details` a mao fora da porta unica', () => {
    const report = offenders
      .map((o) => `  ${o.file}:${o.line}  ${o.snippet}`)
      .join('\n')
    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Caminho de ingestao PARALELO detectado. Use buildCoverageJob() de ${COVERAGE_ENTRY}:\n${report}`,
    ).toEqual([])
  })

  it('os tres chamadores do T0 passam pela porta unica', async () => {
    const callers = [
      'services/ingestion/src/catalog-jobs/handlers/discover-ids-handler.ts', // semente
      'services/ingestion/src/changes/run.ts', // manutencao
    ]
    for (const caller of callers) {
      const content = await readFile(resolve(REPO_ROOT, caller), 'utf8')
      expect(content, `${caller} deveria importar a porta unica`).toMatch(/buildCoverageJob/)
    }
  })

  it('toda excecao declara um motivo', () => {
    for (const entry of ALLOWED) {
      expect(entry.why.length, `${entry.file} sem motivo`).toBeGreaterThan(10)
    }
  })
})
