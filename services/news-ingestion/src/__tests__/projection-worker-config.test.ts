/**
 * projection-worker-config.test.ts — Fronteira de configuracao do worker.
 *
 * O worker acessa a API do Payload e o banco publico do Screen-App — nunca o
 * banco do CMS (isso e provado em `tests/governance/editorial-worker-boundary`).
 * Estes testes travam as duas coisas que nao podem falhar na CONFIGURACAO: ele
 * nunca aponta os dois lados para o mesmo banco, e nenhuma mensagem de erro
 * carrega valor.
 */

import { describe, expect, it } from 'vitest'

import {
  projectionAuthHeader,
  resolveProjectionWorkerConfig,
} from '../projection-worker-config.js'

const SCREEN = 'postgresql://app:segredo-do-banco@127.0.0.1:5432/cinerie_dev'
const PAYLOAD = 'postgresql://cms:outro-segredo@127.0.0.1:5432/cinerie_cms_dev'

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    SCREEN_DATABASE_URL: SCREEN,
    PAYLOAD_DATABASE_URL: PAYLOAD,
    PAYLOAD_INTERNAL_SERVICE_URL: 'http://127.0.0.1:3002',
    PAYLOAD_PROJECTION_API_KEY: 'chave-de-teste-nao-real',
    PROJECTION_WORKER_ID: 'worker-1',
    ...overrides,
  }
}

describe('resolucao de configuracao', () => {
  it('aceita um ambiente completo e aplica defaults sensatos', () => {
    const result = resolveProjectionWorkerConfig(env())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.workerId).toBe('worker-1')
    expect(result.config.batchSize).toBe(10)
    expect(result.config.projectionApiKeyCollection).toBe('service-accounts')
    // Barra final some para que a concatenacao de rota nao gere `//api`.
    expect(result.config.payloadInternalServiceUrl).toBe('http://127.0.0.1:3002')
  })

  it('recusa quando os dois bancos sao o MESMO', () => {
    // Seria o CMS escrevendo direto no banco publico — o acoplamento que a
    // outbox existe para impedir (ADR 0015).
    const result = resolveProjectionWorkerConfig(
      env({ PAYLOAD_DATABASE_URL: SCREEN }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('MESMO banco')
  })

  it('recusa URL com cara de producao, e permite so com opt-in explicito', () => {
    const prod = 'postgresql://u:p@host:5432/rss_prime_screen-db'
    const blocked = resolveProjectionWorkerConfig(
      env({ SCREEN_DATABASE_URL: prod, PAYLOAD_DATABASE_URL: PAYLOAD }),
    )
    expect(blocked.ok).toBe(false)
    const allowed = resolveProjectionWorkerConfig(
      env({ SCREEN_DATABASE_URL: prod, PAYLOAD_DATABASE_URL: PAYLOAD }),
      { allowProductionShapedUrl: true },
    )
    expect(allowed.ok).toBe(true)
  })

  it('NENHUMA mensagem de erro carrega valor de variavel', () => {
    // Um systemd timer com configuracao errada nao pode virar vazamento de
    // credencial no journal.
    const result = resolveProjectionWorkerConfig({
      SCREEN_DATABASE_URL: 'postgresql://u:p@host/rss_prime',
      PAYLOAD_INTERNAL_SERVICE_URL: 'nao-e-url',
      PAYLOAD_PROJECTION_API_KEY: '',
      PROJECTION_WORKER_ID: '',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    const text = result.errors.join(' | ')
    for (const secret of ['postgresql://', 'u:p@host', 'nao-e-url']) {
      expect(text).not.toContain(secret)
    }
    // Controle positivo: os NOMES aparecem, senao o erro seria inutil.
    expect(text).toContain('PAYLOAD_PROJECTION_API_KEY')
    expect(text).toContain('PROJECTION_WORKER_ID')
    expect(text).toContain('PAYLOAD_INTERNAL_SERVICE_URL')
  })

  it('exige as variaveis obrigatorias', () => {
    for (const missing of [
      'SCREEN_DATABASE_URL',
      'PAYLOAD_INTERNAL_SERVICE_URL',
      'PAYLOAD_PROJECTION_API_KEY',
      'PROJECTION_WORKER_ID',
    ]) {
      const result = resolveProjectionWorkerConfig(env({ [missing]: undefined }))
      expect(result.ok, `${missing} deveria ser obrigatoria`).toBe(false)
    }
  })

  it('limita lote, lease e intervalo a faixas seguras', () => {
    const result = resolveProjectionWorkerConfig(
      env({
        PROJECTION_BATCH_SIZE: '999',
        PROJECTION_LEASE_MS: '1',
        PROJECTION_POLL_INTERVAL_MS: 'abc',
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.batchSize).toBe(25)
    expect(result.config.leaseMs).toBe(5_000)
    expect(result.config.pollIntervalMs).toBe(15_000)
  })
})

describe('header de autorizacao', () => {
  it('usa o formato exigido pelo Payload', () => {
    const result = resolveProjectionWorkerConfig(env())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(projectionAuthHeader(result.config)).toBe(
      'service-accounts API-Key chave-de-teste-nao-real',
    )
  })
})
