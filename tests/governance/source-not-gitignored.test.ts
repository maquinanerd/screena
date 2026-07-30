/**
 * source-not-gitignored.test.ts — Nenhum codigo-fonte pode estar em `.gitignore`.
 *
 * POR QUE ISTO EXISTE. O `.gitignore` tinha `media/` para excluir uploads locais
 * do CMS. Padrao sem barra inicial casa em QUALQUER profundidade: quando a FASE
 * 2D criou `services/news-ingestion/src/media/`, o pipeline inteiro de projecao
 * de imagem ficou invisivel para o git. `git status` nao mostra, `git add`
 * ignora em silencio, e o commit sai sem os arquivos — o CI quebra depois, longe
 * da causa.
 *
 * A guarda pergunta ao PROPRIO git (`check-ignore`), nao reimplementa a
 * semantica de `.gitignore`: qualquer reimplementacao divergiria dela.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Arquivos rastreaveis de codigo, na visao do proprio git. */
function sourceFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.ts', '*.tsx'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  return output.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

/** Quais dos caminhos dados o git considera ignorados. */
function ignoredAmong(paths: readonly string[]): string[] {
  if (paths.length === 0) return []
  try {
    const output = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: paths.join('\n'),
      maxBuffer: 32 * 1024 * 1024,
    })
    return output.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  } catch {
    // `check-ignore` sai com codigo 1 quando NENHUM caminho e ignorado.
    return []
  }
}

describe('governanca: codigo-fonte nunca e ignorado pelo git', () => {
  it('a varredura enxerga o repositorio (nao passa por vacuidade)', () => {
    const files = sourceFiles()
    expect(files.length).toBeGreaterThan(200)
    expect(files).toContain('services/news-ingestion/src/media/media-validation.ts')
  })

  it('CONTROLE NEGATIVO: o detector reconhece um caminho realmente ignorado', () => {
    // Sem isto, um `check-ignore` quebrado devolveria "nada ignorado" para
    // sempre e o teste abaixo seria decorativo.
    expect(ignoredAmong(['apps/cms/media/exemplo.png'])).toContain('apps/cms/media/exemplo.png')
    expect(ignoredAmong(['services/news-ingestion/media/exemplo.jpg'])).toHaveLength(1)
  })

  it('nenhum .ts/.tsx sob src/, bin/, scripts/ ou tests/ esta ignorado', () => {
    const candidates = sourceFiles().filter((file) =>
      /(^|\/)(src|bin|scripts|tests)\//.test(file),
    )
    expect(candidates.length).toBeGreaterThan(200)
    const ignored = ignoredAmong(candidates)
    expect(
      ignored,
      `estes arquivos de CODIGO estao em .gitignore e sairiam de um commit em silencio:\n${ignored.join('\n')}`,
    ).toEqual([])
  })
})
