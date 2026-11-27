import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Coluna que o Payload 3.90 passou a exigir em toda colecao de auth.
 *
 * A subida de 3.86.0 para 3.94.2 (correcao dos criticos de 2026-10
 * GHSA-v49j-62m6-pgrr, GHSA-vc4h-q48j-5hcx, GHSA-f7hx-52q9-hcrf e
 * GHSA-66wr-7vmr-p5jq, e do alto GHSA-97rh-rhh2-7vjv) trouxe o campo
 * `resetPasswordRequestedAt`: o "esqueci a senha" agora tem limite de
 * frequencia, e a troca de senha limpa o bloqueio por tentativas. Sem a coluna,
 * login e reset de senha de `editorial-users` quebram em runtime.
 *
 * `service-accounts` nao ganha a coluna: tem `disableLocalStrategy` (sem senha).
 * O `_objectKey` das notas da 3.90 so existe com `clientUploads`, que o CMS nao
 * usa. Gerada com `payload:migrate:create` contra PostgreSQL efemero; o diff
 * vem do snapshot `.json` anterior, nao de um banco real. Registro em
 * `docs/operations/seguranca-rce-2026-11.md`.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "editorial_users" ADD COLUMN "reset_password_requested_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "editorial_users" DROP COLUMN "reset_password_requested_at";`)
}
