/**
 * scope.ts — O ESCOPO de um pedido recorrente. Modulo PURO.
 *
 * ============================================================================
 * POR QUE O ESCOPO EXISTE, E POR QUE ELE CARREGA A JANELA
 * ============================================================================
 * A chave de idempotencia de um job de cobertura inclui o escopo. Sem escopo,
 * dois ciclos da MESMA fila sobre o MESMO titulo colidem numa chave so — o
 * segundo vira noop, e isso e exatamente o que se quer DENTRO da janela (nao
 * duplicar) e exatamente o que se NAO quer entre janelas (a fila congelaria no
 * primeiro lote, em silencio, para sempre).
 *
 * Entao o escopo carrega a JANELA:
 *
 *   diaria/semanal/mensal -> o DIA (`watch_offers:2026-08-21`)
 *   `/changes` (6 h)      -> a HORA (`2026-08-21T14`)
 *
 * A granularidade e a do CICLO, nao a do intervalo declarado: uma fila mensal
 * que rode duas vezes no mesmo dia (por reinicio do container, por exemplo) deve
 * mesmo colidir — o trabalho e o mesmo. No dia seguinte ela ja nao esta vencida,
 * entao a colisao nunca chega a acontecer.
 *
 * ============================================================================
 * UTC, E ISSO IMPORTA COM DUAS REPLICAS
 * ============================================================================
 * O dia sai de `toISOString()`, ou seja UTC. Duas replicas em fusos diferentes
 * (ou uma so, atravessando a meia-noite local) produziriam escopos DIFERENTES
 * para o mesmo trabalho se o dia fosse local — e escopos diferentes significam
 * chaves diferentes, ou seja o trabalho duplicado. O fuso do container nao pode
 * decidir isso.
 */

/** O escopo de uma fila cujo ciclo e por DIA. */
export function dailyScope(queue: string, now: Date): string {
  return `${queue}:${now.toISOString().slice(0, 10)}`
}

/**
 * O escopo de uma fila cujo ciclo e por HORA (`/changes`).
 *
 * Sem o nome da fila: o `sync_changes` nao tem alvo por entidade e a chave dele
 * ja e global. Acrescentar o nome so alongaria a string sem separar nada.
 */
export function hourlySlot(now: Date): string {
  return now.toISOString().slice(0, 13)
}
