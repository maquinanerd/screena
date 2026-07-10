# services/ratings

Servico de **ingestao e atribuicao de ratings externos**. Popula e mantem a tabela
`external_ratings`, sempre preservando a separacao entre **fonte editorial**
(`rating_source`) e **fornecedor tecnico** (`provider_api`), alem do estado de licenca
em `source_licenses`.

## O que faz
- Coleta notas de fontes editoriais distintas (IMDb, Rotten Tomatoes, Metacritic,
  Letterboxd, FilmAffinity) via os **api-clients** apropriados.
- Preenche `external_ratings` com: `rating_source`, `rating_label`, `metric`,
  `rating_value`, `rating_scale`, `rating_count`, `rating_url`, `provider_api`,
  `provider_payload_hash`, `fetched_at`, `attribution_text`, `attribution_url`,
  `license_status`, `display_allowed`.
- Aplica a escala correta por fonte: **imdb=10, rotten_tomatoes=100, metacritic=100,
  letterboxd=5, filmaffinity=10**.
- Cruza cada rating com `source_licenses` para definir `display_allowed`,
  `score_allowed`, `requires_attribution`, `requires_linkback`.

## Como roda
- **Worker TypeScript/Node, sempre offline** (`@screena/ratings`). Python 3.12 segue como
  roadmap/shim, nao como implementacao atual (CLAUDE.md secao 4); agendamento por
  **systemd timers** e roadmap.
- **NUNCA e chamado no render publico.** A pagina le notas ja persistidas e atribuidas
  no PostgreSQL.

### CLI

```bash
TSX="$(ls node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)"

# dry-run (default): so o plano. Zero rede, zero DB, zero quota.
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20

# sample: busca o payload real, grava api_cache + api_sync_logs e escreve um
# sample SANITIZADO em services/ratings/.data/ (gitignored).
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20 --sample

# apply: grava external_ratings SO para mapping inequivoco. Exige --type.
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20 --apply
```

Flags: `--type=film|show`, `--limit=N`, `--sample`, `--apply` (default = dry-run),
`--report=<arquivo>` (`.md` ou `.json`). `--apply` **exige** `--type`: sem ele nao ha como
saber se um item e `movie` ou `tv`, e atribuir a nota a entidade errada e pior do que nao
gravar nada.

`--sample` e `--apply` exigem `RAPIDAPI_FILM_SHOW_RATINGS_KEY` **e** `DATABASE_URL`: toda
chamada externa grava `api_cache` e `api_sync_logs` (nenhuma ingestao silenciosa). O
dry-run puro nao precisa de nenhum dos dois.

### Estado do mapping (importante)

A API Film/Show Ratings **nao publica schema de resposta**. Por isso o reconhecedor em
`src/film-show-ratings/mapping.ts` e **estrito e fail-closed**: so aceita um descritor com
`source` (dentro de `RATING_SOURCES`), `metric`, `value` e `scale` explicitos, mais um id
inequivoco (`imdbId`/`tmdbId`) no item. O `rating_label` **nunca** vem do payload — e
derivado da fonte canonica, o que torna um cross-label impossivel por construcao.

Enquanto o payload real nao for inspecionado por um humano via `--sample`, o resultado
esperado e **"0 ratings mapeados, N recusados"** — e isso e **sucesso**, nao falha.
Estender o reconhecedor exige ver o sample primeiro.

## Resiliencia obrigatoria
- **Cache** (`api_cache`), **retry** com **backoff**, **rate-limit** por fornecedor,
  **circuit-breaker** e **logs** completos em `api_sync_logs` — via
  [`api-clients/rapidapi-core`](../../api-clients/rapidapi-core).
- Linha ja identica: **nao reescreve** nem bumpa `updated_at` (regra de hash de payload).

## Invariantes aplicaveis (criticas)
- **IMDb != Rotten Tomatoes** — nunca misturar fontes, escalas, icones ou linguagem.
- **Nota IMDb (escala 10) NUNCA vira Tomatometer.** Tomatometer/Popcornmeter pertencem
  exclusivamente ao Rotten Tomatoes (escala 100).
- **provider_api != rating_source** — RapidAPI e similares sao apenas o canal tecnico,
  nunca a fonte editorial.
- **Nada de AggregateRating fingindo nota propria** — so se emite `AggregateRating`
  quando permitido e corretamente atribuido a fonte.
- **Sem licenca clara, nao exibe** — `license_status` em `unknown`/`blocked` ou
  `display_allowed=false` nunca aparece em pagina indexavel.
- **Atribuicao obrigatoria** quando a licenca exige (`requires_attribution`,
  `requires_linkback`).
- **Zero API externa no render** — toda coleta ocorre aqui, offline.
- **Nada nasce exibivel.** Toda linha escrita por este worker recebe
  `display_allowed = false` e `license_status = unknown`, **estruturalmente** (nao sao
  parametros do adapter). Liberar exibicao e decisao humana de licenca, registrada fora
  daqui.
- **`screen_score` nao e tocado.** A nota editorial propria do Screen jamais recebe dado
  de terceiro.
