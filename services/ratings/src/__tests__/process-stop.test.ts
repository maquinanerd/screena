/**
 * process-stop.test.ts — SIGTERM/SIGINT viram pedido de parada.
 *
 * A fonte de sinais e um `EventEmitter` falso: o teste emite o sinal como o
 * `process` emitiria, sem matar o processo do vitest.
 */

import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import { exitCodeForStop, listenForStop, type StopSignalName } from '../process-stop.js'

function harness() {
  const source = new EventEmitter()
  const stops: StopSignalName[] = []
  const forces: StopSignalName[] = []
  const stop = listenForStop(source, {
    onStop: (signal) => stops.push(signal),
    onForce: (signal) => forces.push(signal),
  })
  return { source, stop, stops, forces }
}

describe('listenForStop', () => {
  it('o primeiro SIGTERM aborta o sinal e NAO forca a saida', () => {
    const h = harness()
    expect(h.stop.signal.aborted).toBe(false)
    expect(h.stop.received()).toBeNull()

    h.source.emit('SIGTERM')

    expect(h.stop.signal.aborted).toBe(true)
    expect(h.stop.received()).toBe('SIGTERM')
    expect(h.stops).toEqual(['SIGTERM'])
    expect(h.forces).toEqual([])
  })

  it('o SEGUNDO sinal e o operador com pressa: forca a saida', () => {
    const h = harness()
    h.source.emit('SIGINT')
    h.source.emit('SIGINT')

    expect(h.stops).toEqual(['SIGINT'])
    expect(h.forces).toEqual(['SIGINT'])
    // O primeiro sinal continua sendo o que parou o lote.
    expect(h.stop.received()).toBe('SIGINT')
  })

  it('CONTROLE NEGATIVO: sem sinal, nada para', () => {
    const h = harness()
    h.source.emit('SIGHUP')
    expect(h.stop.signal.aborted).toBe(false)
    expect(h.stops).toEqual([])
  })

  it('dispose solta os ouvintes', () => {
    const h = harness()
    expect(h.source.listenerCount('SIGTERM')).toBe(1)
    expect(h.source.listenerCount('SIGINT')).toBe(1)
    h.stop.dispose()
    expect(h.source.listenerCount('SIGTERM')).toBe(0)
    expect(h.source.listenerCount('SIGINT')).toBe(0)
  })
})

describe('exitCodeForStop', () => {
  it('128 + numero do sinal: 143 no SIGTERM, 130 no SIGINT', () => {
    expect(exitCodeForStop('SIGTERM')).toBe(143)
    expect(exitCodeForStop('SIGINT')).toBe(130)
  })
})
