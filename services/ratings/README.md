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

### Endpoint: `/item/?id=<IMDb>` (o plano Pro NAO libera `/popular/`)

O plano contratado **nao libera** `/popular/` (retorna 403). Em vez de listar populares, o
worker **enriquece entidades locais JA existentes**, uma por vez, via
`GET /item/?id=<IMDb_ID>` (ex.: `id=tt9603208`), resolvendo a entidade por **identificador
inequivoco** (IMDb id) — **nunca** por titulo/ano. `/popular/` segue no client apenas por
retrocompatibilidade; o fluxo novo nao o chama.

### CLI

```bash
TSX="$(ls node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs | head -1)"

# dry-run (default): so o plano. Zero rede, zero DB, zero quota.
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20

# sample de UM item explicito (grava api_cache + api_sync_logs + sample; NAO grava ratings).
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --id=tt9603208 --sample

# sample por entidades locais (seleciona ate --limit candidatos do tipo).
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=5 --sample

# apply: grava external_ratings SO para mapping inequivoco + entidade local. Exige --type.
node "$TSX" services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=5 --apply
```

Flags: `--type=film|show`, `--id=tt<digitos>`, `--limit=N`, `--sample`, `--apply`
(default = dry-run), `--report=<arquivo>` (`.md` ou `.json`).

- `--id` enriquece exatamente aquele IMDb id (`tt<digitos>`; TMDB id no request e TODO).
- Sem `--id`, o worker seleciona ate `--limit` (default **20**) entidades locais do `--type`
  que tenham IMDb id, em ordem estavel (`id asc`).
- `--apply` **exige** `--type`: sem ele nao ha como saber se um item e `movie` ou `tv`, e
  atribuir a nota a entidade errada e pior do que nao gravar nada.
- `--sample` **sem `--id`** exige `--type` (a selecao de candidatos precisa da tabela).

`--sample` e `--apply` exigem `RAPIDAPI_FILM_SHOW_RATINGS_KEY` **e** `DATABASE_URL`: toda
chamada externa grava `api_cache` e `api_sync_logs` (nenhuma ingestao silenciosa). O
dry-run puro nao precisa de nenhum dos dois.

### Estado do mapping (importante)

O reconhecedor em `src/film-show-ratings/mapping.ts` e **estrito e fail-closed**. Para o
`/item/`, `mapItemPayload` isola o `result` (objeto) do envelope `{ status, result: {...} }`
e reconhece o formato REAL da RapidAPI (`ratings` como objeto POR FONTE, com
`audience`/`critics`), reusando a mesma logica de `/popular/` (`mapSingleItem`): id via
`ids.IMDb`/`ids.TMDB`, escala via `bestValue`, url via `links[<fonte>]`. Cada `(fonte,
metrica)` passa por `validateRating`. **TMDB e recusado** como fonte tecnica nao governada;
**Metacritic audience em base 10** e recusado por escala (o Metascore canonico e base 100) —
**nunca** reescalado. O `rating_label` **nunca** vem do payload — e derivado da fonte
canonica, o que torna um cross-label impossivel por construcao.

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
