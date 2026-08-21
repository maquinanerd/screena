/**
 * discovery-limit.test.ts — A DESCOBERTA NAO NASCE SEM TETO.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM 21/08/2026
 * ============================================================================
 * `runDiscovery` (`runtime/runners.ts`) enfileirava `discover_ids` com
 * `limit: null` HARDCODED. E `null` nao e "o default": e o export INTEIRO —
 * 1,23 M filmes + 228 k series + 4,86 M pessoas
 * (`discovery/export-discovery.ts`: `input.limit === null ? queue : queue.slice(...)`).
 *
 * Como o payload tambem carrega `enqueueDetails: true`, o PRIMEIRO ciclo desses
 * jobs drenado enfileiraria da ordem de 6,3 MILHOES de `sync_details`.
 *
 * Havia tres desses jobs em `catalog_jobs`, `pending`, esperando um consumidor
 * que nunca subiu. Drenar a fila sem consertar isto trocaria "o catalogo nao
 * cresce" por "o catalogo tenta engolir o TMDB inteiro".
 *
 * ============================================================================
 * A ASSIMETRIA QUE ESCONDIA O DEFEITO
 * ============================================================================
 * O servico de catalogo SEMPRE teve o botao equivalente
 * (`CATALOG_WORKER_DISCOVERY_LIMIT`, default 2000) — e o runbook manda DESLIGAR
 * o enfileirador dele quando o agendador sobe. O produtor COM teto saía de cena;
 * o SEM teto ficava. Os dois produzem o MESMO job.
 */

import { describe, expect, it } from 'vitest'

import { resolveSchedulerConfig } from '../config.js'

/** Env minimo para o config resolver sem reclamar de credencial. */
const BASE: Record<string, string | undefined> = {
  DATABASE_URL: 'postgresql://x',
  TMDB_READ_ACCESS_TOKEN: 'token-de-teste-nao-e-credencial',
}

describe('teto da descoberta do agendador', () => {
  it('(1) o DEFAULT tem teto, e ele e o mesmo do servico de catalogo (2000)', () => {
    // Dois produtores do MESMO job com tetos diferentes por omissao seria uma
    // divergencia esperando acontecer.
    expect(resolveSchedulerConfig(BASE).discoveryLimit).toBe(2000)
  })

  it('(2) CONTROLE NEGATIVO: o default NAO e "sem teto"', () => {
    // Este e o caso que reprova a volta do `limit: null` hardcoded. Se alguem
    // trocar o default por `0`/`null`, aqui fica vermelho.
    expect(resolveSchedulerConfig(BASE).discoveryLimit).not.toBeNull()
  })

  it('(3) `0` significa SEM TETO, e e opt-in EXPLICITO', () => {
    // Mesma semantica de `CATALOG_WORKER_DISCOVERY_LIMIT`: `0` = o universo
    // inteiro, nunca "nenhum id". Dois botoes para o mesmo teto com
    // significados opostos seria a armadilha, nao a protecao.
    expect(
      resolveSchedulerConfig({ ...BASE, CINERIE_SCHEDULER_DISCOVERY_LIMIT: '0' }).discoveryLimit,
    ).toBeNull()
  })

  it('(4) um teto explicito e respeitado', () => {
    expect(
      resolveSchedulerConfig({ ...BASE, CINERIE_SCHEDULER_DISCOVERY_LIMIT: '500' }).discoveryLimit,
    ).toBe(500)
  })

  it('(5) valor invalido e ERRO, nunca fallback silencioso para o default', () => {
    // Um `CINERIE_SCHEDULER_DISCOVERY_LIMIT=dois mil` que virasse 2000
    // esconderia um erro de deploy para sempre.
    expect(() =>
      resolveSchedulerConfig({ ...BASE, CINERIE_SCHEDULER_DISCOVERY_LIMIT: 'dois mil' }),
    ).toThrow()
  })
})
