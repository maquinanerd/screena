# ADR 0003 — SEO como fonte unica de verdade em runtime (Fase 3)

- Status: aceito (implementacao em PR draft para revisao final).
- Data: 2026-07-15.
- Contexto: [[0002-data-governance-hardening]] entregou o schema
  (`page_indexability_decisions` com `is_current`/`supersedes_id`,
  `redirects`, `source_licenses`, gates de licenca). A Fase 3 conecta esse
  schema ao runtime do app publico (`@screena/web`).

## Decisao

Toda decisao de SEO em runtime — `<meta robots>`, HTML, `canonical`, sitemap e
redirects — deriva de UMA resolucao central, alimentada por fatos PERSISTIDOS no
PostgreSQL. Nenhum consumidor recalcula a decisao por conta propria a partir de
heuristica local.

### 1. Resolucao unica (`@screena/seo`)

- `resolvePageSeo(facts) -> PageSeoResolution` e a fonte: devolve
  `decision` (`index|noindex|draft|stale|blocked`), `robots {index,follow}`,
  `includeInSitemap`, `canonical`, `reason`, `decisionSource`, `policy`/
  `policyVersion`. Invariante travada: `includeInSitemap === (decision === 'index')`
  — metadata e sitemap NUNCA discordam.
- `mergePersistedDecision(live, persisted)` funde a resolucao viva com a decisao
  VIGENTE de `page_indexability_decisions`. Regra fail-closed: prevalece a
  **mais restritiva**. Um override humano/motor pode RESTRINGIR (noindex,
  blocked, stale, draft); um `index` persistido desatualizado NUNCA reabre uma
  pagina bloqueada ao vivo por licenca (inv. 6), idioma (inv. 7) ou caso tecnico.

### 2. Getter server-only (`apps/web`)

- `resolveEntityPageSeo(key, liveFacts, client?)` le a decisao vigente
  (`is_current = true` — historico ignorado), funde e devolve a resolucao final.
  FAIL-CLOSED: erro de banco -> `noindex`/fora do sitemap.
- As paginas de detalhe (filme/serie/pessoa) expoem `seo: PageSeoResolution`; o
  `generateMetadata` consome `seo.robots` (sem heuristica por pagina). Portais/
  listagens/noticias mantem seus gates proprios (nao sao entidades da tabela).

### 3. Redirects persistidos

- `redirect-lookup.ts` le `redirects`, classifica e resolve a cadeia
  (`classifyRedirect`/`resolveRedirectChain` puros), com deteccao de loop, teto
  de saltos (`MAX_REDIRECT_HOPS`) e bloqueio de destino externo (sem
  open-redirect). Cache em memoria (TTL curto); fail-closed em falha de banco.
- O `middleware` (Edge) resolve via um route handler Node (`/api/_seo/redirect`),
  porque o Edge nao acessa Postgres. Status HTTP honra o persistido (301/302).

### 4. Sitemap index + shards

- `/sitemap.xml` serve o sitemap-index; `/sitemaps/{id}.xml` serve cada shard
  (`renderSitemapIndex`/`renderUrlset`/`planSitemapShards` puros). A lista base
  vem de `getSitemapEntries` (mesmos gates das paginas) e passa por uma EXCLUSAO
  pela decisao vigente persistida — nunca ha "pagina no sitemap + HTML noindex".
  Fail-closed: erro ao ler decisoes -> so rotas estaticas.

### 5. Gate de noticias (invariante 6)

- Alem de licenca/`display_allowed`, uma noticia que exige atribuicao/linkback
  sem fonte/URL e fail-closed: nao renderiza (404), nao vira card, nao entra no
  sitemap (`isNewsAttributionSatisfied`).

### 6. JSON-LD HTML-safe

- Todo `application/ld+json` usa `serializeJsonLd` (escapa `</script>`, `<`, `>`,
  `&`, U+2028, U+2029 por code point). Travado por teste de governanca.

## Reaproveitamento da PR #64 (`f3ac8e2`)

- **Reaproveitado (verbatim, puro):** `resolver.ts`, `json-ld.ts`, `redirects.ts`,
  `sitemap-plan.ts` e o adaptador `indexability.ts` — os cores puros estavam
  corretos e testados.
- **Novo nesta fase (o que a #64 deixou como follow-up):** `mergePersistedDecision`
  + `sitemap-xml.ts` (puros); e toda a integracao runtime — getter de decisao
  vigente, wiring de metadata/robots/canonical, redirect via middleware+route
  handler, sitemap index/shards servidos como XML, gate de atribuicao de noticia
  e o validador PostgreSQL efemero da Fase 3.
- **Rejeitado:** nada da #64 foi mergeado; ela permanece como referencia (a
  branch nao e deletada). Contratos opcionais que nenhum getter alimentava
  (`explicitlyExcluded`/`isStale`/`isPublished` soltos) agora sao alimentados de
  fato pela decisao persistida.

## Validacao

- `apps/web/scripts/validate-seo-runtime-real-postgres.ts` (script
  `validate:seo-runtime`) prova, em PostgreSQL 16 efemero, os 5 seams acima
  (29 checks). Roda na CI oficial Linux, junto de `db:validate:real`,
  `db:validate:upgrade` e `validate:stores`.

## Consequencias e follow-ups (conscientes)

- Decisoes persistidas cobrem entidades (movie/tv/season/episode/person);
  portais/listagens/noticias usam seus proprios fatos persistidos.
- **Perf redirect:** o middleware faz um subrequest ao route handler Node por
  request. Com Node middleware (Next 15.5) a leitura pode ocorrer direto no
  middleware, eliminando o subrequest — otimizacao futura.
- **Escala sitemap:** o planejamento e em memoria (catalogo pequeno). Paginacao a
  nivel de banco (LIMIT/OFFSET por shard) e otimizacao futura; a arquitetura de
  shards/limite ja esta pronta.
- **Rotas temporada/episodio:** nao existem como rotas dedicadas (sao inline na
  serie). Sao escopo da **Fase 4** — o sitemap so emite tipos com URL indexavel
  real; season/episode entram quando a Fase 4 criar as rotas.
- `PageIndexabilityDecision.decisionOrigin` (nao `decisionSource`) e a coluna de
  origem; `SourceLicense.termsUrl` (nao `attributionUrl`) e o linkback.
