/**
 * image-license-gate.test.ts — A TRAVA do gate de licenca de imagem.
 *
 * ============================================================================
 * O DEFEITO, E POR QUE UMA TRAVA E MAIS IMPORTANTE QUE O CONSERTO
 * ============================================================================
 * Ate 21/08/2026 imagem era o UNICO dado de terceiro exibido pelo render sem
 * consultar `source_licenses`. Cinco modulos consultavam (premiacao, trailer,
 * notas, onde-assistir, hero); o caminho de imagem —
 * `movie-presenter -> imageAsset -> buildTmdbImageUrl` — nao mencionava licenca
 * em ponto nenhum. Consequencia: o valor de `display_allowed` para
 * `tmdb`/`image` era DECORACAO.
 *
 * Consertar os dois presenters de detalhe fecha a pagina de detalhe. NAO fecha
 * a home, a busca, o elenco, a descoberta, a temporada. Sem uma trava, o
 * proximo modulo nasce de novo sem gate — que e exatamente como este defeito
 * chegou ate aqui.
 *
 * ============================================================================
 * A LISTA E UMA DIVIDA DECLARADA, E ELA SO PODE ENCOLHER
 * ============================================================================
 * `AINDA_SEM_GATE` nomeia os modulos de `apps/web` que ainda montam URL de
 * imagem sem autorizacao. O teste (3) prova que ela nao CRESCE: um modulo novo
 * que importe `buildTmdbImageUrl` direto reprova aqui, e nao seis meses depois.
 *
 * Ao gatear um modulo, REMOVA a linha. O teste (4) reprova se uma entrada da
 * lista deixar de existir — divida quitada e divida apagada do registro, senao
 * a lista vira ficcao e ninguem confia nela.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Modulos de `apps/web` que AINDA montam URL de imagem sem passar pela licenca.
 *
 * Cada linha e uma superficie exibindo arte de terceiro sem gate. Nenhuma
 * entrada nova pode ser acrescentada sem que alguem explique por que uma
 * superficie NOVA nasceria sem licenca.
 */
const AINDA_SEM_GATE: readonly string[] = [
  'apps/web/src/lib/anticipated-presenter.ts',
  'apps/web/src/lib/cast-presenter.ts',
  'apps/web/src/lib/entity-index-presenter.ts',
  'apps/web/src/lib/home-hero-presenter.ts',
  'apps/web/src/lib/home-upcoming-presenter.ts',
  'apps/web/src/lib/news-presenter.ts',
  'apps/web/src/lib/person-presenter.ts',
  'apps/web/src/lib/search-presenter.ts',
  'apps/web/src/lib/season-episode-presenter.ts',
  'apps/web/src/lib/similar-titles-presenter.ts',
  'apps/web/src/server/catalog-summary.ts',
  'apps/web/src/server/discover.ts',
  'apps/web/src/server/person-page.ts',
  'apps/web/src/server/popular-rankings.ts',
  'apps/web/src/server/watch-browse.ts',
]

/** Modulos que JA passam pelo gate. Nenhum pode regredir. */
const COM_GATE: readonly string[] = [
  'apps/web/src/lib/movie-presenter.ts',
  'apps/web/src/lib/series-presenter.ts',
]

/**
 * Arquivos de `apps/web` que CHAMAM `buildTmdbImageUrl` (nao apenas o citam).
 *
 * A distincao importa: os dois presenters ja gateados mencionam o nome em
 * COMENTARIO, explicando a historia do gate. Casar por substring os acusaria de
 * um defeito que eles consertaram — e o teste ficaria vermelho para sempre por
 * um paragrafo de documentacao. Ver a licao "guardas de render varrem TEXTO".
 */
function modulosQueChamam(): string[] {
  const saida = execFileSync(
    'git',
    ['grep', '-l', '-E', 'buildTmdbImageUrl\\s*\\(', '--', 'apps/web/src', 'apps/web/app'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  return saida
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha !== '' && !linha.endsWith('tmdb-image-url.ts'))
    .sort()
}

describe('gate de licenca de imagem: nenhuma superficie NOVA nasce sem ele', () => {
  it('(1) CONTROLE POSITIVO: a varredura acha modulos (nao e vacua)', () => {
    // Sem isto, um `git grep` que parasse de funcionar faria todo o resto
    // passar com lista vazia — o teste mediria a si mesmo.
    expect(modulosQueChamam().length).toBeGreaterThan(5)
  })

  it('(2) os modulos JA gateados nao chamam mais o construtor cru', () => {
    const chamam = modulosQueChamam()
    for (const modulo of COM_GATE) {
      expect(chamam).not.toContain(modulo)
    }
  })

  it('(3) a lista de divida nao CRESCE: nenhum modulo novo sem gate', () => {
    const chamam = modulosQueChamam()
    const novos = chamam.filter((modulo) => !AINDA_SEM_GATE.includes(modulo))
    expect(
      novos,
      'Modulo NOVO montando URL de imagem sem licenca. Use `tmdbImageUrlIfAllowed` ' +
        '(@screena/public-contracts) com a autorizacao resolvida em ' +
        '`apps/web/src/server/image-license.ts`. Se houver motivo para nao gatear, ' +
        'acrescente a AINDA_SEM_GATE com justificativa no commit.',
    ).toEqual([])
  })

  it('(4) a lista nao guarda divida ja quitada nem arquivo inexistente', () => {
    const chamam = modulosQueChamam()
    const quitadas = AINDA_SEM_GATE.filter((modulo) => !chamam.includes(modulo))
    expect(
      quitadas,
      'Entrada de AINDA_SEM_GATE que nao chama mais o construtor cru. Remova a ' +
        'linha: registro de divida que sobrevive a quitacao vira ficcao.',
    ).toEqual([])
  })

  it('(5) o gate NAO vive em apps/web — ele e do contrato publico', () => {
    // Se o gate pudesse ser reimplementado em `apps/web`, existiriam duas
    // decisoes de licenca e elas divergiriam. A decisao mora num lugar so.
    const contrato = readFileSync(
      path.join(repoRoot, 'packages/public-contracts/src/image-authorization.ts'),
      'utf8',
    )
    expect(contrato).toContain('export function tmdbImageUrlIfAllowed')
    expect(contrato).toContain('export function authorizeImageDisplay')

    // E o adapter que le o banco fica FORA do contrato puro: contrato nao
    // conhece Prisma (invariante 3 vale para ele tambem).
    expect(contrato).not.toMatch(/@screena\/db|PrismaClient/)
  })
})
