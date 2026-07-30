/**
 * state.ts — Ponte entre o `globalSetup` do Playwright e os specs.
 *
 * O `globalSetup` roda num processo e os workers noutro: variavel de ambiente
 * definida la NAO chega aqui. O estado (URL sorteada, credencial temporaria,
 * ids de fixture) viaja por um arquivo em diretorio temporario, cujo caminho e
 * a UNICA coisa passada por env — e o arquivo e apagado no teardown.
 *
 * Nada disso e segredo de producao: usuario, senha e banco existem so enquanto
 * a suite roda.
 */

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export const STATE_FILE = path.join(tmpdir(), 'cinerie-cms-e2e-state.json')

export interface E2EState {
  readonly baseUrl: string
  readonly admin: { readonly email: string; readonly password: string; readonly id: number }
  readonly mediaFixturePath: string
}

export function readState(): E2EState {
  const raw = readFileSync(process.env.CMS_E2E_STATE ?? STATE_FILE, 'utf8')
  return JSON.parse(raw) as E2EState
}
