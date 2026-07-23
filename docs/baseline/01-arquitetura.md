# 01 — Arquitetura atual

> Como o sistema está construído **hoje**, em `73c58e9`. Descreve o que existe, não o planejado.

---

## 1. Forma geral

Monorepo pnpm, TypeScript strict, ESM, com separação rígida entre **render público** e
**pipelines offline**. A regra que organiza tudo:

```
API externa ──▶ worker OFFLINE (com log) ──▶ PostgreSQL ──▶ Next lê PostgreSQL ──▶ render
                        │                        ▲
                        └── Gemini (offline) ────┘  content_blocks validados e versionados
```

Nenhuma seta cruza da direita para a esquerda: o render **nunca** chama rede externa.

---

## 2. Camadas

### 2.1 Render público — `apps/web`

- Next.js **15.5.19**, App Router, React Server Components.
- 27 rotas; 5 com ISR (`revalidate = 3600`), 12 `force-dynamic`, **nenhuma** pré-renderizada
  em build (zero `generateStaticParams`).
- Lê **exclusivamente** PostgreSQL via `getPrismaClient()` de `@screena/db/server`.
- `trailingSlash: true`; canonicalização por 308.
- Locale único em produção: `/pt/`.

### 2.2 Pipelines offline — `services/*`

| Serviço | Papel |
| --- | --- |
| `ingestion` | TMDB: discovery (Daily ID Exports), catálogo, mídia, jobs, busca — 28.643 linhas |
| `sync` | política de frescor/stale sobre `ingestion` — 110 linhas |
| `entity-writer` | geração editorial offline com Gemini, validação anti-alucinação |
| `ratings` | ratings externos via RapidAPI (governado, não público) |
| `streaming` | disponibilidade de streaming via RapidAPI (gateado por licença) |
| `legal` | registro de autorização de fontes e atribuição |
| `user-platform` | identidade, credencial, sessão, tokens, e-mail transacional |

### 2.3 Dados — `packages/db`

Prisma + PostgreSQL 16. 75 modelos, 42 enums, 12 migrations. Governança implementada **no banco**:
funções SQL versionadas, triggers de fail-close, cadeia de licenças com histórico.

### 2.4 Pacotes puros — `packages/*`

`config` (invariantes), `seo` (indexabilidade/sitemap), `schemas` (validadores),
`public-contracts` (contratos de apresentação), `ui`, `types`, `cinerie-score`.

---

## 3. A decisão arquitetural mais importante: pureza de render é estrutural

`apps/web` **não declara dependência** de nenhum api-client externo nem do Entity Writer:

```
apps/web -> @screena/db, @screena/public-contracts, @screena/seo,
            @screena/types, @screena/ui, @screena/user-platform
```

Verificado:

```bash
grep -rn "@screena/tmdb-client\|@screena/rapidapi-core\|@screena/entity-writer\|\
GoogleGenerativeAI" --include="*.ts" --include="*.tsx" apps/web/
# (nenhum resultado)
```

As invariantes **3** (zero API externa no render) e **4** (zero Gemini no render) não dependem de
disciplina nem de linter: o app público **não consegue resolver** esses módulos. A falha seria em
tempo de resolução, não em revisão de código. `pnpm audit:render` é a segunda camada (91 arquivos
varridos, 0 violações).

Única aresta com capacidade de rede em `apps/web`: `@screena/user-platform` → Brevo, alcançada
apenas pelas rotas `/api/auth/**` (handlers, não páginas indexáveis).

---

## 4. SEO como fonte única

Toda decisão de indexabilidade sai de **uma** função, `resolvePageSeo()`
(`packages/seo/src/resolver.ts:193`), com 8 níveis de precedência (detalhe em
[`06-ambiente-flags-e-bloqueios.md`](06-ambiente-flags-e-bloqueios.md) §3.3).

Duas garantias estruturais:

1. `includeInSitemap === (decision === 'index')` — sitemap e `<meta robots>` derivam da mesma
   resolução e **não conseguem** discordar.
2. Todo `robots` de página passa por `publicRobots()`/`gatePublicRobots()`, que começam com
   `if (!isOfficialIndexableEnvironment(env)) return NOINDEX` — um ponto único de estrangulamento,
   fail-closed.

---

## 5. Governança no banco, não só no código

Padrão distintivo deste projeto: as invariantes de licença e atribuição são impostas por
**triggers e constraints PostgreSQL**, não apenas por validação em TypeScript. Exemplos
exercitados pelos validadores:

- `external_ratings`: trigger recusa `provider_api = rating_source` (invariante 2) e escala
  incompatível com a fonte (invariante 1) — `RAISE EXCEPTION` no banco.
- `watch_availability_display_guard`: `display_allowed = true` é impossível sem hash de payload
  aprovado + revisor + licença + atribuição.
- `source_licenses`: cadeia `supersedes_id` com guard cross-group; licença supersedida
  **bloqueia** reescrever a nota exibida.

Consequência: mesmo um bug de aplicação não consegue publicar dado sem licença.

---

## 6. Fluxos principais

### 6.1 Ingestão de catálogo
`Daily ID Exports (TMDB)` → filtro fail-closed de conteúdo adulto → fila `catalog_jobs` →
`api_cache` (bruto) → normalização → tabelas finais → `api_sync_logs`.
Validado: `validate:tmdb-platform` 15/15, `validate:catalog-platform-complete` 78/78.

### 6.2 Geração editorial
Payload controlado do PostgreSQL → prompt versionado (`prompts/`) → Gemini **offline** →
validação anti-alucinação → `content_blocks` com `prompt_version`, `input_hash`, `output_hash`,
`model_provider`, `model_name`, `review_status`, `warnings_json`.
Publicação **nunca** é automática.

### 6.3 Render de página de entidade
Request → middleware (locale/canonical) → RSC lê PostgreSQL → presenter puro →
`resolvePageSeo()` decide robots/canonical → JSON-LD tipado → HTML.
Zero rede externa.

### 6.4 Autenticação
`POST /api/auth/*` → validação de payload → throttle durável → scrypt → token de uso único →
Brevo (e-mail) → confirmação.
Validado: 141/141 em PostgreSQL real.

---

## 7. Build e deploy

- Imagem: `node:22-bookworm-slim` (`Dockerfile:1`).
- **Nenhuma env pública é assada na imagem** (corrigido no PR #73).
- Boot: `prisma migrate deploy` **e falha ruidosa** se não conseguir — o app não sobe com banco
  inconsistente (`Dockerfile:69`).
- Sem `HEALTHCHECK` (risco **R-27**).
- Migrations são **forward-only**: não há down-migration; rollback de schema depende de restore
  de dump (ver [`13-rollback.md`](13-rollback.md)).

---

## 8. Onde a arquitetura está frágil

| Ponto | Detalhe |
| --- | --- |
| Gates que não protegem | `typecheck` e `vitest` não cobrem `apps/**`; `db:validate:pgcrypto` fora da CI (**R-03/05/06**) |
| Documentação desatualizada | `CLAUDE.md` §5 omite 6 workspaces; regras ainda exigem gate removido (**R-12/14**) |
| Duplicação de constante | `PUBLISHED_LOCALES` em dois lugares com valores diferentes (**R-07**) |
| Código morto apresentado como canônico | `seo/` na raiz (**R-28**) |
| Ausência de E2E e de boundaries de erro | (**R-24/25**) |
| Recuperação | backup nunca validado; sem down-migration (**R-02**, P0) |
