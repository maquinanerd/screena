/**
 * playwright.config.ts — E2E do painel `/admin` REAL do CMS editorial.
 *
 * O alvo e o CMS que uma redacao usa: Next em modo producao, Payload real,
 * PostgreSQL 16 EFEMERO, storage local temporario. Nada aqui toca MNScr,
 * EasyPanel, bucket real ou banco de producao — e o `globalSetup` recusa subir
 * se alguma variavel de automacao estiver presente.
 *
 * O servidor e o banco sao levantados no `globalSetup` (mesmo processo que
 * executa o teardown devolvido por ele), e os testes recebem a URL e as
 * credenciais por um arquivo de estado em diretorio temporario — nunca por
 * segredo commitado.
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Um unico worker: o CMS e o Postgres sao unicos e compartilhados, e dois
  // navegadores editando a mesma materia provariam concorrencia, nao o fluxo.
  workers: 1,
  fullyParallel: false,
  // `next build` + `initdb` acontecem no setup; o teste em si e rapido.
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Sem retry: um E2E que so passa na segunda tentativa esta escondendo corrida.
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    // Sem `baseURL` de proposito: a porta e sorteada no `globalSetup`, que roda
    // em OUTRO processo — o worker nao herdaria a variavel de ambiente. O spec
    // le a URL do arquivo de estado e navega com endereco absoluto.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
})
