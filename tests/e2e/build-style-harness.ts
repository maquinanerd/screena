import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * globalSetup — gera o HTML do harness ANTES da suite.
 *
 * Roda o script real do app (`qa-default-styles-harness.tsx`), que importa os
 * componentes de verdade. Se ele falhar, a suite inteira falha aqui: harness
 * ausente nao pode virar "0 testes" e passar por verde.
 */
export const HARNESS_HTML = path.join(process.cwd(), 'apps/web/.qa-default-styles/index.html')

export default function globalSetup(): void {
  execFileSync(
    'corepack',
    [
      'pnpm',
      '--filter',
      '@screena/web',
      'run',
      // `run qa:default-styles`, e nao `exec tsx`: o script do package.json ja
      // carrega `scripts/tsconfig.json` (jsx: react-jsx). Sem esse tsconfig o
      // `tsx` emite o transform classico e todo componente do App Router morre
      // com "React is not defined" — que parece bug do componente e e so o
      // runner mal configurado.
      'qa:default-styles',
    ],
    { cwd: process.cwd(), stdio: 'inherit', shell: process.platform === 'win32' },
  )
  if (!existsSync(HARNESS_HTML)) {
    throw new Error(`harness nao foi gerado em ${HARNESS_HTML}`)
  }
}
