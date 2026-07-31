/**
 * worker-readiness.test.ts — A COLETA de readiness do worker de projecao.
 *
 * `worker-deployment-readiness.test.ts` cobre o AVALIADOR puro (fatos entram
 * prontos). Aqui cobrimos a camada que MONTA esses fatos a partir do ambiente —
 * e um bug real morava exatamente nessa costura:
 *
 *   o worker subia com `--loop --allow-production-url`, `/healthz` respondia
 *   200, e `/readyz` respondia 503 com "SCREEN_DATABASE_URL parece apontar para
 *   producao; recusado".
 *
 * Causa: `collectWorkerReadiness` reavaliava a configuracao SEM a autorizacao
 * explicita que o processo principal ja tinha usado para subir. Duas leituras da
 * mesma configuracao, uma delas cega para a decisao tomada.
 *
 * O que NAO pode ser conclusao errada daqui: a protecao continua ligada por
 * default. O readiness passa a RESPEITAR a mesma autorizacao — nao a ignorar.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PrismaClient } from '@screena/db/server'

import { collectWorkerReadiness } from '../persistence/worker-readiness.js'
import type {
  ReadinessCheck,
  ReadinessReport,
} from '../media/worker-readiness-types.js'
import {
  REQUIRED_COLUMNS,
  REQUIRED_TABLES,
} from '../media/screen-schema-preflight.js'
import type { MediaStoragePort } from '../media/storage-port.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const WORKER_ENTRY = 'services/news-ingestion/bin/project-editorial.ts'

/* ------------------------------------------------------------------ */
/* Ambiente e dependencias de teste                                    */
/* ------------------------------------------------------------------ */

/** URL com a MESMA cara da de producao do EasyPanel (casa em PRODUCTION_SHAPES). */
const PROD_SHAPED_SCREEN_URL = 'postgresql://app:senha-secreta@db:5432/rss_prime_screen-db'
const PROJECTION_API_KEY = 'chave-de-projecao-nao-real'

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    SCREEN_DATABASE_URL: PROD_SHAPED_SCREEN_URL,
    PAYLOAD_DATABASE_URL: 'postgresql://cms:outra-senha@db:5432/cinerie_cms',
    PAYLOAD_INTERNAL_SERVICE_URL: 'http://cms.interno:3002',
    PAYLOAD_PROJECTION_API_KEY: PROJECTION_API_KEY,
    PROJECTION_WORKER_ID: 'worker-1',
    EDITORIAL_MEDIA_STORAGE_DRIVER: 'local',
    EDITORIAL_MEDIA_LOCAL_ROOT: '/tmp/cinerie-media',
    ...overrides,
  }
}

/** Prisma de mentira que devolve o schema publico COMPLETO. */
function prismaWithCompleteSchema(): PrismaClient {
  const rows = {
    tables: REQUIRED_TABLES.map((table) => ({ table_name: table })),
    columns: REQUIRED_TABLES.flatMap((table) =>
      (REQUIRED_COLUMNS[table] ?? []).map((column) => ({
        table_name: table,
        column_name: column,
      })),
    ),
  }
  return {
    $queryRawUnsafe: async (sql: string) =>
      sql.includes('information_schema.columns') ? rows.columns : rows.tables,
  } as unknown as PrismaClient
}

function storageThatAnswers(): MediaStoragePort {
  return {
    put: async () => ({ key: 'k', byteSize: 0, contentType: 'image/jpeg' }),
    exists: async () => false,
    stat: async () => null,
    read: async () => null,
    delete: async () => undefined,
    publicReference: (key: string) => `/media/${key}`,
  }
}

/** CMS de mentira: responde 200 ao `claim` de lote zero. */
const fetchImplOk = async (): Promise<Response> =>
  new Response(JSON.stringify({ events: [] }), { status: 200 })

function check(report: ReadinessReport, name: string): ReadinessCheck {
  const found = report.checks.find((item) => item.name === name)
  if (found === undefined) throw new Error(`check "${name}" deveria existir no relatorio`)
  return found
}

/* ------------------------------------------------------------------ */
/* A regressao                                                         */
/* ------------------------------------------------------------------ */

describe('readiness e a autorizacao explicita de URL com cara de producao', () => {
  it('SEM autorizacao, URL com cara de producao continua BLOQUEADA', async () => {
    // Controle negativo: se este teste ficar verde por outro motivo, o de baixo
    // provaria apenas que a protecao foi removida.
    const report = await collectWorkerReadiness({
      prisma: prismaWithCompleteSchema(),
      storage: storageThatAnswers(),
      env: env(),
      fetchImpl: fetchImplOk,
    })

    expect(report.ready).toBe(false)
    const config = check(report, 'config')
    expect(config.status).toBe('blocked')
    expect(config.detail).toContain('producao')
    expect(config.detail).toContain('SCREEN_DATABASE_URL')
  })

  it('COM autorizacao, o readiness nao bloqueia por esse motivo', async () => {
    const report = await collectWorkerReadiness({
      prisma: prismaWithCompleteSchema(),
      storage: storageThatAnswers(),
      env: env(),
      fetchImpl: fetchImplOk,
      allowProductionShapedUrl: true,
    })

    const config = check(report, 'config')
    expect(config.status).toBe('ok')
    expect(config.detail).not.toContain('producao')
    // Com o resto do ambiente saudavel, o `/readyz` responde 200 — que era o
    // desfecho que o bug impedia mesmo com o worker rodando normalmente.
    expect(report.ready).toBe(true)
  })

  it('a autorizacao NAO afrouxa nenhuma outra regra de configuracao', async () => {
    // A flag autoriza UMA coisa: a forma da URL. Nao e um bypass geral.
    const report = await collectWorkerReadiness({
      prisma: prismaWithCompleteSchema(),
      storage: storageThatAnswers(),
      env: env({ PAYLOAD_DATABASE_URL: PROD_SHAPED_SCREEN_URL }),
      fetchImpl: fetchImplOk,
      allowProductionShapedUrl: true,
    })

    expect(report.ready).toBe(false)
    expect(check(report, 'config').detail).toContain('MESMO banco')
  })

  it('o default e FECHADO: `false` explicito bloqueia igual a omissao', async () => {
    const report = await collectWorkerReadiness({
      prisma: prismaWithCompleteSchema(),
      storage: storageThatAnswers(),
      env: env(),
      fetchImpl: fetchImplOk,
      allowProductionShapedUrl: false,
    })
    expect(check(report, 'config').status).toBe('blocked')
  })

  it('NENHUMA credencial ou URL sai no relatorio — autorizado ou nao', async () => {
    // O `/readyz` e servido sem autenticacao dentro da rede interna e vai para o
    // log do orquestrador a cada batida. Vazar a connection string aqui seria
    // vaza-la continuamente.
    for (const allow of [undefined, true]) {
      const report = await collectWorkerReadiness({
        prisma: prismaWithCompleteSchema(),
        storage: storageThatAnswers(),
        env: env(),
        fetchImpl: fetchImplOk,
        allowProductionShapedUrl: allow,
      })
      const text = JSON.stringify(report)
      for (const secret of [
        PROD_SHAPED_SCREEN_URL,
        PROJECTION_API_KEY,
        'senha-secreta',
        'outra-senha',
        'postgresql://',
        'API-Key',
      ]) {
        expect(text, `vazou "${secret}" com allow=${String(allow)}`).not.toContain(secret)
      }
      // Controle positivo: o relatorio continua util — nomes de variavel e de
      // check aparecem, so os VALORES e que nao.
      expect(text).toContain('config')
    }
  })
})

/* ------------------------------------------------------------------ */
/* O entrypoint precisa REPASSAR a decisao                             */
/* ------------------------------------------------------------------ */

describe('o entrypoint repassa a mesma autorizacao ao readiness', () => {
  const source = readFileSync(path.join(repoRoot, WORKER_ENTRY), 'utf8')

  /**
   * Por que teste de FONTE e nao de execucao: `bin/project-editorial.ts` chama
   * `main()` no import — nenhuma suite consegue importa-lo sem subir o worker.
   * O bug vivia justamente nesse ponto cego (mesma licao do
   * `editorial-worker-boundary.test.ts`, que reprova import de valor no
   * entrypoint lendo o arquivo).
   */
  it('a flag e lida UMA vez, em uma constante', () => {
    expect(source).toMatch(
      /const\s+allowProductionShapedUrl\s*=\s*args\.has\(\s*'--allow-production-url'\s*\)/,
    )
    // Reler `args.has(...)` em cada ponto e como as duas leituras divergiram.
    const readings = source.match(/args\.has\(\s*'--allow-production-url'\s*\)/g) ?? []
    expect(readings.length).toBe(1)
  })

  it('a MESMA constante alimenta a config e o readiness', () => {
    const configCall = /resolveProjectionWorkerConfig\([\s\S]{0,200}?\)/.exec(source)?.[0] ?? ''
    const readinessCall = /collectWorkerReadiness\([\s\S]{0,200}?\)/.exec(source)?.[0] ?? ''

    expect(configCall).toContain('allowProductionShapedUrl')
    expect(
      readinessCall,
      'o /readyz voltaria a validar sem a autorizacao usada na subida',
    ).toContain('allowProductionShapedUrl')
  })
})
