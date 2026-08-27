import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const PAGE_REL = 'apps/web/app/pt/series/[slug]/page.tsx'
const CSS_REL = 'apps/web/app/pt/series/[slug]/series-canonical.module.css'
const page = readFileSync(path.join(ROOT, PAGE_REL), 'utf8')

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * Indice do BLOCO na fonte: a primeira ocorrencia da classe como TOKEN INTEIRO
 * dentro de um atributo `className` — literal (`className="x"`) ou expressao
 * (`className={cond ? "x" : "x y"}`).
 *
 * POR QUE NAO `indexOf('className="x"')`, QUE ERA O ORIGINAL. Porque ele media
 * a SINTAXE, nao o bloco. No dia em que uma dessas classes virou composta
 * condicionalmente, o literal sumiu do arquivo e a guarda acusou regressao onde
 * nao havia: o grid renderiza certo nos DOIS estados, e isso esta provado por
 * estilo computado em
 * `apps/web/app/_components/__tests__/similar-titles-computed.test.tsx`.
 *
 * POR QUE NAO RELAXAR PARA `indexOf("ficha-grid")`. Isso mataria a guarda:
 * passaria a casar com `ficha-grid--solo`, com caminho de import e com qualquer
 * mencao solta. Aqui a classe precisa (a) estar DENTRO de um `className` e (b)
 * ser um token inteiro — `ficha-grid--solo` sozinho NUNCA satisfaz
 * `ficha-grid`, e `media-strip__cell` nunca satisfaz `media-strip`.
 *
 * FAIL-CLOSED: expressao com chave aninhada (template literal com `${}`) nao e
 * capturada e devolve -1 — reprova em voz alta em vez de passar por engano.
 *
 * A ORDEM CONTINUA SENDO A GARANTIA: o indice devolvido e o do proprio atributo
 * `className`, entao a caminhada estritamente crescente segue valendo.
 */
function blockIndex(code: string, cls: string): number {
  const attribute = /className=(?:"([^"]*)"|\{([^{}]*)\})/g
  const wholeToken = new RegExp(`(?:^|["\\s])${cls}(?=["\\s]|$)`)
  let match: RegExpExecArray | null
  while ((match = attribute.exec(code)) !== null) {
    const value = match[1] ?? match[2] ?? ''
    if (wholeToken.test(value)) return match.index
  }
  return -1
}

/**
 * Bloco que deixou de ser escrito inline na pagina e virou COMPONENTE.
 *
 * A faixa de elenco era escrita aqui dentro — e DUAS vezes, porque o membro
 * com slug virava `<a>` e o sem slug virava `<div>`, cada um carregando sua
 * copia do retrato, das iniciais, do nome e do personagem. Ela agora mora em
 * `apps/web/app/_components/cast-strip.tsx`.
 *
 * O QUE ISSO MUDA PARA ESTA GUARDA. Nada do que ela mede: a ordem canonica
 * continua sendo medida NA PAGINA, e `<CastStrip />` ocupa exatamente a
 * posicao que a `<ul className="cast-strip">` ocupava. So a ancora muda — a
 * classe deixou de existir neste arquivo, entao o elemento e que a marca.
 *
 * As classes em si (`cast-strip`, `cast-tile`, ...) passaram a ser cobertas
 * por `apps/web/app/_components/__tests__/cast-strip.test.tsx`, que renderiza
 * o componente — prova mais forte que casar texto, nao mais fraca.
 */
const BLOCO_EXTRAIDO: Record<string, string | undefined> = {
  'cast-strip': 'CastStrip',
}

/**
 * Indice da ancora do bloco: a CLASSE enquanto ele e inline, o ELEMENTO depois
 * de extraido. FAIL-CLOSED: sem nenhum dos dois, -1 — reprova em voz alta.
 */
function anchorIndex(code: string, cls: string): number {
  const inline = blockIndex(code, cls)
  if (inline !== -1) return inline
  const element = BLOCO_EXTRAIDO[cls]
  return element === undefined ? -1 : code.indexOf(`<${element}`)
}

describe('shell público mínimo · detalhe de série', () => {
  const code = withoutComments(page).replaceAll("'", '"')

  it('preserva dados, metadata, canonical, robots e identidade JSON-LD', () => {
    expect(code).toContain('getSeriesPageData(slug)')
    expect(code).toContain('canonicalRedirectPath(')
    expect(code).toContain('permanentRedirect(redirectPath)')
    expect(code).toContain('robots: gatePublicRobots(seo.robots)')
    expect(code).toContain('alternates: { canonical: canonicalUrl }')
    expect(code).toContain('"@type": "TVSeries"')
    expect(code).toContain('"@type": "BreadcrumbList"')
    expect(code).toContain('buildSameAs(externalIds, "tv")')
    expect(code.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(code).not.toContain('AggregateRating')
  })

  it('mantém um H1, breadcrumb e badge textual de Série', () => {
    expect(code.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(code).toContain('data-vertical="series"')
    expect(code).toMatch(/data-entity-badge="series"[\s\S]{0,40}Série/)
    expect(code).toContain('href={SERIES_INDEX_PATH}>Séries</a>')
  })

  it('preserva seleção de temporada, query e âncoras', () => {
    expect(code).toContain('seasonNumberFromQuery(query.temporada)')
    expect(code).toContain('const selectedSeason =')
    expect(code).toContain('id="episodios"')
    expect(code).toContain('id={`temporada-${season.seasonNumber}`}')
    // Fase 4: as temporadas linkam para as rotas dedicadas (seasonPath),
    // preservando a selecao inline por query (`?temporada=`) como fallback.
    expect(code).toContain('seasonPath(data.canonicalSlug, season.seasonNumber)')
    expect(code).toContain('`?temporada=${season.seasonNumber}#episodios`')
    expect(code).toContain('season={selectedSeason}')
    expect(code).toContain('Nenhum episódio publicado nesta temporada.')
  })

  it('mantém somente blocos revisados e dados reais da ficha', () => {
    expect(code).toContain('WORK_BLOCK_TYPES.has(block.blockType)')
    expect(code).toContain('EPISODE_BLOCK_TYPES.has(block.blockType)')
    // `where_to_watch_text` SAIU do cartao com o topo canonico (20/08/2026):
    // o cartao e "marcas em linha e mais nada". O bloco editorial segue valido
    // no schema e sem superficie nas paginas de detalhe — registrado em
    // docs/frontend/DESIGN-DELTA-detalhe.md; nenhum bloco desse tipo existe em
    // producao hoje.
    expect(code).toContain('block.blockType === "cast_intro"')
    expect(code).toContain('block.blockType === "news_context"')
    // Gate de oferta licenciada = fronteira de secao (decide E registra).
    expect(code).toMatch(/decideSection\(watch,/)
    expect(code).toContain('<WatchBrandsRow brands={watchBrandsRow(view)} />')
    // "Também em: IMDb" SAIU do topo (uma das sete remocoes do dono,
    // 20/08/2026). Os IDs externos continuam alimentando o sameAs do JSON-LD.
    expect(code).not.toContain('EntityExternalIds')
    expect(code).toContain('buildSameAs(externalIds')
    expect(code).toMatch(/decideSection\(visibleCast,/)
    expect(code).toMatch(/decideSection\(visibleNews,/)
    expect(code).toContain('<CastStrip members={members} />')
    expect(code).toContain('articles.map(')
    expect(code).toContain('data-editorial-state="in-review"')
  })

  it('design canônico (tela 07): estrutura EXATA do handoff, sem dado inventado', () => {
    // Ordem canônica: hero editorial claro (verde) → mídia → A obra →
    // Guia crítica → EPISÓDIOS (catálogo) → Elenco → Notícias → Detalhes.
    const order = [
      'detail-hero',
      'media-strip',
      'synopsis-lead',
      'critic-band',
      'season-tabs',
      'cast-strip',
      'mnews-grid',
      'ficha-grid',
    ]
    let cursor = -1
    for (const cls of order) {
      const at = anchorIndex(code, cls)
      // Duas falhas diferentes, duas mensagens diferentes: "sumiu do arquivo" e
      // "esta no arquivo, mas fora de ordem" pedem investigacoes distintas.
      expect(at, `bloco ausente: .${cls}`).toBeGreaterThan(-1)
      expect(at, `bloco fora de ordem: .${cls}`).toBeGreaterThan(cursor)
      cursor = at
    }
    expect(existsSync(path.join(ROOT, CSS_REL))).toBe(false)
    expect(code).not.toContain('.module.css')
    expect(code).toContain('view.media.poster !== null')
    expect(code).toContain('episode.still !== null')
    expect(code).toContain('className="episode-row"')
    expect(code).not.toMatch(/src="https?:/)
    expect(code).not.toMatch(/(?:\?\?|=== null \?)\s*["']—["']/)
    // Cinerie Score: sem fórmula aprovada, o bloco inteiro não renderiza —
    // nem número inventado, nem placeholder na posição de maior destaque da
    // coluna (ver o mesmo caso em movie-canonical-port.test.ts).
    expect(code).not.toMatch(/score-line__value/)
    expect(code).not.toMatch(/Ainda não calculado/)
    expect(code).not.toMatch(/Cinerie Score/)
    // 21k episódios nunca de uma vez (só a temporada selecionada renderiza).
    expect(code).toContain('season={selectedSeason}')
  })
})
