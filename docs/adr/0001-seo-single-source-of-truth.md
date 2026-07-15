# ADR 0001 — SEO como fonte única de verdade (runtime)

- **Status:** aceito (Prompt 3 / `feat/seo-runtime-source-of-truth`)
- **Data:** 2026-07-15
- **Escopo:** indexabilidade, `<meta robots>`, sitemap, canonical, redirects,
  JSON-LD e estados editoriais/de tradução das páginas públicas do Screen.
- **Invariantes tocadas:** 3 (zero API no render), 5 (indexação total),
  6 (licença), 7 (pt-BR primeiro).

## Contexto

Antes desta fase, a decisão de indexabilidade era **derivada em vários lugares
independentes**, abrindo espaço para divergência entre o que a página declara
(`<meta robots>`) e o que o sitemap lista:

- `@screena/seo` tinha `evaluateIndexability`, mas as páginas e o sitemap
  usavam seis avaliadores por-tipo (`evaluateMovieIndexability`,
  `evaluateSeriesIndexability`, `evaluatePersonIndexability`,
  `evaluateEntityIndexIndexability`, `evaluateArticleIndexability`,
  `evaluatePortalIndexability`) — nenhum devolvia um contrato completo
  (sem `follow`, sem `includeInSitemap`, sem `canonical`, sem versão de política).
- **`/pt/explorar/` divergia**: a página decidia o `robots` apenas pelos
  “lançamentos da semana” (`upcomingMovies.length`), enquanto o sitemap decidia
  a inclusão do explorar pelo **catálogo amplo** (filmes/séries/pessoas/notícias).
  Mesma URL, duas decisões.
- **`JSON.stringify` cru** era injetado em `<script type="application/ld+json">`
  em 8 arquivos (16 pontos) — superfície de quebra de `</script>` / XSS.
- As tabelas `page_indexability_decisions` e `redirects` **existiam mas nunca
  eram lidas** pelo código de produto (confirmado na auditoria 360).

## Decisão

Centralizar a decisão em **uma única função pura** em `@screena/seo`:
`resolvePageSeo(facts) → PageSeoResolution`. Metadata, sitemap, canonical e
validadores consomem **o mesmo contrato**.

```ts
interface PageSeoResolution {
  decision: 'index' | 'noindex' | 'draft' | 'stale' | 'blocked'
  robots: { index: boolean; follow: boolean }
  includeInSitemap: boolean          // === (decision === 'index'), regra única
  canonical: string | null
  reason: string                      // auditável
  decisionSource: DecisionSource      // qual fato persistido governou
  policy: 'total-indexing'
  policyVersion: '2026-07'
  hasUniqueValue: boolean             // sinal informativo (não gate)
  allRatingsLicensed: boolean
}
```

`evaluateIndexability` permanece como **adaptador fino** sobre `resolvePageSeo`
(mesma assinatura/decisão) — nenhum consumidor existente quebrou.

### Regra invariante

`includeInSitemap === (decision === 'index')`. Sitemap e `<meta robots>` **nunca
podem discordar** porque derivam da mesma resolução. Travado por teste
(`resolver.test.ts` e `explore-consistency.test.ts`).

## Matriz de decisão (precedência do mais restritivo ao menos)

| # | Fato persistido | `decisionSource` | decision | robots | sitemap |
|---|-----------------|------------------|----------|--------|---------|
| 1 | Exclusão explícita (`page_indexability_decisions`) | `explicit-exclusion` | `noindex` | index=false, follow=false | fora |
| 2 | Rating com `display_allowed=false` (inv. 6) | `license-blocked` | `blocked` | false, false | fora |
| 3 | Notícia sem atribuição/linkback exigidos | `news-attribution-missing` | `blocked` | false, false | fora |
| 4 | Idioma fora de `PUBLISHED_LOCALES` (inv. 7) | `language-not-published` | `draft` | false, true | fora |
| 5 | Conteúdo invalidado (stale) | `stale-invalidation` | `stale` | false, true | fora |
| 6 | Entidade não publicada | `entity-not-published` | `noindex` | false, true | fora |
| 7 | Sem dados estruturados/slug/tradução confiáveis | `technical-invalid` | `noindex` | false, true | fora |
| 8 | Caso contrário (inv. 5 — indexação total) | `total-indexing` | `index` | true, true | **entra** |

Política de `follow`: `false` apenas quando a página carrega dado sem
permissão (`blocked`) ou foi excluída explicitamente; `true` nos demais
`noindex` (equity flui para vizinhos publicados). Blocos de valor são **sinal
de qualidade** (`hasUniqueValue`), nunca gate — indexação total (inv. 5).

## Componentes entregues

| Módulo (`packages/seo/src`) | Papel |
|---|---|
| `resolver.ts` | **Fonte única** `resolvePageSeo` + tipos + `SEO_POLICY`/`_VERSION`. |
| `indexability.ts` | Adaptador de compatibilidade sobre o resolver. |
| `json-ld.ts` | `serializeJsonLd`/`escapeJsonForHtml` HTML-safe (§7). |
| `redirects.ts` | `classifyRedirect` (301/302/alias/framework) + `resolveRedirectChain` (loop/cadeia longa) (§6). |
| `sitemap-plan.ts` | `planSitemapShards` + `buildSitemapIndex` (sitemap-index, por idioma/tipo, paginação) (§5). |

| Módulo (`apps/web`) | Mudança |
|---|---|
| `src/lib/explore-presenter.ts` | **Nova** decisão única do hub explorar. |
| `src/lib/sitemap-presenter.ts` | Explorar passa a usar `evaluateExploreIndexability`; export `countExploreSectionFacts`. |
| `src/server/seo/sitemap-entries.ts` | Snapshot reutilizável; `getExploreSectionFacts` fail-closed; log operacional estruturado (§4). |
| `app/pt/explorar/page.tsx` | Decisão via `getExploreSectionFacts`+`evaluateExploreIndexability` (fim da divergência, §3); JSON-LD seguro. |
| 8 páginas/1 componente | `JSON.stringify` → `serializeJsonLd` (16 pontos, §7). |

## JSON-LD seguro (§7)

`serializeJsonLd` escapa `<`, `>`, `&`, **U+2028** e **U+2029** para seus
escapes `\uXXXX`, por code point numérico (o próprio fonte é ASCII puro, nunca
usa o caractere literal — o mesmo bug que o módulo previne). O resultado
continua JSON válido (`JSON.parse(out)` reconstrói o objeto). Cobre `</script>`,
`<!--` e `<![CDATA[`.

## Falha de banco (§4) — fail-closed

Sem PostgreSQL, `getSitemapEntries` **não inventa entidades**: loga um erro
operacional estruturado e devolve apenas rotas estáticas comprovadamente
seguras. `getExploreSectionFacts` devolve contagens zeradas → explorar resolve
`noindex` (nunca indexa contra estado desconhecido). O `<meta robots>` por
página continua sendo a fonte de verdade para o crawler.

## Rotas afetadas

`/pt/`, `/pt/explorar/`, `/pt/filmes/[slug]/`, `/pt/series/[slug]/`,
`/pt/pessoas/[slug]/`, `/pt/noticias/`, `/pt/noticias/[slug]/`, listagens
(`entity-index`), `/sitemap.xml`.

## Testes

- `resolver.test.ts` (13): matriz completa + invariante `includeInSitemap`.
- `json-ld.test.ts` (6): `</script>`, `&`, U+2028/U+2029, JSON válido, `<!--`.
- `redirects.test.ts` (12): classificação, cadeia, loop, cadeia longa.
- `sitemap-plan.test.ts` (6): shard por idioma/tipo, paginação, `lastmod`, index.
- `explore-consistency.test.ts` (6): página ⇔ sitemap concordam.
- Governança existente (`indexability.test.ts`, `sitemap-presenter.test.ts`,
  `portal-presenter.test.ts`) mantida verde.

## Auditores SEO

- `pnpm audit:invariants` → **PASSOU** (7 ok, 0 violações).
- `pnpm audit:render` → **PASSOU** (zero API externa/Gemini no render).

## Consequências e follow-ups conscientes

Fica **entregue como núcleo puro testado**, mas **não** ligado ao roteamento de
runtime nesta PR (cada um é uma superfície própria, de maior risco, e merece PR
dedicado):

1. **Leitura da tabela `redirects` em runtime** — o *core* de classificação e
   resolução de cadeia está pronto e testado; falta o hook (middleware/route
   handler) que lê a tabela e emite o redirect. Adiado por restrição de acesso
   a Postgres no edge-runtime do Next; requer decisão de onde ler (Node runtime).
2. **`generateSitemaps` sharded servindo XML** — `planSitemapShards`/
   `buildSitemapIndex` estão prontos e testados; a rota `sitemap.xml` atual
   segue única (pt-BR cabe folgado no limite de 50k). Ligar o sitemap-index é
   incremental e sem risco quando o volume exigir.
3. **Persistir/ler `page_indexability_decisions`** — o resolver já aceita
   `explicitlyExcluded`/`isStale`/`isPublished`; falta o pipeline offline que
   **escreve** essas decisões e o getter que as lê. É trabalho de banco
   (migração/escrita) que exige tarefa aprovada de DB e revisão humana.

Nenhum desses adiamentos afrouxa uma invariante: tudo permanece fail-closed.
