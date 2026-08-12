/**
 * ensure-prisma-client.mjs — Preflight do typecheck de runtime.
 *
 * O `tsc -p tsconfig.runtime.json` compila `persistence/**` e os bins — regiao
 * que importa o Prisma Client GERADO. Sem `db:generate`, o tsc morre com uma
 * parede de "Cannot find module '@prisma/client'" que nao diz o que fazer.
 * Este preflight troca a parede por UMA linha acionavel.
 *
 * Sai 0 quando o client gerado existe; sai 1 com instrucao quando nao.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `@prisma/client` e dependencia de packages/db, nao da raiz — no node_modules
// estrito do pnpm ele so resolve a partir de la.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const requireFromDb = createRequire(path.join(repoRoot, 'packages', 'db', 'package.json'))

let generated = false
try {
  // O client gerado materializa `.prisma/client` ao lado do runtime instalado:
  // <...>/node_modules/@prisma/client/package.json -> <...>/node_modules/.prisma/client
  const clientPkg = requireFromDb.resolve('@prisma/client/package.json')
  const generatedEntry = path.join(path.dirname(clientPkg), '..', '..', '.prisma', 'client', 'client.js')
  generated = existsSync(generatedEntry)
} catch {
  generated = false
}

if (!generated) {
  console.error(
    '[typecheck] Prisma Client ainda nao foi gerado — o typecheck de runtime (persistence/, bin/) depende dele.\n' +
      '[typecheck] Rode antes:  corepack pnpm --filter @screena/db db:generate',
  )
  process.exit(1)
}
