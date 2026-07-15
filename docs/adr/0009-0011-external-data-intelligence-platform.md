# ADR 0009--0011 — Plataforma de dados externos e inteligencia

- Status: aceito
- Data: 2026-07-15
- Escopo: Fases 9, 10 e 11; F12--F17 permanecem fora do escopo.

## Decisao

Streaming Availability, Film & Show Ratings e Gemini operam exclusivamente em
workers/CLIs offline. O fluxo canonico e `provider -> raw capture/log ->
normalizacao governada -> PostgreSQL -> render puro`. Nenhum client destes
providers pode ser importado por pagina, metadata, middleware, presenter ou
rota publica.

### Fontes consultadas em 2026-07-15

- Streaming Availability: documentação oficial Movie of the Night,
  `https://docs.movieofthenight.com/` (shows, countries & services, genres,
  pagination e changes). O transporte RapidAPI usa host e chave somente em
  headers; a base configurada e `https://streaming-availability.p.rapidapi.com`.
- Ratings: documentação oficial do produto Film & Show Ratings no RapidAPI e o
  contrato contratado: `GET /item/?id=tt...`; `/popular/` existe no client mas
  está bloqueado no plano e permanece explicitamente `blocked_plan` no registry.
- Gemini: documentação oficial Google AI, `generateContent`, structured output,
  Batch API e referência REST da Generative Language API:
  `https://ai.google.dev/gemini-api/docs/structured-output`,
  `https://ai.google.dev/gemini-api/docs/batch-api` e
  `https://ai.google.dev/api/generate-content`. A base é
  `https://generativelanguage.googleapis.com/v1beta` e a chave só viaja no
  header `x-goog-api-key`.

## Streaming Availability (F9)

O client captura DTOs brutos para lookup `/shows/{id}`, busca por título,
filtros, changes, countries e genres. Consulta por entidade usa IDs IMDb ou
TMDB inequivocamente; busca textual nunca decide associação persistida. País,
tipo, idioma de saída, paginação e cursor são parâmetros explícitos. Catálogos,
taxonomias e changes sem destino de domínio ficam em `api_cache` como
`raw_captured`.

`services/streaming` normaliza somente ofertas legais para
`watch_availability`. A identidade estável prioriza `external_offer_id`; quando
ausente, usa a chave técnica do provider e pacote. Preço, moeda, URLs,
validade, provider exibido, pacote, atribuição e licença participam do
fingerprint. Alteração revoga aprovação; desaparecimento marca stale, sem
delete. Oferta nova nasce `display_allowed=false`, `license_status=unknown` e
não pode ser promovida pelo sync. URL insegura, torrent/IPTV e modalidade não
mapeada são recusados.

## Ratings (F10)

`rapidapi_film_show_ratings` é sempre `provider_api`; IMDb, Rotten Tomatoes,
Metacritic, Letterboxd e FilmAffinity são `rating_source`. O mapeador exige
fonte, métrica, valor e escala declarados e valida a escala canônica antes de
persistir. Não há conversão implícita nem troca de linguagem/ícone entre fontes.
Cada ciclo registra `api_cache` e `api_sync_logs`; payload sem mudança produz
noop e dados novos nascem bloqueados por licença. O Screen Score não é
publicado ou recalculado por esta ADR: não havia contrato canônico elegível e
uma fórmula nova seria uma decisão editorial fora de escopo.

## Gemini Entity Writer (F11)

O adapter usa `:generateContent` com `systemInstruction`, `safetySettings` e
`generationConfig.responseMimeType=application/json` mais JSON Schema fechado.
A garantia de schema não substitui as validações locais: a saída é validada
contra forma, limites do contrato e payload controlado antes de criar
`content_blocks`. Names/datas/números ausentes do payload são tratados como
grounding failure e impedem promoção automática. Todo bloco nasce draft ou
`ai_generated`; somente revisão humana pode torná-lo publicável.

Batch, Files, context caching, embeddings e function calling estão catalogados
no `api:coverage`. Não são chamados sem caso de uso, contrato de custo e
persistência correspondente. A deduplicação atual usa `input_hash` e versão do
prompt, os jobs suportam claim concorrente, retry limitado e execução fake na
CI; Gemini real nunca roda em CI.

## Operação e observabilidade

Os clients compartilham timeout, abort, retry exponencial com jitter,
`Retry-After`, throttle, circuit breaker, request sanitizado e erros tipados.
Raw payload precede normalização em `api_cache`; cada ciclo escreve
`api_sync_logs`. Erros e relatórios removem chaves e secrets. Os comandos
existentes de sync/promoção/revogação e Entity Writer mantêm `--dry-run` como
padrão seguro; promoção permanece uma ação humana separada.

O comando integrado `pnpm validate:external-intelligence-platform` executa os
clients com transports falsos, workers/mappers reais, stores reais contra
PostgreSQL 16 efêmero, Entity Writer com `FakeGeminiPort`, `api:coverage` e a
auditoria de pureza. Não usa credenciais nem rede.

## Consequências e riscos

Licenças, atribuição, linkback e display continuam fail-closed. Mudança de
plano/endpoint/campo do provider deve primeiro atualizar o registry e esta ADR;
o gate de coverage bloqueia drift. Limites/rate limits podem variar por plano,
logo são configuráveis e não tratados como promessa permanente. A interface
visual, canonicals, sitemap e qualquer trabalho de F12+ não foram alterados.
