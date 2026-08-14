import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrato da home — ATUALIZADO DELIBERADAMENTE para a tela 02 do handoff
 * canônico (HomeTemplate). Os contratos de DADO/SEO continuam idênticos aos
 * do reset; as travas visuais passaram a exigir as composições do design em
 * vez de proibi-las.
 */

const ROOT = process.cwd()
const HOME_PATH = 'apps/web/app/pt/page.tsx'
const HOME_LIKE_PATH = 'apps/web/app/_components/home-like.tsx'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

/**
 * Código SEM comentários. Guards de "texto proibido" precisam medir o que o
 * usuário vê, não a prosa que explica por que aquele texto não existe — senão
 * documentar a regra passa a violá-la.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('home pública — design canônico (tela 02)', () => {
  const home = read(HOME_PATH)
  const homeLike = read(HOME_LIKE_PATH)

  it('mantém os getters locais e a decisão canônica de indexabilidade', () => {
    for (const getter of [
      'getHomeCatalogData()',
      'getNewsIndexData()',
      'getHomeHeroSlides()',
      // A home mistura filme e serie no trilho "Em breve"; as categorias usam
      // os getters de uma vertical so (tests/web/upcoming-rail-by-route).
      'getHomeUpcomingMixed()',
      'getSeriesIndexData()',
      'getHomeTickerItems()',
      'getHomeEditorialHighlights()',
    ]) {
      expect(home).toContain(getter)
    }
    expect(home).toContain('evaluatePortalIndexability({')
    expect(home).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(home).toContain('canonicalPublicUrl(HOME_PATH)')
  })

  it('expõe um único H1 institucional e navegação para destinos reais', () => {
    expect(home.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(home).toContain('Cinerie — filmes, séries e pessoas')
    // A navegação das seções vive no template compartilhado (HomeLike).
    for (const destination of ['MOVIES_INDEX_PATH', 'SERIES_INDEX_PATH', 'NEWS_INDEX_PATH']) {
      expect(homeLike).toContain(`href={${destination}}`)
    }
    // Pessoas/Explorar navegam pelo chrome global (header/footer), como no
    // canônico — a home não tem seção própria de pessoas.
  })

  it('segue a ORDEM EXATA da tela 02 do canônico, só com dados persistidos', () => {
    // A composição vive no template compartilhado HomeLike (tela 02 = tela 04
    // com as duas bandas ligadas). Ordem: hero → ticker → destaques → popular
    // (rank) → filmes em alta → stats → séries → em breve → notícias.
    const order = [
      '<HomeHeroCarousel slides={heroSlides} />',
      '<HomeTicker items={tickerItems} />',
      '<HomeEditorialHighlights',
      'className="pop-rail__rank"',
      'label="Filmes em alta"',
      '<MonthStats />',
      'label="Séries da semana"',
      'className="glimpse-rail"',
      'className="hnews-grid"',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = homeLike.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
    // A home liga as DUAS bandas e cada seção continua condicionada a dado real.
    expect(home).toContain('<HomeLike')
    expect(home).toContain('showMoviesBand')
    expect(home).toContain('showSeriesBand')
    expect(homeLike).toContain('heroSlides.length > 0 ?')
    expect(homeLike).toContain('showMoviesBand && movieCards.length > 0 ?')
    expect(homeLike).toContain('showSeriesBand && seriesCards.length > 0 ?')
    // "Em breve" nao usa ternario: a decisao de nao renderizar e o log do
    // motivo sao a MESMA linha (SectionBoundary), senao a ausencia volta a ser
    // muda — foi assim que /pt/series/ ficou sem a secao.
    expect(homeLike).toContain('decision={upcomingSection}')
    expect(homeLike).toContain("section: 'em-breve'")
    expect(homeLike).toContain('newsCards.length > 0 ?')
    expect(home).toContain('Ainda não há conteúdo publicado')
  })

  it('primeira dobra: header transparente, título limpo e dot com acento', () => {
    const css = read('apps/web/app/globals.css')
    const header = read('apps/web/app/_components/site-header.tsx')
    const hero = read('apps/web/app/_components/home-hero-carousel.tsx')

    // 1. Header sobre o hero é transparente de verdade — nenhuma faixa/scrim
    //    próprio duplicando o `hero__scrim-v` (era a "faixa preta" do topo).
    expect(css).toMatch(/\.site-header\[data-overlay='true'\] \{[^}]*background: transparent/s)
    expect(css).not.toMatch(
      /\.site-header\[data-overlay='true'\] \{[^}]*linear-gradient/s,
    )
    // Rota de hero sem hero renderizado não pode virar texto branco no claro.
    expect(header).toContain("document.querySelector('#main-content .hero')")

    // 2. O título do hero NÃO é <p> (o estilo global `p a` o sublinharia) e o
    //    link interno não pode reintroduzir decoração.
    expect(hero).toContain('<div className="hero__title">')
    expect(hero).not.toMatch(/<p className="hero__title">/)
    expect(css).toMatch(/\.hero__title a \{[^}]*text-decoration: none/s)

    // 3. Indicador ativo carrega o acento da vertical do slide, nunca branco.
    expect(hero).toContain('data-vertical={s.vertical}')
    expect(css).toMatch(
      /\.hero__dot\[aria-selected='true'\] \{[^}]*background: var\(--c-accent-movie\)/s,
    )
    expect(css).toMatch(
      /\.hero__dot\[aria-selected='true'\]\[data-vertical='series'\] \{[^}]*var\(--c-accent-series\)/s,
    )
  })

  it('acentos SEPARADOS: menu segue a ROTA, indicador segue o SLIDE', () => {
    const css = read('apps/web/app/globals.css')
    const header = read('apps/web/app/_components/site-header.tsx')
    const hero = read('apps/web/app/_components/home-hero-carousel.tsx')

    // O contexto do header vem do PATHNAME — nunca do slide ativo. Em `/pt/` o
    // contexto é `neutral`, então o sublinhado de Início é SEMPRE o vermelho da
    // marca, mesmo quando o hero está exibindo uma série.
    expect(header).toContain('data-context={context}')
    expect(header).toContain('const context = logoContextOf(pathname)')
    expect(header).not.toMatch(/slide|vertical|hero__dot/)
    expect(css).toMatch(/\.site-header \{[^}]*--nav-accent: var\(--c-accent-movie\)/s)
    expect(css).toMatch(
      /\.site-header\[data-context='series'\] \{[^}]*--nav-accent: var\(--c-accent-series\)/s,
    )
    expect(css).toMatch(
      /\.site-header__link\[aria-current='page'\] \{[^}]*border-bottom-color: var\(--nav-accent\)/s,
    )

    // O indicador do carrossel, ao contrário, segue a vertical do PRÓPRIO slide.
    expect(hero).toContain('data-vertical={s.vertical}')
    expect(css).not.toMatch(/\.hero__dot\[aria-selected='true'\][^{]*\{[^}]*--nav-accent/s)

    // Prova dinâmica no app real (Next + PostgreSQL): checks C1/C2 de
    // `pnpm --filter @screena/web qa:home-fold` — slide de filme => nav
    // vermelho + dot vermelho; slide de série => nav vermelho + dot verde.
    const qa = read('apps/web/scripts/qa-home-first-fold-real-postgres.ts')
    expect(qa).toContain('C1 slide de FILME: underline de Início vermelho E dot ativo vermelho')
    expect(qa).toContain('C2 slide de SERIE: underline de Início continua VERMELHO e dot fica VERDE')
  })

  it('Cinerie Score: procedência vem do banco, nunca de nota de terceiro', () => {
    const provenance = read('apps/web/src/server/editorial-score.ts')
    const heroLoader = read('apps/web/src/server/home-hero.ts')

    // A origem editorial NÃO é inventada nem inferida da coluna: vem de
    // `cinerie_score_calculations` com status `calculated` e valor coerente.
    expect(provenance).toContain("status: \"calculated\"")
    expect(provenance).toContain('SCREEN_SCORE_EDITORIAL_SOURCE')
    expect(provenance).toMatch(/latest\.scale !== candidate\.screenScoreScale/)
    // Nenhuma nota externa pode alimentar a estrela. (Varre o CÓDIGO: o
    // cabeçalho do módulo cita essas fontes justamente para proibi-las.)
    const provenanceCode = provenance.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    expect(provenanceCode).not.toMatch(
      /voteAverage|imdb|rotten|metacritic|letterboxd|filmaffinity/i,
    )

    // O loader do hero passa a procedência adiante (a cadeia estava quebrada
    // aqui: `screenScoreSource` nunca era populado por nenhum loader).
    expect(heroLoader).toContain('resolveEditorialScoreSources')
    expect(heroLoader).toContain('screenScoreSource:')
    // Chave composta: `movies.id` e `tv_shows.id` são sequências independentes.
    expect(heroLoader).toMatch(/`\$\{entityType\}:\$\{id\}`/)
  })

  it('faixa amarela é estrutura fixa, mas nunca inventa episódio ou plataforma', () => {
    const ticker = read('apps/web/app/_components/home-ticker.tsx')
    const tickerServer = read('apps/web/src/server/home-ticker.ts')

    // A faixa não depende de `items.length > 0` para existir…
    expect(ticker).not.toMatch(/if \(items\.length === 0\) return null/)
    expect(ticker).toContain('className="ticker"')
    // …mas o estado vazio é honesto: nada de novidade, data ou provedor fake.
    expect(ticker).toContain('Nenhuma novidade confirmada para hoje')
    expect(ticker).not.toMatch(/Netflix|Prime Video|Disney\+|Max\b|Apple TV/)

    // A faixa agrega as QUATRO fontes reais (não é mais episódio-ou-fallback).
    for (const kind of [
      'episode_today',
      'episode_upcoming',
      'movie_release',
      'series_release',
      'streaming_arrival',
    ]) {
      expect(tickerServer).toMatch(new RegExp(`['"]${kind}['"]`))
    }
    // Toda data vem de coluna persistida — nenhuma é estimada.
    expect(tickerServer).toMatch(/airDate: \{ gte: dayStart, lt: futureEnd \}/)
    expect(tickerServer).toMatch(/releaseDate: \{ gte: dayStart, lt: futureEnd \}/)
    expect(tickerServer).toMatch(/availableFrom: \{ gte: arrivalStart, lte: now \}/)
    // `season_number` REAL (nunca deduzido) e "especiais" (0) fora da estreia.
    expect(tickerServer).toMatch(/seasonNumber: \{ gt: 0 \}/)
    expect(tickerServer).toContain('seasonNumber: season.seasonNumber')

    // PROVEDOR: reusa o gate compartilhado (nunca uma segunda regra de licença)
    // e consulta em LOTE (uma query para todas as séries — jamais N+1).
    expect(tickerServer).toContain('licensedWatchWhere(now)')
    expect(tickerServer).toContain('selectTickerWatchOffer')
    expect(tickerServer).toMatch(/entityId: \{ in: \[\.\.\.movieIds\] \}/)
    expect(tickerServer).toMatch(/entityId: \{ in: \[\.\.\.tvIds\] \}/)
    expect(tickerServer).not.toMatch(/for \([^)]*\) \{\s*await prisma\.watchAvailability/)
    // "Em cartaz" NUNCA é inferido de `release_date`, e sessão de cinema
    // (formato/idioma/rede/horário) não existe no banco — logo não é exibida.
    expect(code(tickerServer)).not.toMatch(/em cartaz/i)
    expect(code(tickerServer)).not.toMatch(/70mm|Legendado|sess(?:ão|ões)|Kinoplex|Cinesystem/i)
    expect(code(ticker)).not.toMatch(/em cartaz/i)
    // Nenhum provedor hardcoded em lugar nenhum da faixa.
    expect(tickerServer).not.toMatch(/Netflix|Prime Video|Disney\+|Apple TV/)
    // O crédito exigido pela licença NÃO fica mais na faixa: desde 2026-08-13
    // (decisão do proprietário) ele vive no rodapé global, que é chrome de toda
    // página e não muda a cada slide. Presença provada em
    // `apps/web/app/_components/__tests__/footer-credits.test.tsx`.
    // `code(...)` e nao `ticker`: a varredura tem de ser sobre CODIGO. O
    // comentario que explica a mudanca cita `attributionText` de proposito, e um
    // grep sobre o texto cru reprovaria a explicacao junto com o defeito.
    expect(code(ticker)).not.toContain('ticker__credit')
    expect(code(ticker)).not.toContain('attributionText')
  })

  it('anúncios só via AdSlot governado (nunca criativo inline)', () => {
    expect(homeLike).toMatch(/<AdSlot format="leaderboard" slotId=\{`\$\{adPrefix\}-/)
    expect(homeLike).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
    expect(home).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
  })

  it('preserva Organization e WebSite em JSON-LD', () => {
    expect(home).toMatch(/['"]@type['"]:\s*['"]Organization['"]/)
    expect(home).toMatch(/['"]@type['"]:\s*['"]WebSite['"]/)
    expect(home.match(/application\/ld\+json/g)).toHaveLength(2)
    expect(home).not.toMatch(/SearchAction|AggregateRating/)
  })
})
