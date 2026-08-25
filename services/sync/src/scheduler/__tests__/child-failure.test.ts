/**
 * O motivo REAL de um processo filho ter falhado chega ao log — e sem segredo.
 *
 * Estes testes cobrem os dois descartes que existiam em producao:
 *  (1) os runners jogavam fora o `stderr` que `runScript` ja capturava;
 *  (2) `describeRun` nunca imprimia o campo `detail`.
 *
 * O controle negativo do fim e o que importa: se alguem voltar ao detalhe que
 * so repete o codigo de saida, o teste cai.
 */

import { describe, expect, it } from 'vitest'

import {
  CHILD_STDERR_MAX,
  describeChildFailure,
  redactSecrets,
  tailOfStderr,
} from '../runtime/child-failure.js'
import { describeRun, type RunOutcome } from '../run-outcome.js'

/** Um `stderr` realista do Prisma: a mensagem util vem DEPOIS da pilha. */
const STDERR_PRISMA = [
  'node:internal/process/promises:391',
  '    triggerUncaughtException(err, true /* fromPromise */)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
  'PrismaClientInitializationError: Can\'t reach database server at `rss_prime_screen-db:5432`',
  '  datasource: postgres://screena:SenhaSuperSecreta@rss_prime_screen-db:5432/screena',
].join('\n')

function outcomeDe(
  status: RunOutcome['status'],
  reasons: RunOutcome['reasons'],
): RunOutcome {
  const t0 = new Date('2026-08-25T01:24:00.000Z')
  const t1 = new Date('2026-08-25T01:24:00.917Z')
  return {
    queue: 'cinerie_score',
    status,
    startedAt: t0,
    finishedAt: t1,
    durationMs: 917,
    planned: 1,
    processed: status === 'success' ? 1 : 0,
    failed: status === 'success' ? 0 : 1,
    skipped: 0,
    spend: [],
    reasons,
    // So `success` avanca o carimbo da fila — ver RunOutcome.
    advancesLastSuccess: status === 'success',
  }
}

describe('redactSecrets', () => {
  it('mascara credencial embutida em URL, preservando o esquema', () => {
    const saida = redactSecrets('postgres://screena:SenhaSuperSecreta@host:5432/screena')
    expect(saida).not.toContain('SenhaSuperSecreta')
    expect(saida).toContain('postgres://')
    expect(saida).toContain('<REDACTED>')
  })

  it('o segredo some, seja qual for a forma da atribuicao', () => {
    // Asserta a PROPRIEDADE (o segredo nao sai), nao a forma da saida. A
    // primeira versao deste teste exigia `NOME=<REDACTED>` e reprovava
    // `DATABASE_URL=postgres://a:b@c/d` — que ja sai seguro pela regra de URL,
    // porque `DATABASE_URL` nao contem KEY/TOKEN/SECRET/PASSWORD no nome.
    const casos: ReadonlyArray<readonly [string, string]> = [
      ['DATABASE_URL=postgres://screena:SenhaSuperSecreta@c/d', 'SenhaSuperSecreta'],
      ['TMDB_READ_ACCESS_TOKEN="eyJhbGciOiJIUzI1NiJ9.abc"', 'eyJhbGciOiJIUzI1NiJ9.abc'],
      ['CINERIE_IP_HASH_SALT=21de65bb69c27a76814b95c78ce7ec5d', '21de65bb69c27a76814b95c78ce7ec5d'],
      ["OMDB_API_KEY: '8427b72b'", '8427b72b'],
    ]
    for (const [linha, segredo] of casos) {
      const saida = redactSecrets(linha)
      expect(saida, `nao mascarou em: ${linha}`).not.toContain(segredo)
      expect(saida).toContain('<REDACTED>')
    }
  })

  it('preserva o NOME da variavel quando ele identifica o segredo', () => {
    expect(redactSecrets('OMDB_API_KEY=8427b72b')).toBe('OMDB_API_KEY=<REDACTED>')
  })

  it('mascara Authorization / Bearer', () => {
    expect(redactSecrets('authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi')
  })

  it('e idempotente', () => {
    const uma = redactSecrets(STDERR_PRISMA)
    expect(redactSecrets(uma)).toBe(uma)
  })

  it('nao destroi texto sem segredo', () => {
    const inocente = 'catalog search-reindex: 0 de 239 titulos projetados'
    expect(redactSecrets(inocente)).toBe(inocente)
  })
})

describe('tailOfStderr', () => {
  it('descarta linhas de pilha e mantem a mensagem', () => {
    const saida = tailOfStderr(STDERR_PRISMA)
    expect(saida).not.toContain('at process.processTicksAndRejections')
    expect(saida).toContain('PrismaClientInitializationError')
  })

  it('respeita o teto e corta pelo COMECO (a causa fica no fim)', () => {
    const ruido = 'x'.repeat(2000)
    const saida = tailOfStderr(`${ruido}\nCAUSA_FINAL`)
    expect(saida.length).toBeLessThanOrEqual(CHILD_STDERR_MAX + 3)
    expect(saida).toContain('CAUSA_FINAL')
    expect(saida.startsWith('...')).toBe(true)
  })

  it('texto vazio vira string vazia, nao "undefined"', () => {
    expect(tailOfStderr('')).toBe('')
    expect(tailOfStderr('   \n\n  ')).toBe('')
  })
})

describe('describeChildFailure', () => {
  it('diz o que saiu, com que codigo, e POR QUE', () => {
    const d = describeChildFailure('compute-cinerie-score', 1, STDERR_PRISMA)
    expect(d).toContain('compute-cinerie-score')
    expect(d).toContain('codigo 1')
    expect(d).toContain('PrismaClientInitializationError')
  })

  it('NUNCA vaza segredo do stderr para o detalhe', () => {
    const d = describeChildFailure('compute-cinerie-score', 1, STDERR_PRISMA)
    expect(d).not.toContain('SenhaSuperSecreta')
  })

  it('stderr vazio e um FATO diagnostico, nao um vazio', () => {
    const d = describeChildFailure('catalog search-reindex', 1, '')
    expect(d).toContain('nao escreveu nada em stderr')
  })

  it('codigo nulo (morto por sinal) e dito com todas as letras', () => {
    const d = describeChildFailure('promote-omdb-awards', null, '')
    expect(d).toContain('sem codigo')
    expect(d).not.toContain('codigo null')
  })
})

describe('describeRun mostra a causa', () => {
  it('em FALHA, a linha carrega o detalhe', () => {
    const linha = describeRun(
      outcomeDe('failure', [
        {
          code: 'score_child_failed',
          detail: describeChildFailure('compute-cinerie-score', 1, STDERR_PRISMA),
          count: 1,
        },
      ]),
    )
    expect(linha).toContain('score_child_failedx1')
    expect(linha).toContain('causa:')
    expect(linha).toContain('PrismaClientInitializationError')
    expect(linha).not.toContain('SenhaSuperSecreta')
  })

  it('em SUCESSO, detalhe de rotina nao polui a linha', () => {
    const linha = describeRun(
      outcomeDe('success', [
        { code: 'already_queued', detail: 'job ja enfileirado hoje', count: 3 },
      ]),
    )
    expect(linha).toContain('already_queuedx3')
    expect(linha).not.toContain('causa:')
  })

  it('CONTROLE NEGATIVO: o detalhe que so repete o codigo de saida NAO diagnostica nada', () => {
    // Esta era literalmente a linha que producao emitia, todo tique, ha dias.
    const antigo = describeRun(
      outcomeDe('failure', [
        {
          code: 'score_child_failed',
          detail: 'compute-cinerie-score saiu com codigo 1',
          count: 1,
        },
      ]),
    )
    // Ela ate aparece agora (o campo passou a ser impresso)...
    expect(antigo).toContain('causa:')
    // ...mas nao diz NADA que o operador ja nao soubesse: zero causa.
    expect(antigo).not.toMatch(/Error|Exception|reach database|ECONN|timeout/i)

    // O conserto de verdade e o detalhe carregar o stderr do filho:
    const novo = describeRun(
      outcomeDe('failure', [
        {
          code: 'score_child_failed',
          detail: describeChildFailure('compute-cinerie-score', 1, STDERR_PRISMA),
          count: 1,
        },
      ]),
    )
    expect(novo).toMatch(/Error|Exception|reach database/i)
    expect(novo.length).toBeGreaterThan(antigo.length)
  })
})
