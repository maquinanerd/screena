-- api_providers: a linha que faltava para a fila `discovery` conseguir se registrar.
--
-- O DEFEITO QUE ESTA MIGRATION FECHA
-- ---------------------------------------------------------------------------
-- `api_sync_logs.provider_api` e `api_cache.provider_api` tem FK para
-- `api_providers.key`. A fila `discovery` do agendador grava com o literal
-- 'tmdb-exports' (services/sync/src/scheduler/rhythms.ts), e essa chave nunca
-- existiu no registro de fornecedores: o INSERT do registro de execucao morria
-- em api_sync_logs_provider_api_fkey em TODA execucao, desde que o agendador
-- nasceu. Consequencia visivel: `readLastRuns` nunca encontrava
-- 'scheduler/discovery', a fila reportava NUNCA RODOU no painel e voltava a
-- vencer em todo tick -- enquanto o trabalho de fato rodava.
--
-- POR QUE MIGRATION, E NAO SO SEED
-- ---------------------------------------------------------------------------
-- O release de producao roda `prisma migrate deploy` (Dockerfile) e NAO roda
-- `db:seed`. Acrescentar a linha apenas em API_PROVIDER_SEED conserta banco
-- novo e deixa producao exatamente como esta. Esta migration nao altera schema:
-- e dado de registro, idempotente, e a unica forma de a linha chegar ao banco
-- que ja existe.
--
-- Os valores espelham API_PROVIDER_SEED (packages/db/src/seed-data.ts). `kind`
-- e 'data' porque os exports entregam identificadores de entidade (metadado
-- estrutural), nao nota nem disponibilidade. O fornecedor e SEPARADO de 'tmdb'
-- de proposito: arquivos publicos em files.tmdb.org, sem token e fora da cota
-- da API (TMDB_EXPORTS_QUOTA em @screena/config).

INSERT INTO "api_providers" ("key", "name", "kind", "homepage_url")
VALUES ('tmdb-exports', 'TMDB Daily ID Exports', 'data', 'https://files.tmdb.org/p/exports')
ON CONFLICT ("key") DO NOTHING;
