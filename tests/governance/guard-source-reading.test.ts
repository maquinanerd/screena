/**
 * Guard dos guards — ler codigo-fonte so pela porta unica.
 *
 * ============================================================================
 * POR QUE ESTE TESTE EXISTE
 * ============================================================================
 * Quatro vezes um guard textual ficou VERDE casando com o proprio comentario do
 * arquivo que ele auditava: o comentario explicava a regra, citava o literal, e
 * `readFileSync(p, 'utf8')` entregava a explicacao junto com o codigo. As quatro
 * foram consertadas uma a uma — conserto de INSTANCIA. Enquanto ler o arquivo
 * cru continuar sendo a forma natural de escrever um guard, o quinto sai errado
 * do mesmo jeito.
 *
 * Este teste fecha o padrao: guard NOVO que ler fonte por fora de
 * `tests/support/source-text.ts` e RECUSADO. Quem precisa mesmo do texto cru
 * (prosa de doc, byte de controle, acento) usa `readSourceRaw(path, motivo)` —
 * continua possivel, mas deixa de ser acidente e passa a ser escolha assinada.
 *
 * ============================================================================
 * A LISTA CONGELADA
 * ============================================================================
 * `JA_LIAM_CRU` sao os arquivos que ja liam fonte quando esta regra nasceu. Ela
 * NAO cresce: entrada nova nao entra, e entrada que deixou de ler e removida
 * (travado abaixo, para a lista nao apodrecer). Ela so encolhe.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// Este guard le o texto CRU de proposito: ele mede como os outros guards leem,
// e um `import ... from 'node:fs'` dentro de um comentario ainda seria um
// arquivo que nao le fonte. Por isso passa pela saida deliberada, com motivo
// escrito — e assim nao viola a propria regra que aplica.
import { readSourceRaw, REPO_ROOT } from '../support/source-text.js'

const MOTIVO_CRU = 'este guard audita COMO os outros leem; precisa ver o import como escrito'

/** O modulo unico. Caminho em pedacos para nao casar consigo mesmo na varredura. */
const PORTA_UNICA = ['tests', 'support', 'source-text.ts'].join('/')

/** Este proprio arquivo, para a auto-exclusao da varredura. */
const ESTE_GUARD = ['tests', 'governance', 'guard-source-reading.test.ts'].join('/')

/**
 * Detecta um guard que le fonte por fora da porta unica. PURA, para ter teste
 * proprio: um detector que so roda sobre o repositorio nao tem como ser provado
 * errado.
 */
export function leFonteCru(source: string): boolean {
  const importaFs = /from\s+['"](?:node:)?fs(?:\/promises)?['"]/.test(source)
  if (!importaFs) return false
  return /\breadFileSync\b|\breadFile\b/.test(source)
}

const RAIZES = ['tests', 'services', 'packages', 'apps', 'api-clients']
const IGNORADOS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage'])

function arquivosDeTeste(): readonly string[] {
  const encontrados: string[] = []
  const andar = (dir: string): void => {
    let entradas
    try {
      entradas = readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const relativo = `${dir}/${entrada.name}`
      if (entrada.isDirectory()) {
        if (IGNORADOS.has(entrada.name)) continue
        andar(relativo)
        continue
      }
      if (!/\.test\.[cm]?tsx?$/.test(entrada.name)) continue
      // O AUDITOR NAO SE AUDITA. As expressoes regulares deste arquivo contem,
      // por necessidade, exatamente os padroes que ele procura — sem esta linha
      // ele se acusaria para sempre, e a unica saida seria se conceder uma
      // excecao na lista congelada, esvaziando a regra.
      if (relativo === ESTE_GUARD) continue
      encontrados.push(relativo)
    }
  }
  for (const raiz of RAIZES) andar(raiz)
  return encontrados.sort()
}

/**
 * Os arquivos que ja liam fonte crua quando a regra nasceu. CONGELADA: so
 * encolhe. Acrescentar caminho aqui e conceder a si mesmo a excecao que a regra
 * existe para negar — migre para `readSourceWithoutComments` em vez disso.
 */
const JA_LIAM_CRU: readonly string[] = [
  'apps/cms/src/__tests__/cms.test.ts',
  'apps/cms/src/__tests__/easypanel-runtime.test.ts',
  'apps/cms/src/__tests__/import-map.test.ts',
  'apps/cms/src/__tests__/manual-editorial.test.ts',
  'apps/web/app/_components/__tests__/detail-hero-canonical.test.tsx',
  'apps/web/app/_components/__tests__/footer-credit-logo-size.test.ts',
  'apps/web/app/_components/__tests__/footer-credits.test.tsx',
  'apps/web/app/_components/__tests__/similar-titles-computed.test.tsx',
  'apps/web/app/_components/__tests__/watch-ads-modality-computed.test.tsx',
  'apps/web/src/lib/__tests__/watch-browse-brand-visible.test.tsx',
  'services/entity-writer/src/__tests__/content-block-store-sql.test.ts',
  'services/entity-writer/src/__tests__/inspect-entity-writer.test.ts',
  'services/entity-writer/src/__tests__/inspect-store-readonly.test.ts',
  'services/entity-writer/src/__tests__/job-claim-sql.test.ts',
  'services/ingestion/src/__tests__/detail-finalize-guards.test.ts',
  'services/ingestion/src/catalog-jobs/__tests__/catalog-job-claim-sql.test.ts',
  'services/legal/src/__tests__/tmdb-video-license.test.ts',
  'services/news-ingestion/src/__tests__/worker-readiness.test.ts',
  'services/streaming/src/__tests__/promotion-no-network.test.ts',
  'services/user-platform/src/auth-runtime/__tests__/boundary.test.ts',
  'services/user-platform/src/contracts/__tests__/contract-boundary.test.ts',
  'services/user-platform/src/persistence/__tests__/boundary.test.ts',
  'services/user-platform/src/persistence/__tests__/identity-credential-ports.test.ts',
  'services/user-platform/src/privacy/__tests__/boundary.test.ts',
  'services/user-platform/src/ratings/__tests__/boundary.test.ts',
  'services/user-platform/src/recommendations/__tests__/boundary.test.ts',
  'services/user-platform/src/reviews/__tests__/boundary.test.ts',
  'services/user-platform/src/tracking/__tests__/boundary.test.ts',
  'tests/admin/access-protection.test.ts',
  'tests/admin/admin-detail-pages.test.ts',
  'tests/admin/admin-list-filters.test.ts',
  'tests/admin/admin-preview-pages.test.ts',
  'tests/admin/bulk-action-ui.test.ts',
  'tests/admin/content-qa-server-readonly.test.ts',
  'tests/admin/editorial-actions-guard.test.ts',
  'tests/admin/editorial-bulk-actions-guard.test.ts',
  'tests/admin/editorial-enums-schema-mirror.test.ts',
  'tests/admin/editorial-lifecycle-single-source.test.ts',
  'tests/admin/no-fake-login.test.ts',
  'tests/admin/no-secret-leak.test.ts',
  'tests/admin/no-server-writes.test.ts',
  'tests/admin/no-write-endpoints.test.ts',
  'tests/admin/pages-no-write.test.ts',
  'tests/admin/public-demo-seed-harness.test.ts',
  'tests/admin/qa-no-write-regression.test.ts',
  'tests/admin/qa-page.test.ts',
  'tests/admin/readonly-guard.test.ts',
  'tests/admin/review-queue.test.ts',
  'tests/admin/security-page.test.ts',
  'tests/admin/staging-seed-harness.test.ts',
  'tests/admin/staging-server-and-page.test.ts',
  'tests/admin/workflow-page.test.ts',
  'tests/governance/acentos-espelham-o-canonico.test.ts',
  'tests/governance/api-coverage.test.ts',
  'tests/governance/catalog-scheduler-units.test.ts',
  'tests/governance/cms-isolation.test.ts',
  'tests/governance/coverage-single-path.test.ts',
  'tests/governance/docs-invariants-present.test.ts',
  'tests/governance/editorial-media-route.test.ts',
  'tests/governance/editorial-worker-boundary.test.ts',
  'tests/governance/episode-no-season-number.test.ts',
  'tests/governance/home-seo-identity.test.ts',
  'tests/governance/image-host-single-source.test.ts',
  'tests/governance/image-license-gate.test.ts',
  'tests/governance/ingestion-person-slug.test.ts',
  'tests/governance/json-ld-safe-serialization.test.ts',
  'tests/governance/known-for-department-single-source.test.ts',
  'tests/governance/legal-cli-invocation-in-docs.test.ts',
  'tests/governance/legal-docs-indexing.test.ts',
  'tests/governance/no-double-dash-in-docs.test.ts',
  'tests/governance/no-fake-streaming-in-ui.test.ts',
  'tests/governance/no-raw-control-bytes.test.ts',
  'tests/governance/no-raw-robots-metadata.test.ts',
  'tests/governance/original-screen-absent.test.ts',
  'tests/governance/projection-has-consumer.test.ts',
  'tests/governance/rapidapi-offline-only.test.ts',
  'tests/governance/schema-safe-defaults.test.ts',
  'tests/governance/seed-filter-scope.test.ts',
  'tests/governance/tmdb-provider-separation.test.ts',
  'tests/governance/tmdb-raw-not-in-render.test.ts',
  'tests/governance/user-platform-enums-mirror.test.ts',
  'tests/governance/user-platform-persistence-foundation.test.ts',
  'tests/governance/user-platform-privacy.test.ts',
  'tests/governance/watch-country-fk.test.ts',
  'tests/governance/watch-license-provenance-sweep.test.ts',
  'tests/governance/web-render-layering.test.ts',
  'tests/web/article-hero-fullscreen.test.ts',
  'tests/web/canonical-slug-redirect.test.ts',
  'tests/web/category-home-canonical-contract.test.ts',
  'tests/web/detalhe-contraste.test.ts',
  'tests/web/detalhe-trailer.test.ts',
  'tests/web/explorar-unifica-busca.test.ts',
  'tests/web/explore-canonical-contract.test.ts',
  'tests/web/home-canonical-contract.test.ts',
  'tests/web/home-editorial-and-ticker-contract.test.ts',
  'tests/web/movie-canonical-port.test.ts',
  'tests/web/news-canonical-contract.test.ts',
  'tests/web/pauta-editorial-prontidao.test.ts',
  'tests/web/person-canonical-contract.test.ts',
  'tests/web/pessoa-detalhes-e-biografia.test.ts',
  'tests/web/popular-section-styling.test.ts',
  'tests/web/preferencias-de-apresentacao.test.ts',
  'tests/web/public-navigation.test.ts',
  'tests/web/public-shell-reset.test.ts',
  'tests/web/ratings-panel.test.ts',
  'tests/web/root-locale-redirect.test.ts',
  'tests/web/series-canonical-port.test.ts',
  'tests/web/series-similar-absence.test.ts',
  'tests/web/sitemap-person-eligibility.test.ts',
  'tests/web/tema-unico.test.ts',
  'tests/web/upcoming-rail-by-route.test.ts',
  'tests/web/watch-absence-reason.test.ts',
  'tests/web/watch-availability-panel.test.ts',
  'tests/web/watch-browse-foryou-absence.test.ts',
  'tests/web/watch-consumers-wiring.test.ts',
]

describe('leFonteCru: o detector, provado nos dois sentidos', () => {
  it('acusa o jeito ingenuo (import de node:fs + readFileSync)', () => {
    const ingenuo = [
      "import { readFileSync } from 'node:fs'",
      "const src = readFileSync('a.ts', 'utf8')",
    ].join('\n')
    expect(leFonteCru(ingenuo)).toBe(true)
  })

  it('acusa tambem `from "fs"` e `fs/promises`', () => {
    expect(leFonteCru('import { readFileSync } from "fs"\nreadFileSync(p)')).toBe(true)
    expect(leFonteCru("import { readFile } from 'node:fs/promises'\nreadFile(p)")).toBe(true)
  })

  it('NAO acusa quem usa a porta unica', () => {
    const certo = [
      "import { readSourceWithoutComments } from '../support/source-text.js'",
      "const src = readSourceWithoutComments('a.ts')",
    ].join('\n')
    expect(leFonteCru(certo)).toBe(false)
  })

  it('NAO acusa quem so lista diretorio (readdirSync nao le conteudo)', () => {
    expect(leFonteCru("import { readdirSync } from 'node:fs'\nreaddirSync(d)")).toBe(false)
  })
})

describe('varredura: nenhum guard NOVO le fonte crua', () => {
  it('a varredura encontra arquivos (nao pode medir o vazio)', () => {
    expect(arquivosDeTeste().length).toBeGreaterThan(100)
  })

  it('todo arquivo de teste que le fonte crua esta na lista congelada', () => {
    const permitidos = new Set(JA_LIAM_CRU)
    const novos = arquivosDeTeste().filter(
      (arquivo) =>
        !permitidos.has(arquivo) && leFonteCru(readSourceRaw(arquivo, MOTIVO_CRU)),
    )
    expect(
      novos,
      'guard lendo fonte por fora de ' +
        PORTA_UNICA +
        '. Use readSourceWithoutComments(caminho) — ou readSourceRaw(caminho, motivo) ' +
        'se precisar mesmo dos comentarios. Arquivos: ' +
        novos.join(', '),
    ).toEqual([])
  })

  it('a lista congelada nao tem entrada morta (ela so encolhe)', () => {
    // Sem isto a lista apodrece: arquivo migrado ou apagado continuaria
    // concedendo excecao a um caminho que nem existe mais.
    const existentes = new Set(arquivosDeTeste())
    const mortas = JA_LIAM_CRU.filter((arquivo) => {
      if (!existentes.has(arquivo)) return true
      return !leFonteCru(readSourceRaw(arquivo, MOTIVO_CRU))
    })
    expect(
      mortas,
      'entradas que nao leem mais fonte crua (ou nem existem) — remova da lista: ' +
        mortas.join(', '),
    ).toEqual([])
  })
})
