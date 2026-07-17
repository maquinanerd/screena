# Runbook — Deploy de producao da Cinerie

> Runbook operacional. Escrito apos o incidente de 2026-07-16 (migration de data
> governance falhou em producao e a flag de indexacao nao tinha efeito).
> Complementa `docs/EASYPANEL_DEPLOY.md` (procedimento da plataforma) e
> `scripts/deploy/README.md` (politica de release).

## 1. Pre-requisito obrigatorio: pgcrypto

A migration `20260715120000_data_governance_hardening` cria duas funcoes
`IMMUTABLE` que chamam `public.digest(..., 'sha256'::text)` — o SHA-256 do
**pgcrypto**. Sem a extensao, a migration **nao aplica** e o deploy para.

**Rode isto UMA VEZ por banco, no container do PostgreSQL** (ou via cliente
administrativo), como superuser/owner:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
```

O `WITH SCHEMA public` **nao e cosmetico**: a migration chama `public.digest`
explicitamente. Se a extensao existir em outro schema (ex.: `extensions`, comum
em Postgres gerenciado), `public.digest` nao existe e a migration falha pelo
motivo oposto ao do incidente original.

`CREATE EXTENSION IF NOT EXISTS` e no-op **global**, nao por schema: se pgcrypto
ja existir em outro schema, o comando **nao a move**. Confira antes:

```sql
SELECT e.extname, n.nspname AS schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
 WHERE e.extname = 'pgcrypto';
```

Esperado: `pgcrypto | public`. Se vier outro schema, decida com um DBA
(`ALTER EXTENSION pgcrypto SET SCHEMA public;` move, mas quebra objetos que
referenciem o schema antigo).

> **Onde cada comando roda.** O `CREATE EXTENSION` e a verificacao acima sao os
> UNICOS passos executados no **container do PostgreSQL** (ou em um cliente
> administrativo). Todo o resto — `migrate deploy`, `migrate status` — roda no
> **container do app**, que e quem tem o CLI do Prisma e o diretorio de
> migrations.

## 2. Aplicar migrations (no container do APP)

```sh
pnpm --filter @screena/db exec prisma migrate deploy
pnpm --filter @screena/db exec prisma migrate status
```

`migrate status` deve terminar com **"Database schema is up to date!"**.

**Nunca** use, em nenhum ambiente com dado real:

| Comando | Por que nao |
| --- | --- |
| `prisma db push` | Sincroniza o schema sem migration e sem historico: pode **dropar coluna/tabela** silenciosamente. Nao existe em nenhum script de deploy deste repo — e nao deve passar a existir. |
| `prisma migrate dev` | E comando de desenvolvimento: cria migration, pode pedir reset e **apaga o banco**. |
| `prisma migrate reset` | **Destroi todos os dados**. |

O `CMD` da imagem ja roda `migrate deploy` antes do `next start` e **aborta sem
subir o app** se a migration falhar.

## 3. Envs publicas (100% runtime)

A imagem **nao assa** nenhuma env publica. Configure no EasyPanel:

| Env | Valor em producao | Efeito |
| --- | --- | --- |
| `CINERIE_PUBLIC_SITE_URL` | `https://cinerie.com` | Origem canonica (canonical, JSON-LD, sitemap). |
| `CINERIE_PUBLIC_INDEXING_ENABLED` | `true` ou `false` | **Kill switch de indexacao.** |
| `NODE_ENV` | `production` | Exigido para indexar. |
| `DATABASE_URL` | (segredo) | Postgres. |

**Parser da flag** (`parseBooleanEnvFlag`, fail-closed):

| Valor | Resultado |
| --- | --- |
| `true`, `1` (qualquer caixa, com espacos) | **liga** |
| `false`, `0`, vazio, ausente, invalido (`yes`, `on`, `sim`...) | **desliga** |

**Precedencia:** `CINERIE_PUBLIC_INDEXING_ENABLED` → `THE_SCREEN_PUBLIC_INDEXING_ENABLED`
(legado) → `false`. Se o nome novo estiver **definido**, ele decide sozinho —
inclusive vazio (resolve `false`), sem cair no legado.

Desligar a indexacao **nao exige rebuild**: `/robots.txt` e as paginas sao
dinamicos e leem a env a cada request. Basta alterar a env e reiniciar o
container.

## 4. Verificar que a indexacao esta como voce quer

```sh
# Com CINERIE_PUBLIC_INDEXING_ENABLED=false:
curl -s https://cinerie.com/robots.txt
#   User-Agent: *
#   Disallow: /
#   (sem linha Sitemap:)

curl -s https://cinerie.com/pt/ | grep -i '<meta name="robots"'
#   <meta name="robots" content="noindex, nofollow"/>
```

Com `=true`, o `robots.txt` volta a liberar `/` e anunciar o sitemap, e cada
pagina passa a refletir a **decisao da entidade** (`page_indexability_decisions`).
A flag global **nunca** torna uma entidade indexavel: ela so derruba.

## 5. Auditar o que realmente rodou no banco

`prisma migrate deploy` compara **nomes** de migration contra `_prisma_migrations`
— **nao valida checksum** (verificado empiricamente com Prisma 6.19.3: um arquivo
ja aplicado e reescrito ainda responde "No pending migrations to apply", exit 0;
so `migrate dev` reclama). Duas consequencias praticas:

1. Um arquivo de migration corrigido **depois** de aplicado **nao** e reaplicado
   em quem ja rodou. Corrigir o arquivo serve para os proximos ambientes
   (staging, restore, CI, banco novo) — nao para consertar o banco atual.
2. Um deploy **nao** avisa se o arquivo do Git divergir do que rodou.

Por isso, quando uma migration for corrigida na mao dentro do container, compare
o que esta VIVO no banco com o que esta no Git — o corpo da funcao, nao o
checksum:

```sql
SELECT proname, prosrc
  FROM pg_proc
 WHERE proname IN ('watch_offer_identity_key_v1', 'watch_offer_payload_fingerprint_v1');
```

O corpo precisa conter `public.digest(` nas duas funcoes. Estado da migration:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
  FROM _prisma_migrations
 ORDER BY started_at DESC
 LIMIT 10;
```

`finished_at IS NULL` com `rolled_back_at IS NULL` = migration **travada no meio**;
`migrate deploy` recusa a seguir (P3009) ate resolver com
`prisma migrate resolve --rolled-back <nome>` (decisao humana, com DBA).

## 6. Replicas

O Prisma serializa `migrate deploy` com advisory lock do Postgres
(`SELECT pg_advisory_lock(72707369)`), entao **N replicas nao corrompem** o
`_prisma_migrations` — as perdedoras esperam o lock.

O risco e **timeout**: numa migration longa, as replicas que esperam podem
estourar o lock timeout, falhar o migrate e entrar em crashloop (o `CMD` aborta
quando o migrate falha — de proposito).

**Decisao aplicada:** manter o `migrate deploy` no start, porque o servico roda
com **1 replica**. Ao escalar para N > 1, mover o migrate para um passo de
release unico (ou initContainer) e deixar o `CMD` do app so com `next start`.

## 7. Ordem de um release

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;` (uma vez por banco).
2. Backup (`scripts/backup/`) — ver `docs/` de backup; nunca migre sem backup.
3. Build da imagem (nao precisa de env publica).
4. Subir o container: o `CMD` roda `migrate deploy` e so entao `next start`.
5. `prisma migrate status` → "up to date".
6. Conferir `/robots.txt` e o `<meta robots>` (secao 4).

## 8. Validar antes de chegar em producao

```sh
corepack pnpm --filter @screena/db db:validate:pgcrypto   # pgcrypto + migration em PG real
corepack pnpm --filter @screena/db db:validate:real       # migration + seed em PG real
corepack pnpm --filter @screena/db db:validate:upgrade    # upgrade sobre estado pre-hardening
```

`db:validate:pgcrypto` sobe um Postgres efemero, aplica a migration e **reproduz
o incidente**: prova que `digest(...)` sem schema falha sob `search_path` hostil e
que `public.digest(...)` funciona. Tambem barra, de forma estatica, qualquer
`digest(` sem schema voltar ao arquivo.
