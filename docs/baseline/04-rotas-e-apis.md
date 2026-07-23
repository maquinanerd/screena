# 04 — Rotas públicas, APIs e contratos

> Inventário de toda superfície HTTP. Estratégia de render, JSON-LD e robots verificados
> diretamente por leitura de arquivo + saída de `pnpm build`. SHA `73c58e9`.

---

## 1. Números verificados

| Métrica | Valor | Fonte |
| --- | ---: | --- |
| Rotas no build de produção | **27** | saída de `pnpm build` |
| Arquivos `page.tsx` | 18 | `find apps/web/app -name page.tsx` |
| Route handlers (`route.ts`) | 7 | idem |
| Rotas de metadata (`robots.ts`) | 1 | idem |
| Rotas com `generateStaticParams` | **0** | `grep -rln generateStaticParams apps/web/app` → vazio |
| Rotas com ISR (`revalidate = 3600`) | 5 | ver §2 |
| Rotas `force-dynamic` | 12 (páginas) + 7 (handlers) | ver §2 |
| Layouts | 1 | nenhum route group, nenhuma parallel route |
| `not-found.tsx` / `error.tsx` | **0** | ver **R-25** |

> Consequência de "0 `generateStaticParams`": **nada é pré-renderizado no build**. As 5 páginas
> com `revalidate` são geradas sob demanda e então cacheadas por 1 h; as demais são recalculadas
> a cada request.

---

## 2. Páginas públicas

Locale: **somente `/pt/`**. Não existe nenhuma rota `/en/` ou `/es/` no repositório.

| URL | Arquivo | Render | JSON-LD | robots |
| --- | --- | --- | --- | --- |
| `/` | *(sem arquivo)* `middleware.ts:63-67` | 307 → `/pt/` | — | — |
| `/pt/` | `app/pt/page.tsx` | `force-dynamic` | `Organization` + `WebSite` | `publicRobots(…)` |
| `/pt/filmes/` | `app/pt/filmes/page.tsx` | `force-dynamic` | `CollectionPage` + `ItemList` + `BreadcrumbList` | `publicRobots(…)` |
| `/pt/filmes/{slug}/` | `app/pt/filmes/[slug]/page.tsx` | **ISR 3600** | `Movie` + `BreadcrumbList` | `gatePublicRobots(seo.robots)` |
| `/pt/series/` | `app/pt/series/page.tsx` | `force-dynamic` | `CollectionPage` + `BreadcrumbList` | `publicRobots(…)` |
| `/pt/series/{slug}/` | `app/pt/series/[slug]/page.tsx` | **ISR 3600** ⚠️ | `TVSeries` + `BreadcrumbList` | `gatePublicRobots(…)` |
| `/pt/series/{slug}/temporadas/{n}/` | `.../[season]/page.tsx` | **ISR 3600** | `TVSeason` + `BreadcrumbList` | `gatePublicRobots(…)` |
| `/pt/series/{slug}/temporadas/{n}/episodios/{e}/` | `.../[episode]/page.tsx` | **ISR 3600** | `TVEpisode` + `BreadcrumbList` | `gatePublicRobots(…)` |
| `/pt/pessoas/` | `app/pt/pessoas/page.tsx` | `force-dynamic` | `CollectionPage` + `BreadcrumbList` | `publicRobots(…)` |
| `/pt/pessoas/{slug}/` | `app/pt/pessoas/[slug]/page.tsx` | **ISR 3600** | `Person` + `BreadcrumbList` | `gatePublicRobots(…)` |
| `/pt/noticias/` | `app/pt/noticias/page.tsx` | `force-dynamic` | — | `publicRobots(…)` |
| `/pt/noticias/{slug}/` | `app/pt/noticias/[slug]/page.tsx` | `force-dynamic` | `NewsArticle` | `publicRobots(…)` |
| `/pt/busca/` | `app/pt/busca/page.tsx` | `force-dynamic` | — | **`noindex,nofollow` fixo** |
| `/pt/explorar/` | `app/pt/explorar/page.tsx` | `force-dynamic` | — | `publicRobots(…)` |
| `/pt/redefinir-senha/` | `app/pt/redefinir-senha/page.tsx` | `force-dynamic` | — | **`noindex,nofollow` fixo** |
| `/pt/verificar-email/` | `app/pt/verificar-email/page.tsx` | `force-dynamic` | — | **`noindex,nofollow` fixo** |
| `/filmes/` | `app/filmes/page.tsx` | estática | — | alias 308 → `/pt/filmes/` |
| `/series/` | `app/series/page.tsx` | estática | — | alias 308 → `/pt/series/` |
| `/dev/movie-page-preview` | `app/dev/movie-page-preview/page.tsx` | estática | — | **`noindex,nofollow` fixo** |

⚠️ **Achado (não verificado adversarialmente):** `/pt/series/{slug}/` declara `revalidate = 3600`
mas lê `searchParams` (`?temporada=N`), o que no Next 15 força render dinâmico — a janela de ISR
declarada seria **inerte** nessa rota. Origem: agente `web-routes`. Confirmar antes de agir.

### 2.1 Diferenciação filme × série (invariante 11)

Verificada nos cinco sinais simultâneos exigidos, sem depender de cor:

| Sinal | Filme | Série |
| --- | --- | --- |
| URL | `/pt/filmes/{slug}/` | `/pt/series/{slug}/` |
| Schema | `Movie` | `TVSeries` |
| Breadcrumb | `.../filmes/...` | `.../series/...` |
| Label + badge | componentes de `@screena/ui` | idem |

Travado por `tests/governance/vertical.test.ts`.

---

## 3. Route handlers (APIs)

| Método · Rota | Arquivo | Autorização | Validação de entrada |
| --- | --- | --- | --- |
| `POST /api/auth/email-verification/request` | `app/api/auth/email-verification/request/route.ts` | pública por design (throttle duravel) | schema de payload em `@screena/user-platform` |
| `POST /api/auth/email-verification/confirm` | `.../confirm/route.ts` | token de uso único | idem |
| `POST /api/auth/password-reset/request` | `app/api/auth/password-reset/request/route.ts` | pública por design (throttle duravel) | idem |
| `POST /api/auth/password-reset/confirm` | `.../confirm/route.ts` | token de uso único | idem |
| `GET /api/seo/redirect` | `app/api/seo/redirect/route.ts` | pública (leitura) | — |
| `GET /robots.txt` | `app/robots.ts` | pública | — |
| `GET /sitemap.xml` | `app/sitemap.xml/route.ts` | pública | — |
| `GET /sitemaps/{shard}` | `app/sitemaps/[shard]/route.ts` | pública | shard validado |

Todos `force-dynamic`. Nenhum endpoint de mutação genérico está exposto — as únicas escritas
públicas são os fluxos de auth por token, com throttle persistido.

> **Nota de escopo:** a análise de autorização/validação por endpoint veio do agente
> `web-api-endpoints` e **não passou pela verificação adversarial**. O que foi verificado
> diretamente é a existência, o método e a natureza `force-dynamic` de cada rota (saída do build
> e leitura dos arquivos).

---

## 4. Middleware

```
matcher: ["/((?!_next/static|_next/image|favicon.ico|api|media|brand|uploads).*)"]
```
`apps/web/middleware.ts:86-88` · 34,7 kB no build

Responsabilidades: redirect de locale na raiz (307 para `/pt/`) e canonicalização.
Exclui `api`, assets internos do Next e assets estáticos (`/media/`, `/brand/`, `/uploads/`).

---

## 5. Canonicalização de URL

- `trailingSlash: true` (`apps/web/next.config.ts:25`) — toda URL canônica termina em `/`.
- **Comprovado por HTTP real:** `GET /pt/filmes` → **308** → `Location: /pt/filmes/`
  (`11-validacao-execucoes.md` §5, check 15).
- Slug não-canônico em página de entidade → `permanentRedirect` (308) para o slug canônico.
- Números de temporada/episódio passam por `parseRouteNumber`, que recusa forma não-canônica
  (`01`, `0`) com **404** — evitando duplicata de URL.

---

## 6. Sitemap e robots

- `GET /sitemap.xml` → índice; `GET /sitemaps/{shard}` → shards paginados **no banco**.
- Uma URL só entra no sitemap quando `decision === 'index'`; `includeInSitemap` é derivado da
  **mesma** resolução que produz o `<meta robots>` (`packages/seo/src/resolver.ts:190-192`), de
  modo que sitemap e meta tag não conseguem discordar.
- `robots.txt` responde `User-Agent: * / Disallow: /` sempre que a origem não é a oficial —
  comprovado por HTTP real no smoke test.
- Validado por `validate:seo-runtime` (36/36) e `validate:season-episode-routes` (32/32).

---

## 7. i18n — estado real

| Fato | Evidência |
| --- | --- |
| `PUBLISHED_LOCALES` canônico = `["pt-BR","pt"]` | `packages/config/src/invariants.ts:164` |
| Duplicata em `apps/web` = `["pt"]` | `apps/web/src/lib/root-locale.ts:7` — **R-07** |
| Rotas `/en/` ou `/es/` | **não existem** |
| `hreflang` | emitido apenas em `/pt/` (pt-BR + `x-default`, ambos autorreferentes) |

Coerente com a invariante 7 (pt-BR publica primeiro): não há tradução cega indexada, e o cluster
`hreflang` não anuncia variante inexistente.
