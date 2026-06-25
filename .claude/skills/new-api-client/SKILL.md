---
name: new-api-client
description: Use quando for criar um novo conector de API externa (ex.: TMDB, fornecedor de ratings) em api-clients/. Cobre padrao worker-only, cache, retry com backoff, rate limit, circuit breaker, logs em api_sync_logs, tratamento de licenca/atribuicao e chaves apenas em env vars. NAO use no codigo de render nem em paginas indexaveis.
---

# Skill: new-api-client

Esta skill descreve como criar um **novo api-client** (conector de API externa) no Screena.
Todo conector e **worker-only**: roda apenas em processos offline (workers Python / jobs Node de
sync), **nunca** no render de paginas publicas.

> **Invariante central:** **Zero API externa no render.** Paginas publicas indexaveis leem apenas
> PostgreSQL/cache local. Um api-client jamais e importado por componente de pagina, route handler
> de render, RSC publico ou qualquer caminho de request do usuario final.
>
> **provider_api != rating_source:** o fornecedor tecnico (ex.: RapidAPI, TMDB) e o transporte;
> ele **nunca** e a fonte editorial. Os dois sao registrados em campos separados
> (`provider_api` vs `rating_source`).

## Quando usar

- Adicionar integracao com uma nova fonte externa (catalogo, ratings, imagens, where-to-watch).
- Padronizar um conector existente que ainda nao siga cache/retry/rate-limit/circuit-breaker.

## Quando NAO usar

- Para ler dados em pagina publica -> leia do **PostgreSQL/cache local**, nunca da API.
- Para gerar texto editorial -> Entity Writer / `content_blocks`.
- Para cadastrar uma entidade -> use a skill **add-entity**.

## Localizacao e formato

- Novos conectores vivem em `api-clients/` (worker-only).
- Codigo/identificadores em ingles; comentarios podem ser pt-BR.
- TypeScript estrito quando aplicavel; funcoes utilitarias puras e testaveis.
- Lembrete de fase: na **Fase 0** nao implemente client real (sem rede/DB/IO). Esta skill define o
  contrato; o conector concreto chega na Fase 2+.

## Passos

1. **Definir o contrato do client.**
   - Nome claro por fornecedor (ex.: `tmdb`, `ratings-rapidapi`). Um modulo por fornecedor.
   - Exponha funcoes nomeadas e tipadas. Separe **provider_api** (de onde os bytes vieram) de
     **rating_source** (a fonte editorial atribuida ao dado).

2. **Carregar chaves SOMENTE de env vars.**
   - API keys **nunca** no frontend, nunca commitadas, nunca em pagina de render. Leia de
     `process.env` (ou config do worker). Falhe explicitamente se a chave faltar.

3. **Garantir worker-only.**
   - O modulo nao deve ser importavel pelo bundle de pagina. Trate qualquer import vindo do render
     como bug. Reforce o invariante **Zero API externa no render**.

4. **Cache local.**
   - Use `api_cache` (cache local) com TTL adequado. Paginas leem o cache/PostgreSQL, nunca a API
     ao vivo. Defina chave de cache deterministica por request.

5. **Retry com backoff exponencial.**
   - Reentente apenas erros transitorios (5xx, timeout, rede). Backoff exponencial com jitter e
     teto de tentativas. Nunca retente erros de licenca/4xx de forma cega.

6. **Rate limit.**
   - Respeite o limite do fornecedor (token bucket / fila). O rate limit do provider_api e do
     transporte — nao confunda com regra editorial.

7. **Circuit breaker.**
   - Apos N falhas consecutivas, abra o circuito e pare de chamar o fornecedor por um periodo.
     Estados claros (closed/open/half-open) e fallback para cache/PostgreSQL.

8. **Logar tudo em `api_sync_logs`.**
   - Todo sync externo gera log: fornecedor, endpoint, status, duracao, contagem, erros. Sem log,
     o sync nao e auditavel.

9. **Tratar licenca e atribuicao.**
   - Mapeie a resposta para `source_licenses` / `external_ratings`:
     `license_status` (official, licensed, third_party, unknown, blocked) e flags
     (`display_allowed`, `logo_allowed`, `score_allowed`, `review_quote_allowed`,
     `requires_attribution`, `requires_linkback`).
   - Dados com `license_status` unknown/blocked ou `display_allowed=false` **nao podem** aparecer
     em pagina indexavel.
   - Guarde `attribution_text`/`attribution_url` quando `requires_attribution`/`requires_linkback`.
   - **IMDb != Rotten Tomatoes:** mantenha fonte, escala, icone e linguagem separados
     (imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10). Nota IMDb
     nunca vira Tomatometer; Tomatometer/Popcornmeter pertencem so ao Rotten Tomatoes. Nada de
     AggregateRating fingindo nota propria.

10. **Persistir normalizado, nunca cru no render.**
    - Grave dados normalizados no PostgreSQL; armazene `provider_payload_hash` para
      rastreabilidade. O render le dessas tabelas/cache, jamais do client.

## Checklist de saida

- [ ] Conector em `api-clients/`, worker-only, nao importavel pelo bundle de pagina.
- [ ] Chaves vindas apenas de env vars; falha explicita se ausentes.
- [ ] Cache local (`api_cache`) com TTL.
- [ ] Retry com backoff + jitter; rate limit; circuit breaker.
- [ ] Logs completos em `api_sync_logs`.
- [ ] Licenca/atribuicao mapeadas; dado sem licenca clara nao chega a pagina indexavel.
- [ ] provider_api separado de rating_source; IMDb e Rotten Tomatoes nunca misturados.
- [ ] Zero API externa no caminho de render.

## Nota de governanca

Skill sem teste vira lembrete; skill com hook/teste vira governanca. Enquanto nao houver hook/CI
que bloqueie import de api-client no bundle de render, valide presenca de chave em env, exercite
retry/circuit breaker em teste e cheque licenca antes de exibir, trate este documento como
**lembrete obrigatorio**. A meta e tornar cada invariante (worker-only, chaves em env, logs em
`api_sync_logs`, separacao provider_api/rating_source, licenca/atribuicao) em **governanca
executavel**.
