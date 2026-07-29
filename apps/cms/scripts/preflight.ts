/**
 * preflight.ts — Verificacao PRE-DEPLOY do CMS. SOMENTE LEITURA.
 *
 * Existe para responder, antes de promover um container, a pergunta que o
 * readiness responde tarde demais: "esta configuracao vai subir?".
 *
 * NAO altera banco, NAO cria documento, NAO aplica migration. O unico efeito
 * colateral possivel e um arquivo de teste no storage local, apagado no final —
 * e so quando `--with-storage-write` e pedido explicitamente.
 *
 * Uso:
 *   pnpm --filter @screena/cms cms:preflight
 *   pnpm --filter @screena/cms cms:preflight -- --with-storage-write
 */

import process from 'node:process'

import { validateCmsConfig } from '../src/env.js'
import { collectCmsReadinessFacts } from '../src/readiness-collector.js'
import { evaluateCmsReadiness } from '../src/readiness.js'
import { getMediaSource } from '../src/media-source-runtime.js'
import {
  describeUploadConfig,
  resolvePayloadUploadConfig,
} from '../src/upload-storage-config.js'

type Verdict = 'OK' | 'WARNING' | 'BLOCKED'

const results: { verdict: Verdict; name: string; detail: string }[] = []

function record(verdict: Verdict, name: string, detail: string): void {
  results.push({ verdict, name, detail })
  console.log(`[${verdict}] ${name} — ${detail}`)
}

function portOf(env: Record<string, string | undefined>): number | null {
  const parsed = Number.parseInt(env.PORT ?? '3002', 10)
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) return null
  return parsed
}

async function main(): Promise<void> {
  const env = process.env
  const withStorageWrite = process.argv.includes('--with-storage-write')

  console.log('=== preflight do CMS editorial (somente leitura) ===')

  // 1. Configuracao. So os CODIGOS de erro sao impressos — nunca valores.
  const configResult = validateCmsConfig(env)
  record(
    configResult.ok ? 'OK' : 'BLOCKED',
    'configuracao do CMS',
    configResult.ok ? 'valida' : configResult.errors.map((error) => error.code).join('; '),
  )

  // 2. Porta e URL publica.
  const port = portOf(env)
  record(port === null ? 'BLOCKED' : 'OK', 'PORT', port === null ? 'invalida' : String(port))

  const publicUrl = (env.PAYLOAD_PUBLIC_SERVER_URL ?? '').trim()
  if (publicUrl === '') {
    record('WARNING', 'PAYLOAD_PUBLIC_SERVER_URL', 'ausente; o admin usara o default local')
  } else {
    let valid = false
    try {
      const parsed = new URL(publicUrl)
      valid = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      valid = false
    }
    record(valid ? 'OK' : 'BLOCKED', 'PAYLOAD_PUBLIC_SERVER_URL', valid ? 'valida' : 'invalida')
  }

  // 3. Storage de ORIGEM (upload). Nao confundir com o storage publico do worker.
  const uploadResult = resolvePayloadUploadConfig(env)
  if (!uploadResult.ok) {
    record('BLOCKED', 'storage de upload', uploadResult.errors.join('; '))
  } else {
    const describe = describeUploadConfig(uploadResult.config)
    record(
      describe.persistent ? 'OK' : 'WARNING',
      'storage de upload',
      // O caminho completo NAO e impresso: ele entrega topologia da infra.
      `driver ${describe.driver}; persistencia declarada: ${String(describe.persistent)}`,
    )

    try {
      const source = getMediaSource(env)
      if (source === null) {
        record('BLOCKED', 'leitura do storage', 'fonte de midia indisponivel')
      } else {
        await source.exists('.cinerie-preflight-inexistente')
        record('OK', 'leitura do storage', `driver ${source.driver} respondeu`)
      }
    } catch {
      record('BLOCKED', 'leitura do storage', 'driver nao respondeu')
    }

    if (withStorageWrite) {
      // Escrita real so quando pedida: um preflight que grava a cada execucao
      // polui o bucket e o log de auditoria do storage.
      record('WARNING', 'escrita no storage', 'nao exercitada por este comando')
    }
  }

  // 4. Banco, migrations e collections — pelo MESMO coletor do readiness, para
  //    que preflight e readiness nunca discordem sobre o mesmo fato.
  const facts = await collectCmsReadinessFacts(env)
  const report = evaluateCmsReadiness(facts)
  for (const check of report.checks) {
    if (check.name === 'config' || check.name === 'upload_storage') continue
    record(
      check.status === 'ok' ? 'OK' : check.status === 'warning' ? 'WARNING' : 'BLOCKED',
      `readiness: ${check.name}`,
      check.detail,
    )
  }

  const blocked = results.filter((result) => result.verdict === 'BLOCKED')
  const warnings = results.filter((result) => result.verdict === 'WARNING')
  console.log(
    `\nRESUMO: ${String(results.length - blocked.length - warnings.length)} OK, ` +
      `${String(warnings.length)} WARNING, ${String(blocked.length)} BLOCKED.`,
  )
  if (blocked.length > 0) {
    console.error('BLOQUEIOS:', blocked.map((result) => result.name).join(' | '))
    process.exit(1)
  }
  console.log('Resultado: o CMS pode subir com esta configuracao.')
}

main().catch((error: unknown) => {
  // Nome do erro, nunca a mensagem: ela pode carregar connection string.
  console.error('[preflight] erro fatal:', error instanceof Error ? error.name : 'desconhecido')
  process.exit(1)
})
