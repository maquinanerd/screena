/**
 * Teste estrutural do adapter Prisma de claim da fila de catalogo.
 *
 * `catalog-job-store.ts` usa SQL raw, que nenhum tipo confere. Sem um Postgres
 * de integracao nos testes unitarios, travamos aqui as propriedades criticas do
 * SQL de claim e de enqueue. Claim: usa `FOR UPDATE SKIP LOCKED` (concorrencia-segura), so
 * reivindica estados claimaveis (pending/retry_wait) que ja passaram de
 * `available_at`, e ordena por prioridade ASC (menor = mais prioritario). A
 * garantia de concorrencia real e provada no validador dedicado (Postgres 16).
 */

import { describe, expect, it } from 'vitest'
import { readSourceWithoutComments } from '../../../../../tests/support/source-text.js'

// PORTA UNICA de leitura de fonte: o conteudo chega SEM comentarios. Este guard
// procura CODIGO, e a prosa do arquivo auditado nao pode nem satisfazer nem
// quebrar uma asserta — foi exatamente o que aconteceu ao adicionar o check do
// enqueue: o comentario que EXPLICA o `P2002` antigo casava com a regex que
// exigia a ausencia dele.
const source = readSourceWithoutComments(
  'services/ingestion/src/persistence/catalog-job-store.ts',
)

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

/**
 * O enqueue nao pode pagar a idempotencia com uma EXCECAO.
 *
 * Ate 2026-08-27 este adapter obtinha idempotencia com `create` + catch de
 * P2002: o Postgres so conseguia contar que a chave existia ABORTANDO a
 * transacao implicita, e cada aborto escrevia `ERROR: duplicate key value
 * violates unique constraint "catalog_jobs_idempotency_key_key"` no log do
 * servidor. Como reenfileirar a mesma dependencia e o caminho NORMAL (todo
 * `sync_details` recoberto reenfileira o seu `sync_media`, cuja chave nao tem
 * escopo), o log de producao enchia de ERROR para descrever sucesso.
 *
 * Estes checks travam a forma. O DESFECHO (nenhuma linha no log, nenhum
 * `xact_rollback`) e provado contra Postgres real no controle negativo de
 * `scripts/validate-catalog-platform-real-postgres.ts` — um guard textual so
 * pega a grafia, entao ele nao substitui aquele.
 */
describe('catalog-job-store enqueue SQL', () => {
  it('obtem idempotencia com ON CONFLICT DO NOTHING, nao com excecao', () => {
    expect(source).toMatch(/ON CONFLICT \(idempotency_key\) DO NOTHING/)
    expect(source).toMatch(/RETURNING id/)
  })

  it('nao ha mais captura de violacao de unique (o caminho que gerava o ERROR)', () => {
    expect(source).not.toMatch(/isUniqueViolation/)
    expect(source).not.toMatch(/P2002/)
  })

  it('DO NOTHING e nao DO UPDATE: o noop nao pode reescrever a linha vencedora', () => {
    expect(source).not.toMatch(/ON CONFLICT[^\n]*DO UPDATE/)
  })

  it('preenche updated_at explicitamente (NOT NULL sem default no banco)', () => {
    // `@updatedAt` do Prisma e do lado da aplicacao: um INSERT cru que o
    // omitisse falharia com not-null violation em TODO enfileiramento.
    expect(source).toMatch(/updated_at/)
    expect(source).toMatch(/\$\{updatedAt\}::timestamptz AT TIME ZONE 'UTC'/)
  })
})
