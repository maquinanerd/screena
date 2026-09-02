/**
 * ensure-prisma-client.mjs — Preflight de quem depende do Prisma Client GERADO.
 *
 * O `tsc -p tsconfig.runtime.json` compila `persistence/**` e os bins, e a
 * SUITE importa `@screena/db` em centenas de arquivos — as duas regioes
 * dependem do client gerado. Sem `db:generate`, as duas morrem com uma parede
 * de "Cannot find module '@prisma/client'" que nao diz o que fazer. Este
 * preflight troca a parede por UMA linha acionavel.
 *
 * ============================================================================
 * POR QUE ELE PASSOU A GUARDAR TAMBEM O `pnpm test`
 * ============================================================================
 * Ate 2026-09-02 so o `typecheck:catalog-runtime` o chamava. Num checkout
 * limpo, `pnpm test` falhava ANTES de rodar um teste — e o modo de falha e o
 * pior possivel: erro de COLETA parece "0 testes" ou parece bug do codigo, e
 * nao "falta um passo de setup". Uma suite que nao coleta nao reprova nada;
 * ela some.
 *
 * O rotulo do prefixo vem do argv para que a mensagem diga qual comando parou.
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
  const generatedEntry = path.join(
    path.dirname(clientPkg),
    '..',
    '..',
    '.prisma',
    'client',
    'client.js',
  )
  generated = existsSync(generatedEntry)
} catch {
  generated = false
}

if (!generated) {
  // `typecheck` continua sendo o default: e o chamador historico, e manter o
  // rotulo evita mudar a saida de quem ja depende dela.
  const label = process.argv[2] ?? 'typecheck'
  console.error(
    `[${label}] Prisma Client ainda nao foi gerado — este comando depende dele.\n` +
      `[${label}] Rode antes:  corepack pnpm --filter @screena/db db:generate`,
  )
  process.exit(1)
}
