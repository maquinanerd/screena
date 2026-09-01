/**
 * cache-purge.ts — expurgo das linhas VENCIDAS de `api_cache`. Nucleo PURO.
 *
 * ============================================================================
 * O QUE FOI MEDIDO
 * ============================================================================
 * Em 2026-09-01, `api_cache` tinha **543.936 linhas e 5.075 MB — ~50% do banco
 * inteiro** —, das quais **500.140 (89%) ja estavam vencidas**, ocupando
 * **3,6 GB**. Nada no sistema apagava uma linha de `api_cache`: a tabela tem
 * `expires_at`, o leitor respeita a coluna, e ninguem nunca recolheu o que
 * venceu. O cache funcionava; o lixo dele so crescia.
 *
 * ============================================================================
 * DUAS REGRAS QUE NAO PODEM SER RELAXADAS
 * ============================================================================
 *
 * 1. `expires_at IS NULL` NUNCA e apagado.
 *    NULL nao significa "venceu ha muito tempo" — significa **sem prazo**. Um
 *    `expires_at < now()` sozinho ja exclui NULL no SQL padrao (a comparacao da
 *    NULL, nunca `true`), mas o predicado aqui declara `IS NOT NULL`
 *    explicitamente: a regra fica legivel para quem for editar a consulta, em
 *    vez de depender de o leitor lembrar da semantica de tres valores.
 *
 * 2. O expurgo e por LOTES, sempre.
 *    Um `DELETE` unico sobre 500 mil linhas segura a transacao, incha o WAL e
 *    bloqueia escrita concorrente do worker de catalogo. Lotes de alguns
 *    milhares terminam em milissegundos cada, cabem entre duas escritas e podem
 *    ser interrompidos a qualquer momento sem deixar estado pela metade —
 *    apagar linha vencida e idempotente por construcao.
 *
 * ============================================================================
 * POR QUE O NUCLEO E PURO
 * ============================================================================
 * O que decide correcao aqui e o PREDICADO e o TETO, nao o IO. Mantendo os dois
 * num modulo sem Prisma, o teste que prova "nunca apaga linha sem prazo" roda
 * sem banco — e o adapter fica com uma responsabilidade so: executar.
 */

/**
 * Quantas linhas cada `DELETE` leva por vez.
 *
 * 5.000 e um compromisso medido pelo lado do risco, nao da velocidade: e grande
 * o bastante para que 500 mil linhas saiam em ~100 lotes, e pequeno o bastante
 * para que cada transacao dure milissegundos e nunca dispute lock com o worker
 * de catalogo, que escreve em `api_cache` continuamente.
 */
export const CACHE_PURGE_BATCH_SIZE = 5_000

/**
 * Teto de lotes por CICLO do agendador.
 *
 * O expurgo e perpetuo: linha nova vence todo dia. Um ciclo diario nao precisa
 * (nem deve) drenar um passivo historico de uma vez — quem faz isso e o runbook
 * em `docs/operations/api-cache-purge.md`, rodado uma vez, sob os olhos do dono.
 * O teto existe para que o ciclo automatico tenha duracao previsivel.
 */
export const CACHE_PURGE_MAX_BATCHES_PER_CYCLE = 40

/**
 * O `DELETE` de UM lote.
 *
 * `id IN (SELECT ... ORDER BY id LIMIT n)` em vez de `DELETE ... LIMIT n`:
 * o Postgres nao aceita `LIMIT` em `DELETE`. O `ORDER BY id` torna o lote
 * DETERMINISTICO — sem ele, dois lotes concorrentes poderiam escolher conjuntos
 * sobrepostos e um deles apagaria zero linhas, parecendo "acabou" quando nao
 * acabou.
 *
 * `RETURNING provider_api` e o que permite dizer DE QUEM era o lixo, e sai de
 * graca: a linha ja esta sendo tocada.
 *
 * `$1` = agora (ISO). Injetado, nunca `now()` do banco: misturar o relogio do
 * processo com o do servidor tornaria o teste nao-determinista.
 * `$2` = tamanho do lote.
 */
export const PURGE_BATCH_SQL = `
  DELETE FROM api_cache
   WHERE id IN (
     SELECT id
       FROM api_cache
      WHERE expires_at IS NOT NULL
        AND expires_at < ($1::timestamptz AT TIME ZONE 'UTC')
      ORDER BY id
      LIMIT $2
   )
  RETURNING provider_api
`

/** Quantas linhas vencidas ainda restam. Usada pelo relatorio, nunca pelo laco. */
export const COUNT_EXPIRED_SQL = `
  SELECT count(*)::bigint AS expired
    FROM api_cache
   WHERE expires_at IS NOT NULL
     AND expires_at < ($1::timestamptz AT TIME ZONE 'UTC')
`

/** Uma linha apagada, como o `RETURNING` a devolve. */
export interface PurgedRow {
  readonly provider_api: string
}

/**
 * Agrega o que foi apagado por fornecedor.
 *
 * Isto NAO e estatistica decorativa: cada entrada vira uma linha de
 * `api_sync_logs`, e `api_sync_logs.provider_api` tem FK para
 * `api_providers.key`. Agrupar pelo valor que veio do proprio `RETURNING`
 * garante que a chave existe — ela veio de uma linha que ja satisfazia a mesma
 * FK em `api_cache`. Inventar um rotulo de manutencao aqui exigiria um
 * fornecedor novo no registro, ou seja, migration; e o INSERT morreria em
 * violacao de FK se alguem esquecesse dela.
 */
export function tallyByProvider(rows: readonly PurgedRow[]): ReadonlyMap<string, number> {
  const tally = new Map<string, number>()
  for (const row of rows) {
    tally.set(row.provider_api, (tally.get(row.provider_api) ?? 0) + 1)
  }
  return tally
}

/** Desfecho de um ciclo de expurgo. */
export interface PurgeCycleResult {
  /** Linhas apagadas no ciclo inteiro. */
  readonly deleted: number
  /** Lotes efetivamente executados. */
  readonly batches: number
  /** Apagadas por fornecedor — uma linha de `api_sync_logs` cada. */
  readonly byProvider: ReadonlyMap<string, number>
  /**
   * `true` quando o ciclo parou por TETO, nao por falta de trabalho.
   *
   * A distincao importa: "acabou" e "cansei" produzem o mesmo `deleted` e
   * significados opostos para quem opera. Sem esta flag, um passivo de 500 mil
   * linhas apareceria como uma sequencia de ciclos bem-sucedidos que nunca
   * termina, e ninguem saberia que faltava rodar o runbook.
   */
  readonly hitBatchCeiling: boolean
}

/** Executa UM lote. O adapter injeta isto; o laco abaixo nao conhece Prisma. */
export type PurgeBatchRunner = (limit: number) => Promise<readonly PurgedRow[]>

/**
 * O LACO do expurgo: lotes ate acabar o trabalho ou bater o teto.
 *
 * Para quando um lote devolve MENOS que o pedido — sinal de que a fila de
 * vencidos acabou. Parar em "menos que o lote" e nao em "zero" economiza uma
 * consulta inteira por ciclo, e e correto: o `ORDER BY id` garante que um lote
 * parcial so acontece quando nao havia mais o que pegar.
 */
export async function purgeExpiredCache(
  runBatch: PurgeBatchRunner,
  options: {
    readonly batchSize?: number
    readonly maxBatches?: number
  } = {},
): Promise<PurgeCycleResult> {
  const batchSize = options.batchSize ?? CACHE_PURGE_BATCH_SIZE
  const maxBatches = options.maxBatches ?? CACHE_PURGE_MAX_BATCHES_PER_CYCLE

  const byProvider = new Map<string, number>()
  let deleted = 0
  let batches = 0
  let exhausted = false

  while (batches < maxBatches) {
    const rows = await runBatch(batchSize)
    batches += 1
    deleted += rows.length
    for (const [provider, count] of tallyByProvider(rows)) {
      byProvider.set(provider, (byProvider.get(provider) ?? 0) + count)
    }
    if (rows.length < batchSize) {
      exhausted = true
      break
    }
  }

  return {
    deleted,
    batches,
    byProvider,
    hitBatchCeiling: !exhausted,
  }
}
