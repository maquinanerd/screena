/**
 * readiness-collector.ts — Coleta os fatos que a readiness do CMS avalia.
 *
 * Separado de `readiness.ts` porque este arquivo faz IO (banco, storage,
 * Payload) e aquele precisa continuar puro para ser testavel sem infraestrutura.
 * Aqui so se COLETA; quem decide e o nucleo.
 *
 * Toda coleta e defensiva: qualquer falha vira um fato negativo, nunca uma
 * excecao. Um readiness que estoura em vez de responder 503 tira o servico do ar
 * sem dizer por que.
 */

import { getPayload } from 'payload'

import { getMediaSource } from './media-source-runtime.js'
import { validateCmsConfig } from './env.js'
import { evaluateAutoPublishReadiness } from './env-auto-publish.js'
import {
  describeUploadConfig,
  resolvePayloadUploadConfig,
} from './upload-storage-config.js'
import type { CmsReadinessInput } from './readiness.js'

/** Nome do arquivo de teste do storage. Escrito e apagado na mesma checagem. */
const STORAGE_PROBE_PREFIX = '.cinerie-readiness-probe'

/**
 * Migrations pendentes.
 *
 * Compara as migrations DECLARADAS no repositorio com as APLICADAS na tabela
 * `payload_migrations`. E a mesma fonte que o CLI do Payload usa, entao
 * readiness e `migrate:status` nunca discordam.
 *
 * `null` quando nao conseguimos determinar — e o nucleo trata "desconhecido"
 * como BLOQUEIO, nao como "provavelmente ok". Servir com schema antigo produz
 * erro de coluna inexistente no meio de uma edicao.
 */
async function countPendingMigrations(payload: {
  readonly db?: { pool?: { query?: (sql: string) => Promise<{ rows?: { name?: unknown }[] }> } }
}): Promise<number | null> {
  try {
    const query = payload.db?.pool?.query
    const pool = payload.db?.pool
    if (query === undefined || pool === undefined) return null

    const { migrations: declared } = await import('./migrations/index.js')
    if (!Array.isArray(declared) || declared.length === 0) return null

    const result = await query.call(pool, 'SELECT name FROM payload_migrations')
    const applied = new Set(
      (result.rows ?? []).map((row) => String(row.name ?? '')).filter((name) => name !== ''),
    )
    return declared.filter((migration) => !applied.has(String(migration.name))).length
  } catch {
    return null
  }
}

export async function collectCmsReadinessFacts(
  env: Record<string, string | undefined> = process.env,
): Promise<CmsReadinessInput> {
  const isProduction = (env.NODE_ENV ?? '').trim() === 'production'

  const configResult = validateCmsConfig(env)
  const uploadResult = resolvePayloadUploadConfig(env)
  const configValid = configResult.ok && uploadResult.ok
  // Os erros do CMS sao objetos com `code`; os de storage sao strings. Aqui os
  // dois viram texto CURTO — e sempre o codigo/nome da variavel, nunca o valor.
  const configErrors: string[] = [
    ...(configResult.ok ? [] : configResult.errors.map((error) => error.code)),
    ...(uploadResult.ok ? [] : uploadResult.errors),
  ]

  // Configuracao invalida NAO tenta conectar em nada: sem ela, uma tentativa de
  // conexao so produziria um segundo erro derivado, escondendo a causa real.
  if (!configValid) {
    return {
      configValid: false,
      configErrors,
      databaseReachable: false,
      pendingMigrations: null,
      storageReady: false,
      storageDriver: 'desconhecido',
      storagePersistent: false,
      collectionCount: 0,
      isProduction,
      autoPublish: evaluateAutoPublishReadiness(env),
    }
  }

  let databaseReachable = false
  let pendingMigrations: number | null = null
  let collectionCount = 0
  try {
    // Import DINAMICO do config. `payload.config.ts` valida a configuracao de
    // RUNTIME ao ser importado (e deve mesmo — falhar cedo e o ponto). Importa-lo
    // no topo faria o `next build` exigir storage e banco reais so para coletar
    // os dados desta rota: o build passaria a depender do ambiente de producao,
    // que e exatamente o furo que o Dockerfile do screen-app documenta ter
    // fechado. A rota e `force-dynamic`; o custo do import so existe em runtime.
    const { default: config } = await import('./payload.config.js')
    const payload = await getPayload({ config })
    collectionCount = Object.keys(payload.collections).length
    // Consulta trivial numa collection real: prova conexao E schema minimo,
    // sem depender de SQL bruto que o adapter poderia nao expor.
    await payload.count({ collection: 'service-accounts', overrideAccess: true })
    databaseReachable = true
    pendingMigrations = await countPendingMigrations(payload as never)
  } catch {
    databaseReachable = false
  }

  const describe = uploadResult.ok
    ? describeUploadConfig(uploadResult.config)
    : { driver: 'desconhecido', persistent: false }

  // Storage: verificar que a porta EXISTE e responde. Nao escrevemos arquivo
  // aqui — um readiness chamado a cada 10s que grava e apaga no bucket vira
  // custo e ruido de auditoria. A escrita real e exercitada pelo preflight.
  let storageReady = false
  try {
    const source = getMediaSource(env)
    if (source !== null) {
      // `exists` de um nome que nao existe: prova que o driver responde sem
      // depender de nenhum arquivo especifico estar la.
      await source.exists(`${STORAGE_PROBE_PREFIX}-inexistente`)
      storageReady = true
    }
  } catch {
    storageReady = false
  }

  return {
    configValid: true,
    configErrors: [],
    databaseReachable,
    pendingMigrations,
    storageReady,
    storageDriver: describe.driver,
    storagePersistent: describe.persistent,
    collectionCount,
    isProduction,
    autoPublish: evaluateAutoPublishReadiness(env),
  }
}
