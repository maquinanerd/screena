# Decisões de cobertura de API — Cinerie (Fase 5)

> Log de decisões (o "porquê") por trás do registro de cobertura. Idioma: pt-BR.
> Autoritativo para a **semântica**; a fonte executável é `endpoints.json` +
> `fields.json`, travada por `pnpm api:coverage` e por
> `tests/governance/api-coverage.test.ts`.

## 1. Objetivo da Fase 5

Classificar **todo endpoint e todo campo** de cada integração externa em
**exatamente 1** de 8 estados de cobertura, com âncora no código real, para que:

- nada fique **desconhecido ou descartado silenciosamente** (base da auditoria
  final, Fase 17);
- "ter tudo" ≠ "publicar tudo": dado bloqueado (licença/privacidade/plano) fica
  **registrado, fail-closed**;
- qualquer **drift** entre o registro e o código **quebre o CI**.

## 2. Os 8 estados (semântica canônica)

| Estado | Quando usar |
| --- | --- |
| `raw_captured` | A resposta bruta é capturada (`tmdb_raw`/`api_cache`) mas ainda não normalizada em tabela tipada nem consumida. |
| `normalized` | Persistido em tabela tipada. Pode ainda não ser exibido (ex.: gated por `review_status` ou por ser sinal técnico). |
| `public_ready` | Elegível a exibir em página indexável: normalizado, licenciado, idioma publicado, tecnicamente válido. |
| `blocked_license` | Capturado/disponível, mas exibição bloqueada por licença/atribuição (**invariante 6**). Ex.: `external_ratings`/`watch_availability` nascem `display_allowed=false`. |
| `blocked_privacy` | Bloqueado por privacidade/segurança de conteúdo. Hoje o caso concreto é a **exclusão fail-closed de conteúdo adulto** na descoberta. |
| `blocked_plan` | Bloqueado pelo **plano contratado** da API (distinto de licença). Ex.: `/popular/` retorna 403 no plano Pro. |
| `not_applicable` | (a) Genuinamente não se aplica (ex.: TMDB não tem campos de rating; `streaming_availability` cobre só movie/tv); **ou** (b) exigido pelo plano mas ainda não implementado. **Sempre** com `justification` — na variante (b), citando a fase de roadmap. |
| `deprecated` | Legado/substituído. **Sempre** com `superseded_by`. Ex.: `imdb236.item` superseded por `film_show_ratings.item`. |

> **Decisão explícita sobre `not_applicable`:** como os 8 estados assumem o item
> dentro do ciclo de dado (ou excluído), uma capacidade **exigida pelo plano mas
> ainda não construída** não cabe em `raw_captured/normalized/public_ready`
> (sem dado), nem em `blocked_*` (não está bloqueada — só não existe). Por
> eliminação, ela é `not_applicable` **com justificativa que cita a fase de
> roadmap** (`implemented: false`). Isso mantém a cobertura total e honesta: a
> lacuna fica listada, não escondida.

## 3. Separação `provider_api` vs `rating_source` (invariante 2)

- `providers.yaml` cataloga **apenas fornecedores técnicos** (`provider_api`).
  Fontes editoriais de rating (`imdb`, `rotten_tomatoes`, `metacritic`,
  `letterboxd`, `filmaffinity`) **nunca** aparecem lá — são `rating_source` em
  `@screena/config`.
- O validador falha se: `provider_api === rating_source`; `provider_api` for um
  valor de `RATING_SOURCES`; ou um `rating_source` não pertencer a
  `RATING_SOURCES`.
- Em `fields.json`, cada `external_ratings.<fonte>` demonstra a separação:
  `provider_api = rapidapi_film_show_ratings` (transporte) e
  `rating_source = imdb|rotten_tomatoes|...` (fonte editorial). A nota IMDb nunca
  vira Tomatometer; escalas por fonte (imdb=10, rotten_tomatoes=100,
  metacritic=100, letterboxd=5, filmaffinity=10).

## 4. `imdb236` vs `rapidapi_film_show_ratings`

O seed `api_providers` tem **dois** provedores técnicos de ratings:
`imdb236` (transporte legado das notas IMDb, sem client dedicado em
`api-clients/`) e `rapidapi_film_show_ratings` (agregador ativo, client real).
Ambos são `provider_api`, disjuntos de `rating_sources` (comentário do próprio
seed). Decisão: `imdb236.item` = `deprecated` (`superseded_by`
`film_show_ratings.item`); o transporte de notas foi consolidado no agregador.

## 5. Estado ativo por família (resumo das decisões)

- **TMDB — catálogo (`public_ready`)**: detalhes de filme/série/temporada/pessoa +
  `/movie/upcoming` fluem para tabelas tipadas exibidas. `getTvEpisode` existe mas
  não é chamado (`not_applicable`). Descoberta via Daily ID Exports
  (`raw_captured`); `/changes` é contrato (`not_applicable`). Sub-recursos de
  `append` (imagens, vídeos, recomendações, similares, reviews, traduções,
  watch/providers, changes) ficam em `tmdb_raw` (`raw_captured`) — **watch/providers
  do TMDB é referência apenas**; onde-assistir exibível vem do
  `streaming_availability`.
- **Gemini — IA (`normalized`)**: só `:generateContent`. Saída vai para
  `content_blocks` gated por `review_status`; **nunca auto-publicada**; **zero
  Gemini no render** (invariantes 3, 4). Todo o resto da superfície Gemini é
  roadmap (`not_applicable`, Fase 11).
- **Ratings (`blocked_license`)**: `film_show_ratings.item` é o fluxo ativo; toda
  linha nasce `display_allowed=false` + `license_status=unknown`. `/popular/` é
  `blocked_plan` (403 Pro). Nunca executado ao vivo (sem key).
- **Streaming (`blocked_license`)**: `streaming_availability.show` (BR-only);
  ofertas nascem `display_allowed=false` (atribuição+linkback Movie of the Night).
  Só ofertas legais (anti-pirataria, invariante 8). Nunca executado ao vivo.
- **Notícias (`not_applicable`, roadmap F13)**: pipeline RSSPRIME/MN26 é README +
  stub Python Fase 0. Notícias nunca criam entidades.

## 6. Conteúdo adulto → `blocked_privacy`

A descoberta exclui conteúdo adulto **fail-closed** em 2 camadas: arquivos
`adult_*` nunca são baixados; `adult===true` ou malformado/ausente-quando-exigido
(movie/person) é descartado como unsafe. É o análogo mais próximo de
`blocked_privacy` (não há gate de PII pessoal separado hoje). Nunca entra no
catálogo.

## 7. Gate humano: promoção de estado nunca é automática

- `blocked_license` → `public_ready` **exige decisão humana de licença**
  (invariante 6). O worker escreve `display_allowed=false`; a promoção
  (`services/streaming/bin/promote-watch-availability.ts`, revisão de ratings) é
  humana, por ids explícitos + `--confirm`. Este registro **não** promove nada.
- Idioma: en/es só indexam via `PUBLISHED_LOCALES` + revisão humana (invariante 7);
  hoje só `pt-BR`/`pt`.

## 8. Contrato do comando `api:coverage`

`pnpm api:coverage` → `node scripts/audit/check-api-coverage.mjs` (audit raiz,
100% offline, sem rede/DB/deps, mesmo contrato de `audit:invariants`/`audit:render`;
`process.exit(1)` em violação, `exit(0)` limpo, `exit(2)` fatal). Lógica pura em
`scripts/audit/api-coverage-core.mjs` (testada por
`tests/governance/api-coverage.test.ts`). O que **quebra** o gate:

1. **Estado inválido**: `coverage_state` fora dos 8; `not_applicable` sem
   `justification`; `deprecated` sem `superseded_by`.
2. **Invariante 2**: `provider_api === rating_source`, ou `provider_api`/
   `rating_source` fora do domínio correto.
3. **Invariante 3**: `worker_only !== true`.
4. **Referência**: `provider` inexistente em `providers.yaml`; `provider_api`
   divergente do declarado.
5. **Drift de âncora (forward)**: entrada `implemented: true` cuja âncora aponta
   arquivo inexistente ou sem algum símbolo de `must_contain` (código
   renomeou/removeu).
6. **Drift reverso**: método-endpoint `async get<X>(` presente num client
   enumerado (`ENUMERATION_SOURCES`) sem entrada correspondente em
   `endpoints.json` (endpoint novo em código sem registro).

> **Escopo do drift reverso:** enforced para os clients cuja função pública é
> exclusivamente endpoints (TMDB `endpoints.ts`, Film & Show Ratings e Streaming
> Availability `client.ts`), onde todo `async get<X>(` é um endpoint — evita
> falso positivo com getters utilitários. Outros clients são cobertos pelas
> âncoras forward das suas constantes de endpoint.

## 9. Fora de escopo (por definição)

- **Campos puramente internos** (ex.: `screen_score`/`screen_score_display`) não
  vêm de API externa; não entram na cobertura de API (são editoriais internos,
  gated por sua própria flag).
- **Helpers internos puros** (adult-filter, sync-queue, partitionAppend, hash)
  não são endpoints; aparecem no `notes`, não como entradas de endpoint.
- **Drift de configuração** (aliases `SCREENA_*_PROVIDER_KEY` vs `RAPIDAPI_*_KEY`
  no `.env.example`; `SCREENA_TMDB_API_KEY` não lido) é dívida de config, tratada
  na fase de deploy/runtime (F14), não neste registro de cobertura de dado.

## 10. Como estender

1. Novo endpoint em código → adicione a `endpoints.json` com `anchor`
   (`file` + `must_contain` estáveis: nomes de método/constante exportada) e o
   `coverage_state` correto.
2. Nova capacidade de campo → `fields.json`, mesma disciplina de estado +
   `justification`/`superseded_by` quando exigido.
3. Novo provider técnico → `providers.yaml` (nunca uma fonte editorial).
4. Rode `pnpm api:coverage` até PASSAR. A auditoria final (Fase 17) roda este
   comando e não pode ter item sem classificação.

## 11. Fase 6 — cobertura do catálogo TMDB

- **Client tipado de catálogo** em `api-clients/tmdb/src/catalog.ts` (config,
  taxonomias, listas, discover, busca, changes), adicionado a `ENUMERATION_SOURCES`:
  todo `async get<X>(` ali TEM entrada no registro (drift reverso). Discover valida
  filtros contra allowlist, serializa de forma determinista (chaves ordenadas) e
  **rejeita filtro desconhecido**; busca exige query não-vazia.
- **`normalized` só com evidência real**: apenas `tmdb.configuration` chega a
  `normalized` — o worker de taxonomia (`services/ingestion/src/config-sync`)
  normaliza `/configuration` em `tmdb_image_config`, idempotente (no-op quando
  inalterado), provado por `validate:tmdb-catalog`.
- **`raw_captured` só com persistência real**: os 7 demais endpoints de taxonomia
  (countries/languages/jobs, genres movie/tv, certifications movie/tv) são
  capturados raw em `api_cache` + log em `api_sync_logs` pelo mesmo worker. Sem
  tabela normalizada dedicada nesta fase (§11 do prompt: sem destino → raw, documentado).
- **`not_applicable` para client-only**: listas curadas, discover, busca e changes
  têm client tipado + testado mas **nenhum worker os executa/persiste** → sem dado
  capturado → `not_applicable` com justificativa citando o worker roadmap (F8). Não
  se marca `raw_captured` sem persistência nem `normalized` com só DTO.
- **Classificação indicativa ≠ rating** (invariante 1/2): certifications são
  advisory por território; nunca viram `external_ratings` nem se misturam com
  `rating_source`. Ficam `raw_captured`, documentadas.
- **Sem migration nesta fase**: `tmdb_image_config` já existia; genres/videos/images
  não têm tabela e ficam `raw_captured` (não se força coluna inadequada). Tabelas
  normalizadas próprias (genres etc.) são roadmap, com migration própria quando
  escopadas.
- **Zero API externa/Gemini no render**: o client e o worker são worker-only
  (`services/ingestion`, `api-clients/tmdb`); `audit:render` permanece verde.
