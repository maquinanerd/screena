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

/**
 * O escopo de uma fila cujo ciclo e de N HORAS (o trending, a 6 h).
 *
 * Nem o dia (colapsaria os quatro ciclos de 6 h num so, e a lista congelaria no
 * primeiro do dia) nem a hora cheia (criaria seis chaves onde ha quatro
 * trabalhos, e o hash-noop do snapshot pagaria a diferenca em requisicao).
 *
 * O balde e ancorado na MEIA-NOITE UTC: `floor(hora / N)`. Ancorar no "agora"
 * faria o balde deslizar a cada reinicio do container, e duas replicas que
 * subissem em minutos diferentes veriam baldes diferentes para o mesmo ciclo.
 */
export function windowSlot(queue: string, now: Date, hours: number): string {
  const size = Math.max(1, Math.trunc(hours))
  const bucket = Math.floor(now.getUTCHours() / size) * size
  const day = now.toISOString().slice(0, 10)
  return `${queue}:${day}T${String(bucket).padStart(2, '0')}`
}
