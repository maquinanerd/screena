# Mapa da arquitetura real — Cinerie / Screen-App (2026-07-30)

> **Auditoria somente.** Nenhum codigo, banco, deploy, commit ou servico foi alterado.
> Todo item abaixo cita caminho real do repositorio. Onde nao ha prova no repositorio,
> a linha diz **NAO COMPROVADO** — nao "funciona".

---

## 0. Identidade do repositorio (verificada)

| Item | Valor |
| --- | --- |
| Caminho absoluto | `E:/Área de Trabalho 2/Screnaa/.claude/worktrees/frosty-mcnulty-30a2f7` (worktree) |
| Remote | `origin` → `https://github.com/maquinanerd/screena.git` |
| Branch | `claude/cinerie-catalog-architecture-400821` |
| HEAD | `77e1c2936cd87e4162ed6e4db98bfef8b76b2639` — *Merge PR #93* (2026-07-30 12:13 -03) |
| Arvore | **limpa** (`git status --porcelain -uall` vazio) |
| Divergencia vs `origin/main` | **0 a frente / 0 atras** — o worktree e exatamente `origin/main` |
| Package manager | `pnpm@9.15.4` via Corepack (`package.json:packageManager`) |
| Node | `>=22 <23` (`package.json:engines`) |
| Workspaces | `apps/*`, `packages/*`, `api-clients/*`, `services/*` (`pnpm-workspace.yaml`) |
| Dockerfiles | `Dockerfile`, `Dockerfile.cms`, `Dockerfile.publication-worker` (**3**) |
| CI | `.github/workflows/ci.yml` — job unico, ~30 passos |
| Prisma schema publico | `packages/db/prisma/schema.prisma` — **2.740 linhas, 74 models, 60 enums** |
| Migrations publicas | `packages/db/prisma/migrations/` — **16** + `migration_lock.toml` |
| Migrations do CMS | `apps/cms/src/migrations/` — **9** (Payload) |
| Arquivos `*.test.ts` | **342** |
| `node_modules` neste worktree | **ausente** — nenhum teste foi executado nesta sessao |

Nenhum `checkout`, `fetch`, `push`, `merge` ou troca de branch foi executado.

---

## 1. Componentes reais (derivados do codigo, nao da documentacao)

| Componente | Funcao real | Entrada | Saida | Banco | Deploy esperado | Deploy comprovado? |
| --- | --- | --- | --- | --- | --- | --- |
| `apps/web` (`@screena/web`) | App publico Next App Router — catalogo + noticias + conta | HTTP | HTML/JSON/XML | `screen-db` (Prisma, leitura + escrita de usuario) | `Dockerfile` → `screen-app` | **NAO COMPROVADO no repo** (usuario declara no ar) |
| `apps/cms` (`@screena/cms`) | Payload CMS — redacao, revisao, publicacao, outbox | HTTP (humano + service account) | Documentos + `publication-outbox` | `cinerie-cms-db` (`PAYLOAD_DATABASE_URL`) | `Dockerfile.cms` → `cinerie-cms` | **NAO COMPROVADO no repo**; PR #93 (`fix/cms-easypanel-runtime-secrets`) e evidencia indireta de deploy real |
| `services/news-ingestion` bin `project-editorial.ts` | Worker de projecao: consome outbox do CMS por HTTP → escreve `screen-db` | API do Payload | `articles`, `article_translations`, `editorial_media_assets`, recibos | **screen-db apenas** (Prisma) | `Dockerfile.publication-worker` | **NAO COMPROVADO** |
| `services/ingestion` bin `catalog.ts` | CLI unica do catalogo: bootstrap, worker, sync, changes, media, episodes, search, indexabilidade, audit, dead-letter | TMDB HTTP + fila | `screen-db` | screen-db | **nenhum Dockerfile / nenhum servico** | **INEXISTENTE como servico** |
| `services/sync` | Politica de frescor/stale sobre `ingestion` | screen-db | screen-db | screen-db | systemd (legado, "ilustrativo") | **INEXISTENTE** |
| `services/entity-writer` | Entity Writer offline (Gemini) → `content_blocks` | screen-db + Gemini | `content_blocks` | screen-db | agendado | **INEXISTENTE** |
| `services/ratings` | Sync de ratings via RapidAPI (`imdb236`) | RapidAPI | `external_ratings` | screen-db | agendado | **INEXISTENTE** |
| `services/streaming` | Disponibilidade via RapidAPI + promocao humana | RapidAPI | `watch_availability` | screen-db | agendado | **INEXISTENTE** |
| `services/legal` | Registro de autorizacao/atribuicao de fontes | — | `source_licenses` | screen-db | CLI | n/a |
| `services/user-platform` | Identidade, credencial, sessao, e-mail (Brevo) | — | — | screen-db | embutido no `screen-app` | idem `screen-app` |
| `apps/admin` (`@screena/admin`) | Painel interno editorial (leitura + acoes gateadas) | HTTP | screen-db | screen-db | nenhum Dockerfile proprio | **INEXISTENTE como servico** |
| `packages/editorial-contracts` | Contratos versionados da cadeia editorial (Zod, puros) | — | — | — | biblioteca | n/a |
| `workers/*.py` | Esqueletos Python (roadmap) | — | — | — | — | **codigo morto / roadmap** |
| `api-clients/imdb`, `kaso`, `rotten_tomatoes` | Apenas `README.md`, sem `package.json` | — | — | — | — | **PLACEHOLDER** |

---

## 2. Os dois bancos e a fronteira assimetrica

```
                     ┌──────────────────────────┐
   redacao humana ──►│  cinerie-cms (Payload)   │
   MNScr (HTTP) ────►│  banco: cinerie-cms-db   │
                     └───────────┬──────────────┘
                                 │ publication-outbox
                                 │ (HTTP autenticado: claim/ack/fail)
                                 ▼
                     ┌──────────────────────────┐
                     │ cinerie-publication-worker│  ← UNICO processo que fala com os dois lados
                     └───────────┬──────────────┘
                                 │ Prisma
                                 ▼
                     ┌──────────────────────────┐
   TMDB ────────────►│        screen-db          │◄──── catalog CLI (services/ingestion)
   (catalog CLI)     └───────────┬──────────────┘
                                 │ Prisma (somente leitura de catalogo)
                                 ▼
                     ┌──────────────────────────┐
                     │  screen-app (apps/web)    │ → cinerie.com
                     └──────────────────────────┘
```

A assimetria e travada por teste: `tests/governance/editorial-worker-boundary.test.ts`
percorre o fecho transitivo de imports e prova que o worker **nao** abre conexao com o banco
do CMS (`Dockerfile.publication-worker` documenta o mesmo; o servico nao recebe
`PAYLOAD_DATABASE_URL`).

---

## 3. Rotas publicas reais (`apps/web/app`)

**32 `page.tsx` + 40 `route.ts`.**

| Grupo | Rotas |
| --- | --- |
| Home / descoberta | `/pt`, `/pt/explorar`, `/pt/busca`, `/pt/em-breve`, `/pt/onde-assistir` |
| Catalogo | `/pt/filmes`, `/pt/filmes/[slug]`, `/pt/series`, `/pt/series/[slug]`, `/pt/series/[slug]/temporadas/[season]`, `.../episodios/[episode]`, `/pt/pessoas`, `/pt/pessoas/[slug]` |
| Editorial | `/pt/noticias`, `/pt/noticias/[slug]` |
| Conta / produto pessoal | `/pt/entrar`, `/pt/criar-conta`, `/pt/recuperar-senha`, `/pt/redefinir-senha`, `/pt/verificar-email`, `/pt/conta`, `/pt/conta/privacidade`, `/pt/minha-lista`, `/pt/listas`, `/pt/listas/[id]`, `/pt/historico`, `/pt/tracker`, `/pt/importar` |
| Alias 308 | `/filmes` → `/pt/filmes/`, `/series` → `/pt/series/` (`permanentRedirect`) |
| Dev-only | `/dev/ad-preview`, `/dev/movie-page-preview` |
| SEO | `/sitemap.xml`, `/sitemaps/[shard]`, `/news-sitemap.xml`, `app/robots.ts` |
| API | `/api/auth/**` (10), `/api/account/**` (5), `/api/me/**` (17), `/api/catalog/summary`, `/api/health`, `/api/seo/redirect` |

**Nao existe** rota de categoria/tag de noticia, nem rota de recomendacoes, nem endpoint
interno de busca de entidades para consumo do CMS.

---

## 4. Endpoints do CMS (`apps/cms/src/endpoints`)

| Path | Metodo | Escopo exigido | Consumidor pretendido |
| --- | --- | --- | --- |
| `/internal/contracts` | GET | — | descoberta de contratos |
| `/internal/contracts/:contractName` | GET | — | idem |
| `/internal/editorial-drafts` | POST | `draft_ingest` | **MNScr** |
| `/internal/editorial-publications` | POST | `editorial_auto_publish` | **MNScr** (autopublicacao) |
| `/internal/publication-outbox/claim` | POST | `publication_projection` | worker |
| `/internal/publication-outbox/ack` | POST | `publication_projection` | worker |
| `/internal/publication-outbox/fail` | POST | `publication_projection` | worker |
| `/internal/publication-media/:mediaId` | GET | `publication_projection` | worker (bytes) |
| `/healthz`, `/readyz` | GET | — | EasyPanel |

Escopos canonicos: `draft_ingest`, `publication_projection`, `editorial_auto_publish`
(`apps/cms/src/outbox-api.ts:33`). Lista vazia = conta sem nenhum poder.

---

## 5. Contratos versionados (`packages/editorial-contracts/src`)

| Contrato | Direcao | Produtor no repo | Consumidor no repo |
| --- | --- | --- | --- |
| `rss-prime-event-v1` | RSS Prime → MNScr | **fora deste repo** (ADR 0015) | **fora deste repo** |
| `cinerie-editorial-context-v1` | Cinerie → MNScr | **NENHUM** — grep por `EDITORIAL_CONTEXT_CONTRACT_VERSION` fora do proprio pacote retorna **vazio** | — |
| `editorial-draft-v1` | MNScr → Payload | fora deste repo | `apps/cms/src/endpoints/editorial-drafts.ts` ✅ |
| `editorial-publication-request-v1` | MNScr → Payload | fora deste repo | `apps/cms/src/endpoints/editorial-publications.ts` ✅ |
| `publication-event-v1` | Payload → projecao | `apps/cms/src/publication.ts` ✅ | `services/news-ingestion/src/editorial-projection.ts` ✅ (**parcialmente** — ver §6) |

O proprio arquivo declara o estado: *"O Cinerie Context Service que o serve NAO faz parte
desta fase (ADR 0015, secao 3.2)."* (`cinerie-editorial-context-v1.ts:4-6`).

---

## 6. Descontinuidade critica na projecao editorial

O evento `publication-event-v1` carrega **vinculos de entidade verificados por humano**:

```ts
// packages/editorial-contracts/src/publication-event-v1.ts:75-87
export const publishedEntityLink = z.object({
  entityKind, entityId: stableId,
  relation: z.enum(['primary_subject', ..., 'compared']),
  verified: z.literal(true),
})
// :202
entities: z.array(publishedEntityLink).max(LIMITS.entitySuggestions).default([]),
```

O CMS **produz** esse campo (`apps/cms/src/publication.ts:271,308`).

O worker de projecao **nunca o le**. Prova: `grep -rn "entityLinks\|\.entities\b"` em
`services/news-ingestion/src` retorna **vazio**; o store escreve apenas
`article`, `articleTranslation`, `editorialMediaAsset` e `editorialProjectionReceipt`
(`services/news-ingestion/src/persistence/editorial-projection-store.ts:190-302`).

Consequencia: `entity_news_links` **so tem um escritor em todo o repositorio** —
`services/news-ingestion/bin/qa-editorial-seed.ts:227` (script de QA). Mas **quatro**
modulos de render dependem dele para funcionar:

- `apps/web/src/server/home-editorial.ts:89` — destaques editoriais da home
- `apps/web/src/server/news-pages.ts:266,378` — card de entidade + relacionadas
- `apps/web/src/server/related-news.ts:47` — "noticias relacionadas" nas fichas

Uma materia publicada pelo Payload chega ao site **sem nenhum vinculo de catalogo**.

---

## 7. Segunda descontinuidade: corpo estruturado nao renderizado

`article_translations.body_blocks` (Json) e projetado do CMS
(`packages/db/prisma/schema.prisma:1618+`), e o CMS mapeia 10 tipos de bloco
(`paragraph`, `heading`, `image`, `video`, `quote`, `entityCard`, `factBox`,
`relatedContent`, `sourceList`, `divider` — `apps/cms/src/publication.ts:155+`).

`grep -rn "bodyBlocks" apps/web` retorna **vazio**. A pagina publica renderiza
`view.bodyParagraphs`, derivado da coluna `body` em texto
(`apps/web/app/pt/noticias/[slug]/page.tsx:128`).

Ou seja: imagens inline, video, factBox, sourceList e entityCard escritos no CMS
atravessam a projecao e **nao aparecem**.

---

## 8. Ciclo continuo do catalogo — existe, mas sem alvo de execucao

Existe e e completo: `scripts/catalog/catalog-cycle-with-alert.sh` (snapshot → worker →
`search-reindex` → `index-decisions --apply` → snapshot → sentinela → alerta, com `flock`).

Existe o agendamento: `services/ingestion/systemd/cinerie-catalog-cycle.{service,timer}`
(horario, `Persistent=true`, jitter 300 s).

**Mas o proprio runbook registra a contradicao**
(`docs/backend/catalog-operations.md:123-124`):

> "as units se declaram 'ilustrativas' e **nunca foram instaladas** — o deploy e
> container EasyPanel, **sem systemd**."

E nao ha `Dockerfile` para o catalogo. Logo: **a maquina do catalogo existe e nao tem onde
rodar continuamente em producao.**

---

## 9. Limitacoes desta auditoria

1. `node_modules` ausente neste worktree — **nenhum teste foi executado**. Toda referencia a
   teste e leitura de arquivo, nao resultado de execucao.
2. Nenhum banco foi consultado. Volume real do catalogo, contagem de artigos publicados e
   estado da fila sao **NAO COMPROVADOS**.
3. O EasyPanel nao foi acessado. O que esta implantado hoje e **declaracao do usuario**,
   nao evidencia do repositorio.
4. `.env` nao existe neste worktree (apenas `.env.example`); nenhum segredo foi lido.
