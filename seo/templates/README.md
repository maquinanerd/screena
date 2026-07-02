# Templates SEO por tipo de entidade

Este diretorio descreve os **templates de SEO on-page** do Screen para cada
tipo de pagina indexavel. Sao a referencia canonica que orienta as rotas
Next (`generateMetadata`, H1, breadcrumbs, JSON-LD) e o gate anti-thin.

> Regra de ouro: nenhuma pagina indexavel le API externa no render (regra 3).
> Tudo aqui sai do PostgreSQL/cache local. Pagina sem **>= 2 blocos de valor
> proprios** (alem de dado cru de API) recebe `noindex` (regra 5). Dado sem
> licenca clara nao aparece (regra 6).

## Diferenciacao filme x serie (regra 11)

A distincao **nunca** depende so da cor. Sempre combine os cinco sinais:

- **label** (ex.: "Filme" / "Serie")
- **badge** visual
- **breadcrumb** (`/pt/filmes/...` vs `/pt/series/...`)
- **schema** (`Movie` vs `TVSeries`)
- **URL** (segmento `filmes` vs `series`)

Cor e apenas reforco: filme usa `--screena-movie-red` (#FF3B30); serie usa
`--screena-series-green` (#7AA66D); home/busca/misto/institucional usam neutro.

---

## Filme

- **Rota**: `/pt/filmes/{slug}/`
- **Title**: `{titulo} ({ano}) — Onde assistir, elenco e avaliacoes | Screen`
- **Meta description**: resumo editorial proprio (sem copiar sinopse externa),
  com idioma, ano e proposta de valor.
- **H1**: `{titulo} ({ano})`
- **Blocos de valor sugeridos** (>= 2 para indexar): introducao editorial
  propria; onde assistir por pais; ratings externos atribuidos; comparacao
  critica vs audiencia; trailer incorporado; elenco comentado; FAQ util.
- **Schema.org**: `Movie` + `BreadcrumbList` (+ `AggregateRating` somente
  quando permitido e devidamente atribuido — nunca nota propria fingida).
- **Visual**: acento vermelho (`--screena-movie-red`), label "Filme", badge,
  breadcrumb `Filmes`.

## Serie

- **Rota**: `/pt/series/{slug}/`
- **Title**: `{titulo} ({ano}) — Temporadas, onde assistir e avaliacoes | Screen`
- **Meta description**: resumo editorial proprio com numero de temporadas e
  status (em exibicao / encerrada).
- **H1**: `{titulo}`
- **Blocos de valor sugeridos**: introducao editorial propria; guia de
  temporadas; onde assistir por pais; ratings externos atribuidos; elenco
  comentado; noticias relacionadas; FAQ util.
- **Schema.org**: `TVSeries` + `BreadcrumbList`.
- **Visual**: acento verde (`--screena-series-green`), label "Serie", badge,
  breadcrumb `Series`.

## Temporada

- **Rota**: `/pt/series/{slug}/temporada-{number}/`
- **Title**: `{serie} — Temporada {number} | Screen`
- **Meta description**: contexto da temporada (ano, n.o de episodios, arco).
- **H1**: `{serie} — Temporada {number}`
- **Blocos de valor sugeridos**: contexto da temporada; guia/lista de
  episodios comentada; onde assistir; elenco da temporada.
- **Schema.org**: `TVSeason` + `BreadcrumbList`.
- **Visual**: acento verde (serie), label "Temporada", breadcrumb
  `Series > {serie} > Temporada {number}`.

## Episodio

- **Rota**: `/pt/series/{slug}/temporada-{number}/episodio-{number}/` (futura)
- **Title**: `{serie} S{temporada}E{episodio} — {titulo do episodio} | Screen`
- **Meta description**: contexto do episodio sem spoiler por padrao.
- **H1**: `{titulo do episodio}`
- **Blocos de valor sugeridos**: contexto do episodio; analise sem/com spoiler
  separada; onde assistir.
- **Schema.org**: `TVEpisode` + `BreadcrumbList`.
- **Visual**: acento verde (serie).

## Pessoa

- **Rota**: `/pt/pessoas/{slug}/`
- **Title**: `{nome} — Filmografia e biografia | Screen`
- **Meta description**: resumo editorial proprio da carreira.
- **H1**: `{nome}`
- **Blocos de valor sugeridos**: introducao editorial propria; filmografia
  comentada; obras parecidas / colaboracoes recorrentes; noticias relacionadas.
- **Schema.org**: `Person` + `BreadcrumbList`.
- **Visual**: neutro (pessoa nao e filme nem serie por si so).

## Onde assistir

- **Rota**: `/pt/filmes/{slug}/onde-assistir/`, `/pt/series/{slug}/onde-assistir/`
  e `/pt/onde-assistir/{slug}/`.
- **Title**: `Onde assistir {titulo} no Brasil — Streaming e aluguel | Screen`
- **Meta description**: onde assistir por pais, com **data de atualizacao**.
- **H1**: `Onde assistir {titulo}`
- **Blocos de valor sugeridos**: onde assistir por pais (texto + tabela);
  historico/data de atualizacao; ratings externos atribuidos; FAQ util.
- **Schema.org**: `Movie`/`TVSeries` (entidade base) + `BreadcrumbList`
  (+ `FAQPage` somente se houver FAQ visivel).
- **Regras criticas**:
  - Nunca prometer disponibilidade nao confirmada pelo banco.
  - Sempre exibir a **data de atualizacao** (`fetched_at`).
  - So mostrar provedores com `display_allowed = true` e licenca clara.
  - Sem pirataria (regra 8): nada de torrent, IPTV, player ilegal ou embed
    pirata.
- **Visual**: herda o acento da entidade base (vermelho p/ filme, verde p/
  serie); paginas agregadoras `/pt/onde-assistir/` podem ser neutras.

---

## Checklist comum a todos os templates

- [ ] Pelo menos 2 blocos de valor proprios; senao `noindex`.
- [ ] Todo dado externo tem fonte editorial atribuida (regra 2:
      provider_api != rating_source).
- [ ] IMDb e Rotten Tomatoes nunca misturados (regra 1).
- [ ] Licenca verificada (`license_status` + `display_allowed`).
- [ ] Diferenciacao filme/serie por label + badge + breadcrumb + schema + URL.
- [ ] en/es em draft/noindex ate revisao humana (regra 7).
