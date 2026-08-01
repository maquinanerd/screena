# Roadmap de execucao — Cinerie (2026-07-30)

> Etapas 19 e 20 da auditoria. Cada item deriva de uma evidencia registrada em
> [`CINERIE_360_AUDIT_2026-07-30.md`](./CINERIE_360_AUDIT_2026-07-30.md) — nao ha item
> especulativo. Nenhum trabalho foi executado.

**Principio que organiza este roadmap:** nao ha subsistema faltando. Ha **conectores**
faltando entre subsistemas prontos. Por isso a ordem otimiza por *"quantos elos mortos cada
item revive"*, nao por tamanho.

---

## P0 — Uma noticia manual aparece **corretamente** no cinerie.com

Objetivo: uma materia escrita a mao no Payload chega ao site **com card de entidade, corpo
estruturado e aparecendo nas relacionadas do filme**.

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P0-1** | Implantar `cinerie-publication-worker` no EasyPanel | CMS no ar; migrations do `screen-db` aplicadas; service account com escopo `publication_projection`; `EDITORIAL_MEDIA_S3_*` | `Dockerfile.publication-worker`, `docs/runbooks/EASYPANEL_EDITORIAL.md` (secao N) | nao | **sim — criar** | medio: storage publico precisa existir antes | `/readyz` do worker `ok`; uma materia publicada aparece em `/pt/noticias` |
| **P0-2** | **Projetar `event.article.entities` → `entity_news_links`** | P0-1 (ou paralelo) | `services/news-ingestion/src/persistence/editorial-projection-store.ts` (dentro da `$transaction` que ja existe, junto do upsert de `article`), `editorial-projection.ts` | **nao** — `EntityNewsLink:1695` ja existe com `@@unique([articleId, entityType, entityId])` | nao | **medio**: `entityType` publico e `EntityType` (movie/tv/person) e o CMS oferece 7 `entityKind` — decidir explicitamente o que fazer com `season`/`episode`/`character`/`franchise` (recomendado: ignorar com aviso, nunca inventar) | teste de integracao: publicar materia com 2 entidades verificadas → 2 linhas em `entity_news_links`; reprojecao nao duplica; entidade inexistente nao cria linha falsa |
| **P0-3** | Renderizar `article_translations.body_blocks` | contrato ja definido | `apps/web/src/lib/news-presenter.ts`, `apps/web/app/pt/noticias/[slug]/page.tsx`, novo componente de blocos | nao | nao | **medio**: sanitizacao — o corpo passa a vir de estrutura, nao de texto; revalidar XSS e a serializacao de JSON-LD | os 10 tipos (`paragraph`,`heading`,`image`,`video`,`quote`,`entityCard`,`factBox`,`relatedContent`,`sourceList`,`divider`) renderizam; ausencia de `bodyBlocks` continua caindo em `body` (aditivo) |
| **P0-4** | Card de entidade hidratado a partir do catalogo | P0-2, P0-3 | `apps/web/src/server/news-pages.ts` (o leitor **ja existe**, `:266`) | nao | nao | baixo | materia com `primary_subject` mostra poster, ano, tipo, link para a ficha |
| **P0-5** | Canario ponta a ponta **com entidade** | P0-2..P0-4 | estender `pnpm test:manual-publication-projection:integration` | nao | nao | baixo | o canario falha se o vinculo nao chegar — hoje ele passaria com o elo quebrado |
| **P0-6** | Confirmar `noindex` + exclusao de sitemap das rotas `/dev/*` | — | `apps/web/app/dev/**`, `packages/seo` | nao | nao | baixo | `/dev/*` fora do sitemap e com `noindex` em producao |

**P0 fecha quando:** publicar "Superman ganha novo trailer" no Payload produz, em
`cinerie.com`, a materia com corpo estruturado, card do filme Superman com poster e ano, e a
materia listada em "noticias relacionadas" na ficha de Superman.

---

## P1 — Ponte catalogo → Payload

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P1-1** | `GET /api/internal/entities/search?q=&kind=&limit=` no Screen-App, autenticado por token de servico | — | `apps/web/app/api/internal/entities/search/route.ts`, sobre `SearchDocument:1315` (ja indexado) | nao | nao | **medio**: e a primeira rota interna autenticada do `screen-app` — definir o modelo de token e o rate limit antes | busca "superman" devolve `{entityKind, entityId, title, year, posterPath, slug, canonicalUrl, externalIds}`; 401 sem token |
| **P1-2** | `GET /api/internal/entities/:kind/:id` (resolucao/hidratacao) | P1-1 | idem | nao | nao | baixo | resolve id valido; 404 em id inexistente |
| **P1-3** | Componente de campo no Payload substituindo `entityId: text` | P1-1, P1-2 | `apps/cms/src/collections.ts:606`, novo componente em `admin.components.Field` | nao | nao | medio: UX do Payload | editor busca por titulo, ve poster/ano/tipo e seleciona; o campo grava o id canonico |
| **P1-4** | Validar `entityId` tambem no intake do MNScr | P1-2 | `apps/cms/src/draft-intake.ts` | nao | nao | baixo | draft com entidade inexistente vira `warning`, nunca vinculo silencioso |
| **P1-5** | Decidir `character` e `franchise` | — | `apps/cms/src/collections.ts:180` vs schema publico | possivel (se criar `Character`) | nao | **decisao de Pablo** | ou o enum do CMS encolhe, ou o catalogo ganha as entidades |
| **P1-6** | Expor imagens do catalogo ao CMS (seletor) | P1-1 | endpoint de imagens sobre `TmdbImage:1183` + componente | nao | nao | **medio — licenca**: existir no catalogo **nao** autoriza uso editorial (ADR 0015 §"midia") | seletor mostra so imagem com permissao; escolha grava `provenanceType: cinerie_catalog` |

---

## P2 — MNScr → Payload

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P2-1** | Criar service account `draft_ingest` e entregar a chave ao MNScr | CMS no ar | operacao no Payload | nao | nao | baixo | MNScr autentica em `/internal/editorial-drafts` |
| **P2-2** | **Trabalho no repositorio do MNScr** — adaptar a saida de WordPress para `editorial-draft-v1` | P2-1, `/internal/contracts` | **repositorio MNScr** (fora deste) | — | — | alto | 1 draft real criado no Payload |
| **P2-3** | Aceitar imagem da fonte por URL no intake | P2-1 | `apps/cms/src/draft-intake.ts` + downloader com allowlist | nao | nao | **ALTO — SSRF**: e a primeira vez que o CMS busca URL fornecida por terceiro. Exige allowlist de host, bloqueio de IP privado, limite de tamanho e timeout | imagem da fonte chega com credito, `sourceUrl` e `licenseStatus: unknown` (fail-closed) |
| **P2-4** | Habilitar autopublicacao (`editorial_auto_publish`) | P2-2, quotas configuradas | `EDITORIAL_AUTO_PUBLISH_*` | nao | nao | **medio — decisao humana**: e o unico caminho que publica sem revisao | kill switch testado; quota diaria respeitada; ator `automation_publisher` na trilha |
| **P2-5** | Cinerie Context Service (`cinerie-editorial-context-v1`) | P1-1, P1-2 | novo endpoint no `screen-app`; contrato **ja existe** | nao | nao | medio | MNScr consulta contexto de entidade antes de redigir |

---

## P3 — Catalogo completo e atualizacao continua

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P3-0** | **Censo antes de qualquer coisa** | acesso read-only ao `screen-db` | `pnpm catalog audit-database --json` | nao | nao | baixo | numero real de filmes/series/pessoas/episodios conhecido |
| **P3-1** | `Dockerfile.catalog-worker` + servico `cinerie-catalog-worker` | P3-0 | novo Dockerfile (espelhando `Dockerfile.publication-worker`) + `scripts/catalog/catalog-cycle-with-alert.sh` como comando | nao | **sim — criar** | **medio**: o script assume `flock` e `bash`; conferir na imagem. `TMDB_READ_ACCESS_TOKEN` so em runtime | ciclo horario roda no container; sentinela reporta crescimento |
| **P3-2** | Agendamento sem systemd | P3-1 | scheduled task do EasyPanel **ou** loop no proprio container | nao | sim | baixo | ciclo horario + `/changes` diario + configuration cache semanal |
| **P3-3** | Bootstrap amplo | P3-1, `db:seed` + taxonomias aplicados | `pnpm catalog bootstrap` (rodar `plan-bootstrap` antes) | nao | nao | **ALTO — custo/cota**: `--limit 20` ja gerou 85.878 episodios num ciclo anterior. Sempre planejar antes | escopo definido por Pablo; cota TMDB respeitada |
| **P3-4** | Dead-letter + reprocessamento operados | P3-2 | `catalog dead-letter`, `docs/runbooks/catalog-dead-letter.md` | nao | nao | baixo | fila morta drenada, alerta ativo |
| **P3-5** | Renderizar trailers (`TmdbVideo`) | P3-0 | `apps/web/src/server/movie-page.ts`, `series-page.ts` + componente | nao | nao | baixo | embed de trailer na ficha; sem play fake quando nao houver video |
| **P3-6** | Aposentar `services/sync/systemd/*` (runner legado) | P3-2 | `services/sync/systemd/` | nao | nao | baixo | um unico caminho de refresh, sem ambiguidade |

---

## P4 — Midia (WebP, R2, licenciamento)

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P4-1** | Provisionar bucket R2/S3 e ligar `EDITORIAL_MEDIA_S3_*` | — | `services/news-ingestion/src/media/storage-config.ts` | nao | nao | baixo | worker grava e o site le |
| **P4-2** | Conversao WebP + derivados no upload | P4-1 | `apps/cms/src/collections.ts:411-422` (`imageSizes`, `formatOptions`); `sharp` **ja instalado** | nao | nao | **medio**: nao fazer upscale; preservar master em alta | JPEG enviado vira WebP + derivados; master preservado |
| **P4-3** | Focal point aplicado no crop | P4-2 | presenter de imagem | nao | nao | baixo | crop respeita `focalPoint` |
| **P4-4** | Exclusao do original **so apos verificacao** | P4-2 | pipeline de midia | nao | nao | **medio**: nunca apagar antes de confirmar integridade do derivado | original removido so com hash do WebP verificado; rollback testado |
| **P4-5** | Decisao humana de licenca por fonte de imagem | — | `services/legal/src/authorization-spec.ts` | nao | nao | **decisao de Pablo** | matriz preenchida |

---

## P5 — Ratings externos e Cinerie Score

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P5-1** | **Decisao de licenca — IMDb** | — | `services/legal` | nao | nao | **ALTA — juridica**. O client existente e `imdb236` via RapidAPI, um **terceiro**, nao a IMDb | decisao humana registrada em `source_licenses` |
| **P5-2** | **Decisao — Rotten Tomatoes** | — | — | nao | nao | **ALTA**. `api-clients/rotten_tomatoes` e so um `README.md`; nao ha fonte | ou fonte oficial contratada, ou RT sai do produto |
| **P5-3** | Agendar sync de ratings | P5-1 | `services/ratings/bin/sync-film-show-ratings.ts` + servico/cron | nao | sim | medio: cota | `external_ratings` populada, `api_sync_logs` gravado |
| **P5-4** | Agendar sync de streaming + promocao humana | licenca | `services/streaming/bin/*` | nao | sim | medio | `watch_availability` com licenca vigente e carimbo "Atualizado em" |
| **P5-5** | Ligar o Cinerie Score | P5-3 | `packages/cinerie-score` | nao | sim | medio: nunca misturar escalas — o gate de procedencia ja existe (`editorial-score.ts:67`) | score exibido so com calculo `calculated` coerente |

---

## P6 — Taxonomia, SEO e medicao

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P6-1** | Taxonomia real (categorias + tags) | — | novos models + collections no CMS + projecao | **SIM** | nao | **medio — precisa de tarefa aprovada para banco** | categoria vira FK; tags existem; retrocompativel com `category` texto |
| **P6-2** | Rotas de categoria e tag | P6-1 | `apps/web/app/pt/noticias/[categoria]` | nao | nao | baixo | navegacao por assunto + sitemap |
| **P6-3** | Projetar autor publico (collection `authors` → banco publico) | — | `publication.ts`, projecao, `Article.authorName` | **provavel** | nao | medio | autor com pagina e E-E-A-T |
| **P6-4** | Google Search Console | site no ar | verificacao de propriedade | nao | nao | baixo | sitemaps e news sitemap submetidos |
| **P6-5** | GA4 respeitando consentimento | P6-4 | `apps/web` + `ConsentRecord` (o consentimento **ja existe**) | nao | nao | **medio — LGPD**: so carregar apos consentimento `analytics` | evento so dispara com consentimento |
| **P6-6** | Renderizar `approvedInternalLinks` | P0-3 | presenter de noticia | nao | nao | baixo | links internos aprovados aparecem |
| **P6-7** | Score de SEO + preview SERP no CMS | P6-1 | componentes do Payload | nao | nao | baixo | editor ve o score antes de publicar |

---

## P7 — Acabamento e lancamento

| ID | Trabalho | Dependencias | Arquivos provaveis | Migration? | Servico? | Risco | Criterio de aceite |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **P7-1** | Expor recomendacoes (dominio ja pronto) | P3 populado | `RecommendationSnapshot:2314` + API + UI; a secao "PARA VOCE" ja existe declarando ausencia | nao | nao | baixo | recomendacao real substitui a declaracao honesta |
| **P7-2** | Expor reviews de usuario | moderacao ja pronta | `UserReview:2231` + API + UI | nao | nao | medio: moderacao operacional | review publicada apos moderacao |
| **P7-3** | Executar restore real de backup | — | `scripts/backup/restore-test.sh` | nao | nao | **ALTO se nunca feito** — o CI so valida sintaxe | restore validado em base efemera |
| **P7-4** | Paginas de colecao/franquia | P1-5 | rotas novas | possivel | nao | baixo | `entityKind: franchise` resolve |
| **P7-5** | en/es em `PUBLISHED_LOCALES` | traducao + i18n de UI + hreflang | `@screena/config` | nao | nao | **decisao humana** (invariante 7) | so com completude e revisao |

---

# ETAPA 20 — Ordem executavel

## 1. O que fazemos primeiro

**P0-2 (projetar `entities` → `entity_news_links`).** E o item de maior alavancagem do
repositorio inteiro: e uma escrita dentro de uma transacao que **ja existe**, sem migration,
e sozinha revive **quatro** superficies mortas (card de entidade, relacionadas da materia,
relacionadas da ficha, destaques editoriais da home).

Em paralelo, **P0-1 (implantar o worker)** — sao independentes; P0-2 e codigo, P0-1 e
infraestrutura.

## 2. O que pode ser feito em paralelo

| Trilha | Itens | Por que nao colidem |
| --- | --- | --- |
| Codigo editorial | P0-2, P0-3, P0-4 | so `apps/web` + `services/news-ingestion` |
| Infra editorial | P0-1, P4-1 | so EasyPanel |
| Infra de catalogo | P3-0, P3-1, P3-2 | so `services/ingestion` + EasyPanel |
| Ponte | P1-1, P1-2 | rotas novas em `apps/web`, sem tocar render existente |
| Decisoes humanas | P5-1, P5-2, P1-5, P4-5 | nao sao codigo |

**Regra de higiene do repositorio:** uma tarefa de escrita por checkout; migrations sempre
seriais. P6-1 e P6-3 (as unicas com migration) **nao** rodam junto com nada.

## 3. O que depende de migration

**Apenas P6-1 (taxonomia) e provavelmente P6-3 (autor publico).** Tudo em P0-P5 e aditivo
sobre o schema existente. `EntityNewsLink` ja tem a `@@unique` necessaria.

## 4. O que depende de servico novo no EasyPanel

- `cinerie-publication-worker` (**P0-1**) — Dockerfile pronto
- `cinerie-catalog-worker` (**P3-1**) — **Dockerfile a criar**
- Bucket R2/S3 (**P4-1**)
- Agendamentos de ratings/streaming (**P5-3**, **P5-4**)

## 5. O que depende do MNScr

**P2-2 inteiro** (trabalho no outro repositorio) e, por consequencia, P2-4. **Nada em P0, P1,
P3, P4 ou P6 depende do MNScr.** A Cinerie pode publicar, ligar catalogo e noticia, operar o
catalogo em escala e medir tudo isso sem o MNScr existir.

## 6. O que depende de contrato/licenca externa

- **P5-1 / P5-2** — IMDb e Rotten Tomatoes. Bloqueantes por natureza juridica, nao tecnica.
- **P4-5** — licenca de imagem por fonte.
- **P1-6** — uso editorial de imagem do catalogo (existir ≠ autorizar).

## 7. Primeiro teste vertical ponta a ponta

```
1. Publicar manualmente no Payload uma materia com:
   - corpo com paragrafo + heading + imagem inline + factBox
   - 1 entidade verificada: filme Superman (primary_subject)
   - hero com licenca aprovada
2. Worker consome a outbox
3. screen-db recebe: article + article_translation + body_blocks
                     + editorial_media_asset + ENTITY_NEWS_LINK
4. cinerie.com/pt/noticias/<slug> mostra corpo estruturado + card do Superman
5. cinerie.com/pt/filmes/superman mostra a materia em "noticias relacionadas"
6. A materia aparece nos destaques editoriais da home
7. /news-sitemap.xml contem a URL
```

Os passos 3-6 sao exatamente o que **hoje falharia**. Este e o teste que deve virar
regressao (P0-5).

## 8. Quando o produto e MVP operacional

Quando **P0 fecha** e **P3-1/P3-2** estao no ar:

- catalogo crescendo e atualizando sozinho
- redacao publicando manualmente
- noticia ligada ao catalogo nas duas direcoes
- SEO tecnico completo (ja esta)
- produto pessoal do usuario funcional (ja esta)

**Nao e preciso MNScr, nem ratings externos, nem WebP para ser MVP operacional.**

## 9. Quando esta pronto para escala

P0 + P1 + P2 + P3 + P4 + P6-4/P6-5:

- MNScr produzindo com autopublicacao governada
- ponte de entidades e imagens no CMS
- catalogo em escala com dead-letter operado
- midia otimizada em R2
- GSC e GA4 medindo

P5 (ratings) e P7 (recomendacoes/reviews) sao **profundidade**, nao escala.

## 10. Decisoes que ainda exigem confirmacao de Pablo

| # | Decisao | Por que so voce decide | Bloqueia |
| --- | --- | --- | --- |
| 1 | **Escopo do catalogo TMDB** — tudo? so pt-BR relevante? so a partir de um ano? | custo de cota e volume de banco; `--limit 20` ja produziu 85.878 episodios | P3-3 |
| 2 | **IMDb via `imdb236`/RapidAPI e aceitavel?** | e um **terceiro**, nao a IMDb. Exibir nota assim e decisao de licenca e de risco | P5-1, P5-3, Cinerie Score |
| 3 | **Rotten Tomatoes fica ou sai?** | hoje e so um `README.md`. Manter na promessa de produto sem fonte e divida | P5-2 |
| 4 | **`character` e `franchise` no CMS** — criar as entidades ou remover do enum? | hoje um editor pode selecionar um tipo que o site nao resolve | P1-5, P0-2 |
| 5 | **Autopublicacao do MNScr entra quando?** | e o unico caminho que publica sem revisao humana | P2-4 |
| 6 | **Taxonomia: quantas categorias e qual arvore?** | define migration e rotas | P6-1, P6-2 |
| 7 | **Imagem do catalogo pode virar imagem de materia?** | existir no banco nao autoriza uso editorial (ADR 0015) | P1-6 |
| 8 | **en/es entram em `PUBLISHED_LOCALES`?** | invariante 7 — exige completude e revisao humana | P7-5 |
| 9 | **Onde o `cinerie-catalog-worker` roda** — servico dedicado com loop, ou scheduled task do EasyPanel? | muda o Dockerfile e o custo | P3-1, P3-2 |

---

## Nota final

Nenhum item deste roadmap propoe reconstruir algo existente. Os tres itens de maior impacto
(P0-2, P0-3, P3-1) somam, respectivamente: uma escrita numa transacao existente, um
componente de render sobre uma coluna existente, e um Dockerfile para um script existente.
