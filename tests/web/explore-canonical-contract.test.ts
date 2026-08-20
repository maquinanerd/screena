import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const PAGE_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/page.tsx')
const RAILS_PATH = resolve(ROOT, 'apps/web/app/_components/discover-rails.tsx')
const CW_PATH = resolve(ROOT, 'apps/web/app/_components/continue-watching.tsx')
const CSS_PATH = resolve(ROOT, 'apps/web/app/pt/explorar/explore-canonical.module.css')

const pageSource = readFileSync(PAGE_PATH, 'utf8')
const railsSource = readFileSync(RAILS_PATH, 'utf8')
const cwSource = readFileSync(CW_PATH, 'utf8')

describe('contrato canônico da rota Explorar (tela 11)', () => {
  it('segue a ordem canônica: busca → ad → rails filtráveis com seções fixas', () => {
    const order = [
      'className="disc-search"',
      '<AdSlot format="leaderboard" slotId="explore-top" />',
      '<DiscoverFilterableRails',
      'className="disc-feature disc-section"',
      '<ContinueWatching route=',
      'className="disc-agenda"',
      'disc-soon-title',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = pageSource.indexOf(marker)
      expect(at, `marcador ausente/fora de ordem: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('busca é um form REAL para a PRÓPRIA rota (nunca barra decorativa)', () => {
    // A unificação trocou o destino: `/pt/busca/` era uma segunda página fina
    // com a mesma intenção e agora responde 301 para cá. O form aponta para a
    // constante da rota, não para um literal — literal esquecido mandaria todo
    // clique de busca por um salto extra.
    expect(pageSource).toContain('action={EXPLORE_PATH}')
    expect(pageSource).not.toContain('/pt/busca/?')
    expect(pageSource).toContain('method="get"')
    expect(pageSource).toContain('name="q"')
  })

  it('mantém a agenda real e estados honestos', () => {
    // A agenda passou de "só filme" para o trilho MISTO, e "Mais aguardados"
    // passou a ler a MESMA fonte de /pt/em-breve/ — a página para onde o
    // próprio trilho manda em "Ver todos". Antes disso o trilho prometia uma
    // lista que ele nunca poderia mostrar.
    expect(pageSource).toContain('getHomeUpcomingMixed({ limit: UPCOMING_SOURCE_LIMIT })')
    expect(pageSource).toContain('getAnticipatedData()')
    expect(pageSource).toContain('takeUpcomingWeek(')
    expect(pageSource).toContain('upcomingWeek.map')
    expect(pageSource).toContain('{movie.weekday}')
    // Vertical do PRÓPRIO item, nunca "Filme" fixo num trilho misto.
    expect(pageSource).toContain('{movie.verticalLabel}')
    expect(pageSource).toContain('entityType={movie.bookmarkType}')
    expect(pageSource).toContain('Nenhum lançamento publicado')
    // Destaque só com entidade real; watchlist é o CardBookmark real
    expect(pageSource).toContain('featured !== null ?')
    expect(pageSource).toContain('<CardBookmark')
  })

  it('não inventa métricas: sem growth 24h, sem contagem de salvos, sem nota', () => {
    expect(pageSource).not.toMatch(/24h|crescimento|\+\d+%|Tomatometer|AggregateRating/i)
    expect(railsSource).not.toMatch(/24h|crescimento|\+\d+%|votes/i)
    // Rótulos honestos documentados nos trilhos
    expect(railsSource).toContain('Mais populares no catálogo agora')
    expect(railsSource).toContain('Mais avaliados no catálogo')
  })

  it('Continuar assistindo é fronteira autenticada real (/api/me/**)', () => {
    expect(cwSource).toContain("'use client'")
    expect(cwSource).toContain('/api/auth/session')
    expect(cwSource).toContain('/api/me/library?status=watching')
    expect(cwSource).toContain('/api/me/series-progress/')
    expect(cwSource).toContain('/api/catalog/summary')
    expect(cwSource).not.toMatch(/localStorage|sessionStorage/)
    // ANÔNIMO: a seção inteira some — não há mais CTA de login aqui.
    //
    // A regra mudou de propósito: seção pessoal que não pode ter sucesso não
    // renderiza (mesma decisão da faixa de newsletter). A prova de que ela some
    // para deslogado E aparece para logado é de RENDER, com sessão simulada, e
    // vive em `apps/web/app/_components/__tests__/continue-watching-anonymous.test.tsx`.
    expect(cwSource).not.toContain('/pt/entrar/')
    // Some CALADA seria o outro defeito: a ausência vira log estruturado.
    expect(cwSource).toContain('formatSectionAbsence')
    expect(cwSource).toContain('no_authenticated_visitor')
  })

  it('preserva metadata, indexabilidade e os dois schemas', () => {
    expect(pageSource).toMatch(/indexability\.decision === ['"]index['"]/)
    expect(pageSource).toContain('canonicalPublicUrl(EXPLORE_PATH)')
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]CollectionPage['"]/)
    expect(pageSource).toMatch(/['"]@type['"]:\s*['"]BreadcrumbList['"]/)
    expect(pageSource.match(/application\/ld\+json/g)).toHaveLength(2)
  })

  it('um H1 por página (vive nos rails) e sem CSS module da composição antiga', () => {
    expect(existsSync(CSS_PATH)).toBe(false)
    expect(pageSource.match(/<h1[\s>]/g)).toBeNull()
    expect(railsSource.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(pageSource).not.toMatch(/<iframe|doubleclick|adsbygoogle/i)
  })
})
