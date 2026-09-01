# FASE 1 — Auditoria do repositório `kal-el`

**Cobertura: abri e li 12 de 532 arquivos versionados (2,3%).**

| Instrumento | Alcance |
| --- | --- |
| Leitura integral ou substancial | **12 arquivos** |
| Varredura por padrão | **100% dos 532**, em 10 varreduras |
| Execução | `pnpm test:unit` (**38 testes**) + `pnpm test:integration` (ver D7) |
| Inspeção de esquema | as **6 migrations Drizzle**, das quais extraí as 27 tabelas |

Dos 532 arquivos, **106 são imagem** (PNG/WEBP) e **121 são Markdown** — 43% do
denominador não é código. `artifacts/` (79 arquivos) e `design-system/` (47) são
material de referência.

> **Aviso sobre o estado do disco:** o repositório está na branch
> **`feat/login-comic-caption`**, não em `main`, e há 12 worktrees em
> `.claude/worktrees/` com cópias completas. Auditei o que está no disco e todas
> as contagens usam `git ls-files`/`git grep`, nunca busca recursiva.

---

## Sumário — os cinco achados mais graves

| # | Achado | Gravidade |
| --- | --- | --- |
| 1 | **A imagem de produção do CMS não copia `apps/cms/public/`.** O `Dockerfile` diz, em comentário, "no `public/` directory exists yet" — e o diretório existe, com o hero da tela de login e as duas marcas, todos referenciados pelo código. O próprio comentário previu o desfecho: "the assets in it will simply 404 with nothing saying why". | **ALTO** |
| 2 | **Não existe leitura pública de conteúdo.** Todas as rotas de `/sites/:siteId/**` passam por `requireSiteScope` + `guard(permissão)`. Não há endpoint anônimo que devolva artigo publicado. Para a arquitetura declarada ("frontends nunca acessam o banco"), isso obriga todo portal a carregar credencial. | **ALTO** (decisão de arquitetura, não bug) |
| 3 | **O sistema nunca foi implantado.** Nenhum serviço no painel EasyPanel, nos 12 projetos, tem origem `kal-el`. Todo julgamento sobre "pronto para substituir o Payload" é sobre um sistema que nunca subiu. | **ALTO** (operacional) |
| 4 | **A cobertura de teste unitário é rasa onde mais importa.** 38 testes unitários no total, e **zero** em `apps/api` (que tem 22 arquivos de teste, todos de integração) — o núcleo de permissão, publicação e outbox só é exercitado com Postgres embarcado. | **MÉDIO** |
| 5 | **`packages/design-system` tem 47 arquivos e `artifacts/` tem 79** — 24% do repositório é material de referência versionado junto com o código. | **BAIXO** |

Contraponto forte: **o modelo de dados é o de um CMS maduro** — 27 tabelas com
outbox, webhooks assinados, revisões de artigo, RBAC completo, tokens de
serviço, chaves de idempotência, trilha de auditoria e multi-site desde o
primeiro dia. Em capacidade de plataforma, não é um protótipo.

---

## D1 — Estrutura e build

### O que é (três frases minhas)

1. É um CMS editorial *API-first*: um servidor Fastify que expõe a API de
   conteúdo, um painel Next.js separado que consome essa mesma API, e um worker
   para tarefas assíncronas.
2. Ele foi desenhado explicitamente para substituir o papel editorial de
   WordPress ou Payload sem acoplar conteúdo a um frontend — vários portais
   consumiriam a mesma API estável.
3. A plataforma é multi-site desde o esquema: todo conteúdo pende de um `siteId`,
   e a autorização é por escopo de site mais permissão nomeada.

### Árvore

| Caminho | Arquivos | Papel |
| --- | ---: | --- |
| `apps/api` | 63 | Servidor Fastify: rotas, serviços, plugins de auth/idempotência/erros |
| `apps/cms` | 72 | Painel Next.js (inclui 10 arquivos de E2E Playwright) |
| `apps/worker` | 18 | Worker assíncrono (heartbeat próprio em `worker_heartbeats`) |
| `apps/fixture` | 8 | Portal de exemplo consumindo a API |
| `packages/db` | 30 | Drizzle: esquema em 5 arquivos + 6 migrations SQL |
| `packages/design-system` | 47 | Tokens e componentes |
| `packages/importer` | 18 | Importação (de WordPress, presumivelmente) |
| `packages/contracts` | 13 | Schemas Zod compartilhados |
| `packages/auth` | 7 | Argon2id, sessão |
| `packages/editor` | 6 | Editor de texto |
| `packages/sdk` | 5 | Cliente da API |
| `packages/events` | 3 | Assinatura HMAC de webhook |
| `packages/testkit` | 4 | Postgres embarcado para teste |
| `artifacts/` | 79 | Material de referência |
| `docs/` | 89 | Documentação |

**21.199 linhas de TS + 10.143 de TSX.**

### Build e teste

| Comando | Resultado |
| --- | --- |
| `pnpm test:unit` | **38 testes, 100% verde** (contracts 15, editor 11, sdk 7, auth 5) |
| `pnpm test:integration` | ver D7 |
| `pnpm build`, `typecheck`, `lint` | **NÃO RODEI** — priorizei os testes; fecha com `corepack pnpm run typecheck && corepack pnpm run build` |

O `pnpm-workspace.yaml` merece nota positiva: o comentário nele registra um
defeito real que foi corrigido —

> "Four of these were previously numbered keys (`'0': esbuild`) and two were the
> literal string pnpm prints when it wants an answer — so the file parsed but
> approved nothing, and the build scripts of every package below were skipped
> silently on every install."

Um arquivo de configuração que parseava e não aprovava nada é exatamente a
classe de defeito silencioso que esta auditoria procura, e aqui ele já foi
achado e documentado no lugar certo.

### CI

`.github/workflows/ci.yml` existe.

### Serviço que roda este código

**Nenhum.** Confirmei nos 12 projetos do painel. Existem `docker-compose.yml` e
`docker-compose.prod.yml` com três serviços (`api`, `worker`, `cms`) mais
`postgres:17-alpine`, e Dockerfiles por app — a implantação está **escrita**,
não **executada**.

---

## D2 — Banco

**PostgreSQL + Drizzle.** Esquema em `packages/db/src/schema/` (`editorial.ts`,
`identity.ts`, `media.ts`, `sites.ts`, `system.ts`) e **6 migrations SQL**
(`0000_furry_psynapse` … `0005_hot_sabretooth`).

### As 27 tabelas

| Domínio | Tabelas |
| --- | --- |
| Editorial | `articles`, `article_revisions`, `article_authors`, `article_categories`, `article_tags`, `article_entities` |
| Taxonomia | `authors`, `categories`, `tags`, `entities`, `sources` |
| Identidade / RBAC | `users`, `sessions`, `roles`, `permissions`, `role_permissions`, `user_roles`, `service_tokens` |
| Multi-site | `sites` |
| Mídia | `media` |
| Integração | **`outbox_events`**, `webhooks`, `webhook_deliveries` |
| Infra | `idempotency_keys`, `audit_log`, `redirects`, `worker_heartbeats` |

Isso é um modelo de CMS completo. Três coisas que ele tem e que normalmente
faltam num projeto de 18 dias: **outbox** (entrega confiável de eventos),
**`idempotency_keys`** (repetição segura de POST) e **`article_revisions`**
(histórico versionado).

**NÃO DETERMINADO:** contagem de linhas — não há banco de produção para medir.
Fecha com `docker compose up db` e `SELECT count(*)` por tabela após seed.

---

## D3 — APIs externas

**Praticamente nenhuma.** O `.env` local tem 12 variáveis, todas locais:
`DATABASE_URL`, `APP_BASE_URL`, `API_BASE_URL`, `PORT`, `HOST`,
`SESSION_SECRET`, `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `BOOTSTRAP_TOKEN`,
`MEDIA_STORAGE_PROVIDER`, `MEDIA_LOCAL_PATH`, `MEDIA_MAX_BYTES`.

**Nenhuma chave de fornecedor externo.** Sem Gemini, sem TMDB, sem OMDb. Como
consequência direta, kal-el **não participa de nenhuma disputa de cota** — o que
é uma vantagem real dele na FASE 4.

A saída externa é o **webhook**, com assinatura HMAC-SHA256 e verificação em
tempo constante ([`packages/events/src/index.ts`](packages/events/src/index.ts)):

```typescript
export function verifyWebhookSignature(secret, body, signature): boolean {
  const expected = signWebhook(secret, body);
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Cabeçalhos próprios: `x-kal-el-signature`, `x-kal-el-event`,
`x-kal-el-delivery`, `x-kal-el-idempotency`.

---

## D4 — Filas, jobs, agendamento

`apps/worker` (18 arquivos) com `worker_heartbeats` no banco — o worker registra
que está vivo, o que permite provar por consulta que rodou.

O `outbox_events` + `webhook_deliveries` implementam o padrão transactional
outbox: o evento é gravado na mesma transação da mudança e entregue depois, com
registro de tentativa.

**A VOLTA não se aplica**: não há universo fechado a varrer — é entrega dirigida
por evento, não varredura.

**NÃO DETERMINADO:** cadência do worker, política de retry/backoff e se há
dead-letter. Fecha com `sed -n '1,80p' apps/worker/src/index.ts` e o esquema de
`webhook_deliveries`.

---

## D5 — Superfície HTTP

Cinco grupos de rota, registrados em `apps/api/src/app.ts:91-95`:
`healthRoutes`, `authRoutes`, `adminRoutes`, `siteRoutes`, `previewRoutes`.

### O achado 2, em detalhe

Todo o conteúdo vive sob `siteRoutes`, e o grupo inteiro tem este `preHandler`
([`apps/api/src/routes/site.ts:85`](apps/api/src/routes/site.ts)):

```typescript
siteApp.addHook("preHandler", async (req) => {
  ...
  await requireSiteScope(app, req, params.siteId);
});
```

E **cada** rota ainda carrega o seu próprio `guard(...)`:

```typescript
siteApp.get("/articles",  { preHandler: guard("articles.read")   }, ...)
siteApp.post("/articles", { preHandler: guard("articles.create") }, ...)
```

Não existe rota anônima que devolva artigo publicado. O `previewRoutes` usa
token de preview (`createPreviewToken`), que é para rascunho, não para o público.

**Isso não é bug — é a arquitetura declarada.** O README diz "Frontends never
access the database directly" e "Delivery: cached frontend rendering with
targeted/on-demand revalidation": o modelo é o portal buscar com credencial e
cachear. Mas é uma **diferença material** em relação ao Payload no Cinerie de
hoje, e a FASE 4 precisa dela explicitada.

### Segurança de plataforma já montada

`apps/api/src/app.ts` registra, nesta ordem: `cookie`, `cors`, `helmet`,
`rateLimit`, `multipart` (com `files: 1` e teto `MEDIA_MAX_BYTES`), `dbPlugin`,
`authPlugin`, `swagger` + `swaggerUi`.

Dois pontos a marcar:
- **`helmet` com `contentSecurityPolicy: false`** (`app.ts:63`) — CSP
  desabilitada explicitamente. O mesmo buraco do `screena`, aqui numa API (onde
  pesa menos, mas o painel Next é servido à parte).
- **Swagger UI condicional** (`app.ts:88`) — bom, desde que a condição seja
  ambiente. **NÃO DETERMINADO** qual é a condição; fecha com
  `sed -n '84,90p' apps/api/src/app.ts`.

### Permissão: a transição privilegiada é barrada na criação

Este trecho ([`site.ts:107-112`](apps/api/src/routes/site.ts)) é bem pensado e
merece registro, porque é o erro que quase todo CMS comete:

```typescript
// R0.1: creating directly into a published/scheduled state is a privileged
// transition and must not be reachable with articles.create alone.
if (wantsPublished) permissionDenied(req, "articles.publish");
if (wantsScheduled) permissionDenied(req, "articles.schedule");
```

Ou seja: `POST /articles` com `status: "published"` **não** publica com permissão
de criação. Exige `articles.publish`. É a mesma classe de defeito que o ADR 0017
do `screena` resolveu com atores distintos.

---

## D6 — Segurança

### Segredos

Há um `.env` no disco (12 variáveis) e ele **não está versionado**. Nenhum
segredo em código.

`SESSION_SECRET` (33 chars) e `BOOTSTRAP_TOKEN` (27) estão preenchidos;
`COOKIE_SECURE` está definido.

### Autenticação e autorização

- Senha com **Argon2id** (`@node-rs/argon2` aprovado no `allowBuilds`).
- Sessão em tabela (`sessions`), com TTL configurável.
- **RBAC desde o esquema**: `roles`, `permissions`, `role_permissions`,
  `user_roles`.
- **Escopo por site** verificado em `preHandler` do grupo — não por rota
  individual, o que é o desenho certo: uma rota nova nasce protegida.
- **Tokens de serviço** em tabela própria (`service_tokens`).
- **Trilha de auditoria** (`audit_log`), importada em `site.ts:5`.

Essa é, das quatro bases, a que tem o modelo de autorização mais completo.

### Entrada não confiável

- Validação por **Zod** em todo corpo e query (`@kal-el/contracts`), com
  `uuidSchema.safeParse` até no `siteId` do path.
- Upload limitado a 1 arquivo e `MEDIA_MAX_BYTES`.
- Sem `eval`; sem SQL por concatenação (Drizzle).

### Dependências

**NÃO DETERMINADO** — não rodei `pnpm audit`.

---

## D7 — Testes

| Escopo | Arquivos | Resultado |
| --- | ---: | --- |
| `apps/api/tests` | **22** | integração (Postgres embarcado) |
| `apps/cms/e2e` | 10 | Playwright |
| `packages/importer/tests` | 5 | — |
| `apps/worker/tests` | 3 | — |
| `packages/db/tests` | 2 | inclui `migration.test.ts` |
| `apps/fixture/tests` | 2 | — |
| `packages/{sdk,editor,contracts,auth}/tests` | 4 | **unitário: 38 testes, 100% verde** |

Os nomes dos testes de `apps/api` são um bom sinal do que foi levado a sério:
`admin-isolation.test.ts`, `hardening.test.ts`, `privilege-trail.test.ts`,
`security.test.ts`, `articles.test.ts`.

### O achado 4

**`pnpm test:unit` executa 38 testes, e nenhum deles é de `apps/api`.** Todo o
núcleo — permissão, publicação, outbox, idempotência — depende de um Postgres
embarcado subir. Isso não é errado (é o teste mais fiel), mas cria uma
dependência frágil: qualquer problema de ambiente derruba a cobertura inteira do
que mais importa, e sobram 38 testes de contrato, editor, SDK e auth.

Comparação honesta com os vizinhos: `screena` tem 7.567 testes, MNScr 3.521,
RSSPRIME 564. kal-el tem 38 unitários + o que a integração rodar.

Cobertura de linhas: **não há ferramenta configurada**.

---

## D8 — Dívida

### O achado 1 — o comentário que envelheceu em um dia

[`apps/cms/Dockerfile:28`](apps/cms/Dockerfile):

```dockerfile
COPY --from=build /app/apps/cms/.next/standalone ./
COPY --from=build /app/apps/cms/.next/static ./apps/cms/.next/static
# no `public/` directory exists yet; add a COPY for it here if one is introduced, or the
# assets in it will simply 404 with nothing saying why
```

O diretório **existe**, com três arquivos versionados:

| Arquivo | Usado em |
| --- | --- |
| `apps/cms/public/login-hero.webp` | `apps/cms/app/login/page.tsx:48` — `src="/login-hero.webp"` |
| `apps/cms/public/brand/kal-el-wordmark.png` | `apps/cms/components/BrandLogo.tsx:19` |
| `apps/cms/public/brand/kal-el-mark.png` | `apps/cms/components/BrandLogo.tsx:21` |

E a linha do tempo fecha o caso:

| Data | Evento |
| --- | --- |
| **2026-08-19** | `apps/cms/Dockerfile` — *"finalize production configuration and deploy commands"*. O comentário era **verdade** neste dia. |
| **2026-08-20** | `apps/cms/public/` — *"merge(login-page): brand typography and the rebuilt login screen"*. O comentário virou **mentira** um dia depois. |
| hoje | O `Dockerfile` nunca foi atualizado. |

Consequência na imagem de produção: a tela de login perde a arte e **o logo da
marca some de todo o painel**, com 404 silencioso — exatamente o que o
comentário avisou que aconteceria.

É a dívida mais barata de pagar de toda esta auditoria (uma linha `COPY`) e uma
das de efeito mais visível.

### Comentários

Encontrei **um** comentário falso — o do Dockerfile acima. Os demais que li
(`pnpm-workspace.yaml`, `site.ts` R0.1, `packages/events`) são verdadeiros e
explicam o porquê.

### Peso de material não-código

`artifacts/` (79 arquivos), `design-system/` (47), `docs/` (89), 106 imagens,
121 Markdown, e um **`kal-el-repository-v2.zip`** e um `RECOVERY-DIFF.patch` na
raiz. Somados, a maior parte do repositório não é código executável.

### Branch

O disco está em `feat/login-comic-caption`. Auditar uma feature branch como se
fosse o produto é um risco que declaro em vez de esconder.

---

## Tabela de achados

| # | Grav. | Arquivo:linha | Achado | Evidência | Consequência |
| --- | --- | --- | --- | --- | --- |
| K-01 | **ALTO** | `apps/cms/Dockerfile:28` | Comentário afirma que `public/` não existe; existe desde 2026-08-20 e não é copiado | código + `git log` | Login sem arte e logo ausente no painel, com 404 silencioso |
| K-02 | **ALTO** | `apps/api/src/routes/site.ts:85` | Nenhuma leitura pública de artigo publicado | código | Todo portal consumidor precisa de credencial |
| K-03 | **ALTO** | painel (ausência) | Nunca implantado | painel | Decisão de substituir o Payload é sobre sistema não exercitado |
| K-04 | **MÉDIO** | `apps/api/tests/**` | Zero teste unitário no núcleo; tudo depende de Postgres embarcado | execução | 38 testes unitários cobrem periferia, não permissão/publicação |
| K-05 | **MÉDIO** | `apps/api/src/app.ts:63` | `helmet` com `contentSecurityPolicy: false` | código | CSP desligada explicitamente |
| K-06 | **BAIXO** | `apps/api/src/app.ts:88` | Swagger UI condicional — condição não verificada | código | **NÃO DETERMINADO** se `/docs` fica exposto em produção |
| K-07 | **BAIXO** | raiz | `kal-el-repository-v2.zip`, `RECOVERY-DIFF.patch` versionados | `git ls-files` | Artefatos de recuperação no controle de versão |
| K-08 | **BAIXO** | disco | Branch `feat/login-comic-caption`, não `main` | `git branch` | O que auditei pode não ser o que será implantado |

---

## Capacidades de CMS — o inventário que a FASE 4 precisa

| Capacidade | kal-el tem? | Evidência |
| --- | --- | --- |
| Coleções / tipos de conteúdo | **Sim** | `articles`, `authors`, `categories`, `tags`, `entities`, `sources`, `media`, `redirects` |
| Campos validados | **Sim** | Zod em `@kal-el/contracts`, 13 arquivos |
| Editor de texto rico | **Sim** | `packages/editor` (6 arquivos, 11 testes) |
| Upload / mídia | **Sim** | `services/media.ts`, `multipart` com teto, provider interface (`MEDIA_STORAGE_PROVIDER`) |
| Autenticação | **Sim** | Argon2id + sessão em tabela |
| Permissões (RBAC) | **Sim, completo** | `roles`, `permissions`, `role_permissions`, `user_roles` + `guard()` por rota |
| Multi-site | **Sim, de origem** | `sites` + `requireSiteScope` |
| Versionamento / rascunho | **Sim** | `article_revisions`; máquina de estados com `submit`/`approve`/`reject`/`schedule`/`publish`/`unpublish`/`archive` |
| API de leitura | **Sim, autenticada** | `siteRoutes` — **sem caminho anônimo** (K-02) |
| Webhooks | **Sim, assinados** | HMAC-SHA256 + `timingSafeEqual`; `webhooks`, `webhook_deliveries` |
| Outbox / entrega confiável | **Sim** | `outbox_events` |
| Idempotência | **Sim** | `idempotency_keys` + header `Idempotency-Key` |
| Trilha de auditoria | **Sim** | `audit_log` |
| Tokens de serviço | **Sim** | `service_tokens` |
| Migrations | **Sim** | 6 migrations Drizzle + `migration.test.ts` |
| Preview de rascunho | **Sim** | `previewRoutes` + `createPreviewToken` |
| Importador | **Sim** | `packages/importer` (18 arquivos, 5 testes) |
| **Implantado** | **NÃO** | nenhum serviço no painel |
| **Exercitado com dado real** | **NÃO** | nenhum banco de produção |

---

## O que NÃO determinei — e o comando que fecha

| Item | Comando |
| --- | --- |
| Resultado de `test:integration` | `corepack pnpm run test:integration` (rodando; Postgres embarcado leva minutos) |
| `build`, `typecheck`, `lint` | `corepack pnpm run typecheck && corepack pnpm run lint && corepack pnpm run build` |
| Condição de exposição do Swagger UI | `sed -n '84,90p' apps/api/src/app.ts` |
| Cadência, retry e dead-letter do worker | `sed -n '1,80p' apps/worker/src/index.ts` |
| Origem do `packages/importer` (WordPress?) | `sed -n '1,40p' packages/importer/src/index.ts` |
| Vulnerabilidades de dependência | `corepack pnpm audit --audit-level=moderate` |
| Se `main` difere da branch auditada | `git diff --stat main..feat/login-comic-caption` |

---

## Anexo — os 12 arquivos que abri

`README.md` · `pnpm-workspace.yaml` · `package.json` · `docker-compose.prod.yml`
(trechos) · `apps/cms/Dockerfile` · `apps/api/src/app.ts` (trechos de registro) ·
`apps/api/src/routes/site.ts` (120 linhas) · `packages/events/src/index.ts` ·
`apps/cms/app/login/page.tsx` (linha do asset) ·
`apps/cms/components/BrandLogo.tsx` (linhas dos assets) ·
`packages/db/drizzle/*.sql` (as 6, lidas por `CREATE TABLE`) · `.env` (só nomes)

**Não abri:** os 63 de `apps/api` além de `site.ts` e `app.ts` — em especial
`services/articles.ts`, `services/webhooks.ts` e `plugins/auth.ts`, que são o
núcleo e merecem uma segunda passagem; os 72 de `apps/cms`; os 18 do worker; os
47 do design system; os 79 de `artifacts/`; os 89 de `docs/`; as 106 imagens.
