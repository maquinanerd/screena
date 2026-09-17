/**
 * process-stop.ts — O SIGTERM (e o Ctrl+C) vira PEDIDO DE PARADA. Modulo PURO:
 * a fonte de sinais e a saida forcada sao injetadas.
 *
 * ============================================================================
 * POR QUE UM WORKER DE LOTE PRECISA DISTO
 * ============================================================================
 * O agendador (`screen-cron`) spawna `sync-omdb-ratings` e, no desligamento de
 * todo redeploy, manda SIGTERM a ele. Sem ouvinte, a acao padrao do sinal mata o
 * processo na hora — e o nucleo grava `api_sync_logs` UMA vez, no FIM do lote.
 * Resultado: o lote cortado nao deixava linha, e a cota da OMDb que ele ja tinha
 * gastado sumia de `readSpentToday`.
 *
 * Com o ouvinte, o primeiro sinal so aborta `signal`. Quem le o sinal decide
 * ONDE parar (o client HTTP entre requisicoes, o nucleo entre ids), e o processo
 * termina pelo caminho normal — gravando a linha.
 *
 * O SEGUNDO sinal e o operador com pressa (`catalog worker` faz o mesmo): ai a
 * CLI sai na hora, sem esperar o lote.
 */

/** Os sinais que pedem parada. */
export type StopSignalName = 'SIGTERM' | 'SIGINT'

const STOP_SIGNALS: readonly StopSignalName[] = ['SIGTERM', 'SIGINT']

/** O pedaco de `process` que isto usa. */
export interface SignalSource {
  on(event: StopSignalName, listener: () => void): unknown
  off(event: StopSignalName, listener: () => void): unknown
}

export interface ProcessStopOptions {
  /** Primeiro sinal: a parada comecou (a CLI imprime a linha de drenagem). */
  readonly onStop: (signal: StopSignalName) => void
  /** Sinal repetido: sair agora. */
  readonly onForce: (signal: StopSignalName) => void
}

export interface ProcessStop {
  /** Abortado no PRIMEIRO sinal. Vai para o client HTTP e para o nucleo. */
  readonly signal: AbortSignal
  /** O primeiro sinal recebido, ou `null`. */
  readonly received: () => StopSignalName | null
  /** Solta os ouvintes. */
  readonly dispose: () => void
}

/** Liga SIGTERM e SIGINT a um pedido de parada. */
export function listenForStop(source: SignalSource, options: ProcessStopOptions): ProcessStop {
  const controller = new AbortController()
  let received: StopSignalName | null = null
  const listeners = STOP_SIGNALS.map((name) => {
    const listener = (): void => {
      if (received !== null) {
        options.onForce(name)
        return
      }
      received = name
      controller.abort()
      options.onStop(name)
    }
    source.on(name, listener)
    return { name, listener }
  })

  return {
    signal: controller.signal,
    received: () => received,
    dispose: () => {
      for (const { name, listener } of listeners) source.off(name, listener)
    },
  }
}

/**
 * O codigo de saida de quem parou por sinal: 128 + o numero do sinal (143 no
 * SIGTERM, 130 no SIGINT) — a convencao que o orquestrador e o shell ja leem.
 *
 * NAO e 0 de proposito: o lote nao terminou. O agendador le codigo diferente de
 * zero como lote NAO processado, e a linha `aborted` de `api_sync_logs` ja diz
 * quanto ele gastou.
 */
export function exitCodeForStop(signal: StopSignalName): number {
  return 128 + (signal === 'SIGTERM' ? 15 : 2)
}
