/**
 * legal-cli-invocation-in-docs.test.ts — A CLI do `legal` so tem UMA forma real.
 *
 * DOIS DEFEITOS, O MESMO CUSTO. Ambos produzem uma linha que alguem copia, cola,
 * roda contra PRODUCAO e recebe erro de uso — gastando uma janela de operacao:
 *
 *   1. FORMA CURTA. `pnpm legal apply --confirm` nao existe. O comando e
 *      `sources` e o subcomando e `apply`; sem `sources` o parser recusa com
 *      "comando desconhecido".
 *   2. LEVA ERRADA. `--policy-version` NAO e texto livre: `parseLegalArgs`
 *      compara com `AUTHORIZATION_BATCH` e recusa qualquer outro valor. Escrever
 *      a versao de uma licenca individual (ex.: a de uma revogacao) parece certo
 *      e sai com erro de uso, sem escrever nada.
 *
 * POR QUE ISTO E UM TESTE E NAO UMA NOTA. Porque a nota ja falhou. Na PR #171 eu
 * escrevi a forma correta no relatorio e, no MESMO conjunto de mudancas, deixei
 * `pnpm legal apply --confirm` num comentario de `authorization-spec.ts` — que
 * foi para `main`. Quem escreve o proximo runbook copia o anterior; comentario
 * nao impede regressao. Mesmo raciocinio de `no-double-dash-in-docs.test.ts`.
 *
 * O QUE ELE NAO FAZ: nao proibe citar a operacao em prosa. "o `legal apply` gera
 * a licenca" descreve o que acontece e nao e copiavel como comando — por isso o
 * padrao exige uma FLAG logo depois, que e o que torna a linha executavel.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AUTHORIZATION_BATCH } from '../../services/legal/src/authorization-spec'

const ROOT = process.cwd()
/** Caminho deste arquivo (ESM: nao existe `__filename`). */
const SELF = fileURLToPath(import.meta.url)

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
 * `legal apply` seguido de uma FLAG — ou seja, uma linha executavel, nao prosa.
 *
 * `legal\s+apply` sem `sources` no meio. A flag logo depois e o que separa
 * "alguem vai copiar isto" de "isto explica o que a operacao faz".
 */
const OFFENDING_SHORT_FORM = /\blegal\s+apply\b[^\n]*?\s--\w/

/** Uma linha que passa `--policy-version=<valor>`; captura o valor. */
const POLICY_VERSION_ARG = /--policy-version=["']?([^"'\s`]+)/

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      walk(full, out)
      continue
    }
    if (SCANNED_EXTENSIONS.has(path.extname(entry))) out.push(full)
  }
  return out
}

/**
 * Arquivo de TESTE do parser — nao "documento que ensina".
 *
 * Um teste que prova que a CLI RECUSA uma leva invalida precisa, por
 * construcao, escrever uma leva invalida (`--policy-version=errado/v9`). Puni-lo
 * tornaria impossivel testar a propria regra que este arquivo defende.
 *
 * A isencao vale SO para a checagem de leva. A forma curta (`legal apply
 * --flag`) continua proibida em qualquer arquivo: la nao existe motivo legitimo
 * para escrever a forma que a CLI recusa como se fosse invocavel.
 */
function isParserTest(relPath: string): boolean {
  return /(^|[\\/])__tests__[\\/]|\.test\.[cm]?[jt]sx?$/.test(relPath)
}

/** Varre o repo aplicando `check` linha a linha. */
function scan(check: (line: string, relPath: string) => boolean): string[] {
  const offenders: string[] = []
  for (const file of walk(ROOT, [])) {
    // Este arquivo cita as formas erradas para documenta-las e para o controle
    // positivo. Varrer a si mesmo produziria falha permanente.
    if (path.resolve(file) === path.resolve(SELF)) continue
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!source.includes('legal')) continue
    const relPath = path.relative(ROOT, file)
    source.split(/\r?\n/).forEach((line, index) => {
      if (check(line, relPath)) offenders.push(`${relPath}:${index + 1}: ${line.trim()}`)
    })
  }
  return offenders.sort()
}

describe('governanca: a CLI do `legal` so tem uma forma invocavel', () => {
  it('nenhum arquivo do repo ensina `legal apply --flag` (falta `sources`)', () => {
    const offenders = scan((line) => OFFENDING_SHORT_FORM.test(line))
    expect(
      offenders,
      `Estes lugares ensinam uma invocacao que a CLI RECUSA ("comando desconhecido"). ` +
        `O comando e \`sources\` e o subcomando e \`apply\`:\n` +
        `  pnpm legal sources apply --reviewer="..." --policy-version="${AUTHORIZATION_BATCH}" --confirm\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('todo `--policy-version` documentado usa a leva vigente', () => {
    // `parseLegalArgs` compara com `AUTHORIZATION_BATCH` e recusa o resto. Um
    // documento com a leva errada nao e impreciso: ele e inexecutavel.
    const offenders = scan((line, relPath) => {
      if (isParserTest(relPath)) return false
      const match = POLICY_VERSION_ARG.exec(line)
      if (match === null) return false
      const value = match[1]!
      // Placeholders declarados nao sao valores: `<leva>`, `…`, `"..."`.
      if (/^[<…]|^\.{3}$|^\.\.\.$|^\$\{/.test(value)) return false
      return value !== AUTHORIZATION_BATCH
    })
    expect(
      offenders,
      `\`--policy-version\` e valor FECHADO: a CLI so aceita "${AUTHORIZATION_BATCH}". ` +
        `Qualquer outro sai com erro de uso e nao escreve nada:\n` +
        offenders.join('\n'),
    ).toEqual([])
  })

  /**
   * CONTROLE POSITIVO. Sem ele, um regex quebrado (ou uma varredura que nao le
   * arquivo nenhum) deixaria os dois testes acima verdes para sempre.
   */
  it('CONTROLE POSITIVO: o padrao REPROVA o que e errado e APROVA o que e certo', () => {
    // Errado — foi exatamente o que foi para `main` na #171.
    expect(OFFENDING_SHORT_FORM.test('Requer `pnpm legal apply --confirm` em producao')).toBe(true)
    expect(OFFENDING_SHORT_FORM.test('corepack pnpm legal apply --reviewer="X" --confirm')).toBe(
      true,
    )

    // Certo — a forma que a CLI aceita.
    expect(
      OFFENDING_SHORT_FORM.test(
        `corepack pnpm legal sources apply --reviewer="X" --policy-version="${AUTHORIZATION_BATCH}" --confirm`,
      ),
    ).toBe(false)

    // PROSA sobre a operacao continua permitida: nao e copiavel como comando.
    expect(OFFENDING_SHORT_FORM.test('o `legal apply` gera a licenca e a decisao')).toBe(false)
    expect(OFFENDING_SHORT_FORM.test('puxa licenca e decisao de uso no `legal apply`.')).toBe(false)

    // Leva: o valor vigente passa, a versao de uma licenca individual reprova.
    const checkPolicy = (line: string): boolean => {
      const m = POLICY_VERSION_ARG.exec(line)
      if (m === null) return false
      const v = m[1]!
      if (/^[<…]|^\.{3}$|^\$\{/.test(v)) return false
      return v !== AUTHORIZATION_BATCH
    }
    expect(checkPolicy(`--policy-version="${AUTHORIZATION_BATCH}"`)).toBe(false)
    // O erro real que eu cometi ao redigir o runbook da revogacao:
    expect(checkPolicy('--policy-version="cinerie-source-auth/2026-08-v2-revogada"')).toBe(true)
    // Placeholder declarado nao e valor.
    expect(checkPolicy('--policy-version="<leva>"')).toBe(false)
  })

  it('CONTROLE POSITIVO: a varredura realmente le arquivos deste repo', () => {
    const scanned = walk(ROOT, [])
    expect(scanned.length).toBeGreaterThan(200)
    expect(
      scanned.some((f) => f.endsWith(path.join('services', 'legal', 'README.md'))),
      'o README da CLI precisa estar no escopo — e ele que carrega a forma canonica',
    ).toBe(true)
  })
})
