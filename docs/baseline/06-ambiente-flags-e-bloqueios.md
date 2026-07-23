# 06 — Variáveis de ambiente, feature flags, `noindex` e bloqueios de produção

> Inventário de configuração e de tudo que pode impedir uma página de indexar ou uma feature de
> funcionar. SHA `73c58e9`. **Todos os fatos deste documento foram verificados diretamente pelo
> autor do baseline** (leitura de arquivo + execução), não por agente auxiliar.

---

## 1. Variáveis de ambiente lidas pelo código do projeto

Extraídas por varredura de `process.env` **restrita ao código do projeto** (excluindo
`node_modules`), em `apps/`, `packages/`, `services/`, `api-clients/`, `scripts/`, `tests/`:

| Variável | Onde é lida | Obrigatória | Exposta ao navegador |
| --- | --- | --- | --- |
| `DATABASE_URL` | `packages/db` (Prisma) | **sim** | não |
| `NODE_ENV` | vários | não (default `development`) | não |
| `VERCEL_ENV` | `apps/web/src/lib/site.ts:60` | não | não |
| `CINERIE_PUBLIC_SITE_URL` | `apps/web/src/lib/site.ts:30` | recomendada | não |
| `CINERIE_PUBLIC_INDEXING_ENABLED` | `apps/web/src/lib/site.ts:33` | não (default **false**) | não |
| `THE_SCREEN_PUBLIC_SITE_URL` | `site.ts:44` — **legado/fallback** | não | não |
| `THE_SCREEN_PUBLIC_INDEXING_ENABLED` | `site.ts:45` — **legado/fallback** | não | não |
| `TMDB_READ_ACCESS_TOKEN` | `api-clients/tmdb` | sim (para ingestão) | não |
| `TMDB_API_KEY` | `api-clients/tmdb` (fallback v3) | não | não |
| `RAW_SYNC_MAX_REQUESTS` | `services/ingestion` | não | não |
| `BREVO_API_KEY` | `services/user-platform/src/auth-runtime/config.ts:24` | sim (para e-mail) | não |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` / `BREVO_REPLY_TO_EMAIL` | `auth-runtime/config.ts` | sim (para e-mail) | não |
| `BREVO_TEST_RECIPIENT` / `BREVO_SMOKE_CONFIRM` | `services/user-platform/scripts/smoke-brevo-transactional-email.ts` | só no smoke manual | não |
| `ADMIN_PROTECTION_ENABLED` | `apps/admin/src/lib/access-protection.ts:53` | **sim em produção** | não |
| `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` | `access-protection.ts:54-55` | **sim em produção** | não |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | `apps/admin/src/lib/editorial-action-policy.ts:76` | não (default **false**) | não |

### 1.1 Segurança de segredos — verificado

- ✅ **Nenhum segredo real está versionado.** `.env.example` traz apenas placeholders
  (`GEMINI_API_KEY="your_gemini_api_key_here"`, `.env.example:45`).
- ✅ **Nenhuma variável `NEXT_PUBLIC_*` real existe no projeto.** A única ocorrência do token
  `NEXT_PUBLIC_ADMIN_PASS` está num **teste negativo** que prova que o detector de vazamento o
  pegaria: `tests/admin/no-secret-leak.test.ts:185`.
- ✅ `BREVO_API_KEY` é server-only, isolado por teste de fronteira dedicado
  (`services/user-platform/src/auth-runtime/__tests__/boundary.test.ts:194,214`) e por
  `transpilePackages` com comentário explícito (`apps/web/next.config.ts:35-38`).
- ✅ **Sem default inseguro**: o código recusa `BREVO_API_KEY` vazia em vez de degradar em silêncio
  (`services/user-platform/src/auth-runtime/config.ts:11`).

### 1.2 Divergência: `.env.example` ensina os nomes legados

`.env.example:20-24` documenta apenas `THE_SCREEN_PUBLIC_SITE_URL` e
`THE_SCREEN_PUBLIC_INDEXING_ENABLED`. Os nomes canônicos são `CINERIE_*`
(`apps/web/src/lib/site.ts:30,33`); os `THE_SCREEN_*` são fallback explicitamente marcado como
"remover após migrar a configuração dos ambientes" (`site.ts:38-42`).

`.env.example` também **não menciona** nenhuma das variáveis `BREVO_*` nem `ADMIN_*`, embora
`ADMIN_BASIC_AUTH_*` seja **obrigatória em produção**. Risco **R-06** (P1) — quem provisiona um
ambiente novo a partir do template não configura a proteção do admin.

---

## 2. Feature flags e kill switches

| Flag | Default | Efeito quando desligada | Parser |
| --- | --- | --- | --- |
| `CINERIE_PUBLIC_INDEXING_ENABLED` | **false** | Site inteiro sai do índice: `robots.txt` vira `Disallow: /` e toda página vira `noindex,nofollow` | fail-closed (`site.ts:81-86`) |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | **false** | Admin vira somente leitura; a UI exibe "Acoes desativadas por ambiente" (`bulk-action-panel.tsx:75`) | `=== "true"` (`editorial-action-policy.ts:16`) |
| `ADMIN_PROTECTION_ENABLED` | — | Exige Basic Auth no admin | `access-protection.ts:53` |

### 2.1 O kill switch de indexação é fail-closed — provado

```ts
export function parseBooleanEnvFlag(raw: string | undefined): boolean {
  const value = readTrimmed(raw);
  if (value === null) return false;
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1";
}
```
`apps/web/src/lib/site.ts:81-86`

Somente `"true"` e `"1"` ligam. **Ausente, vazio ou qualquer valor inválido desliga.** O comentário
do código registra o bug histórico que motivou isso: a leitura anterior era `flag !== "1"`, que fazia
um operador escrevendo `=true` **desligar** a indexação sem perceber.

A precedência também é deliberada e documentada (`site.ts:88-101`): o nome novo, **se definido**,
vence — mesmo vazio — para que o `THE_SCREEN_PUBLIC_INDEXING_ENABLED=1` que já esteve assado em
imagem Docker não reative a indexação contra a vontade do operador.

**Comprovação empírica:** no smoke test desta auditoria, com origem `http://localhost:<porta>`
(não oficial), `GET /robots.txt` retornou literalmente `User-Agent: *` + `Disallow: /`
(`11-validacao-execucoes.md` §5, check 16).

---

## 3. Inventário completo de pontos de `noindex`

Todo `robots` de página pública passa por **um único ponto de estrangulamento**:
`publicRobots()` ou `gatePublicRobots()` (`apps/web/src/lib/site.ts:203,220`), e ambos começam com

```ts
if (!isOfficialIndexableEnvironment(env)) return NOINDEX;
```

### 3.1 `noindex` permanente por natureza da página (correto por design)

| Rota | Arquivo | Motivo |
| --- | --- | --- |
| `/pt/busca/` | `apps/web/app/pt/busca/page.tsx:25` | página de busca nunca indexa |
| `/pt/redefinir-senha/` | `apps/web/app/pt/redefinir-senha/page.tsx:21` | transacional, só faz sentido com token |
| `/pt/verificar-email/` | `apps/web/app/pt/verificar-email/page.tsx:26` | transacional |
| `/dev/movie-page-preview` | `apps/web/app/dev/movie-page-preview/page.tsx:5` | rota técnica de preview |

### 3.2 `noindex` técnico condicional (entidade ausente/inválida)

| Rota | Arquivo:linha |
| --- | --- |
| `/pt/filmes/[slug]/` | `page.tsx:49` |
| `/pt/series/[slug]/` | `page.tsx:119` |
| `/pt/pessoas/[slug]/` | `page.tsx:82` |
| `/pt/noticias/[slug]/` | `page.tsx:30` |
| `/pt/series/[slug]/temporadas/[season]/` | `page.tsx:33,37` |
| `.../episodios/[episode]/` | `page.tsx:35,39` |

### 3.3 `noindex` por decisão persistida (fonte única)

Páginas de detalhe usam `gatePublicRobots(seo.robots)`, onde `seo.robots` vem de
`resolvePageSeo()` (`packages/seo/src/resolver.ts:193`). A precedência **real implementada** é de
**8 níveis**:

1. Exclusão explícita persistida → `noindex,nofollow`
2. Rating com licença bloqueada → `blocked` (invariante 6)
3. Notícia sem atribuição/linkback → `blocked`
4. Idioma fora de `PUBLISHED_LOCALES` → `draft` (invariante 7)
5. Conteúdo invalidado → `stale`
6. Entidade não publicada → `noindex` (`entity-not-published`)
7. Caso técnico (sem dados estruturados) → `noindex` (`technical-invalid`)
8. Caso contrário → **`index`** (indexação total)

`packages/seo/src/resolver.ts:178-186`

> **Garantia estrutural:** `includeInSitemap` é literalmente `decision === 'index'`, derivado da
> mesma resolução que produz o `<meta robots>`. Sitemap e meta tag **não conseguem** discordar.

⚠️ `.claude/rules/seo.md` documenta apenas 4 desses 8 níveis — divergência **D-11**.

---

## 4. Bloqueios de produção (o que impede operar hoje)

| # | Bloqueio | Evidência | Severidade |
| --- | --- | --- | --- |
| B-1 | **Catálogo vazio.** O seed não insere nenhuma entidade; é preciso rodar ingestão TMDB com credencial real | `10-catalogo-contagens.md` §1 | **P0** |
| B-2 | **Backup nunca validado.** A regra do próprio repo proíbe sync/promote em produção sem backup verificado | `scripts/backup/README.md:13` | **P0** |
| B-3 | `ADMIN_BASIC_AUTH_*` ausente do `.env.example` | `.env.example` (sem menção) | **P1** |
| B-4 | `pgcrypto` precisa existir **no schema `public`**, senão o contêiner não sobe | `Dockerfile:69` | **P1** (mitigado: falha ruidosa) |
| B-5 | Sem `HEALTHCHECK` no contêiner | `Dockerfile` | **P2** |
| B-6 | Sem E2E; sem teste de regressão visual | `11-validacao-execucoes.md` §4 | **P2** |

---

## 5. Superfície de rede em produção

| Origem | Destino externo | Momento | Compatível com invariante 3? |
| --- | --- | --- | --- |
| `services/ingestion` / `sync` | TMDB | offline (worker) | ✅ sim |
| `services/ratings` | RapidAPI (Film & Show Ratings) | offline (worker) | ✅ sim |
| `services/streaming` | RapidAPI (Streaming Availability) | offline (worker) | ✅ sim |
| `services/entity-writer` | Gemini | offline (worker) | ✅ sim |
| `apps/web` → `/api/auth/**` | **Brevo** (e-mail transacional) | request de API, **não** render de página indexável | ✅ sim |
| `apps/web` páginas públicas | **nenhum** | — | ✅ sim |

Os únicos `fetch()` em `apps/web` são client-side para a **própria origem**:
`apps/web/app/pt/redefinir-senha/token-form.tsx:53` e
`apps/web/app/pt/verificar-email/token-form.tsx:30`.
