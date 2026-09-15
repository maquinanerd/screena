/**
 * source-fingerprint.ts — A IMPRESSAO DIGITAL do codigo que um processo carregou.
 *
 * ============================================================================
 * A PERGUNTA QUE ESTE MODULO RESPONDE
 * ============================================================================
 * "Este container roda qual commit?" Ate aqui a unica resposta era
 * `CINERIE_BUILD_SHA`, variavel ESTATICA do EasyPanel. Em 2026-08-31 ela dizia um
 * commit 38 commits atras do que os containers rodavam de fato. Um rotulo
 * digitado a mao mente nas duas direcoes: envelhece e acusa um deploy perdido
 * que nao existe, ou fica certo por acaso e esconde um que existe.
 *
 * Aqui a resposta sai do CONTEUDO. Para cada arquivo-fonte no disco calcula-se o
 * SHA-1 de blob do git (`sha1("blob <tamanho>\0" + bytes)`), e a lista inteira
 * vira um digest SHA-256. A API do GitHub devolve o MESMO SHA-1 de blob para cada
 * caminho da arvore de um commit. A mesma regra aplicada aos dois lados diz, sem
 * rotulo nenhum, se o container roda o codigo daquele commit.
 *
 * ============================================================================
 * UMA REGRA SO, E OS DOIS LADOS A USAM
 * ============================================================================
 * `isFingerprintPath` decide o que entra — no disco (`computeFingerprintFromDisk`)
 * e na arvore do GitHub (`fingerprintFromGitTree`). Duas regras parecidas
 * divergiriam no primeiro ajuste, e o painel acusaria uma divergencia que nao
 * existe.
 *
 * ENTRA: `apps|packages|services|api-clients/<pacote>/{src,app,bin,prisma}/**`
 * com extensao de codigo.
 *
 * NAO ENTRA, e cada exclusao tem motivo:
 *  - documentacao: um commit so de doc nao muda o codigo que roda, e contar doc
 *    faria o painel dizer "desatualizado" para um container identico;
 *  - `node_modules`, `.next`, `dist`, `build`, `coverage`: gerado no build ou na
 *    instalacao, nao existe na arvore do commit;
 *  - link simbolico: o blob de um link e o TEXTO do alvo, e ler o link no disco
 *    segue o alvo — os dois lados dariam SHA diferente sem defeito nenhum.
 *
 * ============================================================================
 * FIM DE LINHA — POR QUE ISTO E MEDIDA DE CONTAINER
 * ============================================================================
 * O repositorio nao tem `.gitattributes`: o blob e o byte commitado. Uma imagem
 * construida a partir do GitHub tem os mesmos bytes. Um checkout Windows com
 * `core.autocrlf=true` NAO tem — rodado numa maquina de desenvolvimento, este
 * digest pode divergir do `main` sem que nada esteja errado.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/** Versao da regra. Mudar a regra muda o digest: a versao anda junto. */
export const SOURCE_FINGERPRINT_METHOD = 'git-blob-sha1/v1' as const

/** Raizes de workspace cobertas pela impressao. */
export const FINGERPRINT_WORKSPACE_ROOTS: readonly string[] = [
  'apps',
  'packages',
  'services',
  'api-clients',
]

/** Pastas de codigo dentro de cada pacote. */
export const FINGERPRINT_SOURCE_DIRS: readonly string[] = ['src', 'app', 'bin', 'prisma']

/** Extensoes de codigo. `.prisma` e `.sql` entram: schema e migration mudam o que roda. */
export const FINGERPRINT_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.sql',
  '.prisma',
]

/** Segmentos de caminho que nunca entram: gerados ou dependencias. */
const EXCLUDED_SEGMENTS: ReadonlySet<string> = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
])

/** Modos da arvore git que NAO sao arquivo regular (link simbolico e submodulo). */
const NON_REGULAR_TREE_MODES: ReadonlySet<string> = new Set(['120000', '160000'])

const BLOB_SHA = /^[0-9a-f]{40}$/

/**
 * O caminho (relativo a raiz do repositorio, separado por `/`) entra na impressao?
 *
 * PURA. E a unica fonte da regra — ver o cabecalho.
 */
export function isFingerprintPath(relativePath: string): boolean {
  if (relativePath.includes('\\')) return false
  const parts = relativePath.split('/')
  // raiz / pacote / pasta / ... / arquivo
  if (parts.length < 4) return false
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false
  if (!FINGERPRINT_WORKSPACE_ROOTS.includes(parts[0] as string)) return false
  if (!FINGERPRINT_SOURCE_DIRS.includes(parts[2] as string)) return false
  if (parts.some((part) => EXCLUDED_SEGMENTS.has(part))) return false
  const base = parts[parts.length - 1] as string
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return false
  return FINGERPRINT_EXTENSIONS.includes(base.slice(dot))
}

/** SHA-1 de blob do git: o mesmo valor de `git hash-object <arquivo>`. */
export function gitBlobSha1(content: Uint8Array): string {
  const hash = createHash('sha1')
  hash.update(`blob ${String(content.byteLength)}\0`)
  hash.update(content)
  return hash.digest('hex')
}

/** Um arquivo da impressao. */
export interface FingerprintEntry {
  readonly path: string
  readonly blobSha: string
}

/** A impressao digital de uma arvore de codigo. */
export interface SourceFingerprint {
  readonly method: typeof SOURCE_FINGERPRINT_METHOD
  /** SHA-256 hex sobre `caminho<TAB>blob<LF>` de todos os arquivos, em ordem. */
  readonly digest: string
  readonly fileCount: number
  /**
   * O digest POR PACOTE (`apps/web`, `services/sync`, ...). Existe para que uma
   * divergencia diga ONDE: "services/sync difere" e uma pista; "o digest
   * difere" e so um alarme.
   */
  readonly buckets: Readonly<Record<string, string>>
}

/** O pacote de um caminho: as duas primeiras partes (`services/sync`). */
export function fingerprintBucket(relativePath: string): string {
  const [root, pkg] = relativePath.split('/')
  return `${root ?? ''}/${pkg ?? ''}`
}

function compareText(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function digestOf(entries: readonly FingerprintEntry[]): string {
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(`${entry.path}\t${entry.blobSha}\n`)
  return hash.digest('hex')
}

/**
 * Agrega entradas numa impressao. PURA e deterministica: a ordem de chegada nao
 * importa, e caminho fora da regra e descartado aqui tambem (defesa contra um
 * chamador que esqueceu o filtro).
 *
 * Lanca em blob mal formado: um SHA que nao tem 40 hex e defeito do chamador, e
 * engoli-lo produziria um digest que nunca bate com nada.
 */
export function summarizeFingerprint(entries: readonly FingerprintEntry[]): SourceFingerprint {
  const accepted: FingerprintEntry[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    if (!isFingerprintPath(entry.path)) continue
    if (!BLOB_SHA.test(entry.blobSha)) {
      throw new Error(`blob sha invalido para ${entry.path}`)
    }
    if (seen.has(entry.path)) {
      throw new Error(`caminho duplicado na impressao: ${entry.path}`)
    }
    seen.add(entry.path)
    accepted.push(entry)
  }
  accepted.sort((a, b) => compareText(a.path, b.path))

  const byBucket = new Map<string, FingerprintEntry[]>()
  for (const entry of accepted) {
    const bucket = fingerprintBucket(entry.path)
    const list = byBucket.get(bucket) ?? []
    list.push(entry)
    byBucket.set(bucket, list)
  }
  const buckets: Record<string, string> = {}
  for (const bucket of [...byBucket.keys()].sort(compareText)) {
    buckets[bucket] = digestOf(byBucket.get(bucket) ?? [])
  }

  return {
    method: SOURCE_FINGERPRINT_METHOD,
    digest: digestOf(accepted),
    fileCount: accepted.length,
    buckets,
  }
}

/** Uma entrada da arvore do git como a API do GitHub (e `git ls-tree`) a descreve. */
export interface GitTreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: string
  readonly sha: string
}

/** A impressao de uma arvore de commit. Mesma regra do disco. */
export function fingerprintFromGitTree(tree: readonly GitTreeEntry[]): SourceFingerprint {
  const entries: FingerprintEntry[] = []
  for (const item of tree) {
    if (item.type !== 'blob') continue
    if (NON_REGULAR_TREE_MODES.has(item.mode)) continue
    entries.push({ path: item.path, blobSha: item.sha })
  }
  return summarizeFingerprint(entries)
}

async function walk(absolute: string, relative: string, out: FingerprintEntry[]): Promise<void> {
  let items
  try {
    items = await readdir(absolute, { withFileTypes: true })
  } catch {
    // Pasta ausente (pacote sem `bin/`, por exemplo) nao e erro: e ausencia.
    return
  }
  for (const item of items) {
    const childRelative = `${relative}/${item.name}`
    const childAbsolute = path.join(absolute, item.name)
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(item.name)) continue
      await walk(childAbsolute, childRelative, out)
      continue
    }
    if (!item.isFile()) continue
    if (!isFingerprintPath(childRelative)) continue
    const content = await readFile(childAbsolute)
    out.push({ path: childRelative, blobSha: gitBlobSha1(content) })
  }
}

/**
 * A impressao dos arquivos que ESTAO NO DISCO sob `repoRoot`.
 *
 * Leitura sequencial de proposito: roda na subida de servicos que acabaram de
 * nascer, e disputar CPU e disco com o proprio boot por um numero que so e lido
 * minutos depois nao compra nada.
 */
export async function computeFingerprintFromDisk(repoRoot: string): Promise<SourceFingerprint> {
  const entries: FingerprintEntry[] = []
  for (const root of FINGERPRINT_WORKSPACE_ROOTS) {
    let packages
    try {
      packages = await readdir(path.join(repoRoot, root), { withFileTypes: true })
    } catch {
      continue
    }
    for (const pkg of packages) {
      if (!pkg.isDirectory() || EXCLUDED_SEGMENTS.has(pkg.name)) continue
      for (const dir of FINGERPRINT_SOURCE_DIRS) {
        await walk(path.join(repoRoot, root, pkg.name, dir), `${root}/${pkg.name}/${dir}`, entries)
      }
    }
  }
  return summarizeFingerprint(entries)
}

/**
 * A raiz do monorepo a partir de uma pasta qualquer (`pnpm --filter` roda com o
 * cwd no PACOTE, nao na raiz). `null` quando nao ha `pnpm-workspace.yaml` acima.
 */
export function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (let depth = 0; depth < 16; depth += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}
