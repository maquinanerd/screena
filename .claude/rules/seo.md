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

## 1. Gate anti-thin (>= 2 blocos de valor proprios)

Uma pagina **so pode ser indexada** se tiver **pelo menos 2 blocos de valor
proprios distintos**, alem do dado cru vindo de API. Dado cru espelhado (ficha,
sinopse importada, nota numerica solta) **nao conta** como valor proprio.

Essa e a **invariante 5**: pagina fina recebe `noindex`.

A contagem e feita por `countValueBlocks()` em
[`packages/seo/src/value-blocks.ts`](../../packages/seo/src/value-blocks.ts), e
o limiar de 2 e aplicado por `evaluateIndexability()` em
[`packages/seo/src/indexability.ts`](../../packages/seo/src/indexability.ts).
Duplicatas do mesmo tipo **nao** inflam a contagem; entradas desconhecidas sao
ignoradas.

### Os 15 blocos de valor aceitos

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
| `index`   | Pagina rica, licenciada e revisada — entra no indice e no sitemap do idioma. |
| `noindex` | Pagina fina/incompleta (gate anti-thin falhou) — emite `<meta name="robots" content="noindex">` e fica fora do sitemap. |
| `draft`   | Conteudo ainda nao publicado para aquele idioma (en/es pre-revisao) — `noindex`, fora do sitemap. |
| `stale`   | Conteudo desatualizado por invalidacao posterior — sai do indice ate ser revalidado. |
| `blocked` | Ha dado sem licenca clara na pagina — nao indexa e nao exibe o dado bloqueado. |

### Precedencia (do mais restritivo ao menos)

1. **Algum rating exibido com licenca bloqueada** (`display_allowed=false`,
   `license_status` `unknown`/`blocked`) → `blocked` (**invariante 6**: dados
   sem licenca clara nao aparecem em pagina indexavel).
2. **Idioma fora de pt-BR/pt** → `draft` (**invariante 7**).
3. **Gate anti-thin satisfeito** (dados estruturados confiaveis **e** `>= 2`
   blocos de valor proprios **e** `thinContentScore <= THIN_THRESHOLD` **e**
   `review_status` permitido) → `index` (**invariante 5**).
4. **Caso contrario** → `noindex`, com motivo apontando o requisito faltante.

> Regra pratica: **pagina fina = `noindex`**. Na duvida, nao indexar. E sempre
> melhor uma pagina fora do indice do que poluir o dominio com conteudo raso.

### `review_status` e indexabilidade de blocos de IA

Apenas blocos com `review_status` em estado **publicavel** (`human_reviewed` ou
`published`) contam para indexacao. Blocos em `draft`, `ai_generated`,
`needs_review`, `needs_update`, `blocked` ou `archived` **nao** habilitam
`index`.

---

## 4. Idioma: pt-BR primeiro; en/es em draft/noindex

- **Invariante 7 — pt-BR publica primeiro.** Paginas em `pt-BR`/`pt` sao as
  unicas elegiveis a `index` no MVP.
- `en` e `es` **nascem em `draft`/`noindex`** e so passam a `index` apos
  **revisao humana** explicita (`entity_translations` revisada e
  `review_status` permitido).
- Nenhuma traducao automatica e indexada antes de revisao.

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

## Checklist de publicacao (resumo operacional)

Antes de marcar uma pagina como `index`:

- [ ] `>= 2` blocos de valor proprios distintos (gate anti-thin / invariante 5).
- [ ] `thinContentScore <= THIN_THRESHOLD`.
- [ ] Dados estruturados confiaveis presentes e validos.
- [ ] Nenhum rating com licenca bloqueada (invariante 6).
- [ ] Idioma `pt-BR`/`pt` (en/es ficam em `draft`, invariante 7).
- [ ] `review_status` dos blocos em estado publicavel.
- [ ] Render le apenas PostgreSQL/cache — zero API externa, zero Gemini.
- [ ] Schema correto por tipo + `BreadcrumbList`.
- [ ] Canonical autorreferente; `hreflang` so para variantes publicadas/revisadas.
- [ ] Diferenciacao filme/serie por label + badge + breadcrumb + schema + URL.
- [ ] Pagina presente no sitemap do idioma correspondente.
