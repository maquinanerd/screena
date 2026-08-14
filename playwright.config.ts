import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright da raiz — hoje so os testes de ESTILO COMPUTADO do site publico
 * (`tests/e2e`). Eles precisam de uma engine de verdade porque medem o que a
 * folha de UA do navegador faz com elementos sem reset; jsdom nao tem folha de
 * UA e aprovaria o defeito.
 *
 * O CMS tem o seu proprio `apps/cms/playwright.config.ts` (fluxo autenticado,
 * sobe Payload). Os dois nao se misturam: `testDir` aqui e so `tests/e2e`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // O harness monta o HTML uma vez, com componentes reais + globals.css real.
  globalSetup: './tests/e2e/build-style-harness.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    // As paginas medidas sao `file://` geradas pelo globalSetup — sem baseURL,
    // sem servidor, sem banco. Medir estilo nao exige subir o app.
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
