# services/ingestion

Servico de **ingestao de entidades** da Screena. Responsavel por trazer dados brutos de
catalogos externos (filmes, series, temporadas, episodios, pessoas) para dentro do
PostgreSQL canonico, normalizando-os para as tabelas `movies`, `tv_shows`, `seasons`,
`episodes`, `people`, `cast_members`, `crew_members`, `franchises`, `images`, `trailers`
e tabelas de mapeamento (`entity_external_ids`, `slugs`).

## O que faz
- Orquestra os **api-clients** (principalmente `tmdb`) para baixar metadados de entidades.
- Normaliza e deduplica entidades, resolvendo IDs externos para IDs canonicos via
  `entity_external_ids` (chaves: `entity_type`, `tmdb_id`, `imdb_id`).
- Gera/atualiza `slugs` e registra `redirects` quando um slug muda.
- Persiste midia (`images`, `trailers`) e relacionamentos de elenco/equipe.
- Marca entidades novas/atualizadas para reprocessamento downstream (ratings, streaming,
  entity-writer) atraves de `updated_at` e jobs.

## Como roda
- **Worker Python 3.12, sempre offline.** Executado por **systemd timers** na VPS.
- **NUNCA e chamado no render publico.** Paginas indexaveis leem apenas PostgreSQL/cache
  local — nenhuma chamada a este servico ou a APIs externas acontece durante o render.

## Resiliencia obrigatoria
- **Cache** local de respostas (`api_cache`) para evitar refetch desnecessario.
- **Retry** com **backoff** exponencial em falhas transitorias.
- **Rate-limit** respeitando os limites do fornecedor tecnico.
- **Circuit-breaker** para suspender chamadas quando o upstream esta degradado.
- **Logs** estruturados de todo sync em `api_sync_logs` (sucesso, falha, contagem,
  duracao, provedor).

## Invariantes aplicaveis
- **Zero API externa no render** — toda chamada externa acontece aqui, offline.
- **provider_api != rating_source** — o fornecedor tecnico (ex.: RapidAPI/TMDB) nunca e
  tratado como fonte editorial.
- **API keys so em env vars** — nunca expostas no frontend.
- **Dados sem licenca clara nao aparecem** — campos com `license_status` em
  `unknown`/`blocked` ou `display_allowed=false` ficam fora de pagina indexavel.
- **pt-BR primeiro** — traducoes en/es nascem em `draft`/`noindex` ate revisao humana.
- A ingestao **nao inventa fatos**: apenas persiste o que o upstream retorna, com origem
  rastreavel.
