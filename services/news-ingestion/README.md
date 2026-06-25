# services/news-ingestion

Servico de **ingestao de noticias**. Consome o upstream externo **RSSPRIME** como fonte
de feeds, agrupa itens em **clusters** (`news_clusters`) e mantem `articles`,
`article_translations` e os vinculos `entity_news_links` com entidades existentes.

## O que faz
- Le feeds do **RSSPRIME** (upstream externo) e normaliza itens em `articles`.
- Agrupa noticias relacionadas em `news_clusters` (deduplicacao/clusterizacao por tema).
- Vincula noticias a entidades **ja existentes** no banco via `entity_news_links`,
  alimentando o bloco de valor "noticias relacionadas".
- Mantem `article_translations` para versoes por idioma.

## Como roda
- **Worker Python 3.12, sempre offline.** Agendado por **systemd timers**.
- **NUNCA e chamado no render publico.** A pagina `/pt/noticias/{slug}/` e os blocos de
  noticias relacionadas leem apenas o PostgreSQL.

## Resiliencia obrigatoria
- **Cache** (`api_cache`), **retry** com **backoff**, **rate-limit** ao consumir o
  RSSPRIME, **circuit-breaker** e **logs** de sync em `api_sync_logs`.

## Invariantes aplicaveis
- **Nao cria entidades** — apenas vincula noticias a entidades que ja existem; a criacao
  de entidades e responsabilidade exclusiva de `services/ingestion`.
- **RSSPRIME e upstream externo** — tratado como fornecedor tecnico, nunca como fonte
  editorial propria da Screena.
- **Dados sem licenca clara nao aparecem** em pagina indexavel; respeitar atribuicao e
  linkback quando exigido.
- **Zero API externa no render** — consumo de feeds acontece aqui, offline.
- **pt-BR primeiro** — traducoes en/es nascem em `draft`/`noindex` ate revisao humana.
- **Schema NewsArticle** aplicavel as paginas de noticia (validado no render a partir de
  dados ja persistidos).
