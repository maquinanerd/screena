/**
 * Fixture de `run-script-signal.test.ts`: uma CLI filha com o laco de eventos
 * OCUPADO no instante do SIGTERM — como um lote no meio de trabalho sincrono.
 *
 * Ela cria `<pid>-<ppid>.pronta` no diretorio do argumento 2 (o sinal de
 * "pronta", com os dois numeros no NOME), ocupa o laco por `BUSY_MS` sem devolver
 * o controle e so entao olha se o ouvinte viu o SIGTERM. Nesse intervalo nenhum
 * ouvinte de sinal roda — e e exatamente o intervalo em que a CLI `tsx` desiste
 * de esperar e manda SIGKILL.
 */

import { writeFileSync } from 'node:fs'
import path from 'node:path'

const BUSY_MS = 2_000

const readyDir = process.argv[2]
if (readyDir === undefined) {
  process.stderr.write('uso: busy-until-sigterm.ts <diretorio-de-pronta>\n')
  process.exit(2)
}

let sigterm = false
process.on('SIGTERM', () => {
  sigterm = true
})

writeFileSync(path.join(readyDir, `${String(process.pid)}-${String(process.ppid)}.pronta`), '')

const until = Date.now() + BUSY_MS
while (Date.now() < until) {
  // ocupado de proposito
}

// Devolve o controle: se o SIGTERM chegou, o ouvinte roda agora.
setTimeout(() => {
  process.stdout.write(sigterm ? 'DRENOU\n' : 'SEM SINAL\n')
  process.exitCode = sigterm ? 0 : 3
}, 100)
