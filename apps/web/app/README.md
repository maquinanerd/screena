# Arvore de rotas — App Router (@screena/web)

Este diretorio hospeda as rotas publicas do MVP em **pt-BR**. Cada pagina
indexavel deve respeitar as invariantes do CANON, em especial:

- **Zero API externa no render** e **zero Gemini no render**: paginas leem
  apenas PostgreSQL/cache local.
- **Gate anti-thin**: uma pagina so e indexavel se tiver **>= 2 blocos de
  valor proprios** alem do dado cru de API (ver lista no CANON). Sem isso,
  recebe `noindex`.
- **Diferenciacao filme/serie nunca depende so da cor**: sempre
  `label + badge + breadcrumb + schema + URL`.

## Acento de cor por contexto

- **Filmes** → acento **vermelho** (`--screena-movie-red`, `#FF3B30`),
  schema `Movie`.
- **Series** → acento **verde** (`--screena-series-green`, `#7AA66D`),
  schema `TVSeries`.
- **Home / busca / misto / institucional** → neutro.

## Rotas do MVP (pt)

```
/pt/filmes/                                  -> lista de filmes
/pt/filmes/{slug}/                           -> ficha do filme (Movie)
/pt/filmes/{slug}/onde-assistir/             -> onde assistir por pais
/pt/filmes/{slug}/elenco/                    -> elenco comentado
/pt/filmes/{slug}/avaliacoes/                -> ratings externos atribuidos + review propria

/pt/series/                                  -> lista de series
/pt/series/{slug}/                           -> ficha da serie (TVSeries)
/pt/series/{slug}/temporada-{number}/        -> temporada (TVSeason)
/pt/series/{slug}/onde-assistir/             -> onde assistir por pais

/pt/pessoas/{slug}/                          -> ficha de pessoa (Person)

/pt/streaming/netflix/melhores-filmes/       -> curadoria por plataforma
/pt/onde-assistir/{slug}/                    -> hub de disponibilidade
/pt/noticias/{slug}/                         -> noticia (NewsArticle)
```

### Rotas futuras (en — nascem em draft/noindex)

```
/en/movies/{slug}/
/en/tv/{slug}/
/en/people/{slug}/
/en/news/{slug}/
```

## Schema.org por tipo de pagina

- `Movie`, `TVSeries`, `TVSeason`, `TVEpisode`, `Person`, `NewsArticle`.
- `BreadcrumbList` em todas as paginas principais.
- `FAQPage` apenas quando houver FAQ visivel.
- `Review` para review propria; `AggregateRating` apenas quando permitido e
  corretamente atribuido (nunca fingindo nota propria).

## Licenciamento

Dados com `license_status` `unknown`/`blocked` ou `display_allowed = false`
**nao aparecem** em pagina indexavel (invariante 6).
