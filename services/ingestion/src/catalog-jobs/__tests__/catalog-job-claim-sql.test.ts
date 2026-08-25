/**
 * Teste estrutural do adapter Prisma de claim da fila de catalogo.
 *
 * `catalog-job-store.ts` usa SQL raw, que nenhum tipo confere. Sem um Postgres
 * de integracao nos testes unitarios, travamos aqui as propriedades criticas do
 * SQL de claim: usa `FOR UPDATE SKIP LOCKED` (concorrencia-segura), so
 * reivindica estados claimaveis (pending/retry_wait) que ja passaram de
 * `available_at`, e ordena por prioridade ASC (menor = mais prioritario). A
 * garantia de concorrencia real e provada no validador dedicado (Postgres 16).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourcePath = fileURLToPath(new URL('../../persistence/catalog-job-store.ts', import.meta.url))
const source = readFileSync(sourcePath, 'utf8')

describe('catalog-job-store claim SQL', () => {
  it('reivindica com FOR UPDATE SKIP LOCKED (dois workers nunca pegam o mesmo job)', () => {
    expect(source).toMatch(/FOR UPDATE SKIP LOCKED/)
  })

  it('so reivindica estados claimaveis (pending/retry_wait) elegiveis por available_at', () => {
    expect(source).toMatch(/status::text IN \('pending', 'retry_wait'\)/)
    expect(source).toMatch(/available_at <= \$\{atIso\}::timestamptz AT TIME ZONE 'UTC'/)
  })

  it('ordena por prioridade ASC e depois available_at ASC (menor prioridade primeiro)', () => {
    expect(source).toMatch(/ORDER BY priority ASC, available_at ASC/)
  })

  it('reivindica um por vez (LIMIT 1) e incrementa attempts no claim', () => {
    expect(source).toMatch(/LIMIT 1/)
    expect(source).toMatch(/attempts:\s*\{\s*increment:\s*1\s*\}/)
  })
})
