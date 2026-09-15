# Auditoria de SEO de 11/09/2026 — resolução item a item

> **Branch:** `fix/seo-audit-2026-09-11`, a partir de `main` em `e302161`.
> **Período:** 11 a 15/09/2026.
> **Referências:** [auditoria](AUDITORIA-SEO-2026-09-11.md) ·
> [decisões do dono](DECISOES-DO-DONO-2026-09-11.md) ·
> [baseline](SEO-REMEDIATION-BASELINE-2026-09-11.md) ·
> [mudanças de infraestrutura](SEO-INFRA-CHANGES-2026-09-11.md)
>
> **O que cada estado quer dizer, sem arredondamento:**
>
> | Estado | Significado |
> |---|---|
> | **RESOLVIDO** | o código mudou nesta branch, e um teste ou validador prova a mudança |
> | **VALIDADO** | já estava certo; foi conferido nesta leva |
> | **NÃO APLICÁVEL** | o achado não pede mudança — o porquê está na linha |
> | **DEPENDÊNCIA EXTERNA DOCUMENTADA** | depende do que o repositório não alcança (borda, e-mail, framework, produção editorial, dados), com instrução escrita |
> | **PENDENTE** | não foi resolvido nesta leva; está declarado em vez de escondido |
>
> Marcação de evidência, como na auditoria: **MEDIDO** (observado), **LI** (lido no
> código), **INFERIDO** (deduzido).

---

## 1. Placar

| Estado | Itens |
|---|---|
| RESOLVIDO | **42** |
| VALIDADO | 1 |
| NÃO APLICÁVEL | 3 |
| DEPENDÊNCIA EXTERNA DOCUMENTADA | 9 |
| PENDENTE | 3 |
| **Total** | **58** |

Os três PENDENTES são de desempenho e são refatoração, não ajuste: a folha de CSS
única de 143 KB (§7.6 — a própria auditoria a pôs "fora da caixa de PR pequeno"),
os 149 KB de HTML da ficha de série e os chunks de JS com 62–67% sem executar (§7.7).

---

## 2. Achados críticos e altos (auditoria §3)

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| 3.1 | Teto de 300.000 URLs zerava o sitemap inteiro | Teto **por tipo** (só o tipo que estoura sai) e alertas a 80/90/95% do teto | `packages/seo/src/sitemap-ceiling.ts`, `apps/web/src/server/seo/sitemap-index.ts` | `sitemap-ceiling.test.ts` (pacote e governança), `sitemap-emergency-valve.test.ts` | RESOLVIDO (`c1e874b`) |
| 3.2a | 69.016 galerias sem texto próprio indexáveis | D1: `noindex, follow` e fora do sitemap; a página segue acessível. A descoberta passa pela entidade: `image` no JSON-LD e `og:image` | `packages/seo/src/entity-quality-gates.ts`, `app/_components/gallery-pages.tsx`, `sitemap-index.ts` | `gallery-indexing-floor.test.ts`, `validate:seo-runtime` (48: shards de galeria 404) | RESOLVIDO (`3cf1d0e`, `429a194`) |
| 3.2b | Galeria de episódio indexava com o episódio suspenso | Galeria nunca indexa como página própria (D1): o vazamento some por construção | `…/episodios/[episode]/imagens/page.tsx`, `entity-quality-gates.ts` | `gallery-indexing-floor.test.ts`, `sitemap-emergency-valve.test.ts` | RESOLVIDO (`429a194`) |
| 3.3a | Sem `og:image`/`og:url` fora de notícia; `twitter:card=summary` | Cartão social completo por página, na ordem da D4: arte da entidade → arte editorial → cartão da marca | `packages/seo/src/social-metadata.ts`, `apps/web/src/lib/social-metadata.ts`, fichas, listagens | `social-metadata.test.ts` (pacote e app), `seo:audit` local (og:url = canonical) | RESOLVIDO (`14a6ed0`) |
| 3.3b | Nenhuma página emitia `max-image-preview:large` | Diretiva em toda página que indexa (robots e googlebot) | `apps/web/src/lib/site.ts`, `article-technical-seo.ts` | `public-indexing-flag.test.ts`, `article-technical-seo.test.ts` | RESOLVIDO (`14a6ed0`) |
| 3.4 | `ItemList` de `/pt/filmes/` e `/pt/series/` descrevia 24 títulos que a tela não mostrava | `ItemList` montado dos cards que o trilho RENDERIZA | `apps/web/src/lib/rail-item-list.ts`, `app/pt/filmes/page.tsx`, `app/pt/series/page.tsx` | `home-like-item-list.test.tsx` (paridade), `category-home-canonical-contract.test.ts` | RESOLVIDO (`e2a25c0`) |
| 3.5 | `Movie` sem `image`, `director`, `genre`, `duration`; `TVSeries` e `Person` sem `image` | Campos preenchidos só com o que a ficha mostra; pessoa com `url` só quando a página existe | `packages/seo/src/schema-fields.ts`, `app/pt/filmes/[slug]`, `app/pt/series/[slug]`, `app/pt/pessoas/[slug]` | `schema-fields.test.ts`, `home-seo-identity.test.ts` | RESOLVIDO (`e2a25c0`) |
| 3.6a | Sem Sobre, Política editorial e Contato | D5: `/pt/sobre/`, `/pt/politica-editorial/`, `/pt/contato/` só com fato comprovável; canais e responsável amarrados aos documentos legais | `app/pt/{sobre,politica-editorial,contato}/page.tsx`, `src/lib/institutional-facts.ts`, `src/lib/editorial-disclosure.ts` | `institutional-pages-facts.test.ts`, `seo:audit` local (as três páginas sem violação) | RESOLVIDO (`5bcc5e0`) — as caixas de e-mail: I5 |
| 3.6b | Sem página de autor; assinatura em texto simples; `NewsArticle` sem `author.url` | `/pt/autores/` e `/pt/autores/{slug}/` sobre as MESMAS matérias da listagem; assinatura com link; `author` com `@id` e `url` do perfil | `src/lib/author-presenter.ts`, `src/server/news-pages.ts`, `app/pt/autores/**`, `article-technical-seo.ts` | `author-presenter.test.ts`, `article-jsonld-attribution.test.ts`, `validate:seo-runtime` (25) | RESOLVIDO (`be6c6d1`) |
| 3.6c | O Cinerie Score aparecia sem página que explicasse a conta (D5) | `/pt/cinerie-score/`: fontes, grupos, pesos, piso de 2 fontes, exemplo e versão; link "Como é calculado" no card | `app/pt/cinerie-score/page.tsx`, `src/lib/cinerie-score-methodology.ts`, `cinerie-score-card.tsx` | `cinerie-score-methodology.test.ts` (literais conferidos contra `composeScore`) | RESOLVIDO (`5bcc5e0`) |
| 3.7a | Pessoa: página `index`, sitemap com 0 URLs | D2: UM portão para página e sitemap | `src/server/person-page.ts`, `src/server/seo/decision-coverage.ts`, `sitemap-index.ts` | `decision-coverage.test.ts`, `validate:seo-runtime`, `validate:decision-robots` | RESOLVIDO (`6cae7b1`) |
| 3.7b | `/pt/pessoas/`, `/pt/onde-assistir/`, `/pt/em-breve/` `index` e fora do `static-1` | O shard estático pergunta aos MESMOS loaders das páginas | `sitemap-index.ts`, `src/server/watch-browse.ts`, `src/server/anticipated.ts` | `sitemap-static-hubs.test.ts`, `validate:seo-runtime` (25) | RESOLVIDO (`47a3b23`) |
| 3.7c | Galerias: piso na página, decisão herdada no sitemap | D1 tirou as galerias dos dois lados | ver 3.2a | `validate:seo-runtime` (48) | RESOLVIDO (`429a194`) |
| 3.7d | Decisão ausente: `index` na página, `noindex` no sitemap | A ausência vale nos dois lados com o gate do tipo armado | `src/server/seo/indexability-decision.ts`, `decision-coverage.ts` | `validate:seo-runtime` (39–42) | RESOLVIDO (`6cae7b1`) |

## 3. Achados médios (auditoria §4)

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| M1 | `www.cinerie.com` responde 200 sem redirect | Redirect 301 na borda, com a regra escrita | — | conferência pós-deploy (I1) | DEPENDÊNCIA EXTERNA DOCUMENTADA (I1) |
| M2 | Sitemaps lentos e sem cache | A origem manda `Cache-Control` (`s-maxage` 900/300, `no-store` em falha); falta a Cache Rule na borda | `src/lib/sitemap-cache-control.ts`, rotas de sitemap | `sitemap-cache-control.test.ts` | DEPENDÊNCIA EXTERNA DOCUMENTADA (I2) — origem pronta |
| M3 | 11.666 fichas `tmdb-{id}` sem tradução indexadas | D3: `noindex, follow` e fora do sitemap até enriquecer; voltam sozinhas | `entity-quality-gates.ts`, `resolver.ts`, `sitemap-index.ts` | `entity-quality-gates.test.ts`, `resolver-quality-gate.test.ts`, `validate:seo-runtime` (43–47) | RESOLVIDO (`3cf1d0e`, `429a194`) |
| M4 | Meta description ausente sem sinopse | Descrição factual com o que a ficha mostra (ano, direção, gêneros, elenco, duração) | `packages/seo/src/factual-description.ts`, fichas | `factual-description.test.ts`, `meta-description-length.test.ts` | RESOLVIDO (`14a6ed0`) |
| M5 | Falha de banco virava `noindex` guardado pelo ISR | Falha LANÇA `IndexabilityDecisionUnavailableError` → 5xx, com log; nunca `noindex` | `src/server/seo/indexability-decision.ts` | `validate:seo-runtime` | RESOLVIDO (`dbe5dd7`) |
| M6 | Sitemap de notícias engolia falha de banco sem log | `console.error` com a causa e resposta degradada `no-store` | `src/server/seo/news-sitemap.ts` | `sitemap-cache-control.test.ts` | RESOLVIDO (`47a3b23`) |
| M7 | Identidade fragmentada, sem `@id` | `@id` único de `Organization`/`WebSite`, reaproveitado no `publisher`; `publishingPrinciples` → Política editorial | `packages/seo/src/site-identity.ts`, `app/pt/page.tsx`, `article-technical-seo.ts` | `site-identity.test.ts`, `article-jsonld-attribution.test.ts`, `institutional-pages-facts.test.ts` (4) | RESOLVIDO (`e2a25c0`, `5bcc5e0`) |
| M8 | Degrau de gênero apontava para a listagem geral | Degrau removido da trilha visível e do JSON-LD até existir página de gênero | `app/pt/filmes/[slug]/page.tsx`, `app/pt/series/[slug]/page.tsx` | `home-seo-identity.test.ts` | RESOLVIDO (`e2a25c0`) |
| M9 | Árvore suspensa (~3,9 M URLs `noindex, follow`) segue rastreável | Mantida. `nofollow` ou `Disallow` agora impediriam o buscador de reler o `noindex` das URLs já indexadas — quem desindexa é o meta. Rever quando o Search Console mostrar a árvore fora do índice | — | — | NÃO APLICÁVEL |
| M10 | Cobertura editorial desigual entre títulos populares | Produção de `content_blocks` é offline, com revisão humana; um agente não gera nem publica bloco para cumprir auditoria (invariantes 12 e 13) | — | — | DEPENDÊNCIA EXTERNA DOCUMENTADA (produção editorial) |
| M11 | "Onde assistir" vazio em 6/6 títulos correntes | A ficha diz a verdade quando a oferta está retida, e o lote de promoção passou a avançar sobre o pendente. A COBERTURA depende da ingestão licenciada | `src/server/entity-watch.ts`, `services/streaming/src/persistence/watch-review-store.ts` | `watch-absence-reason.test.ts` | DEPENDÊNCIA EXTERNA DOCUMENTADA (cobertura de dados) — código: `f0622d1`, `7799113` |
| M12 | FAQ ausente em 100% da amostra | Não há bloco `faq` com prompt, payload e revisão ativos, e FAQ genérico escrito para a auditoria é proibido. `FAQPage` só com FAQ visível | — | — | DEPENDÊNCIA EXTERNA DOCUMENTADA (produção editorial) |
| M13 | `/pt/pessoas/` abria com perfis sem biografia | D2: perfis aptos (biografia exibível + foto) primeiro, depois o nome | `src/server/entity-indexes.ts` | `validate:entity-indexes` (18, 21: controle) | RESOLVIDO (`e665405`) |
| M14 | Notícia sem `dateModified` visível e sem `about`/`mentions` | "Atualizada em" visível em dia posterior; `mentions` das entidades citadas; `about` NÃO emitido (o banco não marca o assunto) | `news-presenter.ts`, `app/pt/noticias/[slug]/page.tsx`, `article-technical-seo.ts` | `news-presenter.test.ts`, `article-jsonld-attribution.test.ts` | RESOLVIDO (`be6c6d1`) |

## 4. Achados baixos (auditoria §5)

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| B1 | Raiz com 307 | 308 (destino fixo enquanto só `pt` publica) | `apps/web/middleware.ts` | `root-locale-redirect.test.ts`, `seo:audit` local (raiz) | RESOLVIDO (`3d870f7`) |
| B2 | 308 de barra final sem HSTS | O HSTS não vem do app; ligar na borda cobre os redirects | — | conferência pós-deploy (I7) | DEPENDÊNCIA EXTERNA DOCUMENTADA (I7) |
| B3 | Dois grupos `User-agent: *` | O app emite UM (MEDIDO pelo `seo:audit` local); o segundo é o bloco gerenciado da Cloudflare — opções em I3 | — | `seo:audit` (`robots-grupo-duplicado`) | DEPENDÊNCIA EXTERNA DOCUMENTADA (I3) |
| B4 | `lastmod` do índice por tipo, não por shard | Mantido: o índice lê só contagens e `MAX(updated_at)` por tipo; `lastmod` por shard exigiria agregar página a página a cada leitura — o custo que M2 condena | — | — | NÃO APLICÁVEL |
| B5 | `static-1` sem `lastmod` e incompleto | `lastmod` real por hub; hubs, autores e páginas institucionais no shard | `sitemap-index.ts` | `sitemap-static-hubs.test.ts` (7 casos) | RESOLVIDO (`47a3b23`, `be6c6d1`, `5bcc5e0`) |
| B6 | `og:locale` `pt-BR` inválido; ausente em galeria/temporada/episódio | `pt_BR` em toda superfície | `packages/seo/src/social-metadata.ts` | `social-metadata.test.ts`, `seo:audit` local (og:locale) | RESOLVIDO (`14a6ed0`) |
| B7 | `og:type: website` nas fichas | `video.movie`, `video.tv_show`, `video.episode`, `profile` | `social-metadata.ts`, fichas | `social-metadata.test.ts` | RESOLVIDO (`14a6ed0`) |
| B8 | Títulos de listagem curtos; três acima de 65 | Listagens com `<title>` descritivo, H1 e trilha curtos. Na re-auditoria local, nenhum título amostrado passou de 70 | `app/pt/*/page.tsx` | `seo:audit` local (`title-comprimento`) | RESOLVIDO (`e9a50f8`) |
| B9 | 404 genérico com o texto padrão do Next em inglês | `not-found.tsx` em pt-BR, com H1 e links de saída, sem canonical | `apps/web/app/not-found.tsx` | `not-found-page.test.tsx`, `seo:audit` local (`404-idioma`, `404-canonical`) | RESOLVIDO (`75bd302`) |
| B10 | 404 de ficha sem `lang` e sem H1 | MEDIDO em 15/09/2026 no build local: toda rota dinâmica que chama `notFound()` responde **404** com `noindex`, e o HTML inicial é o esqueleto de erro do Next 15.5 (`<html id="__next_error__">`); o `lang` e o H1 chegam na hidratação. É desenho do framework (`next/dist/server/app-render/app-render.js`). O 404 de rota inexistente sai completo | — | `seo:audit` local (`404-lang`, `404-h1` — as 2 violações restantes) | DEPENDÊNCIA EXTERNA DOCUMENTADA (Next.js) |
| B11 | `/llms.txt` inexistente | Índice em Markdown com o que o site publica, os créditos verbatim e o apontamento para o `robots.txt`; 404 fora da origem oficial | `app/llms.txt/route.ts`, `src/lib/llms-txt.ts` | `llms-txt.test.ts` | RESOLVIDO (`5894146`, `5bcc5e0`) |
| B12 | Datas de `Movie`/`TVSeries` só com o ano | Data completa; `endDate` só com série encerrada | `movie-page.ts`, `series-page.ts`, fichas | `schema-fields.test.ts` | RESOLVIDO (`e2a25c0`) |
| B13 | Trilha visível ≠ JSON-LD em temporada, episódio e notícia | As duas trilhas degrau por degrau | páginas de temporada, episódio e matéria | `home-seo-identity.test.ts`; LI 15/09 | RESOLVIDO (`e2a25c0`) |
| B14 | `sameAs` só com IMDb | TMDB entra pelo namespace do próprio tipo | `packages/seo/src/entity-schema.ts` | `entity-schema.test.ts`, `external-links.test.ts` | RESOLVIDO (`e2a25c0`) |
| B15 | `inLanguage` ausente em `CollectionPage`/`WebSite` | Presente em todo `CollectionPage` e no `WebSite` | — | LI 15/09/2026 | VALIDADO |
| B16 | `/favicon.ico` 404 com 23 KB de HTML | D6: ícone derivado da marca existente, sem desenho novo | `app/favicon.ico`, `app/icon.png`, `app/apple-icon.png` | `app-icons.test.ts`, `seo:audit` local (favicon 200, não HTML) | RESOLVIDO (`75bd302`) |

## 5. GEO e desempenho (auditoria §6 e §7)

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| G1 | Crawlers de treino bloqueados, de busca liberados | D7: a política fica. `/llms.txt` descreve o site sem conceder nem negar uso | — | `llms-txt.test.ts` (4) | NÃO APLICÁVEL (decisão do dono) |
| P1 | Transbordo de 1.816 px na ficha em 412 px (LCP 5,1 s) | `minmax(0, 1fr)` na grade de uma coluna | `apps/web/app/globals.css` | `perf:lab` local: `scrollWidth` 412/412 (home, filme, série) | RESOLVIDO (`9073436`) |
| P2 | 951 KB de fotos de elenco em `original` | Tamanho do TMDB pela área exibida, nos presenters | `cast-presenter.ts`, `person-presenter.ts`, `entity-index-presenter.ts`, `series-presenter.ts`, `season-episode-presenter.ts` | `tmdb-thumbnail-sizes.test.ts` | RESOLVIDO (`6dea9e4`) |
| P3 | HTML sem cache de borda (home, série) | Motivos escritos no código e no runbook; decisão de deploy | — | — | DEPENDÊNCIA EXTERNA DOCUMENTADA (I4) |
| P4 | Backdrop da ficha (LCP) com `loading="lazy"` | `eager` + `fetchpriority="high"`, e o `preload` para ele | `app/pt/filmes/[slug]/page.tsx`, `app/pt/series/[slug]/page.tsx` | `lcp-priority.test.ts`; `perf:lab` (nenhum LCP `lazy`) | RESOLVIDO (`a0447be`) |
| P5 | Fonte sem `preload` (causa do CLS 0,088) | `preload` da Montserrat variável | `apps/web/app/layout.tsx` | `font-preload.test.ts`; `perf:lab` (preload presente, CLS 0,000) | RESOLVIDO (`9685c98`) |
| P6 | CSS único de 143 KB, bloqueante, 82–90% sem casar | Divisão por rota é refatoração da folha inteira; não cabe nesta leva sem risco de regressão visual | — | — | PENDENTE |
| P7 | `upgrade-insecure-requests` em CSP report-only | Diretiva inerte removida | `apps/web/middleware.ts` | `security-headers.test.ts` | RESOLVIDO (`3d870f7`) |
| P8 | Hero da home em `w1280` sem `srcset` | `srcset` com as larguras que a tela usa | `home-hero-carousel.tsx`, `home-hero-presenter.ts` | `home-hero-srcset.test.ts` | RESOLVIDO (`b76b887`) |
| P9 | Ficha de série com 149 KB de HTML | Guia de temporadas no HTML e no payload RSC; exige mudar o que a ficha entrega no servidor | — | — | PENDENTE |
| P10 | Chunks de JS com 62–67% sem executar | Exige análise de bundle por rota | — | — | PENDENTE |

## 6. Encontrados durante a remediação

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| R1 | `/pt/creditos-de-dados/`, `/pt/termos/`, `/pt/privacidade/` prerenderizadas com o robots do BUILD: `noindex, nofollow` assado no HTML (MEDIDO no build local; em produção, INFERIDO do `Dockerfile`) | `force-dynamic` e reclassificação no registro de cache (motivo d); guard contra rota prerenderizada que lê env de indexação | as três páginas, `route-cache-policy.ts` | `prerendered-routes-robots-runtime.test.ts`, `route-cache-policy.test.ts` (7), `validate:route-cache` | RESOLVIDO (`a5867e8`) |
| R2 | `dateModified` podia sair anterior a `datePublished` (matéria agendada é gravada antes de ir ao ar) | A data de modificação nunca fica antes da publicação, no JSON-LD e no Open Graph | `packages/seo/src/article-technical-seo.ts` | `article-jsonld-attribution.test.ts` (`dateModified`) | RESOLVIDO (`be6c6d1`) |
| R3 | Lote de promoção de ofertas de streaming não avançava sobre o pendente | O lote passa a avançar | `services/streaming/src/persistence/watch-review-store.ts` | suíte do serviço | RESOLVIDO (`7799113`) |

---

## 7. Gates da missão → itens

| Gate | Tema | Itens |
|---|---|---|
| G0 | Baseline | [baseline](SEO-REMEDIATION-BASELINE-2026-09-11.md) (`2790505`) |
| G1 | Sitemap, mobile, galeria, banco → 5xx | 3.1, 3.2a, 3.2b, P1, M5 |
| G2 | Desempenho | P1, P2, P4, P5, P8 · pendentes: P6, P9, P10 |
| G3 | OG, Twitter, `max-image-preview`, `og:type`, descrições | 3.3a, 3.3b, M4, B6, B7 |
| G4 | JSON-LD | 3.4, 3.5, M7, B12, B14, B15 |
| G5 | Política de indexabilidade e decisões do dono | 3.7a–d, M3, R1 |
| G6 | Rastreio da árvore suspensa | M9 |
| G7 | Cache, `lastmod`, estático e log dos sitemaps | M2, M6, B4, B5 |
| G8 | Páginas de E-E-A-T | 3.6a, 3.6b, 3.6c |
| G9 | Conteúdo, FAQ, "Onde assistir", listagem de pessoas | M10, M11, M12, M13 |
| G10 | `NewsArticle` | 3.6b, M14, R2 |
| G11 | Degrau de gênero | M8 |
| G12 | Raiz 308, 404 pt-BR, `www` | B1, B9, B10, M1 |
| G13 | Cache de rota | P3, R1 |
| G14 | `robots.txt` e política de IA | B3, G1 |
| G15 | `llms.txt` | B11 |
| G16 | Favicon | B16 |
| G17 | CSP | P7 |
| G18 | Títulos | B8 |
| G19 | `sameAs` | B14 |
| G20 | Datas completas | B12 |
| G21 | Documento de infraestrutura | [SEO-INFRA-CHANGES-2026-09-11.md](SEO-INFRA-CHANGES-2026-09-11.md) |
| G22 | Testes | a coluna "Teste" de cada linha; suíte na §8 |
| G23 | Script de auditoria | `seo:audit` (`9f552e7`, ampliado em `86d9e0a`) |
| G24 | Regressão de desempenho | `perf:lab` (`86d9e0a`), §8 |
| G25 | Re-auditoria | `seo:audit` contra o build local, §8 |

---

## 8. Verificação final (15/09/2026)

Tudo rodou na cópia de trabalho em `C:` (o worktree em `E:` não comporta
`pnpm install`), sobre o HEAD desta branch, com Node 24.19.0.

| Etapa | Resultado |
|---|---|
| `pnpm test` | **602 arquivos de teste, todos passando** (baseline: 577) |
| `pnpm typecheck` | 0 |
| `pnpm typecheck:apps` | 0 (web, admin, cms) |
| `pnpm --filter @screena/web build` | 0 — as rotas novas saem `ƒ`; `/filmes`, `/series` e `/_not-found` seguem `○` |
| `pnpm lint` | 0 |
| `pnpm audit:invariants` | PASSOU — invariantes intactas |
| `pnpm audit:render` | PASSOU — render puro de IO externo |
| `validate:seo-runtime` | 48/48 — inclusive o shard estático com hubs, autores e páginas institucionais (25) e o fail-closed (26) |
| `validate:decision-robots` | 27/27 |
| `validate:news-pages` | 21/21 — a leitura compartilhada entre listagem e autores não mudou a listagem |
| `validate:route-cache` | 27/27 — inclusive `/filmes/ → 308 s-maxage=31536000` |
| `validate:entity-indexes` | 21/21 — perfil apto primeiro e o controle sem liberação na ordem do nome |
| `validate:movie-page` · `validate:series-page` · `validate:person-page` | 29/29 · 28/28 · 29/29 |
| `validate:season-episode-routes` · `validate:person-eligibility` | 32/32 · 13/13 |

### 8.1 Re-auditoria local (G25)

`seo:audit` contra o build desta branch, servido pelo `validate:route-cache` com a
configuração de produção (origem `https://cinerie.com`, indexação ligada) e o
catálogo que o validador semeia; `SEO_AUDIT_CANONICAL_ORIGIN` mantém toda
requisição na base local.

**274 verificações, 7 violações, 1 aviso** — e nenhuma é regressão:

| Violação | Por quê |
|---|---|
| `404-lang` e `404-h1` na ficha inexistente | B10: esqueleto de erro do Next 15.5; status 404 e `noindex` corretos |
| `robots` (e o aviso `max-image-preview`) em `/pt/noticias/` | o banco semeado não tem matéria; listagem vazia é `noindex` técnico por regra. Em produção há 368 matérias |
| `jsonld-image` em 2 filmes e 2 séries | o banco semeado não tem licença de imagem aplicada: a ficha não mostra imagem (o `perf:lab` confirma — nenhuma requisição ao host do TMDB), e o JSON-LD, corretamente, também não |

As quatro páginas institucionais passaram sem violação. O sitemap semeado saiu
com 3 shards e 9.011 URLs, sem galeria, temporada ou episódio; `AggregateRating`
não apareceu em página nenhuma.

### 8.2 Regressão de desempenho (G24)

`perf:lab` — Chrome headless via DevTools Protocol, 3 execuções por caso, mediana;
mobile com os parâmetros de *slow 4G* do modo `devtools` do Lighthouse; toda
requisição fora da base local bloqueada. **Milissegundos de laboratório local:
comparam builds, não são número de produção.**

| Página | Perfil | FCP | LCP (elemento) | CLS | `scrollWidth` |
|---|---|---|---|---|---|
| `/pt/` | mobile | 1.748 ms | 1.748 ms (`div.hero__title`) | 0,000 | 412/412 |
| `/pt/` | desktop | 220 ms | 220 ms | 0,000 | 1335/1350 |
| `/pt/filmes/filme-1/` | mobile | 2.004 ms | 2.004 ms (`h1.detail-hero__title`) | 0,000 | 412/412 |
| `/pt/filmes/filme-1/` | desktop | 316 ms | 316 ms | 0,000 | 1335/1350 |
| `/pt/series/serie-1/` | mobile | 2.280 ms | 2.280 ms (`h1.detail-hero__title`) | 0,000 | 412/412 |
| `/pt/series/serie-1/` | desktop | 292 ms | 292 ms | 0,000 | 1335/1350 |

**Nenhuma causa estrutural da §7 voltou:** sem transbordo em 412 px, `preload` da
fonte em toda página, nenhum elemento de LCP `lazy`, CLS 0,000. O LCP local é
texto porque as imagens não saem da máquina; o LCP de produção só se mede depois
do deploy (I6).

---

## 9. Limites desta resolução

- **Nada foi medido em produção depois das mudanças:** a branch não foi
  implantada. Os números de §8 são de build local; as conferências de produção
  estão em [I6](SEO-INFRA-CHANGES-2026-09-11.md#i6--conferências-depois-do-deploy).
- Sem Search Console, CrUX ou Rich Results Test. Elegibilidade a *rich result*
  continua INFERIDA da documentação.
- As decisões D1, D2 e D3 mudam o estado de dezenas de milhares de URLs **de
  propósito** — o efeito aparece no índice ao longo de semanas.
- O banco do laboratório é o do validador: não tem matéria, imagem licenciada nem
  pessoa com biografia liberada. Os comportamentos que dependem disso foram
  provados nos validadores próprios (`validate:seo-runtime`,
  `validate:entity-indexes`), não no laboratório.
