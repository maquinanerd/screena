/**
 * indexability-mass-change.test.ts — o FREIO de mudanca em massa do produtor de
 * `page_indexability_decisions`, com Prisma FAKE.
 *
 * O QUE ESTE ARQUIVO TRAVA
 * ------------------------
 * `catalog index-decisions --apply` roda de hora em hora, sem humano nenhum
 * (`scripts/catalog/catalog-cycle-with-alert.sh` + timer systemd). Antes deste
 * freio, mudar a politica pura em `@screena/seo` fazia o catalogo INTEIRO ser
 * redecidido no primeiro ciclo depois do deploy — a "indexacao em massa" que a
 * secao 6 do CLAUDE.md manda submeter a revisao humana. A mudanca real que
 * motivou isto levaria o sitemap de ~53.054 para ~2.338 URLs sozinha.
 *
 * O CONTROLE NEGATIVO e o teste central: uma execucao cujos flips passam do
 * teto tem de gravar ZERO linhas. Nao basta `written === 0` — o contador
 * poderia mentir. Contamos as chamadas de ESCRITA no Prisma fake
 * (`pageIndexabilityDecision.create` / `.update`): se o freio nao existisse, ou
 * se ele so parasse depois de comecar, elas apareceriam.
 *
 * Os testes partem dos FATOS de cada entidade e passam pela politica real
 * (`decideCatalogIndexability`), nao por decisoes fabricadas: assim o teste
 * prova a cadeia inteira (fato -> politica -> plano -> censo -> freio ->
 * escrita), e nao so o ultimo elo.
 */

import { describe, expect, it } from 'vitest'

import { CATALOG_POLICY_VERSION } from '@screena/seo'

import {
  INDEXABILITY_SUMMARY_SCHEMA_VERSION,
  produceIndexabilityDecisions,
} from '../indexability-writer.js'

type WriterPrisma = Parameters<typeof produceIndexabilityDecisions>[0]

const LANGUAGE = 'pt-BR'
/**
 * A versao VIGENTE, nao um literal.
 *
 * `decisionChanged` compara tambem `policy_version`: com um literal defasado,
 * TODA linha do fixture conta como mudada e o teste de "deriva normal" mede um
 * bump de politica em vez da deriva. Foi o que aconteceu quando a v2 subiu a
 * versao e este arquivo ainda dizia `catalog-indexability-v1`.
 */
const POLICY = CATALOG_POLICY_VERSION

/**
 * Uma linha crua como `readFacts` a devolve.
 *
 * Espelha a forma UNICA da politica v2: os campos de conteudo (sinopse, imagem,
 * biografia) sao gates de verdade, entao um fixture que os omitisse produziria
 * `noindex` em toda entidade e o teste mediria o proprio descuido.
 */
interface FactRow {
  entity_id: bigint
  has_slug: boolean
  has_title: boolean
  has_translation: boolean
  credits: number
  has_synopsis: boolean
  has_image: boolean
  has_biography: boolean
  listed_episodes: number
  parent_id: bigint | null
  season_number: number | null
  episode_number: number | null
  url: string | null
  cur_decision: string | null
  cur_reason: string | null
  cur_policy: string | null
}

/**
 * Entidade completa e ja decidida como `index`. Mexer em `has_translation`
 * derruba a decisao para `noindex` — e o jeito mais direto de fabricar um flip
 * de SAIDA sem inventar decisao a mao.
 */
function indexedRow(id: number, overrides: Partial<FactRow> = {}): FactRow {
  return {
    entity_id: BigInt(id),
    has_slug: true,
    has_title: true,
    has_translation: true,
    credits: 3,
    // Gates de CONTEUDO da politica v2: sem eles, filme completo vira noindex.
    has_synopsis: true,
    has_image: true,
    has_biography: true,
    listed_episodes: 10,
    parent_id: null,
    season_number: null,
    episode_number: null,
    url: `slug-${id}`,
    cur_decision: 'index',
    cur_reason: 'eligible',
    cur_policy: POLICY,
    ...overrides,
  }
}

/** Entidade completa que ainda NAO tem linha de decisao (catalogo crescendo). */
function undecidedRow(id: number, overrides: Partial<FactRow> = {}): FactRow {
  return indexedRow(id, { cur_decision: null, cur_reason: null, cur_policy: null, ...overrides })
}

/** `index` -> `noindex`: flip de SAIDA (a pagina deixa o sitemap). */
function leavingRow(id: number): FactRow {
  return indexedRow(id, { has_translation: false })
}

interface FakeOptions {
  readonly movie?: readonly FactRow[]
  readonly tv?: readonly FactRow[]
  readonly person?: readonly FactRow[]
}

interface Fake {
  readonly prisma: WriterPrisma
  /**
   * Toda chamada feita DENTRO de uma transacao, na ordem. Vazio prova mais que
   * "zero creates": prova que o produtor nem chegou a abrir transacao.
   */
  readonly txCalls: string[]
  readonly created: Record<string, unknown>[]
}

/**
 * Prisma fake.
 *
 * `$queryRawUnsafe` decide o conjunto pela tabela citada no SQL — e a unica
 * pista disponivel, porque `readFacts` interpola o tipo direto na consulta.
 */
function makeFakePrisma(options: FakeOptions): Fake {
  const txCalls: string[] = []
  const created: Record<string, unknown>[] = []

  const rowsFor = (sql: string): readonly FactRow[] => {
    if (sql.includes('FROM movies e')) return options.movie ?? []
    if (sql.includes('FROM tv_shows e')) return options.tv ?? []
    if (sql.includes('FROM people e')) return options.person ?? []
    throw new Error(`consulta inesperada no fake: ${sql.slice(0, 80)}`)
  }

  const tx = {
    pageIndexabilityDecision: {
      findFirst: async (args: { where: { entityId: bigint } }): Promise<{ id: bigint } | null> => {
        txCalls.push('findFirst')
        // Toda entidade deste fake que ja tinha decisao tem uma linha vigente;
        // o id sintetico so precisa ser estavel dentro da transacao.
        return { id: args.where.entityId * 1000n }
      },
      update: async (): Promise<void> => {
        txCalls.push('update')
      },
      create: async (args: { data: Record<string, unknown> }): Promise<void> => {
        txCalls.push('create')
        created.push(args.data)
      },
    },
  }

  const prisma = {
    $queryRawUnsafe: async (sql: string, _language: string): Promise<FactRow[]> => [
      ...rowsFor(sql),
    ],
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      return await fn(tx)
    },
  } as unknown as WriterPrisma

  return { prisma, txCalls, created }
}

const run = async (
  fake: Fake,
  options: Partial<Parameters<typeof produceIndexabilityDecisions>[1]> = {},
) =>
  await produceIndexabilityDecisions(fake.prisma, {
    language: LANGUAGE,
    entityTypes: ['movie'],
    dryRun: false,
    now: () => new Date('2026-08-24T00:00:00.000Z'),
    ...options,
  })

describe('freio de mudanca em massa — CONTROLE NEGATIVO', () => {
  it('execucao acima do teto grava ZERO linhas (nenhuma escrita chega ao Prisma)', async () => {
    // 30 entidades saindo do sitemap num teto de 5: a execucao inteira e
    // recusada. Se o freio nao existisse, ou se parasse "no meio", as chamadas
    // de create/update apareceriam em `txCalls`.
    const rows = Array.from({ length: 30 }, (_, i) => leavingRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake, {
      massChangeThresholds: { maxFlips: 5, maxFlipRatio: 1 },
    })

    expect(summary.massChange.blocked).toBe(true)
    expect(summary.written).toBe(0)
    // O plano existe — o freio nao esconde o trabalho, so recusa aplica-lo.
    expect(summary.planned).toBe(30)
    // A prova de verdade: o banco nao foi tocado.
    expect(fake.created).toHaveLength(0)
    expect(fake.txCalls).toEqual([])
  })

  it('o censo por razao acompanha a recusa (o operador precisa do porque)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => leavingRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake, { massChangeThresholds: { maxFlips: 5, maxFlipRatio: 1 } })

    expect(summary.flipsByReason).toEqual({ missing_translation: 30 })
    expect(summary.flipsByEntityType).toEqual({ movie: 30 })
    expect(summary.massChange.leavesIndex).toBe(30)
    expect(summary.massChange.entersIndex).toBe(0)
    expect(summary.massChange.explanation).toContain('--confirm-mass-change')
  })

  it('o opt-in humano destrava a MESMA execucao', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => leavingRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake, {
      massChangeThresholds: { maxFlips: 5, maxFlipRatio: 1 },
      confirmMassChange: true,
    })

    expect(summary.massChange.blocked).toBe(false)
    // Continua registrado que ISTO foi uma mudanca em massa.
    expect(summary.massChange.exceeded).toBe(true)
    expect(summary.written).toBe(30)
    expect(fake.created).toHaveLength(30)
    expect(fake.created.every((d) => d.decision === 'noindex')).toBe(true)
  })
})

describe('freio de mudanca em massa — o que NAO pode travar', () => {
  it('deriva normal do ciclo horario grava (poucas entidades, tetos default)', async () => {
    // 3 saidas em 400 avaliadas: 0,75%. E o regime real de uma hora.
    const rows = [
      ...Array.from({ length: 3 }, (_, i) => leavingRow(i + 1)),
      ...Array.from({ length: 397 }, (_, i) => indexedRow(i + 100)),
    ]
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake)

    expect(summary.massChange.blocked).toBe(false)
    expect(summary.evaluated).toBe(400)
    expect(summary.written).toBe(3)
    // As 397 inalteradas nao geram linha: o produtor continua SEM churn.
    expect(summary.unchanged).toBe(397)
  })

  it('CRESCIMENTO do catalogo passa livre: `null -> index` nao e flip', async () => {
    // 600 entidades novas recebendo a primeira decisao. Sao 600 escritas e
    // estourariam qualquer teto se "mudanca de veredito" contasse — mas nenhuma
    // delas muda o sitemap, porque ausencia de decisao ja significa "dentro".
    const rows = Array.from({ length: 600 }, (_, i) => undecidedRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake)

    expect(summary.massChange.flips).toBe(0)
    expect(summary.massChange.blocked).toBe(false)
    expect(summary.written).toBe(600)
  })

  it('troca de razao entre dois vereditos nao-index nao e flip', async () => {
    // `noindex/missing_slug` -> `noindex/missing_translation`: a pagina continua
    // fora do sitemap. Gravar isso e auditoria, nao reindexacao.
    const rows = Array.from({ length: 600 }, (_, i) =>
      indexedRow(i + 1, {
        has_translation: false,
        cur_decision: 'noindex',
        cur_reason: 'missing_slug',
      }),
    )
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake)

    expect(summary.massChange.flips).toBe(0)
    expect(summary.written).toBe(600)
  })
})

describe('freio de mudanca em massa — escopo e modos', () => {
  it('o censo e GLOBAL: tipos que sozinhos passariam somam e travam juntos', async () => {
    // 300 filmes + 300 series = 600 flips. Nenhum tipo estoura os 500 sozinho.
    // Contar por tipo deixaria a mudanca inteira passar.
    const fake = makeFakePrisma({
      movie: Array.from({ length: 300 }, (_, i) => leavingRow(i + 1)),
      tv: Array.from({ length: 300 }, (_, i) => leavingRow(i + 1)),
    })

    const summary = await produceIndexabilityDecisions(fake.prisma, {
      language: LANGUAGE,
      entityTypes: ['movie', 'tv'],
      dryRun: false,
      now: () => new Date('2026-08-24T00:00:00.000Z'),
      massChangeThresholds: { maxFlipRatio: 1 },
    })

    expect(summary.massChange.flips).toBe(600)
    expect(summary.massChange.blocked).toBe(true)
    expect(summary.flipsByEntityType).toEqual({ movie: 300, tv: 300 })
    expect(fake.txCalls).toEqual([])
  })

  it('o teto proporcional pega o que o absoluto deixaria passar', async () => {
    // 100 flips em 200: metade do acervo muda de lado, e 100 < 500.
    const fake = makeFakePrisma({
      movie: [
        ...Array.from({ length: 100 }, (_, i) => leavingRow(i + 1)),
        ...Array.from({ length: 100 }, (_, i) => indexedRow(i + 1000)),
      ],
    })

    const summary = await run(fake)

    expect(summary.massChange.flips).toBe(100)
    expect(summary.massChange.exceededBy).toEqual(['ratio'])
    expect(summary.written).toBe(0)
    expect(fake.txCalls).toEqual([])
  })

  it('dry-run nao grava nem quando o freio esta folgado', async () => {
    // Tetos frouxos de proposito: aqui o que se mede e o dry-run, nao o freio.
    // Com os defaults, 1 flip em 1 entidade e 100% e o freio dispararia — o
    // efeito colateral documentado do teto proporcional em catalogo minusculo.
    const fake = makeFakePrisma({ movie: [leavingRow(1)] })

    const summary = await run(fake, {
      dryRun: true,
      massChangeThresholds: { maxFlipRatio: 1 },
    })

    expect(summary.massChange.blocked).toBe(false)
    expect(summary.planned).toBe(1)
    expect(summary.written).toBe(0)
    expect(fake.txCalls).toEqual([])
  })

  it('dry-run tambem calcula o freio (e a pre-checagem do apply)', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => leavingRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake, {
      dryRun: true,
      massChangeThresholds: { maxFlips: 5, maxFlipRatio: 1 },
    })

    // Sair "verde" no dry-run diria "pode aplicar" para a unica execucao que
    // NAO pode aplicar.
    expect(summary.massChange.blocked).toBe(true)
  })
})

/**
 * O CENSO que o `--dry-run` imprime.
 *
 * Ate 2026-08-27 o resumo respondia "quantas mudam" e nada alem disso. As
 * perguntas que o dono faz antes de assinar sao outras: quantas de CADA tipo,
 * com que veredito, por que, e — a mais importante — quantas dessas ja tinham
 * decisao vigente. Uma linha que NASCE `noindex` amplia a cobertura da tabela;
 * uma linha que TROCA de `index` para `noindex` tira do indice uma pagina que o
 * buscador ja conhece. Os dois somavam no mesmo numero.
 *
 * Os fixtures passam pela politica REAL: os vereditos abaixo sao o que
 * `decideCatalogIndexability` decide a partir dos fatos, nunca valores fixados.
 */
describe('censo por tipo de entidade (o que o dry-run mostra)', () => {
  it('separa criadas de alteradas, e nao confunde nenhuma das duas com inalteradas', async () => {
    const fake = makeFakePrisma({
      movie: [
        // ja `index` e continua `index`: nao entra em nenhum dos dois baldes.
        indexedRow(1),
        // ja tinha veredito e TROCA (index -> noindex): `updated`.
        leavingRow(2),
        // nunca teve linha e nasce decidida: `created`.
        undecidedRow(3),
      ],
    })

    const summary = await run(fake, {
      dryRun: true,
      massChangeThresholds: { maxFlips: 100, maxFlipRatio: 1 },
    })

    expect(summary.evaluated).toBe(3)
    expect(summary.writes).toEqual({ created: 1, updated: 1, unchanged: 1 })
    // A soma tem de fechar com o total varrido: qualquer entidade cai em
    // exatamente um dos tres baldes.
    const { created, updated, unchanged } = summary.writes
    expect(created + updated + unchanged).toBe(summary.evaluated)
    // `planned` e o que a fase 2 gravaria — created + updated, nunca unchanged.
    expect(summary.planned).toBe(created + updated)
  })

  it('conta veredito e motivo POR TIPO, nao so no total', async () => {
    const fake = makeFakePrisma({
      movie: [indexedRow(1), leavingRow(2)],
      person: [indexedRow(10), indexedRow(11, { credits: 0 })],
    })

    const summary = await run(fake, {
      entityTypes: ['movie', 'person'],
      dryRun: true,
      massChangeThresholds: { maxFlips: 100, maxFlipRatio: 1 },
    })

    const filme = summary.byEntityType.movie
    const pessoa = summary.byEntityType.person
    expect(filme).toBeDefined()
    expect(pessoa).toBeDefined()

    expect(filme?.evaluated).toBe(2)
    expect(pessoa?.evaluated).toBe(2)

    // Um `index` e um `noindex` de cada lado — mas por motivos DIFERENTES, e e
    // essa a informacao que o total global apagava: `sem_traducao` do filme e
    // `sem credito publicavel` da pessoa viravam duas linhas soltas sem dono.
    expect(filme?.byDecision.index).toBe(1)
    expect(filme?.byDecision.noindex).toBe(1)
    expect(pessoa?.byDecision.index).toBe(1)
    expect(pessoa?.byDecision.noindex).toBe(1)

    // A razao ESPECIFICA de um tipo nunca vaza para o balde do outro. (A razao
    // de aprovacao, `eligible`, e a mesma para todo tipo — por isso a afirmacao
    // e sobre as razoes de RECUSA, que sao dirigidas ao gate daquele tipo.)
    expect(filme?.byReason.missing_translation).toBe(1)
    expect(filme?.byReason.no_eligible_credit).toBeUndefined()
    expect(pessoa?.byReason.no_eligible_credit).toBe(1)
    expect(pessoa?.byReason.missing_translation).toBeUndefined()

    // E cada balde soma exatamente as entidades daquele tipo.
    for (const censo of [filme, pessoa]) {
      const porVeredito = Object.values(censo?.byDecision ?? {}).reduce((a, b) => a + b, 0)
      const porRazao = Object.values(censo?.byReason ?? {}).reduce((a, b) => a + b, 0)
      expect(porVeredito).toBe(censo?.evaluated)
      expect(porRazao).toBe(censo?.evaluated)
    }
  })

  it('o censo por tipo sobrevive ao freio: bloquear NAO apaga a informacao', async () => {
    // O censo e justamente o que o operador precisa ler para decidir se assina.
    // Se o caminho bloqueado devolvesse um resumo vazio, o freio pararia a
    // escrita e a pre-checagem junto.
    const rows = Array.from({ length: 30 }, (_, i) => leavingRow(i + 1))
    const fake = makeFakePrisma({ movie: rows })

    const summary = await run(fake, {
      dryRun: true,
      massChangeThresholds: { maxFlips: 5, maxFlipRatio: 1 },
    })

    expect(summary.massChange.blocked).toBe(true)
    expect(summary.writes.updated).toBe(30)
    expect(summary.byEntityType.movie?.evaluated).toBe(30)
    expect(summary.byEntityType.movie?.byDecision.noindex).toBe(30)
    // O teto que barrou tem de vir no mesmo objeto: sem ele o consumidor sabe
    // que bloqueou e nao sabe contra o que.
    expect(summary.massChange.limits.maxFlips).toBe(5)
  })

  it('o JSON carrega a versao da forma (contrato de leitor de maquina)', async () => {
    const fake = makeFakePrisma({ movie: [indexedRow(1)] })
    const summary = await run(fake, { dryRun: true })

    expect(summary.schemaVersion).toBe(INDEXABILITY_SUMMARY_SCHEMA_VERSION)
    expect(Number.isInteger(summary.schemaVersion)).toBe(true)
  })
})
