---
name: seo-audit
description: >-
  Audita uma rota/pagina publica da Screena (screena.media) quanto as
  invariantes de SEO e governanca: pureza de render (zero API externa, zero
  Gemini), gate anti-thin (>= 2 blocos de valor proprios), schema correto por
  tipo, canonical autorreferente, hreflang reciproco, decisao de indexabilidade
  (index/noindex/draft/stale/blocked) e diferenciacao filme/serie que nunca
  depende so de cor. Use ao revisar uma rota antes de marca-la como `index`,
  ao investigar por que uma pagina nao indexa, ou ao validar um PR que cria ou
  altera paginas publicas. Aponta para `packages/seo` e `scripts/audit`.
---

# Skill: seo-audit — Auditoria de SEO e indexabilidade de uma rota

Esta skill conduz a **auditoria de uma rota/pagina publica** da Screena contra
as invariantes do CANON. O objetivo unico e responder, com evidencia: **esta
pagina pode ser `index`?** — e, se nao, **qual requisito faltou**.

A fonte editorial das regras e [`.claude/rules/seo.md`](../../rules/seo.md). A
fonte executavel e [`packages/seo`](../../../packages/seo) (gate anti-thin +
decisao de indexabilidade). Os dois **devem concordar**; qualquer divergencia e
bug e deve ser corrigida no codigo/regra, nunca contornada na pagina.

> Esta skill **audita e relata**. Ela nao implementa features de produto, nao
> chama APIs, nao acessa banco e nao publica nada. O veredito final de
> indexabilidade e sempre de `evaluateIndexability()` em
> [`packages/seo/src/indexability.ts`](../../../packages/seo/src/indexability.ts),
> alimentado por um payload ja resolvido a partir do PostgreSQL.

---

## Quando usar

- Antes de promover uma rota a `index`.
- Ao investigar por que uma pagina caiu para `noindex`/`draft`/`blocked`.
- Em revisao de PR que cria ou altera paginas publicas indexaveis.
- Ao validar uma nova rota do MVP (ver lista de rotas em `.claude/rules/`).

## Entrada esperada

- A **rota** auditada (ex.: `/pt/filmes/{slug}/onde-assistir/`).
- O **tipo de entidade** (filme, serie, temporada, episodio, pessoa, noticia).
- O **idioma** da pagina (`pt-BR`, `pt`, `en`, `es`).
- O payload que o render usaria (blocos de valor presentes, ratings exibidos com
  flags de licenca, dados estruturados, `thinContentScore`, `review_status`).

---

## Passos da auditoria

### 1. Pureza de render (invariantes 3 e 4)

- Confirme que o render da rota **le apenas PostgreSQL e cache local**
  (`api_cache`). **Zero** chamada a RapidAPI, TMDB, IMDb, Rotten Tomatoes ou
  qualquer provider durante o render.
- Confirme **zero Gemini no render**: a IA so gera `content_blocks` offline,
  ja salvos e validados. O render apenas **le** blocos persistidos e aprovados.
- Verifique que nenhuma API key aparece no frontend/codigo de render — chaves
  vivem **somente em variaveis de ambiente**.
- Sinal de alerta: qualquer `fetch`/cliente HTTP, import de SDK de provider, ou
  chamada a Gemini no caminho de render e **falha imediata** — relate e pare.

### 2. Gate anti-thin (invariante 5)

- Liste os **blocos de valor proprios distintos** da pagina e conte-os com a
  logica de [`packages/seo/src/value-blocks.ts`](../../../packages/seo/src/value-blocks.ts)
  (`countValueBlocks` / `VALUE_BLOCK_TYPES`). Duplicatas do mesmo tipo **nao**
  contam duas vezes; tipos desconhecidos sao ignorados.
- Exija **>= 2** blocos de valor, **alem** do dado cru de API. Ficha, sinopse
  importada ou nota numerica solta **nao** sao blocos de valor.
- Para cada bloco gerado por IA, confirme que ele so conta como valor se: veio de
  payload controlado do PostgreSQL; passou na validacao anti-alucinacao; esta
  salvo em `content_blocks`; tem `prompt_version` e `input_hash`; nao copia
  sinopse externa; e tem `review_status` permitido (`human_reviewed`/`published`).
- Verifique `thinContentScore <= THIN_THRESHOLD` (0,5).

### 3. Schema.org correto por tipo (invariantes 1, 2 e 9)

- Confira o tipo principal: `Movie` (filme), `TVSeries` (serie), `TVSeason`
  (temporada), `TVEpisode` (episodio), `Person` (pessoa), `NewsArticle` (noticia).
- Exija `BreadcrumbList` em todas as paginas principais.
- `FAQPage` **somente** se houver FAQ visivel na pagina. `Review` apenas para
  review propria da Screena.
- `AggregateRating` **somente quando permitido e atribuido** a sua fonte
  (`score_allowed=true`, `license_status` `official`/`licensed`). **Nunca**
  apresentar nota de terceiro como nota propria da Screena, nem
  `AggregateRating` fingindo nota propria.
- Fonte: IMDb != Rotten Tomatoes (escalas/icones/linguagem nunca se misturam);
  `provider_api` (fornecedor tecnico) **nunca** e `rating_source` (fonte
  editorial). Para a validacao detalhada do JSON-LD, encaminhe para a skill
  `schema-validate`.

### 4. Canonical (regra 6 de SEO)

- Toda pagina indexavel declara `<link rel="canonical">` **absoluto e
  autorreferente**, com idioma, sem parametros de tracking, com barra final
  conforme o padrao de rotas.
- A URL canonica vem de `slugs`/`redirects` — nunca montada ad hoc no render.
- Variacoes de URL (filtros/ordenacoes) apontam o canonical para a versao limpa.
- Pagina `noindex`/`draft`/`blocked` **nao** se promove como canonical de outra.

### 5. Hreflang (regra 7 de SEO + invariante 7)

- `hreflang` so e emitido **entre paginas publicadas e revisadas**. Variante em
  `draft`/`noindex`/`blocked` **nao** entra no conjunto.
- O conjunto deve ser **reciproco e completo** (todas as variantes se
  referenciam, com `x-default` quando aplicavel) ou **nao deve existir**.
  Hreflang parcial/quebrado e pior que ausente.
- Lembre: como `en`/`es` nascem em `draft`, no MVP a maioria das paginas pt-BR
  **nao tem alternates** ainda — e correto.

### 6. Decisao de indexabilidade (invariantes 5, 6 e 7)

Aplique `evaluateIndexability()` de
[`packages/seo/src/indexability.ts`](../../../packages/seo/src/indexability.ts)
sobre o payload e respeite a precedencia (do mais restritivo ao menos):

1. Algum rating exibido com licenca bloqueada (`display_allowed=false`,
   `license_status` `unknown`/`blocked`) → `blocked` (invariante 6).
2. Idioma fora de `pt-BR`/`pt` → `draft` (invariante 7).
3. Gate anti-thin satisfeito (dados estruturados confiaveis **e** `>= 2` blocos
   de valor **e** `thinContentScore <= THIN_THRESHOLD` **e** `review_status`
   permitido) → `index` (invariante 5).
4. Caso contrario → `noindex`, apontando o requisito faltante.

- Confirme que a decisao bate com o `<meta robots>` e com a presenca/ausencia no
  **sitemap do idioma**. Sitemap e meta tag **nunca** podem discordar.
- Regra pratica: **na duvida, `noindex`**.

### 7. Diferenciacao filme/serie (invariante 11)

- A distincao filme/serie **nunca** depende so da cor de acento
  (`--screena-movie-red` vs `--screena-series-green`).
- Exija os **cinco sinais simultaneos**: label textual, badge, breadcrumb
  (`/pt/filmes/...` vs `/pt/series/...`), schema (`Movie` vs `TVSeries`) e URL
  (segmento `filmes` vs `series`).
- Esta regra e testada em
  [`tests/governance/vertical.test.ts`](../../../tests/governance/vertical.test.ts).

### 8. Licenca e pirataria (invariantes 6 e 8)

- Dados com `license_status` `unknown`/`blocked` ou `display_allowed=false`
  **nao aparecem** em pagina indexavel; um unico desses torna a pagina `blocked`.
- Quando `requires_attribution`/`requires_linkback`, exibir `attribution_text` e
  `attribution_url` junto ao dado. Logos/notas/citacoes so com os flags
  correspondentes (`logo_allowed`, `score_allowed`, `review_quote_allowed`).
- **Sem pirataria**: nenhuma pagina exibe ou linka torrent, IPTV, player ilegal,
  link de download ou embed pirata. "Onde assistir" lista apenas disponibilidade
  oficial/licenciada.

---

## Saida da auditoria

Relate um **veredito por rota** com:

- Decisao final (`index` / `noindex` / `draft` / `stale` / `blocked`) e o motivo.
- Checklist por passo (1 a 8) com aprovado/reprovado e evidencia.
- Lista de requisitos faltantes, se houver, em ordem de prioridade.

Use como base o checklist operacional de [`.claude/rules/seo.md`](../../rules/seo.md):

- [ ] Render le apenas PostgreSQL/cache — zero API externa, zero Gemini.
- [ ] `>= 2` blocos de valor proprios distintos e `thinContentScore` baixo.
- [ ] Schema correto por tipo + `BreadcrumbList`.
- [ ] Canonical autorreferente; `hreflang` so para variantes publicadas/revisadas.
- [ ] Nenhum rating com licenca bloqueada; atribuicao presente quando exigida.
- [ ] Idioma `pt-BR`/`pt` para `index` (en/es ficam em `draft`).
- [ ] Diferenciacao filme/serie por label + badge + breadcrumb + schema + URL.
- [ ] Pagina presente no sitemap do idioma correspondente.

---

## Referencias

- Logica executavel: [`packages/seo`](../../../packages/seo)
  (`value-blocks.ts`, `indexability.ts`).
- Regras editoriais: [`.claude/rules/seo.md`](../../rules/seo.md),
  [`.claude/rules/i18n.md`](../../rules/i18n.md),
  [`.claude/rules/ratings.md`](../../rules/ratings.md).
- Validacao de JSON-LD: skill `schema-validate`.
- Scripts de auditoria automatizada: `scripts/audit` (esqueletos; nesta fase a
  auditoria e conduzida manualmente com base nesta skill e em `packages/seo`).

---

## Nota de governanca

Esta skill **nao** implementa produto, **nao** acessa rede/banco, **nao** chama
Gemini nem APIs externas e **nao** publica paginas. Ela apenas audita e relata.
O veredito de indexabilidade pertence a `evaluateIndexability()` em `packages/seo`,
sempre sobre payload ja resolvido do PostgreSQL — a skill nunca inventa dados nem
contorna uma reprovacao. Na duvida entre indexar e nao indexar, a decisao e
sempre `noindex`: e melhor uma pagina fora do indice do que poluir o dominio com
conteudo raso ou dado sem licenca.
