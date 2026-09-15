# Implantar o painel interno (`apps/admin`)

> A criação do serviço no painel e a exposição do domínio são do dono. Este
> documento prepara tudo o que vem antes e diz o que conferir depois.

---

## Por que isto existe

O `apps/admin` nasceu editorial — `review-queue` e `content-blocks/[id]` são a
única tela onde um humano revisa `content_blocks` — e **nunca foi construído por
nada**: não havia Dockerfile, não havia `build:admin`, não havia serviço. A
auditoria de 2026-09-01 registrou isso como S-31.

Desde 2026-09-15 ele também é o **painel operacional** (`/`): filas, cotas,
serviços, cobertura, títulos, usuários, logs e as ações de forçar atualização.
Contrato de cada tela: [`admin-operacional.md`](./admin-operacional.md).

---

## O que já está pronto

| Peça | Estado |
| --- | --- |
| `Dockerfile.admin` | criado, no mesmo padrão dos outros quatro |
| `pnpm build:admin` | criado na raiz |
| Job de build em CI | criado (`Build do painel interno (admin)`) |
| Autenticação | **já existia** — ver abaixo |
| Validador com PostgreSQL e Next reais | `pnpm --filter @screena/admin validate:ops-panel` |

### A autenticação já existe, e é fail-closed

`apps/admin/middleware.ts` põe HTTP Basic Auth na frente de **todas** as telas,
e a decisão vive num módulo puro testado (`src/lib/access-protection.ts`):

- **production-like** (`NODE_ENV=production` ou `VERCEL_ENV=production`) → a
  proteção é **sempre** exigida, mesmo sem `ADMIN_PROTECTION_ENABLED` ou com ela
  em `"false"`. O painel **nunca sobe aberto**.
- proteção exigida **sem usuário/senha em ENV** → **401**. Ele nega; não libera.
- Basic Auth ausente ou inválido → 401 + desafio.
- Toda resposta — liberada ou 401 — sai com `X-Robots-Tag: noindex, nofollow, noarchive`.

O `ENV NODE_ENV=production` do Dockerfile não é só otimização: é o que coloca o
middleware nesse ramo. **Removê-lo abriria o painel.**

A credencial é **compartilhada**: o painel não distingue pessoas. Cada ação grava
o rótulo `ADMIN_OPERATOR_LABEL` na auditoria e diz, na tela, que é credencial
compartilhada.

---

## Criar o serviço no painel

| Campo | Valor |
| --- | --- |
| Origem | GitHub `screena`, branch `main` |
| Build | `Dockerfile.admin` |
| Porta | `3006` |
| Comando | (nenhum — o `CMD` do Dockerfile) |
| Domínio | **interno**, ou domínio próprio com Basic Auth. Nunca em `cinerie.com` |

### Variáveis — o mínimo, e nada além

```
DATABASE_URL=<a mesma do screen-app>
ADMIN_BASIC_AUTH_USER=<escolher>
ADMIN_BASIC_AUTH_PASSWORD=<escolher, forte>
```

Opcionais:

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `ADMIN_OPERATOR_LABEL` | `credencial compartilhada do painel` | Rótulo (não secreto) gravado em cada ação auditada |
| `ADMIN_OPS_ACTIONS_ENABLED` | ligado | `false` desliga TODAS as ações do painel operacional (as telas continuam) |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | `false` | Escrita editorial (revisão/publicação) |
| `CINERIE_SERVICE_KEY` | `cinerie-admin` | Nome do serviço no sinal de vida |

> **`connection_limit` na `DATABASE_URL` do admin: 5 ou mais, nunca 1.** As telas
> medem filas, cotas e serviços em PARALELO, e cada contagem pesada roda numa
> transação curta com teto de tempo. Com uma conexão só, as medidas esperam umas
> pelas outras até estourar o tempo e a tela passa a dizer "não determinado". O
> `connection_limit=1` é exigência do `screen-cron` (a trava por
> `pg_advisory_lock`), não do painel.

> **Não copie o env do `screen-app`.** Ele carrega 51 variáveis — Gemini, OMDb,
> TMDB×3, RapidAPI×4, Brevo, S3, R2 — e o admin não lê nenhuma delas. Cada
> credencial a mais num serviço é superfície que não compra nada.

### O que o admin NÃO recebe

Nenhuma credencial de fornecedor. Ele não fala com TMDB, OMDb, GitHub, Gemini nem
RapidAPI, e não conhece o banco do Payload. As ações do painel **enfileiram**
trabalho no banco; quem executa é o `screen-catalog-worker` (`catalog_jobs`) e o
`screen-cron` (`scheduler_force_requests`).

### O que o admin escreve

| Tabela | Quando |
| --- | --- |
| `service_heartbeats` | o sinal de vida do próprio painel, a cada 60 s |
| `admin_action_audits` | toda ação confirmada (e toda recusa) |
| `catalog_jobs` | forçar detalhe, mídia ou temporadas de um título |
| `scheduler_force_requests` | forçar nota, Score ou um ciclo de fila |

Nada mais. Travado por `tests/admin/ops-actions-guard.test.ts`.

---

## A migration desta leva, e o que ela custa

`20260915120000_admin_operational_panel` roda no `migrate deploy` do release, como
toda migration. Ela cria cinco tabelas novas (sem risco) e **um índice em
`catalog_jobs` (`run_id`, `created_at`)**. O Prisma roda a migration dentro de
transação, então o índice é construído sem `CONCURRENTLY`: **enquanto ele é
construído, escritas em `catalog_jobs` esperam** (o worker de catálogo pausa; não
falha). O tempo cresce com o tamanho da tabela — para medir antes:

```sql
SELECT count(*) FROM catalog_jobs;
```

---

## Depois de implantar: os serviços que precisam de redeploy

O painel mede o que os serviços gravam. Até cada um ser reimplantado com esta
versão, a tela Serviços mostra **"NUNCA deu sinal de vida"** em vermelho — que é a
verdade: sem a versão nova, o serviço não grava sinal.

| Serviço | O que passa a gravar |
| --- | --- |
| `screen-app` | sinal de vida e impressão digital do código |
| `screen-cron` | sinal de vida; filas novas `deploy_reference` e `catalog_coverage`; atende `scheduler_force_requests` a cada tique |
| `screen-catalog-worker` | sinal de vida |
| `cinerie-publication-worker` | sinal de vida (modo contínuo) |
| `cinerie-admin` | sinal de vida |

`deploy_reference` lê o `main` do GitHub sem token (repositório público, 60
requisições por hora bastam). `CINERIE_GITHUB_TOKEN` no `screen-cron` é opcional.

---

## Conferir depois de subir

**1. O portão está de pé** — 401 sem credencial:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/
```

Esperado: **401**. Se vier 200, o painel subiu aberto — pare e confira
`NODE_ENV`.

**2. A credencial funciona:**

```bash
curl -sS -u '<user>:<senha>' -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/filas
```

Esperado: **200**.

**3. O painel está fora do índice:**

```bash
curl -sS -u '<user>:<senha>' -D - -o /dev/null https://<dominio-do-admin>/ | grep -i x-robots-tag
```

Esperado: `noindex, nofollow, noarchive`.

**4. A fila de revisão responde:**

```bash
curl -sS -u '<user>:<senha>' -o /dev/null -w '%{http_code}\n' https://<dominio-do-admin>/review-queue
```

---

## Sobre o `HEALTHCHECK` aceitar 401

`/health` está atrás do Basic Auth, então o healthcheck do container aceita
**200 ou 401** como vivo. Um 401 prova que o processo subiu, roteou e aplicou o
portão — que é exatamente o que liveness precisa saber.

Aceitar só 200 exigiria embutir a credencial no `HEALTHCHECK`, ou seja, colocar
a senha na definição da imagem. A troca não vale.

---

## O que isto destrava

O tópico 10 do protocolo (primeira geração real do Entity Writer). A ordem é
obrigatória: **gerar sem ter onde revisar produz `content_blocks` presos em
`needs_review` para sempre**, porque nenhum agente pode promovê-los
(invariante 12).
