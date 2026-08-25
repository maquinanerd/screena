/**
 * Governanca: a `<meta name="description">` passa pelo helper unico.
 *
 * O QUE ISTO IMPEDE DE VOLTAR (medido em producao, 2026-08-24):
 *
 *   /pt/filmes/a-origem/    description = 504 caracteres
 *   /pt/series/red-dwarf/   description = 500 caracteres
 *
 * As paginas de detalhe caiam para o `summary` INTEIRO quando nao havia
 * `meta_description` propria, e o despejavam na tag. O buscador corta por volta
 * de 155 a 160: 504 caracteres nao sao "descricao longa", sao uma frase cortada
 * no meio de uma palavra por quem nao e o dono do texto.
 *
 * A regra e textual de proposito: toda atribuicao a `metadata.description`
 * dentro de `apps/web/app` tem de citar `buildMetaDescription(` na mesma linha.
 * Nao adianta o helper existir se o proximo `generateMetadata` esquecer de
 * chama-lo — e esquecer e o modo de falha provavel, nao a malicia.
 *
 * Le pela porta unica (`readSourceWithoutComments`): exemplo dentro de
 * comentario nao conta como codigo.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { META_DESCRIPTION_MAX } from '@screena/seo'

import { readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

const RENDER_DIR = path.join(REPO_ROOT, 'apps', 'web', 'app')
const EXTENSOES = ['.ts', '.tsx']

/** Atribuicao direta a `metadata.description`. */
const ATRIBUICAO = /\bmetadata\.description\s*=/

/** `const ALGO_DESCRIPTION = 'literal'` numa linha so. */
const CONSTANTE_LITERAL = /^\s*const\s+([A-Z_]*DESCRIPTION[A-Z_]*)\s*=\s*(['"])([^'"]*)\2\s*;?\s*$/

/**
 * Detector PURO, para ter teste proprio: um detector que so roda sobre o
 * repositorio nao tem como ser provado errado.
 */
export function atribuicaoSemHelper(linha: string): boolean {
  if (!ATRIBUICAO.test(linha)) return false
  return !linha.includes('buildMetaDescription(')
}

function arquivosDeRender(): readonly string[] {
  const achados: string[] = []
  const andar = (dir: string): void => {
    let entradas
    try {
      entradas = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const cheio = path.join(dir, entrada.name)
      if (entrada.isDirectory()) {
        if (entrada.name === 'node_modules' || entrada.name === '.next') continue
        andar(cheio)
      } else if (
        EXTENSOES.some((e) => entrada.name.endsWith(e)) &&
        !entrada.name.includes('.test.') &&
        !cheio.split(path.sep).includes('__tests__')
      ) {
        achados.push(cheio)
      }
    }
  }
  try {
    if (statSync(RENDER_DIR).isDirectory()) andar(RENDER_DIR)
  } catch {
    /* apps/web/app pode nao existir (Fase 0) */
  }
  return achados.sort()
}

describe('governanca: meta description passa pelo helper unico', () => {
  const arquivos = arquivosDeRender()

  it('a varredura enxerga o render (nao passa por vacuidade)', () => {
    expect(arquivos.length).toBeGreaterThan(20)
  })

  it('toda atribuicao a metadata.description chama buildMetaDescription', () => {
    const infratores: string[] = []
    for (const arquivo of arquivos) {
      const linhas = readSourceWithoutComments(arquivo).split(/\r?\n/)
      linhas.forEach((linha, i) => {
        if (atribuicaoSemHelper(linha)) {
          const rel = path.relative(REPO_ROOT, arquivo).split(path.sep).join('/')
          infratores.push(`${rel}:${i + 1} -> ${linha.trim()}`)
        }
      })
    }
    expect(
      infratores,
      'Descricao crua indo para a tag. Envolva com buildMetaDescription(...) de ' +
        `@screena/seo. Ocorrencias:\n${infratores.join('\n')}`,
    ).toEqual([])
  })

  it('constante estatica de descricao respeita o teto', () => {
    const estouradas: string[] = []
    for (const arquivo of arquivos) {
      const linhas = readSourceWithoutComments(arquivo).split(/\r?\n/)
      linhas.forEach((linha, i) => {
        const m = CONSTANTE_LITERAL.exec(linha)
        if (m === null) return
        // `noUncheckedIndexedAccess`: grupo de captura e `string | undefined`
        // mesmo quando o padrao garante que casou. Nomear os dois deixa o
        // contrato explicito em vez de confiar na leitura da regex.
        const nome = m[1] ?? '(sem nome)'
        const valor = m[3] ?? ''
        if (valor.length <= META_DESCRIPTION_MAX) return
        const rel = path.relative(REPO_ROOT, arquivo).split(path.sep).join('/')
        estouradas.push(`${rel}:${i + 1} -> ${nome} tem ${valor.length} caracteres`)
      })
    }
    expect(
      estouradas,
      `Constante de descricao acima de ${META_DESCRIPTION_MAX}:\n${estouradas.join('\n')}`,
    ).toEqual([])
  })

  it('CONTROLE NEGATIVO: o detector reconhece a linha que existia antes', () => {
    // Esta era literalmente a linha de apps/web/app/pt/series/[slug]/page.tsx.
    expect(atribuicaoSemHelper('  if (view.metaDescription !== null) metadata.description = view.metaDescription')).toBe(
      true,
    )
    expect(atribuicaoSemHelper('    metadata.description = view.overview')).toBe(true)
    // E deixa passar a forma corrigida.
    expect(
      atribuicaoSemHelper('    metadata.description = buildMetaDescription(view.overview) ?? view.overview'),
    ).toBe(false)
    // Linha sem atribuicao nenhuma nao e infracao.
    expect(atribuicaoSemHelper('  const description = view.metaDescription ?? view.deck')).toBe(false)
  })
})
