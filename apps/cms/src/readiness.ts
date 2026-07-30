/**
 * readiness.ts — Liveness e readiness do CMS. Nucleo PURO + coletores finos.
 *
 * A distincao importa para o orquestrador:
 *
 *  - LIVENESS responde "o processo esta vivo". Nao toca banco, nao le
 *    configuracao. Se ela falhar, o container deve ser REINICIADO.
 *  - READINESS responde "posso receber trafego". Ela olha banco, migrations,
 *    storage e collections. Se falhar, o container deve ser DESPROMOVIDO — mas
 *    reinicia-lo nao resolve nada, porque a causa esta fora dele.
 *
 * Colapsar as duas faz o orquestrador reiniciar em loop um container saudavel
 * cujo banco esta fora do ar.
 *
 * NADA aqui expoe segredo, URL de banco, usuario, caminho de storage, chave ou
 * conteudo editorial: um readiness e lido por quem estiver com o painel aberto.
 *
 * O worker tem o seu proprio avaliador, em
 * `services/news-ingestion/src/media/worker-readiness-types.ts`. A forma e a
 * mesma de proposito, mas os dois sao servicos INDEPENDENTES: nenhum pode
 * importar codigo do outro em runtime.
 */

export type CheckStatus = 'ok' | 'blocked' | 'warning'

export interface ReadinessCheck {
  readonly name: string
  readonly status: CheckStatus
  /** Motivo CURTO e de politica. Nunca valor, caminho ou credencial. */
  readonly detail: string
}

export interface ReadinessReport {
  readonly ready: boolean
  readonly checks: readonly ReadinessCheck[]
}

/**
 * Consolida os checks.
 *
 * Um unico `blocked` derruba a readiness. `warning` nao derruba: existe para
 * sinalizar degradacao (ex.: storage local em desenvolvimento) sem impedir o
 * servico de atender.
 */
export function summarizeReadiness(checks: readonly ReadinessCheck[]): ReadinessReport {
  return { ready: checks.every((check) => check.status !== 'blocked'), checks }
}

export interface CmsReadinessInput {
  readonly configValid: boolean
  readonly configErrors: readonly string[]
  readonly databaseReachable: boolean
  readonly pendingMigrations: number | null
  readonly storageReady: boolean
  readonly storageDriver: string
  readonly storagePersistent: boolean
  readonly collectionCount: number
  readonly isProduction: boolean
  /**
   * Estado da autopublicacao, ja avaliado por
   * `evaluateAutoPublishReadiness`. Entra como FATO para o nucleo continuar
   * puro — e para o CMS manual poder passar `ok` sem env de automacao alguma.
   */
  readonly autoPublish: { readonly status: CheckStatus; readonly detail: string }
}

/** Collections que o CMS precisa ter registrado para funcionar. */
export const REQUIRED_CMS_COLLECTIONS = 6

/**
 * Readiness do CMS a partir de fatos ja coletados.
 *
 * PURO — os fatos entram prontos. E isso que permite testar "migration pendente
 * bloqueia" sem subir Postgres.
 */
export function evaluateCmsReadiness(input: CmsReadinessInput): ReadinessReport {
  const checks: ReadinessCheck[] = []

  checks.push({
    name: 'config',
    status: input.configValid ? 'ok' : 'blocked',
    // So os NOMES das variaveis chegam aqui — `resolve*Config` nunca devolve valor.
    detail: input.configValid ? 'valida' : input.configErrors.join('; '),
  })

  checks.push({
    name: 'database',
    status: input.databaseReachable ? 'ok' : 'blocked',
    detail: input.databaseReachable ? 'acessivel' : 'banco editorial inacessivel',
  })

  // Migration pendente bloqueia. Servir com schema antigo produz erro de coluna
  // inexistente no meio de uma edicao — pior do que nao atender.
  checks.push(
    input.pendingMigrations === null
      ? {
          name: 'migrations',
          status: 'blocked',
          detail: 'estado das migrations desconhecido',
        }
      : {
          name: 'migrations',
          status: input.pendingMigrations === 0 ? 'ok' : 'blocked',
          detail:
            input.pendingMigrations === 0
              ? 'aplicadas'
              : `${String(input.pendingMigrations)} pendente(s)`,
        },
  )

  checks.push({
    name: 'upload_storage',
    status: !input.storageReady
      ? 'blocked'
      : // Storage local em producao ja e recusado pela configuracao; se chegar
        // aqui sem persistencia declarada, e sinal de alerta, nao de bloqueio.
        input.isProduction && !input.storagePersistent
        ? 'warning'
        : 'ok',
    detail: input.storageReady
      ? `driver ${input.storageDriver}`
      : 'storage de upload inacessivel',
  })

  checks.push({
    name: 'collections',
    status: input.collectionCount >= REQUIRED_CMS_COLLECTIONS ? 'ok' : 'blocked',
    detail: `${String(input.collectionCount)} registrada(s)`,
  })

  // AUTOPUBLICACAO. O check aparece SEMPRE, inclusive quando a automacao esta
  // desligada — e nesse caso com status `ok`.
  //
  // Existe para fechar uma lacuna que a documentacao ja prometia e o codigo nao
  // cumpria: o runbook afirmava que fuso invalido "bloqueia readiness", mas
  // nenhum check consultava a configuracao. Quem ligasse a automacao com fuso
  // errado descobriria a cada request, em vez de no deploy.
  //
  // O que ele NAO faz: exigir configuracao de automacao para o CMS ficar
  // pronto. Um Payload que publica apenas por redacao humana e um Payload
  // saudavel, e o kill switch desligado e estado conhecido — nao avaria.
  checks.push({
    name: 'auto_publish',
    status: input.autoPublish.status,
    detail: input.autoPublish.detail,
  })

  return summarizeReadiness(checks)
}

/**
 * Codigo HTTP do relatorio.
 *
 * 503 (nao 500) quando nao esta pronto: o servico nao quebrou, ele so ainda nao
 * pode atender. E o unico status que faz o orquestrador tirar do balanceador em
 * vez de marcar o deploy como falho.
 */
export function readinessHttpStatus(report: ReadinessReport): number {
  return report.ready ? 200 : 503
}
