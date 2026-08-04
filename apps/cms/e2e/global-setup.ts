/**
 * global-setup.ts — Sobe o CMS REAL para o E2E do painel.
 *
 * Reusa o MESMO harness dos testes de integracao (`src/__tests__/harness.ts`):
 * `next build` + `next start` em modo producao sobre PostgreSQL 16 efemero,
 * migrations REAIS pelo CLI real. Um E2E que subisse o CMS por outro caminho
 * provaria outro CMS.
 *
 * O que este setup NAO faz, e a recusa e explicita:
 *  - nao configura nada do MNScr (nenhuma `MNSCR_*`, nenhuma API key, nenhuma
 *    conta `editorial_auto_publish`);
 *  - nao liga a autopublicacao;
 *  - nao usa bucket, banco ou credencial de producao.
 *
 * Se alguma variavel de automacao estiver no ambiente, o setup ABORTA: um E2E
 * que rodasse com a autopublicacao ligada nao provaria independencia nenhuma.
 */

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { startCmsHarness } from '../src/__tests__/harness.js'
import { STATE_FILE, type E2EState } from './state.js'

/** Bytes de um JPEG minimo VALIDO (cabecalho real, nao extensao de arquivo). */
function jpegBytes(): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    ...Array.from('JFIF', (char) => char.charCodeAt(0)), 0,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ])
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // GUARDA DE INDEPENDENCIA. Fail-closed: qualquer sinal de automacao no
  // ambiente derruba a suite antes de subir nada.
  const forbidden = Object.keys(process.env).filter(
    (key) => key.startsWith('MNSCR_') || key.startsWith('EDITORIAL_AUTO_PUBLISH_'),
  )
  if (forbidden.length > 0) {
    throw new Error(
      `E2E manual nao roda com automacao configurada; variaveis presentes: ${forbidden.join(', ')}`,
    )
  }
  // Explicito, e nao herdado: a autopublicacao fica DESLIGADA.
  process.env.EDITORIAL_AUTO_PUBLISH_ENABLED = 'false'

  const harness = await startCmsHarness()

  // A partir daqui o CMS esta DE PE. Qualquer falha na montagem das fixtures
  // precisa derruba-lo antes de subir: sem isto, o `return` com o teardown nunca
  // acontece, e o PostgreSQL efemero so morre pelo gancho de saida do
  // `embedded-postgres` — um `pg_ctl stop -m fast` que atinge o pool aberto do
  // Payload e chega ao relatorio como `57P01` nao tratado, escondendo o erro
  // real por tras de um sintoma de banco.
  let fixtureDir: string | null = null
  try {
    const email = `admin.e2e@cinerie.test`
    const password = `senha-e2e-${randomUUID()}`
    const admin = await harness.payload.create({
      collection: 'editorial-users',
      data: {
        email,
        password,
        displayName: 'Administradora E2E',
        role: 'administrator',
        active: true,
      } as never,
      overrideAccess: true,
    })

    // Arquivo de imagem para o upload PELO PAINEL. O teste sobe este arquivo pelo
    // seletor real de `input[type=file]`, nao pela Local API.
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'cinerie-e2e-fixture-'))
    const mediaFixturePath = path.join(fixtureDir, 'capa-e2e.jpg')
    writeFileSync(mediaFixturePath, jpegBytes())

    const state: E2EState = {
      baseUrl: harness.baseUrl,
      admin: { email, password, id: Number(admin.id) },
      mediaFixturePath,
    }
    const stateFile = process.env.CMS_E2E_STATE ?? STATE_FILE
    writeFileSync(stateFile, JSON.stringify(state), 'utf8')

    return buildTeardown(harness, stateFile, fixtureDir)
  } catch (error) {
    try {
      if (fixtureDir !== null) rmSync(fixtureDir, { recursive: true, force: true })
    } catch {
      /* diretorio temporario: nao pode impedir derrubar o CMS */
    }
    await harness.stop()
    throw error
  }
}

function buildTeardown(
  harness: Awaited<ReturnType<typeof startCmsHarness>>,
  stateFile: string,
  fixtureDir: string,
): () => Promise<void> {
  return async () => {
    try {
      rmSync(stateFile, { force: true })
      rmSync(fixtureDir, { recursive: true, force: true })
    } catch {
      /* diretorio temporario: falhar aqui nao pode impedir derrubar o CMS */
    }
    await harness.stop()
  }
}
