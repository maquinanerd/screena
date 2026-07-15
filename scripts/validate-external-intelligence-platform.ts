/** Validador integrado F9--F11; nenhum passo usa rede ou credenciais reais. */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

interface Step { readonly name: string; readonly args: readonly string[] }
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pnpmEntrypoint = process.env.npm_execpath
if (pnpmEntrypoint === undefined) throw new Error('npm_execpath ausente; execute este validador via pnpm.')
const steps: readonly Step[] = [
  { name: 'F9 streaming: client, mapper, worker, review e store PostgreSQL', args: ['test', '--', 'api-clients/streaming_availability/src/__tests__', 'services/streaming/src/__tests__'] },
  { name: 'F10 ratings: client, mapping, gates, raw capture e idempotencia', args: ['test', '--', 'api-clients/film_show_ratings/src/__tests__', 'services/ratings/src/__tests__'] },
  { name: 'F11 Gemini: schema estruturado, grounding, retries e jobs PostgreSQL', args: ['test', '--', 'services/entity-writer/src/__tests__'] },
  { name: 'F9 store real PostgreSQL 16', args: ['--filter', '@screena/streaming', 'validate:stores'] },
  { name: 'F11 Entity Writer real PostgreSQL 16 com FakeGeminiPort', args: ['--filter', '@screena/entity-writer', 'validate:real'] },
  { name: 'Registro api:coverage e pureza de render', args: ['api:coverage'] },
  { name: 'Auditoria zero provider/Gemini no render', args: ['audit:render'] },
]

for (const step of steps) {
  console.log(`\n=== ${step.name} ===`)
  const result = spawnSync(process.execPath, [pnpmEntrypoint, ...step.args], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1
    console.error(`\nFalhou: ${step.name}`)
    break
  }
}
if (process.exitCode === undefined) console.log('\nPASSOU: plataforma externa e de inteligencia validada sem rede.')
