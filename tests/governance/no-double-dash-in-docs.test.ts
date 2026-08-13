/**
 * no-double-dash-in-docs.test.ts — O separador `--` NAO existe neste repo.
 *
 * MEDIDO, nao suposto. Com o pnpm 9.15.4 (o do `packageManager`), `--` nao e
 * consumido pelo runner: ele chega ao script como argumento literal. Nos DOIS
 * niveis de encaminhamento:
 *
 *   pnpm --filter p s --apply        -> ["--apply"]              OK
 *   pnpm --filter p s -- --apply     -> ["--","--apply"]         ERRADO
 *   pnpm <script-raiz> a b --confirm -> ["a","b","--confirm"]    OK
 *   pnpm <script-raiz> a b -- --confirm -> ["a","b","--","--confirm"] ERRADO
 *
 * POR QUE ISTO E UM TESTE E NAO UMA NOTA: a documentacao errada ja custou duas
 * rodadas de producao. `ratings:omdb -- --type=movie` foi recusado pelo parser
 * porque o `--` virou argumento posicional; o runbook de streaming ensinava
 * `register-watch-providers -- --apply`. Comentario nao impede regressao —
 * quem escreve o proximo runbook copia o anterior. Este teste impede.
 *
 * O que ele NAO faz: nao opina sobre `--` em npm/yarn/bash em geral. O escopo e
 * exatamente uma invocacao `pnpm` deste repo.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
/** Caminho deste arquivo (ESM: nao existe `__filename`). */
const SELF = fileURLToPath(import.meta.url)

/** Diretorios que nunca sao varridos (nao sao fonte deste repo). */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.pnpm-store',
  'worktrees',
])

const SCANNED_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.mts', '.mjs', '.js', '.yml', '.yaml'])

/**
 * Uma invocacao `pnpm` seguida do separador `--` antes de outra flag.
 *
 * Ancorado em `pnpm` de proposito: `--` e legitimo em outros contextos (git,
 * docker, `node --import tsx -- script`). O defeito e especificamente o
 * encaminhamento de argumento pelo pnpm.
 */
const OFFENDING = /pnpm[^\n]*?\s--\s+--/

/**
 * CONVENCAO DE CONTRAEXEMPLO: uma linha marcada com o simbolo abaixo esta
 * MOSTRANDO a forma errada de proposito — e o caso da tabela comparativa em
 * `docs/runbooks/streaming-sync.md`. Documentar o erro e o que impede alguem de
 * reintroduzi-lo; o guard nao pode punir a documentacao dele.
 *
 * A escolha do marcador nao e cosmetica: ele e visivel no diff e no render,
 * entao ninguem o aplica por acidente para silenciar uma ocorrencia real.
 */
const COUNTEREXAMPLE_MARKER = '❌'

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(full)
    } catch {
      continue // link quebrado / arquivo removido durante a varredura
    }
    if (stats.isDirectory()) {
      walk(full, out)
      continue
    }
    if (SCANNED_EXTENSIONS.has(path.extname(entry))) out.push(full)
  }
  return out
}

/** Toda ocorrencia ofensiva, como `caminho:linha: trecho`. */
function findOffenders(): string[] {
  const offenders: string[] = []
  for (const file of walk(ROOT, [])) {
    // O proprio teste cita as formas erradas para documenta-las e para o
    // controle positivo. Varrer a si mesmo produziria uma falha permanente.
    if (path.resolve(file) === path.resolve(SELF)) continue
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!source.includes('pnpm')) continue
    source.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(COUNTEREXAMPLE_MARKER)) return // contraexemplo declarado
      if (OFFENDING.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`)
      }
    })
  }
  return offenders.sort()
}

describe('governanca: `--` nunca separa argumentos de um comando pnpm', () => {
  it('nenhum arquivo do repo ensina `pnpm ... -- --flag`', () => {
    const offenders = findOffenders()
    expect(
      offenders,
      `Estes lugares ensinam o separador \`--\`, que o pnpm 9.15.4 NAO consome ` +
        `(ele chega como argumento literal e o parser recusa). Passe as flags direto:\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  /**
   * CONTROLE POSITIVO. Sem ele, um regex quebrado (ou uma varredura que nao le
   * arquivo nenhum) deixaria o teste verde para sempre — a falha exata que ja
   * derrubou outras suites deste repo, onde testes passavam pelo motivo errado.
   */
  it('CONTROLE POSITIVO: o padrao REPROVA as formas erradas e APROVA as certas', () => {
    // Erradas — cada uma foi realmente escrita e realmente falhou em producao.
    expect(OFFENDING.test('pnpm --filter @screena/streaming register-watch-providers -- --apply')).toBe(true)
    expect(OFFENDING.test('corepack pnpm --filter @screena/ratings ratings:omdb -- --type=movie')).toBe(true)
    expect(OFFENDING.test('pnpm legal sources apply -- --confirm')).toBe(true)

    // Certas — a forma que este repo usa.
    expect(OFFENDING.test('pnpm --filter @screena/streaming register-watch-providers --apply')).toBe(false)
    expect(
      OFFENDING.test(
        'corepack pnpm legal sources apply --reviewer="X" --policy-version="y" --confirm',
      ),
    ).toBe(false)

    // Fora de escopo: `--` que nao pertence a uma invocacao pnpm.
    expect(OFFENDING.test('node --import tsx -- --script.ts')).toBe(false)

    // O marcador de contraexemplo NAO afrouxa o padrao em si: ele so isenta a
    // linha na varredura. O regex continua reprovando a forma errada.
    expect(
      OFFENDING.test(`| \`pnpm --filter p s -- --apply\` | ${COUNTEREXAMPLE_MARKER} |`),
    ).toBe(true)
  })

  it('CONTROLE POSITIVO: a varredura realmente le arquivos deste repo', () => {
    const scanned = walk(ROOT, [])
    // Um numero baixo aqui significa varredura quebrada (raiz errada, extensao
    // errada, SKIP_DIRS agressivo demais) — e uma varredura vazia passa no
    // teste principal sem provar nada.
    expect(scanned.length).toBeGreaterThan(200)
    expect(scanned.some((f) => f.endsWith(path.join('docs', 'runbooks', 'streaming-sync.md')))).toBe(
      true,
    )
  })
})
