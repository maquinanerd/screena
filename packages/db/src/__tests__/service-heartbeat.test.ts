/**
 * service-heartbeat.test.ts — O sinal de vida diz o que precisa e NUNCA o valor
 * de uma credencial.
 */

import { describe, expect, it } from 'vitest'

import {
  buildHeartbeatValues,
  classifyCredentialFormat,
  describeCredentials,
  HEARTBEAT_UPSERT_SQL,
  safeErrorLabel,
  startServiceHeartbeat,
  type HeartbeatSqlPort,
} from '../service-heartbeat.js'
import type { SourceFingerprint } from '../source-fingerprint.js'

const SEGREDOS = [
  'postgresql://usuario:SenhaMuitoSecreta@rss_prime_screen-db:5432/screena',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.assinaturaSecreta',
  '0123456789abcdef0123456789abcdef',
  'ChaveAlfanumericaSecreta42',
  'com espaco e $imbolo secreto',
]

describe('classifyCredentialFormat — um rotulo de conjunto fechado', () => {
  it.each([
    [undefined, 'ausente'],
    ['   ', 'vazia'],
    ['postgresql://u:p@h:5432/db', 'url'],
    ['eyJ.abc.def', 'jwt'],
    ['abcdef0123', 'hex'],
    // `Abc123` seria hex (A, b, c sao digitos hexadecimais): o caso alfanumerico
    // precisa de uma letra FORA de a-f para medir o ramo certo.
    ['Xyz123', 'alfanumerica'],
    ['a b$c', 'outra'],
  ] as const)('%s -> %s', (valor, esperado) => {
    expect(classifyCredentialFormat(valor)).toBe(esperado)
  })

  it('o resultado e SEMPRE um rotulo do conjunto fechado — por construcao, nada do valor sai', () => {
    // Procurar "pedaco do segredo no rotulo" seria teste fraco: o segredo
    // `ChaveAlfanumerica...` contem letras do rotulo `alfanumerica` sem vazar
    // nada. A propriedade real e o CONJUNTO: o que sai daqui so pode ser um dos
    // sete rotulos, qualquer que seja a entrada.
    const permitidos = new Set(['ausente', 'vazia', 'url', 'jwt', 'hex', 'alfanumerica', 'outra'])
    const entradas = [...SEGREDOS, 'x', '::', 'a.b', 'a.b.c.d', 'ZZ', '\t\n', 'https://', 'tt1234567']
    for (const valor of entradas) {
      expect(permitidos.has(classifyCredentialFormat(valor)), valor).toBe(true)
    }
  })
})

describe('describeCredentials', () => {
  it('diz nome, presenca e formato — e o JSON nao contem valor nenhum', () => {
    const env = {
      DATABASE_URL: SEGREDOS[0],
      TMDB_READ_ACCESS_TOKEN: SEGREDOS[1],
      OMDB_API_KEY: SEGREDOS[2],
      VAZIA: '',
    }
    const lista = describeCredentials(['DATABASE_URL', 'TMDB_READ_ACCESS_TOKEN', 'OMDB_API_KEY', 'VAZIA', 'AUSENTE'], env)
    expect(lista).toEqual([
      { name: 'DATABASE_URL', present: true, format: 'url' },
      { name: 'TMDB_READ_ACCESS_TOKEN', present: true, format: 'jwt' },
      { name: 'OMDB_API_KEY', present: true, format: 'hex' },
      { name: 'VAZIA', present: false, format: 'vazia' },
      { name: 'AUSENTE', present: false, format: 'ausente' },
    ])
    const serializado = JSON.stringify(lista)
    for (const segredo of SEGREDOS.slice(0, 3)) {
      expect(serializado).not.toContain(segredo)
      expect(serializado).not.toContain('SenhaMuitoSecreta')
    }
  })

  it('recusa nome que nao e nome de variavel (um valor passado no lugar do nome)', () => {
    expect(() => describeCredentials([SEGREDOS[0] as string], {})).toThrow(/nome de variavel invalido/)
  })
})

const IMPRESSAO: SourceFingerprint = {
  method: 'git-blob-sha1/v1',
  digest: 'd'.repeat(64),
  fileCount: 12,
  buckets: { 'services/sync': 'e'.repeat(64) },
}

describe('buildHeartbeatValues', () => {
  it('monta os 15 parametros na ordem do UPSERT', () => {
    const valores = buildHeartbeatValues({
      serviceKey: 'screen-cron',
      instanceId: 'container:1',
      startedAt: new Date('2026-09-15T10:00:00.000Z'),
      lastSeenAt: new Date('2026-09-15T10:05:00.000Z'),
      fingerprint: IMPRESSAO,
      digestError: null,
      buildId: null,
      nodeVersion: 'v22.0.0',
      rssBytes: 1000,
      heapUsedBytes: 500,
      cpuPercent: 3.5,
      credentials: [{ name: 'OMDB_API_KEY', present: true, format: 'hex' }],
    })
    expect(valores).toHaveLength(15)
    expect((HEARTBEAT_UPSERT_SQL.match(/\$\d+/g) ?? []).length).toBe(15)
    expect(valores[0]).toBe('screen-cron')
    expect(valores[2]).toBe('2026-09-15T10:00:00.000Z')
    expect(valores[4]).toBe('git-blob-sha1/v1')
    expect(valores[5]).toBe('d'.repeat(64))
    expect(valores[7]).toBe(JSON.stringify(IMPRESSAO.buckets))
  })
})

describe('safeErrorLabel', () => {
  it('leva classe e codigo, nunca a mensagem (que pode carregar connection string)', () => {
    const erro = Object.assign(new Error(`falha em ${SEGREDOS[0] as string}`), { code: 'ECONNREFUSED' })
    expect(safeErrorLabel(erro)).toBe('Error:ECONNREFUSED')
    expect(safeErrorLabel(new TypeError('segredo'))).toBe('TypeError')
    expect(safeErrorLabel('texto solto')).toBe('erro_desconhecido')
  })
})

function bancoFalso(): HeartbeatSqlPort & { chamadas: unknown[][]; falhar: boolean } {
  const banco = {
    chamadas: [] as unknown[][],
    falhar: false,
    async $executeRawUnsafe(_query: string, ...valores: unknown[]): Promise<number> {
      if (banco.falhar) throw Object.assign(new Error(`conexao ${SEGREDOS[0] as string}`), { code: 'P1001' })
      banco.chamadas.push(valores)
      return 1
    },
  }
  return banco
}

async function esvaziarFila(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('startServiceHeartbeat', () => {
  it('sinaliza JA na subida (sem digest) e de novo quando a impressao fica pronta', async () => {
    const banco = bancoFalso()
    let liberar: (valor: SourceFingerprint) => void = () => undefined
    const handle = startServiceHeartbeat({
      db: banco,
      serviceKey: 'screen-catalog-worker',
      repoRoot: '/app',
      intervalMs: 60_000,
      credentialEnvNames: ['OMDB_API_KEY'],
      env: { OMDB_API_KEY: SEGREDOS[3] },
      fingerprint: () => new Promise<SourceFingerprint>((resolve) => {
        liberar = resolve
      }),
    })
    await esvaziarFila()
    expect(banco.chamadas).toHaveLength(1)
    expect(banco.chamadas[0]?.[5]).toBeNull()
    expect(banco.chamadas[0]?.[8]).toBe('em_calculo')

    liberar(IMPRESSAO)
    await handle.fingerprintReady()
    expect(banco.chamadas).toHaveLength(2)
    expect(banco.chamadas[1]?.[5]).toBe('d'.repeat(64))
    expect(banco.chamadas[1]?.[8]).toBeNull()

    // Nenhum parametro de nenhuma chamada carrega o valor da credencial.
    expect(JSON.stringify(banco.chamadas)).not.toContain(SEGREDOS[3])

    handle.stop()
    await handle.beat()
    expect(banco.chamadas).toHaveLength(2)
  })

  it('banco fora do ar NAO derruba o servico e o log nao leva a mensagem crua', async () => {
    const banco = bancoFalso()
    banco.falhar = true
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = []
    const handle = startServiceHeartbeat({
      db: banco,
      serviceKey: 'screen-cron',
      repoRoot: null,
      log: (_nivel, event, fields) => logs.push({ event, fields }),
    })
    await handle.beat()
    handle.stop()
    expect(logs.some((l) => l.event === 'service_heartbeat_write_failed')).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('SenhaMuitoSecreta')
  })

  it('sem raiz de repositorio o digest fica AUSENTE com motivo — nunca inventado', async () => {
    const banco = bancoFalso()
    const handle = startServiceHeartbeat({ db: banco, serviceKey: 'screen-app', repoRoot: null })
    await handle.fingerprintReady()
    await esvaziarFila()
    handle.stop()
    expect(banco.chamadas[0]?.[5]).toBeNull()
    expect(banco.chamadas[0]?.[8]).toBe('raiz_do_repositorio_nao_encontrada')
  })

  it('recusa serviceKey fora do padrao', () => {
    expect(() => startServiceHeartbeat({ db: bancoFalso(), serviceKey: 'Screen App' })).toThrow(/serviceKey invalido/)
  })
})
