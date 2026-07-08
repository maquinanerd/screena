# Regras de SEO — Screen

Estas regras governam **indexabilidade, qualidade e estrutura tecnica de SEO**
de todas as paginas publicas do Screen (`https://thescreen.media`). Sao de cumprimento
obrigatorio: nenhuma pagina entra no indice dos buscadores sem satisfazer o que
esta aqui descrito.

## 0. Identidade publica e dominio canonico

- A marca publica principal e **Screen**.
- O dominio canonico publico e **`https://thescreen.media`**.
- **The Screen** pode aparecer apenas como referencia historica, explicativa ou
  nome expandido nao-principal.
- **Screena** permanece como namespace tecnico/legado interno (`@screena/*`,
  tokens `--screena-*`, scripts/services antigos), nunca como marca publica.
- `screena.media` e legado historico e nao deve ser usado como dominio publico
  canonico ativo.

A logica executavel correspondente vive em
[`packages/seo/src/indexability.ts`](../../packages/seo/src/indexability.ts) e
e validada por
[`tests/governance/indexability.test.ts`](../../tests/governance/indexability.test.ts).
Estas regras sao a fonte editorial; o codigo e a fonte executavel. Os dois
**devem concordar** — qualquer divergencia e bug e deve ser corrigida no codigo,
nunca contornada na pagina.

---

## 1. Indexacao total; blocos de valor = qualidade _(politica atualizada 2026-07)_

**Mudanca de politica (2026-07):** o antigo **gate anti-thin** (que exigia
`>= 2` blocos de valor proprios para uma pagina indexar) foi **removido**. A
nova **invariante 5** e **indexacao total**: toda entidade sincronizada e
indexada em todos os idiomas publicados; `noindex` fica **so para casos
tecnicos** (404, erro, entidade sem slug/traducao/dados estruturados
confiaveis). A licenca (invariante 6) continua bloqueando dado sem permissao, e
o idioma segue o gate da secao 4 (PUBLISHED_LOCALES).

Os **blocos de valor proprios** deixaram de ser pre-requisito de `index` e
passaram a ser **alavanca de qualidade e ranqueamento** (E-E-A-T, profundidade,
citacao em AI Overview) e sinal de "riqueza" da pagina (`hasUniqueValue`). Dado
cru espelhado (ficha, sinopse importada, nota solta) segue nao contando como
valor **proprio**, mas sua ausencia nao impede mais a indexacao.

A contagem continua em `countValueBlocks()`
([`packages/seo/src/value-blocks.ts`](../../packages/seo/src/value-blocks.ts));
`evaluateIndexability()`
([`packages/seo/src/indexability.ts`](../../packages/seo/src/indexability.ts))
nao usa mais essa contagem como gate — so como sinal informativo. Duplicatas do
mesmo tipo **nao** inflam a contagem; entradas desconhecidas sao ignoradas.

### Os 15 blocos de valor (alavanca de qualidade)

1. Introducao editorial propria
2. Onde assistir por pais
3. Ratings externos atribuidos (com fonte e licenca claras)
4. Comparacao critica vs audiencia
5. Review propria
6. Noticias relacionadas
7. FAQ util
8. Trailer incorporado
9. Elenco comentado
10. Contexto de franquia
11. Ordem cronologica
12. Guia de temporadas
13. Obras parecidas
14. Historico de atualizacao
15. Analise sem/com spoiler separada

Esta lista define o que pode contar como valor quando existir dado licenciado,
revisado e persistido. No estado atual do produto, ratings externos,
streaming/onde assistir, RSSPRIME/MN26 e reviews proprias ainda nao estao ativos
como feature publica; nao gere nem force esses blocos para cumprir o gate.

### Bloco gerado por IA so conta como valor se

- Veio de **payload controlado** do PostgreSQL (Entity Writer nunca inventa
  fatos nem chama APIs externas).
- Passou pela **validacao anti-alucinacao**.
- Esta **salvo em `content_blocks`**.
- Tem `prompt_version` e `input_hash`.
- **Nao copia** sinopse externa.
- Tem `review_status` permitido (ver secao de indexabilidade).

Um bloco que falhe em qualquer um desses pontos **nao conta** para o gate.

---

## 2. Pureza de render (zero API externa, zero Gemini)

- **Invariante 3 — Zero API externa no render.** Paginas publicas indexaveis
  leem **apenas PostgreSQL e cache local** (`api_cache`). Nenhuma chamada a
  RapidAPI, TMDB, IMDb, Rotten Tomatoes, provedor de streaming, RSSPRIME/MN26,
  Gemini ou qualquer fornecedor acontece durante o render de uma pagina.
- **Invariante 4 — Zero Gemini no render.** A IA so gera `content_blocks`
  **offline**, salvos e validados antes de qualquer publicacao. O render apenas
  **le** blocos ja persistidos e aprovados.
- Todo sincronismo externo acontece em **workers offline** e gera log em
  `api_sync_logs`.
- API keys vivem **somente em variaveis de ambiente** — nunca no frontend, nunca
  em codigo de render, nunca expostas ao cliente.
- Consequencia pratica: o tempo de resposta de uma pagina indexavel nunca pode
  depender de latencia de terceiros, e nenhuma falha de provider externo pode
  quebrar uma pagina publica.

---

## 3. Indexabilidade (`index` / `noindex` / `draft` / `stale` / `blocked`)

A decisao de indexabilidade de cada pagina e registrada em
`page_indexability_decisions` e calculada por `evaluateIndexability()`.

| Decisao   | Significado |
|-----------|-------------|
| `index`   | Entidade sincronizada, licenciada e em idioma publicado — entra no indice e no sitemap do idioma. |
| `noindex` | Caso tecnico (404, erro, entidade sem slug/traducao/dados estruturados confiaveis) — emite `<meta name="robots" content="noindex">` e fica fora do sitemap. |
| `draft`   | Idioma ainda nao publicado (fora de `PUBLISHED_LOCALES`) — `noindex`, fora do sitemap. |
| `stale`   | Conteudo desatualizado por invalidacao posterior — sai do indice ate ser revalidado. |
| `blocked` | Ha dado sem licenca clara na pagina — nao indexa e nao exibe o dado bloqueado. |

### Precedencia (do mais restritivo ao menos) _(politica atualizada 2026-07)_

1. **Algum rating exibido com licenca bloqueada** (`display_allowed=false`,
   `license_status` `unknown`/`blocked`) → `blocked` (**invariante 6**: dados
   sem licenca clara nao aparecem em pagina indexavel).
2. **Idioma fora de `PUBLISHED_LOCALES`** → `draft` (**invariante 7**).
3. **Caso tecnico** (sem dados estruturados/slug/traducao confiaveis) →
   `noindex`.
4. **Caso contrario** → `index` (**invariante 5 — indexacao total**: entidade
   sincronizada, licenciada e em idioma publicado indexa, independentemente da
   quantidade de blocos de valor). Blocos de valor sao alavanca de ranqueamento,
   nao pre-requisito.

> Regra pratica: **indexa por padrao**; `noindex` so em caso tecnico. A licenca
> (invariante 6) continua bloqueando dado sem permissao — "indexacao total"
> nunca significa indexar mock/placeholder/dado sem licenca.

### `review_status` e exibicao de blocos de IA

Apenas blocos com `review_status` em estado **publicavel** (`human_reviewed` ou
`published`) sao **renderizados** publicamente e contam como sinal de qualidade.
Blocos em `draft`, `ai_generated`, `needs_review`, `needs_update`, `blocked` ou
`archived` **nunca** aparecem como conteudo final. Sob indexacao total, isso
governa **o que a pagina mostra** (nao mais se a pagina indexa): a entidade
indexa com sua ficha crua mesmo sem nenhum bloco publicavel.

---

## 4. Idioma: pt-BR primeiro; en/es via `PUBLISHED_LOCALES` _(politica atualizada 2026-07)_

- **Invariante 7 — pt-BR publica primeiro.** So idiomas listados em
  `PUBLISHED_LOCALES` (`@screena/config`) sao elegiveis a `index`. Hoje:
  `pt-BR`/`pt`. Idioma fora do conjunto → `draft`.
- `en` e `es` **entram em `PUBLISHED_LOCALES`** (e passam a indexar) **apenas
  quando completos**: dado traduzido + i18n de UI + `hreflang` reciproco, e apos
  **revisao humana** explicita. Nao nascem mais permanentemente `noindex` — mas
  tambem nao ligam sozinhos.
- Nenhuma traducao automatica (cega) e indexada antes de revisao. Alterar
  `PUBLISHED_LOCALES` e decisao editorial humana registrada.

---

## 5. Sitemap segmentado por idioma

- Existe **um sitemap por idioma** (ex.: `sitemap-pt.xml`, `sitemap-en.xml`,
  `sitemap-es.xml`), agregados por um `sitemap_index.xml`.
- Cada sitemap lista **somente paginas `index`** daquele idioma. Paginas
  `noindex`, `draft`, `stale` ou `blocked` **nunca** entram no sitemap.
- Como `en`/`es` nascem em `draft`, no MVP **so o sitemap pt** tem URLs reais; os
  demais existem mas comecam vazios ate haver conteudo revisado.
- O sitemap e gerado a partir de `page_indexability_decisions` — a mesma fonte
  que decide o `<meta robots>`. Sitemap e meta tag **nunca** podem discordar.
- O sitemap **nao promove** pagina fina: se o gate anti-thin, licenca, idioma ou
  revisao falhar, a pagina fica fora do sitemap mesmo que exista rota.

---

## 6. Canonical

- Toda pagina indexavel declara um `<link rel="canonical">` **absoluto e
  autorreferente**, apontando para sua propria URL canonica (com idioma, sem
  parametros de tracking, com barra final conforme o padrao de rotas).
- Variacoes de URL (filtros, ordenacoes, parametros) apontam o canonical para a
  versao limpa.
- A URL canonica vem de `slugs`/`redirects` — nunca e montada ad hoc no render.
- Pagina `noindex`/`draft`/`blocked` **nao** se promove como canonical de outra.

---

## 7. Hreflang

- `hreflang` so e emitido **entre paginas publicadas e revisadas**. Uma variante
  de idioma que esteja em `draft`/`noindex`/`blocked` **nao** entra no conjunto
  de `hreflang`.
- Como `en`/`es` nascem em `draft`, no MVP a maioria das paginas pt-BR **nao tem
  alternates** ainda — e correto: so se anuncia o que existe e foi revisado.
- O conjunto de `hreflang` deve ser **reciproco e completo** (todas as variantes
  se referenciam, incluindo `x-default` quando aplicavel) ou **nao deve existir**.
  Hreflang parcial/quebrado e pior que hreflang ausente.

---

## 8. Sem redirect automatico de idioma em URL indexavel

- URLs indexaveis **nunca** fazem redirect automatico por idioma (Accept-Language,
  geo-IP ou cookie). `/pt/filmes/{slug}/` serve sempre pt-BR para qualquer
  visitante — incluindo o Googlebot.
- A escolha de idioma e do usuario (troca explicita), nunca do servidor sobre uma
  URL canonica. Redirecionar o crawler por idioma esconde conteudo do indice e e
  proibido.

---

## 9. Schema.org correto por tipo

Cada pagina emite **JSON-LD** com o tipo correto. Nunca o tipo errado, nunca
`AggregateRating` fingindo nota propria.

| Pagina | Schema principal |
|--------|------------------|
| Filme (`/pt/filmes/{slug}/`) | `Movie` |
| Serie (`/pt/series/{slug}/`) | `TVSeries` |
| Temporada (`/pt/series/{slug}/temporada-{n}/`) | `TVSeason` |
| Episodio | `TVEpisode` |
| Pessoa (`/pt/pessoas/{slug}/`) | `Person` |
| Noticia (`/pt/noticias/{slug}/`) | `NewsArticle` |

Complementos:

- `BreadcrumbList` em **todas** as paginas principais.
- `FAQPage` **somente** se houver FAQ visivel na pagina.
- `Review` apenas para **review propria** do Screen. Como reviews proprias ainda
  nao estao ativas como produto, nao emita `Review` por inferencia.
- `AggregateRating` **somente quando permitido e atribuido** a sua fonte
  (`license_status` `official`/`licensed`, `score_allowed=true`).
  **Nunca** apresentar nota de terceiro como se fosse nota propria do Screen.
  Como ratings externos ainda nao estao ativos como produto, nao emita
  `AggregateRating` sem escopo/licenca/revisao explicitos.

Regra de fonte (**invariantes 1 e 2**): IMDb != Rotten Tomatoes (nunca misturar
escalas, icones ou linguagem); o fornecedor tecnico (`provider_api`) **nunca** e
a fonte editorial (`rating_source`). Nota IMDb nunca vira Tomatometer;
Tomatometer/Popcornmeter pertencem so ao Rotten Tomatoes.

---

## 10. Diferenciacao filme/serie nunca depende so de cor

A distincao entre filme e serie **nunca** pode depender apenas da cor de acento
(filme = `--screena-movie-red`, serie = `--screena-series-green`). Cor e apoio
visual, nao sinal semantico.

Toda pagina deve diferenciar filme de serie por **cinco sinais simultaneos**
(**invariante 11**):

1. **Label** textual ("Filme" / "Serie").
2. **Badge** visivel.
3. **Breadcrumb** (`/pt/filmes/...` vs `/pt/series/...`).
4. **Schema** (`Movie` vs `TVSeries`).
5. **URL** (segmento `filmes` vs `series`).

Cor sozinha e invisivel para crawlers, leitores de tela e daltonicos — por isso
nunca pode ser o unico diferenciador. Esta regra e testada em
[`tests/governance/vertical.test.ts`](../../tests/governance/vertical.test.ts).

---

## 11. Licenca e exibicao de dados

- Dados com `license_status` `unknown`/`blocked` ou `display_allowed=false`
  **nao aparecem** em pagina indexavel (**invariante 6**); a presenca de um
  unico desses torna a pagina `blocked`.
- Atribuicao obrigatoria: quando `requires_attribution`/`requires_linkback`,
  exibir `attribution_text` e `attribution_url` junto ao dado.
- Logos/notas/citacoes so quando os flags correspondentes (`logo_allowed`,
  `score_allowed`, `review_quote_allowed`) permitirem.

---

## 12. Sem pirataria

Nenhuma pagina exibe ou linka torrent, IPTV, player ilegal, link de download ou
embed pirata (**invariante 8**). "Onde assistir" lista **apenas** disponibilidade
oficial/licenciada (`watch_availability` com provider legitimo).

---

## Checklist de indexacao (resumo operacional) _(politica atualizada 2026-07)_

Sob **indexacao total**, uma entidade sincronizada indexa por padrao. Antes de
confirmar `index`, garanta que nenhum bloqueio se aplica:

- [ ] Dados estruturados confiaveis presentes e validos (senao → `noindex`
      tecnico; nao ha slug/traducao → nao indexa).
- [ ] Nenhum rating/dado com licenca bloqueada (invariante 6) — senao `blocked`.
- [ ] Idioma em `PUBLISHED_LOCALES` (`pt-BR`/`pt` hoje; en/es só quando
      completos, invariante 7) — senao `draft`.
- [ ] Render le apenas PostgreSQL/cache — zero API externa, zero Gemini.
- [ ] Schema correto por tipo + `BreadcrumbList`.
- [ ] Canonical autorreferente; `hreflang` so para variantes publicadas/revisadas.
- [ ] Diferenciacao filme/serie por label + badge + breadcrumb + schema + URL.
- [ ] Pagina presente no sitemap do idioma correspondente.
- [ ] (Qualidade/ranqueamento, nao gate) blocos de valor proprios enriquecem a
      pagina — `review_status` publicavel para renderizar.
