# Arvore de rotas — App Router (@screena/web)

Este diretorio hospeda as rotas publicas do MVP em **pt-BR**. Cada pagina
indexavel deve respeitar as invariantes do CANON, em especial:

- **Zero API externa no render** e **zero Gemini no render**: paginas leem
  apenas PostgreSQL/cache local.
- **Indexacao total** (invariante 5, politica 2026-07): toda entidade
  sincronizada, licenciada e em idioma publicado indexa por padrao;
  `noindex` fica so para caso tecnico (entidade sem slug/traducao/dados
  estruturados confiaveis). Os blocos de valor proprios (ver lista no CANON)
  **nao gateiam mais** a indexacao — sao alavanca de qualidade/ranqueamento
  (`hasUniqueValue`), nao pre-requisito. O antigo gate anti-thin (`>= 2`
  blocos para indexar) foi removido; ver `.claude/rules/seo.md` §1.
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
/pt/series/{slug}/temporadas/{number}/        -> temporada (TVSeason)
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
