/**
 * worker-readiness-types.ts — Forma do relatorio de readiness. PURO (so tipos).
 *
 * Vive em modulo proprio para que o servidor de health nao precise importar
 * `apps/cms`: o worker e o CMS avaliam readiness com a MESMA forma, mas sao
 * servicos independentes e nenhum pode depender do codigo do outro em runtime.
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

/** Um unico `blocked` derruba a readiness; `warning` apenas sinaliza. */
export function summarizeReadiness(checks: readonly ReadinessCheck[]): ReadinessReport {
  return { ready: checks.every((check) => check.status !== 'blocked'), checks }
}

export interface WorkerReadinessInput {
  readonly configValid: boolean
  readonly configErrors: readonly string[]
  readonly screenDatabaseReachable: boolean
  /** Objetos do schema publico que a projecao exige e nao encontrou. */
  readonly missingSchemaObjects: readonly string[]
  readonly payloadReachable: boolean
  readonly payloadAuthAccepted: boolean
  readonly storageReady: boolean
  readonly storageDriver: string
  /**
   * Veredito do LOOP de projecao, quando ha um loop rodando.
   *
   * OPCIONAL porque nem todo consumidor deste avaliador tem loop: o
   * `worker-preflight` e uma verificacao pre-deploy de processo curto, e o
   * `--once` termina antes de existir loop para observar. Ausente, o check nao
   * aparece no relatorio — melhor do que um `ok` que afirmaria saude de algo
   * que ninguem mediu.
   */
  readonly loop?: { readonly status: CheckStatus; readonly detail: string }
}

/**
 * Readiness do worker de projecao. PURO — os fatos entram prontos.
 *
 * E isso que permite testar "schema publico atrasado bloqueia" sem subir banco.
 */
export function evaluateWorkerReadiness(input: WorkerReadinessInput): ReadinessReport {
  const checks: ReadinessCheck[] = [
    {
      name: 'config',
      status: input.configValid ? 'ok' : 'blocked',
      detail: input.configValid ? 'valida' : input.configErrors.join('; '),
    },
    {
      name: 'screen_db',
      status: input.screenDatabaseReachable ? 'ok' : 'blocked',
      detail: input.screenDatabaseReachable ? 'acessivel' : 'banco publico inacessivel',
    },
    {
      // Schema publico ATRASADO bloqueia. Sem isto o worker consumiria eventos
      // e falharia na escrita, gastando tentativas e mandando para dead-letter
      // materia que estava perfeita — a culpa era do deploy fora de ordem.
      name: 'screen_schema',
      status: input.missingSchemaObjects.length === 0 ? 'ok' : 'blocked',
      detail:
        input.missingSchemaObjects.length === 0
          ? 'atualizado'
          : `faltando: ${input.missingSchemaObjects.join(', ')}`,
    },
    {
      name: 'payload_reachable',
      status: input.payloadReachable ? 'ok' : 'blocked',
      detail: input.payloadReachable ? 'alcancavel' : 'CMS inalcancavel',
    },
    {
      name: 'payload_auth',
      status: input.payloadAuthAccepted ? 'ok' : 'blocked',
      // Nunca a chave, nem parte dela.
      detail: input.payloadAuthAccepted
        ? 'escopo publication_projection aceito'
        : 'credencial ou escopo recusados',
    },
    {
      name: 'public_storage',
      status: input.storageReady ? 'ok' : 'blocked',
      detail: input.storageReady ? `driver ${input.storageDriver}` : 'storage publico indisponivel',
    },
  ]

  // O LOOP entra por ultimo e so quando existe. Sem este check, o `/readyz`
  // media exclusivamente as DEPENDENCIAS do worker (config, banco, CMS,
  // storage) e respondia 200 com o loop de projecao completamente parado — o
  // servidor de health esta de pe, entao o painel fica verde. Era possivel ter
  // todas as dependencias saudaveis e nenhum evento sendo projetado.
  if (input.loop !== undefined) {
    checks.push({ name: 'projection_loop', status: input.loop.status, detail: input.loop.detail })
  }

  return summarizeReadiness(checks)
}
