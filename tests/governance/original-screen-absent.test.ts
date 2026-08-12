/**
 * original-screen-absent.test.ts — "ORIGINAL SCREEN" NAO VOLTA.
 *
 * O canonico (`paginas/06-movie-detail.html` e `07-series-detail.html`) carrega,
 * ao lado do selo Filme/Serie:
 *
 *     <span style="...">Original Screen</span>
 *
 * Sao DUAS coisas erradas de uma vez:
 *
 *  1. RESIDUO DE REBRAND. O `MANIFESTO-CANONICO.json` registra a passada
 *     "The Screen -> Cinerie"; este rotulo sobreviveu nos dois arquivos. A marca
 *     publica e Cinerie, e "Screen" so pode aparecer como referencia historica
 *     em snapshot datado — nunca como identidade ativa numa pagina no ar.
 *
 *  2. AFIRMACAO FALSA, que e o motivo mais forte. "Original <marca>" significa
 *     producao propria — e o vocabulario de "Netflix Original", "Prime Original".
 *     A Cinerie nao produz filme nem serie. Estampar isso em cima de "Gladiador"
 *     diz ao leitor uma coisa que nao e verdade, e o rebrand nao conserta o
 *     erro: "Original Cinerie" seria igualmente falso. Por isso este teste
 *     barra as DUAS formas.
 *
 * Este teste nao conserta nada hoje: o rotulo nunca foi portado. Ele existe
 * porque a divergencia esta no canonico, e o canonico e a fonte que a proxima
 * pessoa vai abrir para "completar o que falta na pagina". Sem esta trava, o
 * rotulo entra como implementacao fiel ao desenho.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PAGINAS = [
  'apps/web/app/pt/filmes/[slug]/page.tsx',
  'apps/web/app/pt/series/[slug]/page.tsx',
] as const

/**
 * Le a pagina SEM comentarios.
 *
 * Isto nao e conveniencia: e a diferenca entre a regra certa e a errada. A
 * regra e "o rotulo nao chega ao DOM", nao "a string nao existe no arquivo".
 * Um guard que varresse o texto cru proibiria DOCUMENTAR a decisao — e as duas
 * paginas precisam explicar, no proprio cabecalho, por que o bloco do canonico
 * nao foi portado. Sem esta separacao, a unica saida seria apagar a explicacao,
 * e a proxima pessoa reimplementaria o rotulo por falta dela.
 *
 * (Ja aconteceu neste repositorio: guard de render casando com comentario.)
 */
function sourceOf(relativePath: string): string {
  const raw = readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8')
  return (
    raw
      // Blocos /* ... */ — cobre tambem os comentarios JSX {/* ... */}.
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // Linha // ... — o `[^:]` antes evita comer o "//" de uma URL.
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  )
}

/**
 * CONTROLE POSITIVO. Um caminho errado faria `readFileSync` estourar (bom),
 * mas um arquivo que virasse vazio ou stub passaria em todas as buscas
 * negativas abaixo sem provar nada. Exigir a marcacao do selo garante que
 * estamos lendo a pagina de detalhe de verdade.
 */
function assertPaginaDeDetalhe(source: string, path: string): void {
  if (!source.includes('detail-badge-row') || !source.includes('detail-badge')) {
    throw new Error(
      `FIXTURE INUTILIZAVEL: ${path} nao contem a linha do selo (detail-badge-row). ` +
        'As buscas negativas abaixo passariam pelo motivo errado.',
    )
  }
}

describe('"Original Screen" nao entra na pagina de detalhe', () => {
  it.each(PAGINAS)('%s nao estampa o rotulo do canonico', (path) => {
    const source = sourceOf(path)
    assertPaginaDeDetalhe(source, path)

    // O rotulo do canonico, literal.
    expect(source).not.toMatch(/Original Screen/i)
    // E a versao "corrigida pelo rebrand", que seria igualmente falsa: a
    // Cinerie nao produz nem filme nem serie.
    expect(source).not.toMatch(/Original Cinerie/i)
  })

  it('o selo de tipo continua sozinho na linha (nada tomou o lugar do rotulo)', () => {
    // Se um dia um dado REAL couber ali (país de origem, estúdio, distribuidora
    // — tudo vem da TMDB), ele entra por proposta explicita, nao de carona.
    const filme = sourceOf(PAGINAS[0])
    const linha = /detail-badge-row[\s\S]{0,400}?<\/div>/.exec(filme)
    expect(linha, 'linha do selo nao encontrada').not.toBeNull()
    expect(linha![0]).toContain('Filme')
  })
})
