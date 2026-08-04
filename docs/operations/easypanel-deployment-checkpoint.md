# Checkpoint de implantação — CMS editorial e worker de projeção no EasyPanel

> **Nada foi implantado.** Este documento é um levantamento: inventário, variáveis,
> ordem e riscos. Nenhum serviço, banco, volume, bucket, credencial ou DNS foi
> criado ou consultado. O EasyPanel **não** foi acessado.
>
> Base: commit `7ca81da` (FASE 2G), descendente direto de `f4c49c4` (FASE 2F).
> Idioma: pt-BR. Sem segredos.

---

## 1. Os três marcos, e por que eles são independentes

| Marco | Entrega | Depende de |
| --- | --- | --- |
| **A — CMS manual** | redação escreve, revisa e **publica** | banco editorial, serviço Payload, storage de upload, migrations, 1 administrador |
| **B — publicação pública** | a matéria publicada **aparece no site** | migrations do screen-db, service account do worker, worker, storage público |
| **C — autopublicação** | matéria que nasce publicada | MNScr, conta `editorial_auto_publish`, kill switch, quotas |

**A implantação inicial é A + B.** C fica para depois e **não é pré-requisito**:
com `EDITORIAL_AUTO_PUBLISH_ENABLED=false` (ou ausente), o check `auto_publish`
do `/readyz` sai `ok` com detalhe "desabilitada". Kill switch desligado é estado
operacional conhecido, não avaria.

Parar no marco A é um estado **válido e útil**: o CMS publica e os eventos ficam
na `publication-outbox` esperando o worker. A matéria não aparece no site — e
isso é o comportamento correto, não uma falha.

---

## 2. Estado do repositório (verificado)

| Item | Valor |
| --- | --- |
| Caminho | `E:/screena-manual-editorial` (worktree) |
| Branch | `claude/cinerie-manual-editorial-readiness` |
| HEAD | `7ca81da6340e52e4b31f4ccd4230004f89f696ef` |
| Árvore | limpa antes desta fase (`git status --porcelain -uall` vazio) |
| `f4c49c4` é ancestral de HEAD | **sim** (`git merge-base --is-ancestor` confirmou) |
| Commits à frente de `origin/main` | 10 |
| Upstream da branch | **não existe** (`no upstream configured`) |
| Remoto | `origin` → `https://github.com/maquinanerd/screena.git` |
| Branch remota homônima | **não existe** |

Consequência operacional: **o commit está apenas local**. A etapa 7 da ordem de
implantação (publicar branch/commit no remoto) é obrigatória antes de qualquer
build no EasyPanel — o build puxa do Git, e hoje não há o que puxar.

Nenhum `fetch`, `push` ou `merge` foi executado.

---

## 3. Arquivos de implantação (caminhos verificados)

| Arquivo | Função |
| --- | --- |
| [`Dockerfile.cms`](../../Dockerfile.cms) | imagem do `cinerie-cms` (Payload + Next) |
| [`Dockerfile.publication-worker`](../../Dockerfile.publication-worker) | imagem do worker de projeção |
| [`Dockerfile`](../../Dockerfile) | imagem do `screen-app` (já existente) |
| [`apps/cms/scripts/preflight.ts`](../../apps/cms/scripts/preflight.ts) | preflight do CMS, somente leitura |
| [`services/news-ingestion/bin/worker-preflight.ts`](../../services/news-ingestion/bin/worker-preflight.ts) | preflight do worker, somente leitura |
| [`apps/cms/src/migrations/`](../../apps/cms/src/migrations/) | 9 migrations do Payload + `index.ts` |
| [`packages/db/prisma/migrations/`](../../packages/db/prisma/migrations/) | 16 migrations Prisma do screen-db |
| [`services/news-ingestion/bin/project-editorial.ts`](../../services/news-ingestion/bin/project-editorial.ts) | entrypoint do worker (`--loop`/`--once`) |
| [`apps/cms/app/healthz/route.ts`](../../apps/cms/app/healthz/route.ts) | liveness do CMS |
| [`apps/cms/app/readyz/route.ts`](../../apps/cms/app/readyz/route.ts) | readiness do CMS |
| [`services/news-ingestion/src/worker-health-server.ts`](../../services/news-ingestion/src/worker-health-server.ts) | `/healthz` e `/readyz` do worker |
| [`apps/cms/src/env.ts`](../../apps/cms/src/env.ts) | validador da config do CMS |
| [`apps/cms/src/upload-storage-config.ts`](../../apps/cms/src/upload-storage-config.ts) | storage de **origem** (uploads) |
| [`services/news-ingestion/src/media/storage-config.ts`](../../services/news-ingestion/src/media/storage-config.ts) | storage **público** editorial |
| [`services/news-ingestion/src/projection-worker-config.ts`](../../services/news-ingestion/src/projection-worker-config.ts) | config do worker |
| [`services/news-ingestion/src/worker-lifecycle.ts`](../../services/news-ingestion/src/worker-lifecycle.ts) | encerramento gracioso |
| [`docs/runbooks/EASYPANEL_EDITORIAL.md`](../runbooks/EASYPANEL_EDITORIAL.md) | runbook passo a passo |
| [`docs/operations/manual-editorial-workflow.md`](./manual-editorial-workflow.md) | operação diária da redação |

`.env.example` existe na raiz, mas **não pôde ser lido** nesta sessão (regra de
permissão bloqueia `.env*`). A tabela de variáveis abaixo foi derivada dos
**validadores em código**, que são a fonte executável — e mais confiável que um
exemplo que pode ter envelhecido.

---

## 4. Imagem do CMS (`Dockerfile.cms`)

| Item | Valor |
| --- | --- |
| Contexto de build | raiz do repositório |
| Dockerfile | `Dockerfile.cms` |
| Target | nenhum (single-stage deliberado) |
| Base | `node:22-bookworm-slim`, **pinada por digest** `sha256:6c74791e…f6b3` |
| Gerenciador | pnpm 9.15.4 via corepack |
| WORKDIR | `/app` |
| Usuário final | `node` (**não-root**) |
| Porta | 3002 (`EXPOSE`, `ENV PORT=3002`) |
| HEALTHCHECK | `GET /healthz` a cada 30s, `start-period` 90s, 3 retries |
| Migration | `pnpm --filter @screena/cms cms:migrations:deploy` **antes** do start; falha ⇒ container não sobe |
| Start | `exec pnpm --filter @screena/cms start` (Next vira PID 1 e recebe SIGTERM direto) |
| Copiados | `COPY . .` (repo inteiro; `pnpm install --frozen-lockfile`) |
| Build sem banco | `ARG PAYLOAD_SECRET` / `ARG PAYLOAD_DATABASE_URL` apontando para `127.0.0.1:1` (inalcançável de propósito), driver de build `s3` com endpoint morto |

Detalhe que merece atenção do operador: o driver de build é `s3` e **não**
`local` porque `local` sob `NODE_ENV=production` exigiria
`PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true` — e assar essa declaração no
build seria afirmar persistência que o build não tem.

**A imagem NÃO foi construída.** Não há `docker` neste ambiente e nenhum
`docker build` foi executado. O Dockerfile foi validado **por leitura**, e o
mesmo `next build` que ele executa roda em toda suíte de integração do CMS
(harness com PostgreSQL efêmero) — mas isso valida o build da aplicação, não a
imagem.

---

## 5. Imagem do worker (`Dockerfile.publication-worker`)

| Item | Valor |
| --- | --- |
| Contexto de build | raiz do repositório |
| Base | mesma imagem pinada por digest |
| Usuário final | `node` (**não-root**) |
| Porta | 3003 (`PUBLICATION_WORKER_HEALTH_PORT`) |
| HEALTHCHECK | `GET /healthz` a cada 30s, `start-period` 30s |
| Passo extra de build | `pnpm --filter @screena/db db:generate` (Prisma Client; **não** toca banco) |
| Migration | **nenhuma** — o worker nunca aplica migration no screen-db; ele apenas recusa readiness com schema atrasado |
| Start | `exec pnpm --filter @screena/news-ingestion publication-worker:start` |
| Encerramento | SIGTERM/SIGINT → `draining` → termina o lote, para de reclamar, devolve leases |

**A imagem NÃO foi construída.**

### Defeito real encontrado e corrigido nesta fase

O entrypoint (`bin/project-editorial.ts`) e o preflight
(`bin/worker-preflight.ts`) faziam `import { PrismaClient } from '@screena/db/server'`
como **valor**, mas aquele módulo exporta `PrismaClient` apenas como **tipo**.
Sob ESM isso lança `SyntaxError: does not provide an export named 'PrismaClient'`
**no import** — antes de qualquer log, qualquer validação de config e qualquer
health check. Reproduzido:

```
services/news-ingestion/bin/project-editorial.ts:20
import { PrismaClient } from '@screena/db/server'
SyntaxError: The requested module '@screena/db/server' does not provide an export named 'PrismaClient'
```

Ou seja: **o container do worker subiria e morreria imediatamente**, e o
comando "Verificação rápida" do runbook (`publication-worker:preflight`)
crashava exatamente quando o operador fosse usá-lo. Marco B estava bloqueado.

Por que ninguém viu: `services/**/bin/**` estava **fora do `pnpm typecheck`**, e
a suíte de integração importa os módulos de `src/`, nunca o entrypoint.

Correção: `@screena/db/server` ganhou uma fábrica de **valor**,
`createPrismaClient({ datasourceUrl })` — que preserva a fronteira do ADR 0015
(o worker aponta para `SCREEN_DATABASE_URL` e **nunca** cai em `DATABASE_URL`) —
e os dois `bin/` passaram a usá-la. A exclusão do typecheck foi **estreitada**:
`services/news-ingestion/bin/**` agora é verificado (0 erros); os demais `bin/`
seguem fora por dívida pré-existente, não por decisão de arquitetura.

Gate provado nos dois sentidos: com o defeito reintroduzido, `pnpm typecheck`
falha com `TS1362: 'PrismaClient' cannot be used as a value because it was
exported using 'export type'`; sem ele, zero erros.

Segunda trava, em `tests/governance/editorial-worker-boundary.test.ts`: uma
asserção nova recusa o import de `PrismaClient` **como valor** no entrypoint.
Ela existe porque a guarda que já havia ali inspecionava o **argumento** da
chamada (`screenDatabaseUrl`, nunca `payload`) — e o argumento estava certo o
tempo todo. Também foi provada nos dois sentidos.

---

## 6. Serviços a criar (nomes **provisórios**)

Declarado pelo usuário, **não validado** no EasyPanel: projeto `rss_prime`, com
`feed`, `screen-app` e `screen-db`.

| | `cinerie-cms` | `cinerie-publication-worker` |
| --- | --- | --- |
| Repositório | `maquinanerd/screena` | idem |
| Branch/commit | `claude/cinerie-manual-editorial-readiness` @ `7ca81da` (**ainda não publicado**) | idem |
| Contexto de build | raiz | raiz |
| Dockerfile | `Dockerfile.cms` | `Dockerfile.publication-worker` |
| Comando | o `CMD` da imagem | o `CMD` da imagem |
| Porta / protocolo | 3002 / HTTP | 3003 / HTTP (só health) |
| Healthcheck (liveness) | `GET /healthz` → 200 | `GET /healthz` → 200 |
| Readiness | `GET /readyz` → 200/503 | `GET /readyz` → 200/503 |
| Volumes | storage de upload, **se** driver `local` | storage público, **se** driver `local` |
| Rede interna | → banco editorial | → CMS (HTTP), → screen-db, → storage público |
| Depende de | banco editorial | CMS de pé **e** screen-db migrado |
| Restart | `always` | `always` |
| Ordem | 1º | 2º |
| Saudável quando | `/readyz` 200 e o painel `/admin` responde | `/readyz` 200 com `payload_auth` e `screen_schema` em `ok` |

Os nomes não são definitivos: o EasyPanel pode ter convenção própria, e a única
consequência técnica é o hostname interno usado em `PAYLOAD_INTERNAL_SERVICE_URL`.

---

## 7. Banco editorial: duas opções

**Regra inegociável:** `PAYLOAD_DATABASE_URL` **não pode** apontar para o mesmo
database lógico do Prisma/screen-db. Isso é validado em código de três formas —
`validateCmsConfig` recusa padrões de banco público, o CMS nunca usa
`DATABASE_URL` como fallback, e o worker recusa subir se
`SCREEN_DATABASE_URL === PAYLOAD_DATABASE_URL`.

### Opção A — database lógico separado na instância existente

| Dimensão | Avaliação |
| --- | --- |
| Isolamento | lógico (mesma instância, mesmo processo, mesmos recursos) |
| Vantagem | zero infraestrutura nova; backup já existe; rede já resolvida |
| Risco | ruído entre cargas; um `DROP`/restore errado atinge o vizinho; usuário com permissão ampla enxerga os dois |
| Backup/restore | por database (`pg_dump -d`), não por instância |
| Credencial | **usuário próprio**, com privilégio só no database do CMS |
| Manutenção | upgrade da instância afeta os dois ao mesmo tempo |
| Risco de banco errado | **alto** se a connection string diferir só pelo nome do database |

### Opção B — serviço PostgreSQL separado

| Dimensão | Avaliação |
| --- | --- |
| Isolamento | de processo e de recursos |
| Vantagem | falha, upgrade e restore independentes; credencial naturalmente distinta |
| Risco | mais um serviço para operar, monitorar e fazer backup |
| Backup/restore | independente, e restore não ameaça o público |
| Manutenção | maior custo operacional |
| Risco de banco errado | **baixo** (host diferente, não só nome diferente) |

**Não escolha sem ver a infraestrutura real.** A decisão depende de: o EasyPanel
permite criar database adicional no `screen-db`? Há recurso para outro serviço
PostgreSQL? A política de backup atual cobre por database ou por instância?

Independentemente da opção: usuários/credenciais separados, e a string do CMS
nunca reaproveitada de outro serviço.

---

## 8. Migrations do Payload (banco editorial)

| Item | Valor |
| --- | --- |
| Comando | `pnpm --filter @screena/cms cms:migrations:deploy` (= `payload migrate`) |
| Diretório | `apps/cms` |
| Quantidade | **9**, ordenadas por timestamp em `src/migrations/index.ts` |
| Banco vazio | aplica a cadeia inteira, na ordem |
| Upgrade | aplica só as pendentes |
| Controle | tabela `payload_migrations` (o Payload registra as aplicadas) |
| `push` implícito | **desativado** (`push: false` no adapter) |
| Rollback | cada migration tem `down`; `payload migrate:down` existe, mas **rollback de produção é decisão humana** |
| Logs | o CLI não imprime credencial; a URL vem do ambiente |
| Exclusividade | não é exigida: o adapter serializa por transação, e uma segunda instância encontra tudo aplicado |
| Onde roda | no **start do container**, antes do app; falha ⇒ o CMS não sobe |

Ordem, confirmada em `index.ts`:

1. `20260728_224559_initial`
2. `20260729_011649_outbox_lease_and_scopes`
3. `20260729_145607_auto_publish_scope_and_author_policy`
4. `20260729_145858_auto_publication_article_fields`
5. `20260729_170140_automation_audit_fields`
6. `20260729_180427_auto_publish_quota_counters`
7. `20260729_180503_drop_legacy_contract_hash`
8. `20260729_184812_content_type_review`
9. **`20260729_223310_human_publication_trail`** ← `createdBy`/`updatedBy`/`publishedBy`

A migration do rastro humano **está na cadeia** e é aditiva: três colunas em
`articles` (mais as espelhadas em `_articles_v`), FK para `editorial_users` com
`ON DELETE SET NULL` e três índices. Verificada no catálogo do Postgres pelo
teste de integração (`confdeltype = 'n'` nas três FKs).

Nenhuma migration foi executada contra banco persistente nesta fase.

---

## 9. Migrations do screen-db (banco público)

| Item | Valor |
| --- | --- |
| Comando | `pnpm --filter @screena/db db:migrate:deploy` (= `prisma migrate deploy`) |
| Diretório | `packages/db` |
| Quantidade | **16** migrations |
| Relevantes ao editorial | `20260727120000_editorial_news_platform`, `20260728220000_editorial_projection_from_cms`, `20260729010000_editorial_media_assets`, `20260729190000_editorial_approved_seo` |
| Ordem vs. worker | **antes** do worker subir |
| Quem aplica | o processo governado do banco público — **nunca** o worker |

Se o worker subir antes, ele **não fica ready**: `collectWorkerReadiness`
inspeciona o `information_schema` e o check `screen_schema` sai `blocked`
listando o que falta, por nome qualificado (`tabela.coluna`). Exigido:

- tabelas: `articles`, `article_translations`, `editorial_projection_receipts`, `editorial_media_assets`;
- colunas: `articles.payload_document_id`, `.projected_sequence`, `.hero_media_asset_id`, `.hero_image_path`; `article_translations.body_blocks`, `.body_blocks_version`; `editorial_projection_receipts.event_id`, `.emission_sequence`, `.outcome`, `.worker_id`; `editorial_media_assets.payload_media_id`, `.content_hash`, `.storage_key`, `.public_path`.

Schema atrasado é **readiness negativa**, não erro de evento: nenhuma matéria vai
para dead-letter por deploy fora de ordem.

---

## 10. Variáveis do CMS

Derivadas de `apps/cms/src/env.ts`, `upload-storage-config.ts` e
`env-auto-publish.ts`. Exemplos são **fictícios**.

### Banco e Payload

| Variável | Marco A | Segredo | Formato / exemplo | Ausente ⇒ |
| --- | --- | --- | --- | --- |
| `PAYLOAD_DATABASE_URL` | **sim** | **sim** | `postgresql://cms_user:***@cinerie-cms-db:5432/cinerie_cms` | config inválida; container não sobe |
| `PAYLOAD_SECRET` | **sim** | **sim** | string ≥ **32** chars | config inválida |
| `PAYLOAD_PUBLIC_SERVER_URL` | recomendada | não | `https://cms.exemplo.tld` | admin usa default local; links do painel quebram |
| `PORT` | não | não | `3002` (default da imagem) | usa 3002 |
| `NODE_ENV` | sim (imagem) | não | `production` | validações relaxam |

`DATABASE_URL` **nunca** é usada pelo CMS — o validador recusa explicitamente
esse fallback, e há padrões de banco público que ele rejeita.

### Storage de origem (uploads) — um dos dois blocos

| Variável | Segredo | Exemplo | Observação |
| --- | --- | --- | --- |
| `PAYLOAD_UPLOAD_STORAGE_DRIVER` | não | `local` \| `s3` | **obrigatória em production** |
| `PAYLOAD_UPLOAD_LOCAL_ROOT` | não | `/data/cms-uploads` | absoluto; recusa diretórios efêmeros conhecidos |
| `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED` | não | `true` | **declaração do operador** de que o caminho é durável |
| `PAYLOAD_UPLOAD_S3_ENDPOINT` | não | `https://xxx.r2.cloudflarestorage.com` | http(s) obrigatório |
| `PAYLOAD_UPLOAD_S3_BUCKET` | não | `cinerie-cms-uploads` | |
| `PAYLOAD_UPLOAD_S3_REGION` | não | `auto` (default) | |
| `PAYLOAD_UPLOAD_S3_ACCESS_KEY_ID` | **sim** | — | rotacionável |
| `PAYLOAD_UPLOAD_S3_SECRET_ACCESS_KEY` | **sim** | — | rotacionável |
| `PAYLOAD_UPLOAD_S3_FORCE_PATH_STYLE` | não | `true` (default) | `false` só para S3 nativo |
| `PAYLOAD_UPLOAD_S3_PREFIX` | não | `cms-uploads` (default) | **não pode colidir** com o prefixo público |

### Autopublicação — **Marco C apenas**

| Variável | Marco A | Ausente ⇒ |
| --- | --- | --- |
| `EDITORIAL_AUTO_PUBLISH_ENABLED` | não | tratada como `false`; readiness `ok` |
| `EDITORIAL_AUTO_PUBLISH_TIME_ZONE` | não | só bloqueia se a automação estiver **ligada** |
| `EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT` | não | sem teto |
| `EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT` | não | sem teto |

**`MNSCR_PAYLOAD_API_KEY` não é variável do CMS.** Ela é uma credencial que o
MNScr guarda para chamar o CMS — o CMS só conhece a conta em `service-accounts`.

Nenhum valor é ecoado em log: preflight e readiness imprimem **códigos** e
**nomes de variável**, nunca conteúdo.

---

## 11. Variáveis do worker

De `projection-worker-config.ts` e `media/storage-config.ts`.

| Variável | Obrigatória | Segredo | Exemplo | Ausente ⇒ |
| --- | --- | --- | --- | --- |
| `SCREEN_DATABASE_URL` | **sim** | **sim** | `postgresql://worker:***@screen-db:5432/rss_prime_screen_db` | config inválida |
| `PAYLOAD_INTERNAL_SERVICE_URL` | **sim** | não | `http://cinerie-cms:3002` | config inválida |
| `PAYLOAD_PROJECTION_API_KEY` | **sim** | **sim** | — | config inválida |
| `PAYLOAD_PROJECTION_API_KEY_COLLECTION` | não | não | `service-accounts` (default) | usa o default |
| `PROJECTION_WORKER_ID` | **sim** | não | `cinerie-worker-1` | config inválida |
| `PROJECTION_BATCH_SIZE` | não | não | `10` (1–25) | default 10 |
| `PROJECTION_LEASE_MS` | não | não | `60000` (5s–10min) | default 60s |
| `PROJECTION_POLL_INTERVAL_MS` | não | não | `15000` | default 15s |
| `PROJECTION_REQUEST_TIMEOUT_MS` | não | não | `20000` | default 20s |
| `PUBLICATION_WORKER_HEALTH_PORT` | não | não | `3003` (default da imagem) | usa 3003 |
| `EDITORIAL_MEDIA_STORAGE_DRIVER` | **sim** | não | `local` \| `s3` | config inválida |
| `EDITORIAL_MEDIA_LOCAL_ROOT` | se `local` | não | `/data/editorial-media` | config inválida |
| `EDITORIAL_MEDIA_PUBLIC_BASE_PATH` | não | não | `/media` (default) | usa `/media` |
| `EDITORIAL_MEDIA_S3_ENDPOINT` / `_BUCKET` / `_REGION` | se `s3` | não | — | config inválida |
| `EDITORIAL_MEDIA_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | se `s3` | **sim** | — | config inválida |
| `EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE` | não | não | `true` | default |

Duas recusas ativas, ambas em código:

- `SCREEN_DATABASE_URL` que **pareça produção** (`rss_prime`, `_prod`, `production`)
  é recusada por padrão — libere só com a opção explícita do serviço;
- `SCREEN_DATABASE_URL === PAYLOAD_DATABASE_URL` é recusado: seria o CMS
  escrevendo direto no banco público, o acoplamento que a outbox existe para impedir.

**O worker NÃO recebe** `PAYLOAD_DATABASE_URL` nem credencial
`editorial_auto_publish`. Escopo único: `publication_projection`.

---

## 12. Variáveis do Screen-App afetadas

| Variável | Efeito |
| --- | --- |
| `CINERIE_PUBLIC_SITE_URL` | origem canônica; **precisa ser exatamente** `https://cinerie.com` para o ambiente contar como indexável |
| `CINERIE_PUBLIC_INDEXING_ENABLED` | kill switch de indexação; com `false`, `robots` colapsa para `noindex,nofollow` e o News Sitemap sai **vazio** |
| `DATABASE_URL` | banco público (já configurado) |
| `EDITORIAL_MEDIA_PUBLIC_BASE_PATH` | precisa **coincidir** com o do worker, senão a imagem projetada 404 |

O Screen-App **não vira cliente do Payload**: ele lê o screen-db e o storage
público. Nenhuma variável do CMS entra nele.

### 12.1. Leitura do storage público (rota `/media/editorial/**`)

O caminho gravado em `editorial_media_assets.public_path` é servido pelo route
handler [`apps/web/app/media/editorial/[...key]/route.ts`](../../apps/web/app/media/editorial/%5B...key%5D/route.ts).
Ele casa o caminho com a linha do banco, reconfere a licença e devolve os bytes
do objeto apontado pela coluna `storage_key`. **A URL nunca vira chave de
storage** — a chave sai do banco.

Sem estas variáveis no screen-app a rota responde **503** (indisponível), nunca
404: um bucket mal configurado não pode ser registrado como "imagem não existe".

| Variável | Obrigatória | Segredo | Observação |
| --- | --- | --- | --- |
| `EDITORIAL_MEDIA_STORAGE_DRIVER` | **sim** em produção | não | `s3` \| `local`. Ausente em `production` ⇒ 503 |
| `EDITORIAL_MEDIA_S3_ENDPOINT` / `_BUCKET` | se `s3` | não | **mesmo bucket** do worker |
| `EDITORIAL_MEDIA_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | se `s3` | **sim** | credencial **somente-leitura**: o site nunca escreve nem apaga |
| `EDITORIAL_MEDIA_S3_REGION` | não | não | default `auto` |
| `EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE` | não | não | default `true` (R2/MinIO) |
| `EDITORIAL_MEDIA_LOCAL_ROOT` | se `local` | não | raiz do volume montado |

Duas assimetrias deliberadas em relação ao worker:

- o site usa **somente-leitura**. O `MediaStoragePort` do worker tem `put` e
  `delete`; nada disso entra no processo público, então a credencial do
  screen-app pode e deve ser um token sem permissão de escrita;
- o site **aceita** o driver `local` em produção. A recusa no worker
  (`storage-config.ts:82-91`) existe porque *escrever* em disco efêmero perde
  mídia no próximo deploy. *Ler* de um volume montado de propósito é legítimo, e
  recusar transformaria uma escolha de infraestrutura válida em 503.

> **O prefixo `/media` é o caminho do arquivo de rota, não configuração.**
> Se `EDITORIAL_MEDIA_PUBLIC_BASE_PATH` do worker deixar de ser `/media`, o
> banco passa a gravar um caminho que esta rota não atende e a imagem volta a
> 404 — silenciosamente. Mantenha o default dos dois lados.

---

## 13. Storage de ORIGEM (uploads do Payload)

Guarda o **arquivo original** que a redação subiu. Não é servido ao público.

**LOCAL** — volume persistente obrigatório; caminho absoluto; o container roda
como `node` e a imagem cria `/app/apps/cms/media` com esse dono para um volume
montado por cima herdar permissão utilizável; backup = backup do volume; em
filesystem efêmero **perde-se a mídia**, por isso `production` exige
`PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true` como declaração explícita.

**S3-COMPATIBLE** — plugin oficial `@payloadcms/storage-s3`; endpoint, região
(default `auto`), bucket, `forcePathStyle` (default `true`, correto para R2 e
MinIO), prefixo (default `cms-uploads`); credenciais só em env; preflight prova
leitura com `exists()` de chave inexistente (não grava nada); rotação por
credencial nova + restart; versionamento do bucket é a rede de proteção.

**Não crie bucket nem forneça credencial real neste momento.**

---

## 14. Storage PÚBLICO editorial

Papel **diferente**: guarda a cópia verificada que o site serve. Escrito pelo
**worker**, nunca pelo CMS.

- chave derivada do **hash do conteúdo** (`editorial/<2 primeiros>/<sha256>.<ext>`),
  o que torna a projeção idempotente: o mesmo arquivo em duas matérias não
  duplica bytes nem linha;
- o screen-db guarda o **caminho** (`/media/editorial/...`), nunca uma URL — o
  normalizador do site recusa `http(s)`;
- o Screen-App serve esse caminho direto; **não** busca mídia no Payload durante
  render (invariante 3);
- backup: reconstruível reprojetando os eventos, desde que os originais existam
  no storage de origem — então o backup **crítico** é o de origem;
- **limpeza de órfãos não existe**: mídia projetada e depois removida do CMS
  permanece no storage público. Dívida conhecida, não bloqueante.

Preflight do worker recusa (`BLOCKED`) se o prefixo de upload colidir com o
caminho público — sem isso o worker poderia apagar original achando que era
derivada.

---

## 15. Health e readiness

|  | CMS | Worker |
| --- | --- | --- |
| Liveness | `GET /healthz` → sempre 200; **não toca banco, config ou storage** | `GET /healthz` → 200 enquanto o processo não estiver `stopped` |
| Readiness | `GET /readyz` → 200 `{status:"ready"}` / 503 `{status:"not_ready"}` | idem |
| Checks | `config`, `database`, `migrations`, `storage`, `collections`, `auto_publish` | `config`, `screen_db`, `screen_schema`, `payload_reachable`, `payload_auth`, `storage` |
| Cache | `cache-control: no-store` | idem |

Por que a separação importa: se a **liveness** dependesse do banco, uma queda do
PostgreSQL faria o orquestrador **reiniciar em loop** um container saudável — e
reiniciar não devolve o banco. Quem tira do balanceador é a readiness.

Configuração sugerida: liveness a cada 30s, timeout 5s, 3 retries,
`start-period` 90s (CMS, por causa da migration) e 30s (worker); readiness a
cada 10–15s, timeout 5s, **sem** matar o container em falha.

`auto_publish` aparece **sempre**, inclusive desligado — e nesse caso `ok`.
Só bloqueia com automação **ligada** e mal configurada (ex.: fuso ausente ou
inválido em produção).

---

## 16. Primeiro administrador

Mecanismo real, verificado em `apps/cms/src/payload.config.ts`: `admin.user` é
`editorial-users`, uma collection de auth do Payload. O Payload oferece o
**bootstrap pela interface**: com a collection de auth **vazia**, `/admin`
apresenta a tela de criação do primeiro usuário. Não existe endpoint próprio de
bootstrap neste repositório, e `scripts/seed-dev.ts` é de desenvolvimento (semeia
o autor institucional), **não** cria administrador de produção.

Consequências operacionais:

- a tela de criação só existe **enquanto não houver nenhum** `editorial-users`;
- criar o primeiro usuário **fecha** a porta: a partir daí `/admin` exige login e
  novos usuários só saem do painel, e só por `administrator`;
- por isso o intervalo entre o serviço ficar público e o primeiro admin ser
  criado é uma **janela real de exposição** — faça imediatamente, ou mantenha o
  domínio fechado até criar;
- senha: o campo `role` precisa ser `administrator` e `active = true`;
- recuperação de senha depende de adapter de e-mail — **não há adapter
  configurado** (o servidor avisa "No email adapter provided"), então o reset por
  e-mail **não funciona** hoje; a recuperação prática é um administrador redefinir
  pelo painel;
- **não há MFA** nesta versão;
- nunca compartilhe a senha, o `PAYLOAD_SECRET` ou a connection string.

**Não crie o usuário nesta fase.**

---

## 17. Autores

Procedimento futuro, em `Editorial → Authors`:

- **Redação Cinerie**: `name`, `slug` (ex.: `redacao-cinerie`), `isOrganization = true`, `active = true`;
- **autor individual**: `name`, `slug`, `bio`, `avatar` (relação com `media`),
  `roleLabel`, `publicEmail`, `sameAs`;
- ativar/desativar por `active` — **autor inativo não publica** (o gate exige ao
  menos um autor ativo ligado à matéria);
- publicação automática: `automationPublishingAllowed`,
  `allowedAutomationContentTypes`, `allowedAutomationSections`,
  `automationDailyLimit`, `automationAttributionModes` — **tudo Marco C**.

No Marco A nenhum autor precisa autorizar automação. **Não crie autor agora.**

---

## 18. Service account do worker

Futuro, em `Identidade → Service Accounts` (só `administrator` enxerga):

| Campo | Valor |
| --- | --- |
| `label` | ex.: `cinerie-publication-worker` |
| `purpose` | `internal_tooling` |
| `scopes` | **`publication_projection`** e mais nada |
| `active` | `true` |
| `apiKey` | gerada pelo painel; **exibida uma vez** |

A chave vai para o EasyPanel como `PAYLOAD_PROJECTION_API_KEY` (secret). Rotação:
criar conta nova, trocar a variável, reiniciar o worker, desativar a antiga.
Revogação sem apagar: esvaziar `scopes` — a política nega tudo para lista vazia,
e a trilha de quem a conta era permanece.

Teste sem efeito colateral: `publication-worker:preflight`, que faz um `claim`
de lote **zero** — prova autenticação e escopo sem tirar um evento da fila.

Essa conta **não** lê a collection de artigos e **não** publica. **Não crie agora**,
e nenhuma chave de teste anterior é reutilizável (todas nasceram e morreram em
bancos efêmeros).

---

## 19. Service account do MNScr — Marco C

Futuro, com escopo `editorial_auto_publish` (e `draft_ingest` só se a ingestão de
rascunho for usada). **Não crie agora.**

A ausência dessa conta **não** é falha do CMS nem do worker: os dois ficam
`ready` sem ela.

---

## 20. Domínios e rede

**Público (só o painel administrativo):** um domínio/subdomínio dedicado ao CMS,
HTTPS obrigatório (cookie de sessão do Payload precisa de `Secure`), acesso
idealmente restrito (IP allowlist ou proxy autenticado). O subdomínio final
**não** está definido — decisão do operador.

**Interno (nunca exposto):**

| De → para | Como |
| --- | --- |
| CMS → banco editorial | rede interna, TCP 5432 |
| worker → CMS | HTTP interno, `PAYLOAD_INTERNAL_SERVICE_URL` (ex.: `http://cinerie-cms:3002`) |
| worker → screen-db | rede interna, TCP 5432 |
| worker → storage público | volume local ou endpoint S3 |
| screen-app → screen-db / storage | já existente |

- **Pública:** o domínio do painel do CMS; o domínio do `screen-app`.
- **Interna:** `PAYLOAD_INTERNAL_SERVICE_URL`, ambos os bancos, o storage.
- **Nunca expostos:** endpoints `/api/internal/**` do CMS (outbox, mídia,
  drafts, publicações). Eles exigem API key com escopo, mas a defesa em
  profundidade é não publicá-los.

`PAYLOAD_PUBLIC_SERVER_URL` deve ser o domínio **público** do painel: é dele que
saem os links e a base do admin.

---

## 21. Segurança

**Validado em código e teste**

- containers **não-root** (`USER node`) nos dois serviços;
- segredos só em env; erro e readiness imprimem **nome/código**, nunca valor;
- API key nunca volta em resposta (`access: { read: () => false }` em `apiKey`);
- CMS **não** conhece `DATABASE_URL`; worker **não** conhece `PAYLOAD_DATABASE_URL`
  (travado por `tests/governance/editorial-worker-boundary.test.ts`, que percorre
  o fecho transitivo de imports);
- upload restrito a `image/png`, `image/jpeg`, `image/webp`, `image/avif` —
  **SVG não é aceito** (o vetor clássico de XSS em CMS);
- mídia só vira pública com licença aprovada e permissão para o uso pretendido;
  o gate barra capa, galeria **e blocos do corpo**;
- `hero_image_path` nunca recebe URL arbitrária — o normalizador do site recusa
  `http(s)`;
- corpo é lista de **blocos tipados**; não existe bloco de HTML livre;
- GraphQL **desabilitado**;
- outbox não é superfície editorial: `create/update/delete` negados para todos,
  inclusive administrador; a única escrita é o hook de publicação;
- endpoints internos exigem API key **com escopo**; conta sem escopo não pode nada.

**Ainda depende da infraestrutura do EasyPanel**

- HTTPS e certificado do domínio do painel;
- `PAYLOAD_PUBLIC_SERVER_URL` correta (dela dependem cookie e CORS/CSRF do Payload);
- restrição de acesso ao `/admin`;
- limite de tamanho de upload no proxy (o repositório não define um);
- **CORS/CSRF não estão declarados** em `payload.config.ts`. O default do Payload
  é restritivo (nenhuma origem extra), o que é o comportamento desejado — mas
  isso vale **enquanto** `serverURL` estiver correta. Item a confirmar no deploy;
- SSRF: o worker busca bytes **apenas** do `PAYLOAD_INTERNAL_SERVICE_URL`
  configurado, nunca de URL vinda de conteúdo.

---

## 22. Backup e restore

| Ativo | Frequência | Retenção | Restore | Reconstruível? |
| --- | --- | --- | --- | --- |
| **Banco editorial** | diário + antes de cada migration | ≥ 30 dias | `pg_restore` em database novo, validar, só então promover | **NÃO** — é a fonte da verdade editorial |
| **Storage de origem** | snapshot do volume ou versionamento do bucket | ≥ 30 dias | restaurar volume/objetos | **NÃO** — original que a redação subiu |
| **screen-db** | já coberto pela política existente | existente | existente | **parcialmente** — a projeção editorial reconstrói reprocessando a outbox; o restante do catálogo **não** |
| **Storage público** | opcional | curta | — | **SIM** — reprojetável, desde que o de origem exista |

Prioridade: **banco editorial e storage de origem**. Os dois públicos são
derivados; os dois de origem, não.

Teste de restore: restaurar em database temporário e rodar
`pnpm --filter @screena/cms cms:migrations:status`. **Nenhum backup foi
executado nesta fase.**

---

## 23. Ordem de implantação (34 etapas)

Cada etapa: **avança** só com a condição satisfeita; **rollback** é o caminho de volta.

| # | Etapa | Avança quando | Rollback |
| --- | --- | --- | --- |
| 1 | validar projeto e serviços no EasyPanel | inventário conferido | — |
| 2 | validar `screen-db` | versão, databases e backup conhecidos | — |
| 3 | escolher banco editorial (A ou B) | decisão registrada | — |
| 4 | escolher storage de origem | decisão registrada | — |
| 5 | escolher storage público | decisão registrada | — |
| 6 | preparar backups | backup do screen-db recente e testado | não avançar |
| 7 | **publicar branch/commit no remoto** | `7ca81da` visível no GitHub | — |
| 8 | criar banco editorial | conecta com usuário próprio | apagar (ainda vazio) |
| 9 | configurar variáveis do CMS | `cms:preflight` sem `BLOCKED` | corrigir variável |
| 10 | migrations do Payload | `migrate:status` sem pendência | restaurar backup |
| 11 | criar serviço CMS | container sobe | remover serviço |
| 12 | validar `/healthz` | 200 | ver log |
| 13 | validar `/readyz` | 200, `auto_publish` = `ok` | ler o check que bloqueou |
| 14 | criar administrador | login funciona | — |
| 15 | criar Redação Cinerie | autor ativo | desativar |
| 16 | escrever draft canário | rascunho salvo e reaberto | apagar |
| 17 | migrations públicas | `screen_schema` completo | restaurar backup |
| 18 | service account `publication_projection` | chave gerada | esvaziar `scopes` |
| 19 | configurar worker | `publication-worker:preflight` sem `BLOCKED` | corrigir variável |
| 20 | criar serviço worker | container sobe | remover serviço |
| 21 | worker `/healthz` | 200 | ver log |
| 22 | worker `/readyz` | 200 com `payload_auth` e `screen_schema` `ok` | ler o check |
| 23 | publicar matéria canária | `workflowStatus=published`, `autoPublished=false` | despublicar (`archived`) |
| 24 | confirmar outbox | 1 evento `article.published` | — |
| 25 | confirmar worker | evento `processed` | reenfileirar |
| 26 | confirmar screen-db | `Article` + `ArticleTranslation` pt-BR | — |
| 27 | confirmar página | `GET /pt/noticias/<slug>/` → 200 | despublicar |
| 28 | confirmar mídia | caminho `/media/editorial/...` carrega | verificar storage |
| 29 | confirmar SEO | canonical, robots, JSON-LD | verificar env do site |
| 30 | confirmar Sitemap | slug em `sitemap-pt-BR-news-1.xml` | — |
| 31 | confirmar News Sitemap | slug presente (ambiente indexável) | — |
| 32 | configurar backups | agendados e testados | não seguir sem isso |
| 33 | observar logs e métricas | 24–48h sem erro recorrente | — |
| 34 | **só então** retomar o MNScr (Marco C) | tudo acima estável | manter desligado |

Ponto de não-retorno: a etapa **10**. Depois dela, voltar exige restore.

---

## 24. Evidências que o operador precisa fornecer

Para cada item: onde achar, o que copiar, o que ocultar, que decisão depende dele.

| # | Evidência | Onde | Copiar | Ocultar | Decide |
| --- | --- | --- | --- | --- | --- |
| 1 | Projeto `rss_prime` | tela do projeto | nome e lista de serviços | — | nomenclatura |
| 2 | Lista de serviços | painel | nome, tipo, estado | — | conflito de nome |
| 3 | `screen-db` (não secreto) | serviço → Overview | versão do PostgreSQL, host **interno**, porta | **senha e connection string completa** | opção A vs B |
| 4 | Databases existentes | console do PG ou painel | saída de `\l` (só nomes) | — | opção A vs B |
| 5 | Volumes | serviço → Storage/Mounts | nomes, caminhos, tamanho | — | storage local |
| 6 | Storage disponível | plano/infra | espaço livre | — | local vs S3 |
| 7 | Rede interna | Networking | hostnames internos | — | `PAYLOAD_INTERNAL_SERVICE_URL` |
| 8 | Domínio do `screen-app` | serviço → Domains | domínio atual | — | subdomínio do CMS |
| 9 | Build do `screen-app` | serviço → Source/Build | repositório, branch, Dockerfile, contexto | tokens | replicar padrão |
| 10 | Criar banco adicional? | painel do PG | sim/não + como | — | opção A |
| 11 | Criar volume? | painel | sim/não + limites | — | storage local |
| 12 | S3/R2 disponível? | infra | endpoint e bucket (**sem chave**) | **access key / secret** | local vs S3 |
| 13 | Política de backup | painel/infra | frequência, retenção, escopo | — | etapa 6 |

**Nunca envie:** senha, API key, secret, connection string completa, chave
privada, `PAYLOAD_SECRET`. Capturas de tela: recorte ou borre esses campos.

---

## 25. Riscos e rollback

| Etapa | Risco | Evidência antes | Validação depois | Rollback | Parar se |
| --- | --- | --- | --- | --- | --- |
| 8–10 | **banco errado** (CMS apontando para o público) | `\l` mostrando os dois nomes | `cms:preflight` OK; worker recusa URLs iguais | restaurar backup | as URLs coincidirem |
| 10 | migration errada | backup testado | `migrate:status` limpo | `pg_restore` | falha no meio |
| 9 | **filesystem efêmero** | mount listado | `PERSISTENT_CONFIRMED=true` **verdadeiro** | trocar para S3 | caminho não estiver em volume |
| 18 | escopo excessivo | — | conta só com `publication_projection` | esvaziar `scopes` | aparecer `editorial_auto_publish` |
| 11 | domínio incorreto | domínio decidido | painel abre e o login persiste | corrigir `PAYLOAD_PUBLIC_SERVER_URL` | cookie não persistir |
| 11 | cookie/CORS incorretos | HTTPS ativo | login sobrevive a reload | corrigir `serverURL` | login cair |
| 20 | **worker duplicado** | 1 réplica | `lockedBy` sempre o mesmo | reduzir para 1 | dois `PROJECTION_WORKER_ID` iguais |
| 20 | lease curta demais | default 60s | nenhum evento reentregue no meio | subir `PROJECTION_LEASE_MS` | reentrega recorrente |
| 24 | outbox duplicada | — | 1 evento por transição | — | dois `article.published` para a mesma matéria |
| 19 | **storages divergentes** | prefixos anotados | preflight "separação de storages" OK | corrigir prefixo | prefixos colidirem |
| 30 | **Sitemap em staging** | `CINERIE_PUBLIC_INDEXING_ENABLED` conhecida | staging → News Sitemap vazio | desligar a flag | staging anunciar URL |
| 12 | **preview indexável** | idem | `robots` `noindex` fora de produção | desligar a flag | preview responder `index` |
| 34 | **autopublicação sem intenção** | flag ausente | `auto_publish` = "desabilitada" | `EDITORIAL_AUTO_PUBLISH_ENABLED=false` | flag ligada sem decisão |

**Nunca apagar:** banco editorial, storage de origem, `publication-outbox` com
eventos pendentes, `editorial_projection_receipts` (a idempotência depende deles).

---

## 26. Limitações conhecidas

| Limitação | Classificação |
| --- | --- |
| `writer` pode editar **qualquer** matéria, não só as próprias | **decisão editorial futura** — não bloqueia |
| `scheduledFor` sem publicador agendado ativo | **não bloqueia** — agendar não publica sozinho |
| `build:cms` exige `PAYLOAD_DATABASE_URL`/`PAYLOAD_SECRET` no ambiente | **não bloqueia** — o `Dockerfile.cms` já fornece via `ARG` |
| **Imagens Docker nunca construídas** neste ambiente | **risco do Marco A e B** — validar com um `docker build` antes de promover |
| Storage S3 nunca testado contra bucket real | **risco do Marco A e B**, se a escolha for S3 — o preflight prova no deploy |
| Sem limpeza de mídia órfã no storage público | **não bloqueia** — cresce devagar |
| Sem derivadas/thumbnails (`imageSizes` não configurado) | **não bloqueia** — o site serve o original |
| Sem adapter de e-mail: reset de senha por e-mail **não funciona** | **não bloqueia** — recuperação por outro administrador |
| Sem MFA no painel | **não bloqueia** — mitigar restringindo acesso ao `/admin` |
| CORS/CSRF não declarados explicitamente (default do Payload) | **confirmar no deploy** |
| `services/{entity-writer,ingestion,legal,ratings,streaming,sync}/bin` fora do typecheck (7 erros pré-existentes) | **não bloqueia** — dívida anterior, fora do caminho editorial |

Nada disso foi corrigido em silêncio nesta fase.

---

## 27. Verificações executadas nesta fase

Somente não destrutivas. Nenhuma conexão com EasyPanel, produção ou rede externa.

| Verificação | Resultado |
| --- | --- |
| `pnpm typecheck` (agora incluindo `services/news-ingestion/bin/**`) | 0 erros |
| `pnpm typecheck:catalog-runtime` | ok |
| `pnpm typecheck:apps` (web, admin, cms) | ok |
| `pnpm lint` | ok |
| `pnpm audit:invariants` | 7 ok, 0 violações |
| `pnpm audit:render` | 2 ok, 0 violações |
| `pnpm test` (raiz) | 4332 ✓ (336 arquivos) |
| `pnpm test:cms` | 243 ✓ |
| `pnpm test:cms:deployment-readiness` | 31 ✓ |
| `pnpm test:publication-worker:deployment-readiness` | 56 ✓ |
| Preflight do CMS com **ambiente vazio** | fail-closed correto: 5 `BLOCKED`, nenhum valor vazado |
| Preflight do worker com **ambiente vazio** | fail-closed correto (após a correção da seção 5) |
| Entrypoint do worker com ambiente vazio | recusa configuração e sai — **não** crasha mais no import |
| Cadeia de migrations do Payload | 9, ordenadas, com o rastro humano incluído |
| Migrations Prisma | 16, com as 4 editoriais presentes |
| Dockerfiles | validados **por leitura**; `docker build` **não** executado |

---

## 28. O que este checkpoint NÃO fez

Não acessou o EasyPanel. Não criou serviço, banco, volume, bucket, credencial,
usuário, autor ou service account. Não alterou DNS. Não construiu imagem. Não
executou migration contra banco persistente. Não fez push, PR, merge ou deploy.
Não tocou no MNScr, no RSS Prime nem no MN26. Não alterou contrato,
`schemaHash`, fixtures nem funcionalidade editorial.
