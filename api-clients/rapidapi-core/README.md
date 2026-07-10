# api-clients/rapidapi-core

Nucleo HTTP **compartilhado** dos clients RapidAPI. Nao conhece dominio: nao sabe o que e
nota, fonte editorial ou disponibilidade. Existe para que cada client concreto so precise
declarar **config + endpoints**.

Consumido por:
- [`api-clients/film_show_ratings`](../film_show_ratings) (`provider_api = rapidapi_film_show_ratings`)
- [`api-clients/streaming_availability`](../streaming_availability) (`provider_api = streaming_availability`)

## O que oferece

| Peca | Papel |
| --- | --- |
| `RapidApiHttpClient` | throttle por `maxRps`, retry com backoff exponencial + jitter, circuit breaker, parse de JSON |
| `createRapidApiFetchTransport(timeoutMs)` | transporte `fetch` com **timeout** (abort) |
| `RapidApiHttpError` / `RapidApiCircuitOpenError` / `RapidApiInvalidPayloadError` / `RapidApiConfigError` | erros **sanitizados** |
| `buildCacheKey` / `hashPayload` / `stableStringify` | chave de `api_cache` e `payload_hash` deterministas |
| `sanitizePayload` / `redactSecrets` | sanitizacao de sample antes de ir para o disco |
| `requireSecret` / `readNonEmpty` / `readPositiveInt` | leitura pura de env |

## Os cinco mecanismos obrigatorios (regra de ingestao)

1. **Retry com backoff exponencial + jitter** — so em transitorio (429, 5xx, rede/timeout).
   4xx (exceto 429) e **permanente**: nao retenta e **nao conta para o breaker**.
2. **Rate limit por provider** — intervalo minimo `ceil(1000 / maxRps)`, por instancia.
3. **Circuit breaker por API** — uma instancia por provider, entao estourar uma fonte
   **nunca** suspende as outras. Abre apos `breakerThreshold` falhas consecutivas; volta
   sozinho apos o cooldown.
4. **Cache local** — o worker grava o bruto em `api_cache` usando `buildCacheKey`.
5. **Hash de payload** — `hashPayload` alimenta `payload_hash` e o short-circuit
   "sem mudanca, nao reescreve".

## Seguranca de segredo (nao negociavel)

- A chave viaja **so em header** (`x-rapidapi-key`). **Nunca** em querystring — se fosse
  query, ela acabaria persistida em `api_cache.request_key` e em qualquer log de URL.
- Os erros carregam **apenas** `status`, um trecho **truncado** do corpo, o `providerApi`
  e o `endpoint` (path, sem query). **Nunca** headers, nunca a URL completa.
- `RapidApiConfigError` cita so o **nome** da variavel ausente, jamais o valor.
- `sanitizePayload` redige por **nome de campo** e por **valor do segredo**, para que um
  sample em `.data/` jamais contenha a chave.

## Worker-only

Nunca importado pelo render publico (invariantes 3 e 4). O teste de governanca
[`tests/governance/rapidapi-offline-only.test.ts`](../../tests/governance/rapidapi-offline-only.test.ts)
trava isso.
