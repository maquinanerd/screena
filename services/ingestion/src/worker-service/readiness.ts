/**
 * readiness.ts — Nucleo PURO da readiness do servico de catalogo.
 *
 * Separado do IO de proposito: a DECISAO ("isto esta pronto?") tem teste sem
 * banco, sem rede e sem relogio; o adapter so coleta os fatos.
 *
 * LIVENESS != READINESS. `/healthz` responde enquanto o processo esta vivo e
 * NAO toca banco nem TMDB — se tocasse, uma queda do PostgreSQL faria o
 * orquestrador reiniciar em loop um worker saudavel, e reiniciar nao devolve o
 * banco. Quem tira do balanceador (ou sinaliza "nao me mande trabalho") e a
 * readiness.
 */

/** Desfecho de um check. `blocked` = configuracao/autorizacao; `down` = infra. */
export type CatalogCheckStatus = 'ok' | 'blocked' | 'down'

/** Um check nomeado. `detail` nunca carrega valor de segredo. */
export interface CatalogCheck {
  readonly name: string
  readonly status: CatalogCheckStatus
  readonly detail: string
}

/** Fatos coletados pelo adapter, ja reduzidos a booleanos e contagens. */
export interface CatalogReadinessFacts {
  /** `NODE_ENV === 'production'`. */
  readonly isProduction: boolean
  /**
   * O operador declarou explicitamente que este servico pode escrever em
   * producao. E o equivalente, no container, ao `--force` da CLI: sem ele o
   * servico nao trabalha em producao.
   */
  readonly productionWriteAuthorized: boolean
  /** `DATABASE_URL` presente e nao vazia. */
  readonly hasDatabaseUrl: boolean
  /** Credencial TMDB presente (v4 read token OU api key v3). */
  readonly hasTmdbCredential: boolean
  /** O `SELECT 1` respondeu. `null` = ainda nao foi tentado. */
  readonly databaseReachable: boolean | null
  /** A tabela `catalog_jobs` existe. `null` = nao verificado. */
  readonly queueSchemaPresent: boolean | null
  /** Jobs em dead-letter. Informativo: NAO bloqueia readiness. */
  readonly deadLetterCount: number | null
}

/** Relatorio de readiness. */
export interface CatalogReadinessReport {
  readonly ready: boolean
  readonly checks: readonly CatalogCheck[]
}

/**
 * Avalia a readiness a partir dos fatos.
 *
 * O que BLOQUEIA:
 *  - producao sem autorizacao explicita de escrita;
 *  - `DATABASE_URL` ausente (o worker nao tem contra o que falar);
 *  - credencial TMDB ausente (todo job de sync morreria em `TmdbConfigError`);
 *  - banco inalcancavel;
 *  - schema da fila ausente (migration atrasada).
 *
 * O que NAO bloqueia:
 *  - dead-letter. Fila com job morto e trabalho para o operador, nao motivo para
 *    o orquestrador declarar o worker inapto — declarar not-ready ali pararia a
 *    ingestao inteira por causa de um unico id problematico. O numero e exposto
 *    para vigilancia, e nao como gate.
 */
export function evaluateCatalogReadiness(facts: CatalogReadinessFacts): CatalogReadinessReport {
  const checks: CatalogCheck[] = []

  if (facts.isProduction && !facts.productionWriteAuthorized) {
    checks.push({
      name: 'authorization',
      status: 'blocked',
      detail:
        'NODE_ENV=production sem CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED=true: ' +
        'escrita em producao exige autorizacao explicita (equivalente ao --force da CLI).',
    })
  } else {
    checks.push({
      name: 'authorization',
      status: 'ok',
      detail: facts.isProduction ? 'escrita em producao autorizada' : 'ambiente nao-producao',
    })
  }

  checks.push(
    facts.hasDatabaseUrl
      ? { name: 'config_database', status: 'ok', detail: 'DATABASE_URL presente' }
      : { name: 'config_database', status: 'blocked', detail: 'DATABASE_URL ausente' },
  )

  checks.push(
    facts.hasTmdbCredential
      ? { name: 'config_tmdb', status: 'ok', detail: 'credencial TMDB presente' }
      : {
          name: 'config_tmdb',
          status: 'blocked',
          detail: 'TMDB_READ_ACCESS_TOKEN (ou TMDB_API_KEY) ausente',
        },
  )

  checks.push(
    facts.databaseReachable === true
      ? { name: 'database', status: 'ok', detail: 'conexao verificada' }
      : {
          name: 'database',
          status: 'down',
          detail:
            facts.databaseReachable === null ? 'nao verificado' : 'banco inalcancavel',
        },
  )

  checks.push(
    facts.queueSchemaPresent === true
      ? { name: 'queue_schema', status: 'ok', detail: 'catalog_jobs presente' }
      : {
          name: 'queue_schema',
          status: 'blocked',
          detail:
            facts.queueSchemaPresent === null
              ? 'nao verificado'
              : 'catalog_jobs ausente: migration do screen-db atrasada',
        },
  )

  // Informativo, NUNCA gate.
  checks.push({
    name: 'dead_letter',
    status: 'ok',
    detail:
      facts.deadLetterCount === null
        ? 'nao verificado'
        : `${facts.deadLetterCount} job(s) em dead-letter (informativo)`,
  })

  const ready = checks.every((check) => check.name === 'dead_letter' || check.status === 'ok')
  return { ready, checks }
}
