/**
 * source-fingerprint.test.ts — A impressao digital bate com o GIT DE VERDADE.
 *
 * O teste que importa aqui nao compara a funcao com ela mesma. Ele cria um
 * repositorio git temporario, deixa o PROPRIO git calcular os blobs
 * (`git ls-tree -r HEAD`) e exige que a impressao da arvore do commit seja
 * identica a impressao do disco. E exatamente o que acontece em producao: um lado
 * vem do GitHub, o outro do disco do container.
 *
 * E os controles negativos provam que a igualdade nao e acidente: mudar um byte
 * de codigo muda o digest (e SO o pacote tocado); mudar documentacao nao muda.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  computeFingerprintFromDisk,
  findRepoRoot,
  fingerprintFromGitTree,
  gitBlobSha1,
  isFingerprintPath,
  summarizeFingerprint,
  type GitTreeEntry,
} from '../source-fingerprint.js'

const temporarios: string[] = []

function novoDiretorio(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinerie-fingerprint-'))
  temporarios.push(dir)
  return dir
}

afterEach(() => {
  while (temporarios.length > 0) {
    const dir = temporarios.pop() as string
    rmSync(dir, { recursive: true, force: true })
  }
})

function escrever(root: string, relativo: string, conteudo: string | Uint8Array): void {
  const destino = path.join(root, ...relativo.split('/'))
  mkdirSync(path.dirname(destino), { recursive: true })
  writeFileSync(destino, conteudo)
}

function git(root: string, args: readonly string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.quotepath=false',
      '-c',
      'user.email=painel@cinerie.invalid',
      '-c',
      'user.name=painel',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  )
}

/** A arvore do HEAD como o GIT a descreve (mesmo formato da API do GitHub). */
function arvoreDoHead(root: string): GitTreeEntry[] {
  return git(root, ['ls-tree', '-r', 'HEAD'])
    .split('\n')
    .filter((linha) => linha.trim() !== '')
    .map((linha) => {
      const [meta, caminho] = linha.split('\t') as [string, string]
      const [mode, type, sha] = meta.split(' ') as [string, string, string]
      return { mode, type, sha, path: caminho }
    })
}

function repositorioDeExemplo(): string {
  const root = novoDiretorio()
  escrever(root, 'pnpm-workspace.yaml', 'packages:\n  - apps/*\n')
  escrever(root, 'apps/web/app/page.tsx', 'export default function P() { return null }\n')
  escrever(root, 'apps/web/src/lib/acao.ts', 'export const texto = "ação — título"\n')
  // CRLF DENTRO do blob: o git guarda o byte (autocrlf desligado) e o disco tem o
  // mesmo byte. A regra nao normaliza fim de linha — e nao pode.
  escrever(root, 'services/sync/src/scheduler/x.ts', 'export const a = 1\r\nexport const b = 2\r\n')
  escrever(root, 'services/sync/bin/run.ts', 'console.log("run")\n')
  escrever(root, 'packages/db/prisma/schema.prisma', 'model A { id Int @id }\n')
  escrever(root, 'packages/db/prisma/migrations/1_init/migration.sql', 'CREATE TABLE a (id int);\n')
  escrever(root, 'api-clients/tmdb/src/index.ts', 'export {}\n')
  // Fora da regra, e commitados de proposito: o teste prova que os DOIS lados
  // os ignoram, nao que eles nao existem.
  escrever(root, 'apps/web/README.md', '# web\n')
  escrever(root, 'docs/operations/x.md', '# doc\n')
  escrever(root, 'apps/web/.next/server/chunk.js', 'gerado()\n')
  escrever(root, 'apps/web/src/node_modules/pkg/index.js', 'dependencia()\n')
  escrever(root, 'apps/web/next.config.ts', 'export default {}\n')
  git(root, ['init', '-q'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'exemplo'])
  return root
}

describe('gitBlobSha1 — o mesmo valor de `git hash-object`', () => {
  it('confere com os blobs conhecidos do git', () => {
    expect(gitBlobSha1(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(gitBlobSha1(new TextEncoder().encode('hello\n'))).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    )
  })
})

describe('isFingerprintPath — a regra unica', () => {
  it.each([
    ['apps/web/app/page.tsx', true],
    ['apps/web/src/server/x.ts', true],
    ['services/sync/bin/cinerie-scheduler.ts', true],
    ['packages/db/prisma/schema.prisma', true],
    ['packages/db/prisma/migrations/1/migration.sql', true],
    ['apps/web/app/globals.css', true],
    ['apps/web/next.config.ts', false],
    ['apps/web/README.md', false],
    ['docs/operations/admin-operacional.md', false],
    ['apps/web/.next/server/chunk.js', false],
    ['apps/web/src/node_modules/x/index.js', false],
    ['scripts/audit/check-render-purity.mjs', false],
    ['apps/web/src/lib/image.png', false],
    ['apps\\web\\src\\x.ts', false],
    ['apps/web/src/../x.ts', false],
  ])('%s -> %s', (caminho, esperado) => {
    expect(isFingerprintPath(caminho)).toBe(esperado)
  })
})

describe('summarizeFingerprint — deterministica e defensiva', () => {
  const a = { path: 'apps/web/src/a.ts', blobSha: 'a'.repeat(40) }
  const b = { path: 'services/sync/src/b.ts', blobSha: 'b'.repeat(40) }

  it('a ordem de chegada nao muda o digest', () => {
    expect(summarizeFingerprint([a, b]).digest).toBe(summarizeFingerprint([b, a]).digest)
  })

  it('separa o digest por pacote', () => {
    const resumo = summarizeFingerprint([a, b])
    expect(Object.keys(resumo.buckets)).toEqual(['apps/web', 'services/sync'])
    expect(resumo.fileCount).toBe(2)
  })

  it('recusa blob mal formado e caminho duplicado, em vez de gerar digest que nunca bate', () => {
    expect(() => summarizeFingerprint([{ path: a.path, blobSha: 'xyz' }])).toThrow(/blob sha invalido/)
    expect(() => summarizeFingerprint([a, a])).toThrow(/duplicado/)
  })
})

describe('disco x arvore do git — a igualdade que o painel usa', () => {
  it('o digest do disco e IDENTICO ao da arvore do commit calculada pelo git', async () => {
    const root = repositorioDeExemplo()
    const doDisco = await computeFingerprintFromDisk(root)
    const daArvore = fingerprintFromGitTree(arvoreDoHead(root))

    expect(doDisco.fileCount).toBe(7)
    expect(daArvore.fileCount).toBe(7)
    expect(doDisco.digest).toBe(daArvore.digest)
    expect(doDisco.buckets).toEqual(daArvore.buckets)
  })

  it('CONTROLE NEGATIVO: um byte de codigo muda o digest, e SO o pacote tocado', async () => {
    const root = repositorioDeExemplo()
    const antes = fingerprintFromGitTree(arvoreDoHead(root))
    escrever(root, 'services/sync/src/scheduler/x.ts', 'export const a = 2\r\nexport const b = 2\r\n')
    const depois = await computeFingerprintFromDisk(root)

    expect(depois.digest).not.toBe(antes.digest)
    const diferentes = Object.keys(antes.buckets).filter((k) => antes.buckets[k] !== depois.buckets[k])
    expect(diferentes).toEqual(['services/sync'])
  })

  it('mudar so documentacao e artefato de build NAO muda o digest', async () => {
    const root = repositorioDeExemplo()
    const antes = await computeFingerprintFromDisk(root)
    escrever(root, 'apps/web/README.md', '# outro texto\n')
    escrever(root, 'docs/operations/x.md', '# outra doc\n')
    escrever(root, 'apps/web/.next/server/chunk.js', 'outro build\n')
    const depois = await computeFingerprintFromDisk(root)
    expect(depois.digest).toBe(antes.digest)
  })

  it('link simbolico fica de fora dos dois lados', async () => {
    const root = repositorioDeExemplo()
    const antes = await computeFingerprintFromDisk(root)
    try {
      symlinkSync(
        path.join(root, 'apps', 'web', 'src', 'lib', 'acao.ts'),
        path.join(root, 'apps', 'web', 'src', 'lib', 'atalho.ts'),
      )
    } catch {
      // Windows sem privilegio de link: a regra continua coberta pelo lado da
      // arvore abaixo, que nao depende do sistema de arquivos.
    }
    const depois = await computeFingerprintFromDisk(root)
    expect(depois.digest).toBe(antes.digest)

    const comLink = fingerprintFromGitTree([
      ...arvoreDoHead(root),
      { mode: '120000', type: 'blob', sha: 'c'.repeat(40), path: 'apps/web/src/lib/atalho.ts' },
    ])
    expect(comLink.digest).toBe(antes.digest)
  })
})

describe('findRepoRoot', () => {
  it('sobe ate o pnpm-workspace.yaml a partir de uma pasta de pacote', () => {
    const root = repositorioDeExemplo()
    expect(findRepoRoot(path.join(root, 'services', 'sync', 'src'))).toBe(path.resolve(root))
  })

  it('devolve null quando nao ha marcador acima (nunca inventa uma raiz)', () => {
    const solto = novoDiretorio()
    const encontrado = findRepoRoot(solto)
    // O temporario pode, em tese, morar dentro de um monorepo; o que se exige e
    // que a resposta nunca seja a propria pasta sem marcador.
    expect(encontrado === null || encontrado !== path.resolve(solto)).toBe(true)
  })
})
