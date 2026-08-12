import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Contrato ESTRUTURAL da primeira dobra corrigida:
 *
 *  - "Destaques de hoje" é EDITORIAL (matérias), não catálogo;
 *  - `Filmes`/`Séries` são TABS reais, não navegação;
 *  - a faixa amarela é um CARROSSEL de novidades reais, não um item único.
 *
 * Estas travas existem porque o defeito anterior era invisível para os testes:
 * a seção compilava, renderizava e passava em tudo — só mostrava a coisa errada.
 */

const ROOT = process.cwd()
const EDITORIAL = 'apps/web/app/_components/home-editorial-highlights.tsx'
const TICKER = 'apps/web/app/_components/home-ticker.tsx'
const HOME_LIKE = 'apps/web/app/_components/home-like.tsx'
const EDITORIAL_SERVER = 'apps/web/src/server/home-editorial.ts'
const TICKER_SERVER = 'apps/web/src/server/home-ticker.ts'

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

/** Código SEM comentários: guards de texto medem o que o usuário vê. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('Destaques de hoje — seção editorial, não catálogo', () => {
  const editorial = read(EDITORIAL)
  const editorialCode = code(editorial)
  const homeLike = read(HOME_LIKE)
  const server = read(EDITORIAL_SERVER)

  it('consome ARTIGOS: nenhum contrato de catálogo entra na seção', () => {
    for (const forbidden of [
      'EntityCard',
      'entity-index-presenter',
      'voteAverageTmdb',
      'voteCountTmdb',
      'screenScore',
      'posterPath',
    ]) {
      expect(editorialCode, `seção cita contrato de catálogo: ${forbidden}`).not.toContain(
        forbidden,
      )
    }
    expect(editorialCode).toContain('home-editorial-presenter')
  })

  it('o loader lê a cadeia editorial e NÃO as tabelas de catálogo', () => {
    expect(server).toContain('prisma.articleTranslation.findMany')
    expect(server).toContain('prisma.entityNewsLink.findMany')
    expect(server).not.toMatch(/prisma\.(?:movie|tvShow|season|episode)\./)
  })

  it('todo card aponta para notícia — nunca para ficha de filme/série', () => {
    // O href do card vem do presenter (que monta /pt/noticias/{slug}/); a seção
    // não pode reintroduzir rota de catálogo por conta própria.
    expect(editorialCode).not.toMatch(/\/pt\/(?:filmes|series|pessoas)\//)
    expect(editorialCode).not.toContain('MOVIES_INDEX_PATH')
    expect(editorialCode).not.toContain('SERIES_INDEX_PATH')
    expect(editorialCode).toContain('href={card.href}')
  })

  it('nenhuma metadata de entidade aparece nos cards', () => {
    for (const forbidden of [
      'Filme · ',
      'Série · ',
      'certification',
      'runtime',
      'temporada',
      'card.meta',
    ]) {
      expect(editorialCode, `card exibe metadata de catálogo: ${forbidden}`).not.toContain(
        forbidden,
      )
    }
  })

  it('sem imagem publicável usa PLACEHOLDER, nunca o pôster da entidade', () => {
    expect(editorialCode).toContain('feat-card__placeholder')
    expect(editorialCode).toContain('card.imagePath === null')
    // O placeholder não pode virar uma porta para mídia de catálogo.
    expect(editorialCode).not.toMatch(/image\.tmdb\.org|buildTmdbImageUrl/)
  })

  it('imagem sempre com alt real (nunca alt="")', () => {
    expect(editorialCode).toContain('alt={card.imageAlt}')
    expect(editorialCode).not.toMatch(/alt=""/)
  })

  it('a seção NUNCA some: renderiza sempre, com estado vazio explícito', () => {
    // O defeito nº 3 do descarte silencioso: a seção existia desde a PR #91 e
    // uma auditoria inteira a declarou inexistente porque ela se escondia
    // quando não havia vínculo. Agora ela é estrutura fixa: o template não
    // pode voltar a envolvê-la num guard condicional.
    expect(homeLike).toContain('<HomeEditorialHighlights')
    const homeLikeCode = code(homeLike)
    expect(homeLikeCode, 'a seção voltou a se esconder atrás de hasEditorial').not.toMatch(
      /hasEditorial\s*\?[\s\S]{0,400}<HomeEditorialHighlights/,
    )
    // Com ZERO vínculos, o que o usuário vê é a mensagem honesta da vertical
    // ativa (EMPTY_MESSAGE do componente) — nunca uma página sem a seção.
    expect(editorialCode).toContain('EMPTY_MESSAGE[tab.vertical]')
  })

  it('o loader avisa (uma vez) quando os destaques resolvem vazios', () => {
    expect(server).toContain('logEmptyHighlightsOnce')
    expect(server).toContain('destaques vazios')
  })

  it('a home NÃO repete nos destaques matéria do bloco "Notícias & entrevistas"', () => {
    // A deduplicação é aplicada na montagem da home: os hrefs dos newsCards
    // (exatamente o que a banda de notícias renderiza) são excluídos dos
    // destaques ANTES de o template receber os dados.
    const homePage = read('apps/web/app/pt/page.tsx')
    expect(homePage).toContain('excludeEditorialHighlights(')
    expect(homePage).toContain('new Set(newsCards.map((card) => card.href))')
    expect(homePage).toContain('editorialHighlights: dedupedHighlights')
  })
})

describe('Filmes/Séries são TABS, não navegação', () => {
  const editorial = read(EDITORIAL)
  const editorialCode = code(editorial)

  it('são <button type="button"> com semântica de tab', () => {
    expect(editorialCode).toContain('role="tablist"')
    expect(editorialCode).toContain('role="tab"')
    expect(editorialCode).toContain('role="tabpanel"')
    expect(editorialCode).toContain('type="button"')
    expect(editorialCode).toContain('aria-selected={active === tab.vertical}')
    expect(editorialCode).toContain('aria-controls=')
  })

  it('NÃO navegam: sem href, sem router.push, sem window.location', () => {
    // O único `href` permitido na seção é o do card (a matéria). O controle
    // segmentado não pode ter nenhum.
    expect(editorialCode).not.toContain('router.push')
    expect(editorialCode).not.toContain('useRouter')
    expect(editorialCode).not.toContain('window.location')
    expect(editorialCode).not.toContain('<Link')
    expect(editorialCode).not.toMatch(/<a[^>]*className="seg-toggle__opt"/)
    expect(editorialCode).not.toMatch(/aria-current=/)
  })

  it('trocam CONTEÚDO de verdade (dataset por vertical), não só o estilo', () => {
    expect(editorialCode).toMatch(
      /active === 'movies' \? highlights\.movies : highlights\.series/,
    )
    expect(editorialCode).toContain('setActive(tab.vertical)')
  })

  it('a tab ativa nunca é derivada do slide do hero', () => {
    expect(editorialCode).not.toMatch(/hero|slide|vertical={slide/i)
  })

  it('teclado: setas esquerda/direita movem entre as tabs', () => {
    expect(editorialCode).toContain('onKeyDown={onKeyDown}')
    expect(editorialCode).toContain("'ArrowRight'")
    expect(editorialCode).toContain("'ArrowLeft'")
    // O foco acompanha a tab ativa (roving tabindex), como manda o padrão ARIA.
    expect(editorialCode).toContain('tabIndex={active === tab.vertical ? 0 : -1}')
    expect(editorialCode).toContain('tabRefs.current[next.vertical]?.focus()')
  })

  it('estado vazio é honesto: nunca troca de vertical nem cai no catálogo', () => {
    expect(editorialCode).toContain('Ainda não há destaques de filmes publicados.')
    expect(editorialCode).toContain('Ainda não há destaques de séries publicados.')
  })
})

describe('faixa amarela — carrossel de novidades reais', () => {
  const ticker = read(TICKER)
  const tickerCode = code(ticker)
  const server = read(TICKER_SERVER)

  it('renderiza UM item por vez, com um dot por item', () => {
    expect(tickerCode).toMatch(/items\[index\]/)
    expect(tickerCode).toMatch(/items\.map\(\(entry, dotIndex\)/)
    expect(tickerCode).toContain('aria-selected={dotIndex === index}')
  })

  it('tem autoplay próprio, pausa em hover/foco e respeita reduced-motion', () => {
    expect(tickerCode).toContain('AUTOPLAY_MS')
    expect(tickerCode).toContain('prefers-reduced-motion: reduce')
    expect(tickerCode).toContain('onMouseEnter')
    expect(tickerCode).toContain('onFocus')
    // Autoplay do hero e da faixa são independentes: nenhum índice compartilhado.
    expect(tickerCode).not.toMatch(/hero/i)
  })

  it('controle manual continua funcionando (dots e teclado)', () => {
    expect(tickerCode).toContain("event.key === 'ArrowRight'")
    expect(tickerCode).toContain("event.key === 'ArrowLeft'")
    expect(tickerCode).toContain('onClick={() => go(dotIndex)}')
  })

  it('o CTA muda conforme o tipo da novidade', () => {
    expect(tickerCode).toContain("item.entityType === 'movie' ? 'Ver filme' : 'Ver série'")
    expect(tickerCode).toContain('Ver lançamentos')
  })

  it('o crédito acompanha o item ATIVO (nada de crédito residual)', () => {
    expect(tickerCode).toMatch(/item\?\.provider != null \? <TickerCredit provider=\{item\.provider\}/)
  })

  it('o loader agrega QUATRO fontes reais e nenhuma delas é inventada', () => {
    expect(server).toContain('prisma.episode.findMany')
    expect(server).toContain('prisma.movie.findMany')
    expect(server).toContain('prisma.season.findMany')
    expect(server).toContain('prisma.watchAvailability.findMany')
  })

  it('chegada ao streaming só existe com provedor aprovado pelo gate', () => {
    expect(server).toContain('licensedWatchWhere(now)')
    expect(server).toContain('identity === undefined || provider === undefined) continue')
  })

  it('nenhum provedor hardcoded, nenhum dado de sessão de cinema', () => {
    expect(code(server)).not.toMatch(/Netflix|Prime Video|Disney\+|Apple TV|Kinoplex|Cinesystem/)
    expect(tickerCode).not.toMatch(/Netflix|Prime Video|Disney\+|Apple TV|Kinoplex|Cinesystem/)
    expect(code(server)).not.toMatch(/70mm|Legendado|sess(?:ão|ões)|em cartaz/i)
  })
})
