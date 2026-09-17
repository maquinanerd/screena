/**
 * sitemap-static-hubs.test.ts — o shard estatico lista cada hub quando a PAGINA
 * dele diz `index`, e com `lastmod` real.
 *
 * O DEFEITO (auditoria de SEO, 11/09/2026, secao 3.7): `/pt/pessoas/`,
 * `/pt/onde-assistir/` e `/pt/em-breve/` saiam `index` na pagina e ficavam fora do
 * shard estatico; e o shard saia sem `lastmod` nenhum.
 *
 * A funcao e pura: as contagens e as decisoes dos hubs entram como argumento. Que
 * as decisoes venham dos MESMOS loaders das paginas e provado contra Postgres real
 * (`validate:seo-runtime`, check 25).
 */

import { describe, expect, it } from 'vitest'

import {
  eligibleStaticRoutes,
  type StaticHubDecisions,
} from '../../apps/web/src/server/seo/sitemap-index'

type Counts = Parameters<typeof eligibleStaticRoutes>[0]
type Lastmods = Parameters<typeof eligibleStaticRoutes>[1]

const TIPOS = ['movies', 'series', 'people', 'news', 'seasons', 'episodes', 'imagens', 'videos'] as const

function contagens(valor: number, extra: Record<string, number> = {}): Counts {
  return Object.fromEntries([...TIPOS.map((t) => [t, valor]), ...Object.entries(extra)]) as Counts
}

function datas(extra: Record<string, Date | null> = {}): Lastmods {
  return Object.fromEntries([...TIPOS.map((t) => [t, null]), ...Object.entries(extra)]) as Lastmods
}

const HUBS: StaticHubDecisions = {
  people: true,
  watch: true,
  anticipated: true,
  watchUpdatedAtIso: '2026-09-10T08:00:00.000Z',
  authors: [{ path: '/pt/autores/pablo-gameleira/', lastmod: '2026-09-09T12:00:00.000Z' }],
}

function loc(rotas: ReturnType<typeof eligibleStaticRoutes>, caminho: string) {
  return rotas.find((rota) => rota.loc.endsWith(caminho))
}

describe('hubs do shard estatico', () => {
  it('(1) sem as decisoes dos hubs (o uso do INDEX), pessoas, onde assistir, em breve e autores ficam de fora', () => {
    const rotas = eligibleStaticRoutes(contagens(100), datas())
    expect(loc(rotas, '/pt/filmes/')).toBeDefined()
    for (const hub of ['/pt/pessoas/', '/pt/onde-assistir/', '/pt/em-breve/', '/pt/autores/']) {
      expect(loc(rotas, hub), hub).toBeUndefined()
    }
  })

  it('(2) pessoas entra pela decisao DA LISTAGEM, mesmo com o sitemap de pessoas zerado pelo portao D2', () => {
    const rotas = eligibleStaticRoutes(contagens(100, { people: 0 }), datas(), HUBS)
    expect(loc(rotas, '/pt/pessoas/')).toBeDefined()
    expect(loc(rotas, '/pt/onde-assistir/')).toBeDefined()
    expect(loc(rotas, '/pt/em-breve/')).toBeDefined()
  })

  it('(3) hub cuja pagina diz noindex fica fora', () => {
    const rotas = eligibleStaticRoutes(contagens(100), datas(), {
      ...HUBS,
      people: false,
      watch: false,
      anticipated: false,
    })
    for (const hub of ['/pt/pessoas/', '/pt/onde-assistir/', '/pt/em-breve/']) {
      expect(loc(rotas, hub), hub).toBeUndefined()
    }
  })

  it('(4) lastmod real: o de cada lista, o mais recente na home, e nenhum onde nao ha data honesta', () => {
    const rotas = eligibleStaticRoutes(
      contagens(100),
      datas({
        movies: new Date('2026-09-01T00:00:00.000Z'),
        series: new Date('2026-09-05T00:00:00.000Z'),
        news: new Date('2026-09-03T00:00:00.000Z'),
      }),
      HUBS,
    )
    expect(loc(rotas, '/pt/filmes/')?.lastmod).toBe('2026-09-01T00:00:00.000Z')
    expect(loc(rotas, '/pt/series/')?.lastmod).toBe('2026-09-05T00:00:00.000Z')
    expect(loc(rotas, '/pt/')?.lastmod).toBe('2026-09-05T00:00:00.000Z')
    expect(loc(rotas, '/pt/onde-assistir/')?.lastmod).toBe('2026-09-10T08:00:00.000Z')
    expect(loc(rotas, '/pt/pessoas/')?.lastmod).toBeNull()
    expect(loc(rotas, '/pt/em-breve/')?.lastmod).toBeNull()
  })

  it('(5) autores: a listagem e cada pagina entram, com a data da materia mais recente', () => {
    const rotas = eligibleStaticRoutes(contagens(100), datas(), {
      ...HUBS,
      authors: [
        { path: '/pt/autores/pablo-gameleira/', lastmod: '2026-09-09T12:00:00.000Z' },
        { path: '/pt/autores/redacao-cinerie/', lastmod: '2026-09-02T12:00:00.000Z' },
      ],
    })
    expect(loc(rotas, '/pt/autores/')?.lastmod).toBe('2026-09-09T12:00:00.000Z')
    expect(loc(rotas, '/pt/autores/pablo-gameleira/')?.lastmod).toBe('2026-09-09T12:00:00.000Z')
    expect(loc(rotas, '/pt/autores/redacao-cinerie/')?.lastmod).toBe('2026-09-02T12:00:00.000Z')
  })

  it('(6) sem autor com materia no ar, nem a listagem de autores entra (ela e noindex)', () => {
    const rotas = eligibleStaticRoutes(contagens(100), datas(), { ...HUBS, authors: [] })
    expect(rotas.some((rota) => rota.loc.includes('/pt/autores/'))).toBe(false)
  })

  it('(7) paginas institucionais: no shard, sem lastmod; fora do uso do INDEX', () => {
    const INSTITUCIONAIS = ['/pt/sobre/', '/pt/politica-editorial/', '/pt/cinerie-score/', '/pt/contato/']
    const shard = eligibleStaticRoutes(contagens(100), datas(), HUBS)
    for (const pagina of INSTITUCIONAIS) {
      expect(loc(shard, pagina), pagina).toBeDefined()
      expect(loc(shard, pagina)?.lastmod, pagina).toBeNull()
    }
    const indice = eligibleStaticRoutes(contagens(100), datas())
    for (const pagina of INSTITUCIONAIS) expect(loc(indice, pagina), pagina).toBeUndefined()
  })
})
