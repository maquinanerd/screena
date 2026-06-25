# Database — visao geral do schema (Fase 0)

Este documento e a **visao geral** das tabelas canonicas da Screena, agrupadas por
dominio. **O ORM recomendado e o Prisma** (alternativa documentada: Drizzle). **NESTA
FASE 0 nao existe schema real nem migrations** — o schema real (Prisma `schema.prisma` +
migrations) chega na **Fase 1**. Aqui apenas documentamos as tabelas, seus papeis e a
politica de indices.

> Banco: **PostgreSQL**. Todo dado publico indexavel e lido **apenas** do PostgreSQL/cache
> local — **zero API externa no render**.

## Grupos de tabelas

### Entidades
- `movies` — filmes.
- `tv_shows` — series.
- `seasons` — temporadas (pertencem a uma serie).
- `episodes` — episodios (pertencem a uma temporada).
- `people` — pessoas (atores, diretores, equipe).
- `franchises` — franquias/colecoes que agrupam entidades.

### Elenco e equipe
- `cast_members` — elenco (pessoa <-> entidade, papel/personagem).
- `crew_members` — equipe tecnica (pessoa <-> entidade, funcao).

### Midia
- `images` — posters, backdrops, fotos.
- `trailers` — trailers e videos (links/embeds legais).

### Ratings e licencas
- `external_ratings` — notas externas atribuidas; colunas-chave: `rating_source`,
  `rating_label`, `metric`, `rating_value`, `rating_scale`, `rating_count`, `rating_url`,
  `provider_api`, `provider_payload_hash`, `fetched_at`, `attribution_text`,
  `attribution_url`, `license_status`, `display_allowed`.
- `rating_sources` — catalogo de fontes editoriais (imdb, rotten_tomatoes, metacritic,
  letterboxd, filmaffinity) com sua escala canonica.
- `source_licenses` — estado de licenca por fonte; `license_status` em
  `official | licensed | third_party | unknown | blocked`; flags: `display_allowed`,
  `logo_allowed`, `score_allowed`, `review_quote_allowed`, `requires_attribution`,
  `requires_linkback`.
- `api_providers` — fornecedores tecnicos (`provider_api`), distintos das fontes editoriais.

### Onde assistir
- `platforms` — plataformas de streaming (Netflix, etc.).
- `providers` — fornecedores/distribuidores de oferta.
- `watch_availability` — disponibilidade por entidade, pais e modalidade.

### Noticias
- `articles` — noticias.
- `article_translations` — versoes por idioma.
- `entity_news_links` — vinculo noticia <-> entidade.
- `news_clusters` — agrupamento de noticias relacionadas.

### Editorial / content_blocks
- `content_blocks` — blocos editoriais (gerados por IA offline ou humanos); colunas:
  `id`, `entity_type`, `entity_id`, `language_code`, `block_type`, `content`,
  `source_type`, `model_provider`, `model_name`, `prompt_version`, `input_hash`,
  `output_hash`, `review_status`, `warnings_json`, `published_at`, `created_at`,
  `updated_at`.
- `reviews` — reviews proprias da Screena.
- `entity_translations` — traducoes de campos de entidade.

### Entity Writer
- `entity_writer_jobs` — fila de jobs (status: `queued`, `claimed`, `running`,
  `completed`, `failed`, `blocked`, `cancelled`).
- `entity_writer_logs` — log de execucao do Entity Writer.

### Infra / cache / logs
- `api_sync_logs` — log de todo sync externo (todo sync gera log).
- `api_cache` — cache local de respostas externas.
- `entity_external_ids` — mapeamento de IDs externos (`tmdb_id`, `imdb_id`, etc.).

### i18n / slugs
- `countries` — paises.
- `languages` — idiomas.
- `slugs` — slugs canonicos por entidade/idioma.
- `redirects` — redirecionamentos quando um slug muda.

### Indexabilidade
- `page_indexability_decisions` — decisao de indexacao por pagina
  (`index | noindex | draft | stale | blocked`).

## Politica de indices (regra)
Indexar pelos campos de acesso mais frequentes, por tabela onde se aplicam:
- `entity_type`
- `tmdb_id`
- `imdb_id`
- `slug`
- `language`
- `country`
- `updated_at`

Esses indices suportam: resolucao de entidade por ID externo, lookup por slug/idioma,
filtros por pais (onde assistir) e reprocessamento incremental por `updated_at`.

## Notas de fase
- **Fase 0 (agora):** apenas esta documentacao; sem `schema.prisma`, sem migrations.
- **Fase 1:** schema real em Prisma, migrations versionadas em `database/migrations/` e
  seeds iniciais em `database/seeds/`.
