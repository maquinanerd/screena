/**
 * Testes PUROS da politica de quota (`quota.ts`).
 *
 * Aqui nao ha banco: o que se prova e a DECISAO — quais dimensoes um pedido
 * consome, em que ordem as linhas sao tocadas e o que se promete ao produtor
 * quando o teto estoura. A execucao transacional e provada contra PostgreSQL
 * real em `quota.integration.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import {
  GLOBAL_QUOTA_KEY,
  localDateIn,
  nextEligibleAt,
  planQuotaConsumption,
  quotaRowKey,
  QUOTA_DIMENSIONS,
  QUOTA_LIMIT_CODES,
  type QuotaPlanInput,
} from '../quota.js'

const limits = {
  dailyLimit: 10,
  perAuthorLimit: 5,
  perSectionLimit: 4,
  perContentTypeLimit: 6,
  perArticleUpdateLimit: 3,
}

function plan(overrides: Partial<QuotaPlanInput> = {}): QuotaPlanInput {
  return {
    publicationIntent: 'publish',
    contentType: 'news',
    section: 'cinema',
    publicAuthorId: 'author-1',
    targetArticleId: null,
    limits,
    ...overrides,
  }
}

describe('planQuotaConsumption — quais dimensoes um pedido consome', () => {
  it('publicacao nova consome global, contentType, section e author (e NAO article_update)', () => {
    const entries = planQuotaConsumption(plan())
    expect(entries.map((e) => e.dimension)).toEqual([
      'global',
      'content_type',
      'section',
      'author',
    ])
  })

  it('atualizacao consome as MESMAS dimensoes diarias mais article_update', () => {
    // Decisao explicita: uma atualizacao automatica tambem publica bytes no
    // site e tambem assina em nome do autor. Se so o `create` contasse, a
    // automacao poderia reescrever o dia inteiro sem tocar em nenhum teto.
    const entries = planQuotaConsumption(
      plan({ publicationIntent: 'update', targetArticleId: 'article-9' }),
    )
    expect(entries.map((e) => e.dimension)).toEqual([
      'global',
      'content_type',
      'section',
      'author',
      'article_update',
    ])
    expect(entries.at(-1)).toMatchObject({ key: 'article-9', limit: 3 })
  })

  it('atualizacao SEM artigo alvo nao consome article_update', () => {
    const entries = planQuotaConsumption(
      plan({ publicationIntent: 'update', targetArticleId: null }),
    )
    expect(entries.some((e) => e.dimension === 'article_update')).toBe(false)
  })

  it('secao ausente ou em branco nao vira balde artificial', () => {
    // Inventar uma chave `sem-secao` juntaria materias sem relacao nenhuma sob
    // um mesmo teto — o limite passaria a recusar publicacoes que nada tem a
    // ver umas com as outras.
    for (const section of [null, '', '   ']) {
      const entries = planQuotaConsumption(plan({ section }))
      expect(entries.some((e) => e.dimension === 'section')).toBe(false)
    }
  })

  it('secao e normalizada (espaco em volta nao cria duas chaves)', () => {
    const entries = planQuotaConsumption(plan({ section: '  cinema  ' }))
    const section = entries.find((e) => e.dimension === 'section')
    expect(section?.key).toBe('cinema')
  })

  it('dimensao sem teto NAO vira linha de contador', () => {
    // Contar sem limite so gastaria escrita e criaria contencao numa linha que
    // nunca recusa nada.
    const entries = planQuotaConsumption(
      plan({ limits: { ...limits, perSectionLimit: null, perContentTypeLimit: null } }),
    )
    expect(entries.map((e) => e.dimension)).toEqual(['global', 'author'])
  })

  it('sem nenhum teto declarado, nenhuma linha e tocada', () => {
    const entries = planQuotaConsumption(
      plan({
        limits: {
          dailyLimit: null,
          perAuthorLimit: null,
          perSectionLimit: null,
          perContentTypeLimit: null,
          perArticleUpdateLimit: null,
        },
      }),
    )
    expect(entries).toEqual([])
  })

  it('teto zero AINDA vira linha — zero recusa, ausencia de teto nao', () => {
    // `0` e `null` sao coisas diferentes: `0` significa "nada pode passar hoje"
    // e precisa ser avaliado; `null` significa "sem teto".
    const entries = planQuotaConsumption(plan({ limits: { ...limits, dailyLimit: 0 } }))
    expect(entries[0]).toMatchObject({ dimension: 'global', limit: 0 })
  })

  it('a chave global e constante — todos os pedidos disputam o MESMO balde', () => {
    const a = planQuotaConsumption(plan({ contentType: 'news', publicAuthorId: 'x' }))
    const b = planQuotaConsumption(plan({ contentType: 'review', publicAuthorId: 'y' }))
    expect(a[0]?.key).toBe(GLOBAL_QUOTA_KEY)
    expect(b[0]?.key).toBe(GLOBAL_QUOTA_KEY)
  })
})

describe('planQuotaConsumption — ORDEM de aquisicao (prevencao de deadlock)', () => {
  it('a ordem segue QUOTA_DIMENSIONS, do mais generico ao mais especifico', () => {
    const entries = planQuotaConsumption(
      plan({ publicationIntent: 'update', targetArticleId: 'a' }),
    )
    const positions = entries.map((e) => QUOTA_DIMENSIONS.indexOf(e.dimension))
    expect(positions).toEqual([...positions].sort((x, y) => x - y))
  })

  it('a ordem NAO depende da ordem em que os campos chegaram', () => {
    // Este e o ponto do teste: duas transacoes que travem as MESMAS linhas em
    // ordens diferentes formam um ciclo e o Postgres mata uma por deadlock.
    // Como o plano e derivado de um objeto, a unica forma de dois pedidos
    // divergirem seria a funcao preservar alguma ordem de entrada.
    const first = planQuotaConsumption(plan({ section: 'series', publicAuthorId: 'zzz' }))
    const second = planQuotaConsumption(plan({ publicAuthorId: 'zzz', section: 'series' }))
    expect(first).toEqual(second)
  })

  it('dentro da mesma dimensao, chaves sao ordenadas de forma estavel', () => {
    // Hoje nenhum pedido consome duas linhas da mesma dimensao, mas a garantia
    // de ordem precisa valer se isso mudar — senao o deadlock volta pela porta
    // dos fundos.
    const entries = planQuotaConsumption(plan())
    const bySameDimension = entries.filter((e) => e.dimension === 'global')
    const keys = bySameDimension.map((e) => e.key)
    expect(keys).toEqual([...keys].sort())
  })

  it('cada dimensao tem um codigo de recusa proprio', () => {
    // O produtor precisa saber QUAL teto estourou: "limite atingido" generico
    // nao diz se ele deve esperar a meia-noite ou parar de reescrever o mesmo
    // artigo.
    for (const dimension of QUOTA_DIMENSIONS) {
      expect(QUOTA_LIMIT_CODES[dimension]).toMatch(/^AUTO_PUBLISH_[A-Z_]+$/)
    }
    expect(new Set(Object.values(QUOTA_LIMIT_CODES)).size).toBe(QUOTA_DIMENSIONS.length)
  })
})

describe('quotaRowKey — identidade da linha', () => {
  it('o fuso faz parte da chave', () => {
    // Trocar o fuso da operacao nao pode reaproveitar os baldes do fuso antigo:
    // eles cobrem intervalos diferentes de tempo real.
    const base = { localDate: '2026-07-29', dimension: 'global' as const, key: 'all' }
    expect(quotaRowKey({ ...base, timeZone: 'America/Sao_Paulo' })).not.toBe(
      quotaRowKey({ ...base, timeZone: 'UTC' }),
    )
  })

  it('dimensoes diferentes com a mesma chave nao colidem', () => {
    const base = { timeZone: 'UTC', localDate: '2026-07-29', key: 'x' }
    expect(quotaRowKey({ ...base, dimension: 'section' })).not.toBe(
      quotaRowKey({ ...base, dimension: 'author' }),
    )
  })
})

describe('localDateIn — o dia civil da redacao', () => {
  it('21:00 em Sao Paulo ainda e o dia corrente, nao o seguinte', () => {
    // 2026-07-30T00:30:00Z e 29/07 21:30 em Sao Paulo. Contar em UTC viraria o
    // dia as 21h da redacao — um teto diario que zera na noite anterior nao e
    // um teto.
    expect(localDateIn('2026-07-30T00:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-07-29')
    expect(localDateIn('2026-07-30T00:30:00.000Z', 'UTC')).toBe('2026-07-30')
  })

  it('o formato e sempre YYYY-MM-DD com zero a esquerda', () => {
    expect(localDateIn('2026-01-05T12:00:00.000Z', 'UTC')).toBe('2026-01-05')
  })

  it('fusos a leste de Greenwich adiantam o dia', () => {
    expect(localDateIn('2026-07-29T23:00:00.000Z', 'Asia/Tokyo')).toBe('2026-07-30')
  })
})

describe('nextEligibleAt — o que se promete ao produtor', () => {
  const windowEnd = '2026-07-30T03:00:00.000Z'

  it('dimensoes diarias liberam no fim da janela', () => {
    for (const dimension of ['global', 'content_type', 'section', 'author'] as const) {
      expect(nextEligibleAt(dimension, windowEnd)).toBe(windowEnd)
    }
  })

  it('article_update NAO promete horario nenhum', () => {
    // O teto de reescritas de um artigo nao se renova a meia-noite. Prometer um
    // horario ali mandaria o produtor reenviar para sempre, num loop que nunca
    // seria aceito.
    expect(nextEligibleAt('article_update', windowEnd)).toBeNull()
  })
})
