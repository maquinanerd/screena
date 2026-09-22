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
| RESOLVIDO | **44** |
| VALIDADO | 1 |
| NÃO APLICÁVEL | 3 |
| DEPENDÊNCIA EXTERNA DOCUMENTADA | 10 |
| PENDENTE | 0 |
| **Total** | **58** |

Não sobrou PENDENTE. O último era o P10 (§7.7: dois chunks de JS com 62–67% sem
executar). Medido em produção em 21/09/2026, os dois chunks são o **React DOM** e o
**runtime do Next.js**, e 94% do JS que não roda na abertura da página é deles: o
item virou dependência de framework, com a medição na linha P10 e na §10.4. A
folha de CSS única de 143 KB (P6 — a própria auditoria a pôs "fora da caixa de PR
pequeno") foi dividida por rota e está no ar desde 17/09/2026, e os 149 KB de HTML
da ficha de série (P9) também saíram: ver as linhas P6 e P9.

---

## 2. Achados críticos e altos (auditoria §3)

| ID | Achado | Ação | Arquivos | Teste | Estado |
|---|---|---|---|---|---|
| 3.1 | Teto de 300.000 URLs zerava o sitemap inteiro | Teto **por tipo** (só o tipo que estoura sai) e alertas a 80/90/95% do teto | `packages/seo/src/sitemap-ceiling.ts`, `apps/web/src/server/seo/sitemap-index.ts` | `sitemap-ceiling.test.ts` (pacote e governança), `sitemap-emergency-valve.test.ts` | RESOLVIDO (`c1e874b`) |
| 3.2a | 69.016 galerias sem texto próprio indexáveis | D1: `noindex, follow` e fora do sitemap; a página segue acessível. A descoberta passa pela entidade: `image` no JSON-LD, `og:image` e, na URL da ficha de filme e de série no sitemap, `<image:image>` com a MESMA arte da ficha, sob a MESMA licença (`tmdb`/`image`) | `packages/seo/src/entity-quality-gates.ts`, `app/_components/gallery-pages.tsx`, `sitemap-index.ts`, `src/lib/entity-page-images.ts` | `gallery-indexing-floor.test.ts`, `sitemap-entity-images.test.ts`, `sitemap-xml-images.test.ts` (orçamento de 50 MB), `validate:seo-runtime` (48: shards de galeria 404; 49–54: imagem sem, com e com licença revogada) | RESOLVIDO (`3cf1d0e`, `429a194`; imagem no sitemap: `fix/seo-sitemap-image-entries`) |
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
| M3 | 11.666 fichas `tmdb-{id}` sem tradução indexadas | D3: `noindex, follow` e fora do sitemap até enriquecer; voltam sozinhas. **A primeira versão não barrava ninguém em produção** — ver §10 | `entity-quality-gates.ts`, `resolver.ts`, `sitemap-index.ts` | `entity-quality-gates.test.ts`, `resolver-quality-gate.test.ts`, `sitemap-localizacao-titulo-proprio.test.ts`, `validate:seo-runtime` (43–47, 55–57) | RESOLVIDO (`3cf1d0e`, `429a194`; título copiado barrado no #305, `623ad96`). No ar e medido em 21/09/2026: 169 fichas `tmdb-N` no sitemap, contra 11.922 antes do #305 (§10.3) |
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
| P6 | CSS único de 143 KB, bloqueante, 82–90% sem casar | Dividido por rota seguindo o [plano](../frontend/CSS-SPLIT-PLAN-2026-09-15.md): oito PRs (#286, #289, #290, #296–#299, #301) e a nota de correção (#304). Só saiu da folha global bloco exclusivo de rota, e nenhum estilo computado mudou: paridade em 38 rotas × 4 larguras, com o acúmulo de folhas da navegação, 0 diferenças em cada passo. **MEDIDO em produção (21/09/2026):** a home carrega 2 folhas, 51.295 B; as fichas de filme e de série, 3 folhas, 61.971 B. Antes, toda rota carregava uma folha só, de 144.735 B | `apps/web/app/globals.css` e as folhas de rota em `apps/web/app/**` | `css:parity`, `css:move-check`, `css-order.test.ts`, `css-sheets-exclusive.test.ts`, `test:styles` | RESOLVIDO (#286–#301, #304; no ar desde 17/09/2026) |
| P7 | `upgrade-insecure-requests` em CSP report-only | Diretiva inerte removida | `apps/web/middleware.ts` | `security-headers.test.ts` | RESOLVIDO (`3d870f7`) |
| P8 | Hero da home em `w1280` sem `srcset` | `srcset` com as larguras que a tela usa | `home-hero-carousel.tsx`, `home-hero-presenter.ts` | `home-hero-srcset.test.ts` | RESOLVIDO (`b76b887`) |
| P9 | Ficha de série com 149 KB de HTML | A lista de episódios virou client component (`EpisodeList`): o HTML é o mesmo e o payload RSC leva os DADOS de cada episódio, não a árvore de elementos de cada linha. Medido no laboratório, 40 episódios com still: HTML 126.541 → 86.791 B (−31%), payload 78.169 → 39.379 B (−50%), gzip 11.545 → 10.616 B (−8%) | `app/_components/episode-list.tsx`, `app/pt/series/[slug]/page.tsx` | `episode-list.test.tsx`, `series-canonical-port.test.ts`, `validate:route-cache` (guia inteiro no HTML; payload sem árvore — reprova no build anterior) | RESOLVIDO (`fcf7198`) |
| P10 | Chunks de JS com 62–67% sem executar | **MEDIDO em produção (21/09/2026):** os dois chunks são o **React DOM** (`839bbb11…`, 173.020 B, 64–66% sem rodar) e o **runtime do Next.js** (`608…`, 173.703 B, 62%). Na home, respondem por ~219 KB dos ~233 KB crus que não rodam na abertura (94%). O código do próprio Cinerie no navegador tem 33 KB crus na home, com ~12 KB sem rodar (~4 KB comprimidos, INFERIDO pela proporção): o diálogo do trailer, o menu móvel e a newsletter do rodapé, e os blocos da home. Nenhuma biblioteca de terceiros entrou no pacote compartilhado. Detalhe e método na §10.4 | — | sonda de cobertura de bloco por CDP (§10.4) | DEPENDÊNCIA EXTERNA DOCUMENTADA (framework) |

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
| G2 | Desempenho | P1, P2, P4, P5, P6, P8, P9 · P10: framework (dependência documentada, §10.4) |
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
| `pnpm test` | **602 arquivos de teste, todos passando** (baseline: 577). Depois do merge de `main` (#279, uma linha de CSS): 601 passando e 1 vermelho por **timeout** — `apps/cms/src/__tests__/easypanel-runtime.test.ts` levou 5.245 ms contra o limite de 5 s, com quatro leituras paralelas disputando o disco; rodado isolado, 3/3 em 8 ms. O teste só lê `Dockerfile.cms`, que a merge não tocou |
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

---

## 10. Conferência em produção (17/09/2026, depois do deploy)

Os 15 PRs entraram na `main` em 17/09/2026 (`5fb9cd0`) e foram implantados no
mesmo dia. Esta seção registra o que foi **MEDIDO no site publicado** — o que a
§9 dizia não existir ainda. Sondas: `fetch` com `cache: 'no-store'` na própria
origem, contagem de folhas de CSS no HTML, `<meta name="robots">` e leitura
completa dos shards de sitemap.

### 10.1 O que o deploy confirmou

| O quê | Medido em produção | Antes do deploy |
|---|---|---|
| CSS da home | 2 folhas, 51.629 B crus, 11.035 B em gzip | 1 folha, 144.735 B e 24.800 B |
| CSS da ficha de filme | 3 folhas, 62.305 B, 13.563 B em gzip | as mesmas 1 folha e 144.735 B |
| HTML da ficha de série | 92.452 B | 150.132 B |
| D1 · galeria | `/pt/filmes/o-fim-da-rua/imagens/` responde `noindex, follow` | `index, follow` |
| D1 · sitemap | o índice não anuncia `imagens-*` nem `videos-*`; `sitemap-pt-BR-imagens-1.xml` responde 404 | os três shards anunciados |
| D2 · pessoa | 3 de 3 perfis amostrados em `noindex, follow`; nenhum perfil no sitemap | página `index`, sitemap com 0 URLs |
| Imagens no sitemap (#282) | `sitemap-pt-BR-movies-1.xml` com `xmlns:image` e `<image:image>` (pôster e backdrop) | sem extensão de imagem |
| M2 · cache do sitemap | a origem manda `Cache-Control: public, max-age=0, s-maxage=900, stale-while-revalidate=3600` | sem `Cache-Control` |

Continuam pendentes, e todas fora do repositório: **I1** (`https://www.cinerie.com/pt/`
ainda responde 200, sem redirect), **I2** (a borda responde `cf-cache-status: DYNAMIC`,
sem Cache Rule), **I5** (`cinerie.com` não tem registro MX, e `/pt/privacidade/`
já publica `privacidade@` e `contato@`) e **I7**.

**Achado de borda, para o dono decidir (D7).** O `robots.txt` de produção traz
**um** grupo `User-agent: *`, sem `Content-Signal` e sem `Disallow` para crawler
de treino: o bloco gerenciado da Cloudflare não está mais sendo servido. A D7
manda mantê-lo. Se a duplicidade do I3 foi resolvida desligando o bloco, o
bloqueio de treino saiu junto.

### 10.2 A D3 não barrava ninguém — e o conserto

**MEDIDO.** O sitemap publicado tem 94.415 fichas (58.169 filmes e 36.246
séries), e **11.922 delas têm slug `tmdb-N`** (6.682 filmes e 5.240 séries) —
praticamente a população que a auditoria media (11.666). Todas com `index` na
página. Ou seja: o portão da D3 estava no ar e não excluía nada.

**A amostra explicou.** `/pt/filmes/tmdb-1465816/` (`Τίποτα`),
`/pt/filmes/tmdb-1729257/` e `/pt/filmes/tmdb-1744388/` (`月の民`) saem com `h1` no
alfabeto original, `index, follow` e a description **gerada de fatos** (M4) —
portanto sem `summary` e sem `meta_description` na linha do locale publicado.

**A causa.** A condição era "existe título não vazio na linha do locale
publicado". E existe: a linha pt-BR carrega o **título original copiado**. Copiar
o original não é traduzir, e a D3 fala de "título no alfabeto original e sem
description".

**O conserto.** `isLocalizedTitle` passa a exigir título **diferente** do
original (comparação exata, só com `trim`, para o SQL do sitemap julgar igual à
página), e os quatro trechos de SQL comparam `et.title` com `movies.title_original`
/ `tv_shows.name_original`. Provas: `entity-quality-gates.test.ts` (casos 3b, 3c,
4b, 5b), `sitemap-localizacao-titulo-proprio.test.ts` (guard dos quatro trechos,
com controle) e `validate:seo-runtime` 55–57 contra PostgreSQL real.

**Efeito esperado:** as ~11,9 mil fichas saem da página e do sitemap, e voltam
sozinhas quando ganharem título em pt-BR ou descrição. É **indexação em massa**:
vale a D3, que o dono decidiu em 11/09/2026, e o merge é dele.

### 10.3 Depois do #305 e do #304 (medido em 21/09/2026)

O dono mergeou o #305 em 17/09/2026 (`623ad96`) e implantou. A conferência foi
refeita em 21/09/2026, com as mesmas sondas.

**A D3 passou a barrar.**

| Medição | 17/09, antes do #305 | 21/09, depois |
|---|---|---|
| Fichas no sitemap | 94.415 (58.169 filmes + 36.246 séries) | 89.979 (57.834 + 32.145) |
| Delas, com slug `tmdb-N` | 11.922 (6.682 + 5.240) | **169** (68 + 101) |

**Sobre a precisão da coluna de 17/09.** A primeira sonda lia o shard em pedaços e
contava de novo o que caía nos últimos 40 caracteres do pedaço anterior: o shard de
filmes 1 deu 50.018 URLs, e o exato é 50.000. Os números de 17/09 podem estar até
~0,05% acima. Os de 21/09 foram refeitos contando bloco `<url>` por bloco, sem
sobreposição. Nenhuma conclusão muda.

- As três fichas amostradas em 17/09 (`/pt/filmes/tmdb-1465816/`,
  `/pt/filmes/tmdb-1729257/` e `/pt/filmes/tmdb-1744388/`) respondem 200 com
  `noindex, follow`: a página continua acessível, só não se oferece ao índice.
- As 169 que ficaram são as que a D3 manda manter. Três séries amostradas
  (`tmdb-325807`, `tmdb-281967`, `tmdb-129748`) têm sinopse em pt-BR na
  description e respondem `index`.
- O total de fichas caiu menos que o de `tmdb-N` porque o catálogo publicado
  cresceu no intervalo (INFERIDO: a ingestão segue rodando).

**O #304 está no ar.** A folha global tem 39.469 B e não contém mais
`.correction-notice`, que só vem com a folha da matéria. A home carrega 2 folhas
(51.295 B); as fichas de filme e de série, 3 folhas (61.971 B).

**Borda e e-mail: nenhum efeito visível em 21/09/2026.**

| Item | Medido |
|---|---|
| I1 · `www` | `https://www.cinerie.com/pt/filmes/a-origem/` responde 200, sem redirect (a canonical aponta o apex) |
| I2 · cache do sitemap | `cf-cache-status: DYNAMIC` em pedidos seguidos a `/sitemap.xml`, `/sitemaps/*` e `/news-sitemap.xml`; o índice leva de 2 a 9 s na origem |
| I5 · e-mail | `cinerie.com` segue sem registro MX |
| D7 · `robots.txt` | 161 B: um grupo `User-agent: *`, sem `Content-Signal` e sem `Disallow` para crawler de treino |
| I7 · HSTS nos redirects | não conferido: o navegador não expõe cabeçalho de redirect, e o `curl` é bloqueado nesta máquina. Nas respostas 200 o HSTS sai (`max-age=63072000; includeSubDomains; preload`) |

### 10.4 P10 — o JS que não roda na abertura (medido em 21/09/2026)

**Método.** Chrome headless por CDP (o helper do laboratório,
`apps/web/scripts/lab/cdp-chrome.ts`), celular de 412 px, primeira visita sem
cache, cobertura em nível de bloco (`Profiler.startPreciseCoverage` com
`detailed`) lida 4 s depois do `load`. Os bytes usados são contados como o
Puppeteer conta: em cada ponto vale o intervalo mais interno. Só entram os
arquivos de `/_next/static/`.

| Página | JS cru | Não roda na abertura | Dele, React DOM + runtime do Next |
|---|---|---|---|
| `/pt/` | 383.621 B | 232.820 B (60,7%) | ~219 KB (94%) |
| `/pt/filmes/a-origem/` | 368.514 B | 229.459 B (62,3%) | ~220 KB (96%) |
| `/pt/series/ukryta-prawda/` | 369.936 B | 230.080 B (62,2%) | ~218 KB (95%) |
| uma matéria (`/pt/noticias/…/`) | 364.311 B | 224.916 B (61,7%) | ~218 KB (97%) |

**Quais são os dois chunks da auditoria.** `839bbb11…` (173.020 B crus, 54.360 B
transferidos) traz as marcas do **React DOM** (`hydrateRoot`,
`__REACT_DEVTOOLS_GLOBAL_HOOK__`); `608…` (173.703 B, 46.320 B) traz as do
**runtime do Next.js** (`NEXT_REDIRECT`, `__next_f`, `next-router-state-tree`).
Eles carregam em toda página do App Router, e boa parte deles só roda ao navegar,
ao clicar ou em erro. Não saem sem trocar de framework.

**O que é do Cinerie.** Três arquivos, pequenos:

- `1522…` (18.162 B, só na home): hero, ticker de novidades, faixa de números —
  28% não roda;
- `app/layout…` (8.371 B, toda página): cabeçalho, menu móvel, newsletter do
  rodapé — 30–37%;
- `8900…` (6.121 B, home e fichas): diálogo do trailer e fachada do YouTube —
  66–94%, porque só é usado no clique.

Somados, ~12 KB crus não rodam na home (~4 KB comprimidos, INFERIDO pela
proporção). O maior candidato isolado, o diálogo do trailer carregado só no
clique, renderia ~2 KB comprimidos, ao custo de uma requisição no primeiro clique.
Fica como opção, não como pendência.

**Observação medida, fora do P10.** Os arquivos estáticos (`/_next/static/`) saem
da Cloudflare em **gzip** (`cf-cache-status: HIT`, o que a origem mandou), enquanto
o HTML dinâmico sai em **zstd**: a borda recomprime o que não guarda. Se a origem
deixasse de comprimir, a borda poderia servir os estáticos em zstd ou brotli, e o
tamanho transferido provavelmente cairia — INFERIDO. Isso precisa ser medido antes
de mudar o `compress` do Next, porque, sem compressão na borda, os arquivos
passariam a ir crus.

### 10.5 Sitemap: arquivos de 10.000 URLs (medido em 21/09/2026)

O índice já era dividido — um arquivo por tipo e por página —, mas cada arquivo ia
até o limite do protocolo, 50.000 URLs. Medido em produção, contando bloco `<url>`
por bloco:

| Arquivo | URLs | Imagens | Cru | Transferido | 1º byte | Total |
|---|---|---|---|---|---|---|
| `sitemap-pt-BR-movies-1.xml` | 50.000 | 80.683 | 20.357.582 B | 2.942.388 B | 4,5 s | 7,9 s |
| `sitemap-pt-BR-series-1.xml` | 32.145 | 56.415 | 13.634.542 B | 1.986.104 B | 3,0 s | 5,6 s |
| `sitemap-pt-BR-movies-2.xml` | 7.834 | 11.047 | 2.988.176 B | 427.743 B | 1,6 s | 3,0 s |

Dentro do limite do Google (50.000 URLs e 50 MB por arquivo), mas pesado: as rotas
são dinâmicas, então cada pedido monta o arquivo inteiro do PostgreSQL, e a extensão
de imagem dobrou o tamanho por URL.

**O que mudou:** `SITEMAP_URL_LIMIT` passa a 10.000 (o limite do protocolo fica em
`SITEMAP_PROTOCOL_URL_LIMIT`). Pela proporção medida, cada arquivo fica perto de
4 MB crus e 0,6 MB transferidos — confirmado depois do deploy, logo abaixo. O total de
URLs não muda: muda só em quantos arquivos ele se divide. O que mais alivia a
origem continua sendo o cache de borda (I2), que ainda não pega.

**Risco medido, para o dono decidir.** O teto por tipo (`SITEMAP_TYPE_URL_CEILING`)
é 150.000 para filme e série, e é fail-closed: o tipo que passa dele sai INTEIRO
do sitemap. Descontadas as fichas que a D3 tirou, o sitemap de filmes ganhou cerca
de 6,3 mil URLs entre 17 e 21/09/2026. Nesse ritmo — INFERIDO, com janela de
quatro dias —, filme chegaria a 120.000 (alerta de 80%) em umas seis semanas e a
150.000 em cerca de dois meses. Subir o teto é mudança revisada, e decidir o que
fica no sitemap é do dono.

**Depois do deploy do #308 (MEDIDO em 22/09/2026).** O índice lista 12 arquivos:
filmes 1 a 6, séries 1 a 4, notícias e estáticas.

| Arquivos | URLs | Cru por arquivo | Transferido por arquivo | 1º byte | Total |
|---|---|---|---|---|---|
| filmes 1–6 | 59.612 (5 × 10.000 + 9.612) | 3,7–4,3 MB | 526–622 KB | 1,5–1,9 s | 2,1–3,5 s |
| séries 1–4 | 32.328 (3 × 10.000 + 2.328) | 0,9–4,4 MB | 136–647 KB | 1,3–2,0 s | 2,0–11,5 s |
| notícias 1 | 381 | 81 KB | 10 KB | 0,7 s | 0,7 s |
| estáticas 1 | 14 | 2 KB | 0,4 KB | 4,1 s | 4,1 s |

- Antes, o maior arquivo tinha 20,4 MB crus e 2,9 MB transferidos, com 4,5 s até
  o primeiro byte. A previsão (~4 MB e ~0,6 MB por arquivo) se confirmou.
- **Nenhuma URL se perdeu nem repetiu:** as 92.335 URLs lidas nos 12 arquivos são
  todas distintas e somam exatamente os quatro tipos. `movies-7` e `series-5`
  respondem 404.
- O total de 11,5 s de `series-1` foi uma transferência lenta, não a origem: o
  primeiro byte chegou em 1,7 s, e os outros arquivos de série fecharam em 2–4,6 s.
- Continuam lentos, e não por causa do tamanho: o **índice** (5,6 s, porque conta
  cada tipo a cada pedido) e o arquivo de **estáticas** (4,1 s para 14 URLs, porque
  pergunta aos loaders das próprias páginas). A borda ainda responde `DYNAMIC`: o
  cache do I2 é o que tiraria esses dois da origem.
- Filmes passaram de 57.834 para 59.612 URLs em um dia (+1.778). Esse ritmo
  confirma o risco do teto por tipo descrito acima.

**O teto de filme subiu para 500.000 (22/09/2026, com autorização do dono).** No
ritmo medido, os 150.000 chegariam em menos de dois meses, e o corte fail-closed
tiraria todos os filmes do sitemap de uma vez. A 500.000, o alerta de 80%
(400.000) fica a meses de distância, e o teto continua detectando anomalia: um
salto até ele seria ~8x o volume de hoje. Série ficou em 150.000, porque cresce
~180 URLs por dia. Um teste novo trava a folga: o alerta de 80% tem de ficar a
mais de 120 dias do volume medido, no ritmo de 1.800 por dia.

**Borda, 22/09/2026 (feito pelo agente, com autorização do dono):**

| Item | Estado |
|---|---|
| I1 · `www` → apex | Redirect Rule 301, preservando caminho e query string. Medido: `https://www.cinerie.com/pt/filmes/a-origem/?teste=redirect` chega em `https://cinerie.com/pt/filmes/a-origem/?teste=redirect` |
| I2 · cache do sitemap | Cache Rule `sitemaps-cacheaveis` para `/sitemap.xml`, `/news-sitemap.xml` e `/sitemaps/*`, respeitando o `Cache-Control` da origem. Medido: índice 3.969 ms (MISS) → 74 ms (HIT); `static-1` 3.523 → 43 ms; `news-1` 1.168 → 55 ms |
| I5 · e-mail | Email Routing: MX `route1/2/3.mx.cloudflare.net`, DKIM `cf2024-1._domainkey` e SPF `v=spf1 include:_spf.mx.cloudflare.net ~all`, conferidos no DNS público. `contato@` e `privacidade@` encaminham para a caixa do dono; o catch-all segue desligado |
| D7 · `robots.txt` | Política de bots de IA: busca e agentes liberados, treino `Disallow`, Bot Preference Sync ligado. Os crawlers de treino já eram bloqueados na borda. O bloco gerenciado ainda não aparecia no `robots.txt` publicado ao fim desta rodada |
| I7 · HSTS nos redirects | não aplicado: o modo automático do agente recusa mudança de certificado/HSTS; fica com o dono |
