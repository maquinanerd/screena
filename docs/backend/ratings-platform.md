# Plataforma de ratings (Backend B)

Governança de **notas externas** (IMDb, Rotten Tomatoes, Metacritic, Letterboxd,
FilmAffinity) — do byte cru do fornecedor técnico até a exibição em página
pública. Marca pública: **Cinerie** (`https://cinerie.com`); `@screena/*` é
namespace técnico legado.

## Princípio: nada nasce exibível

Toda nota nasce `display_allowed = false` e `license_status = unknown`. Exibir uma
nota exige uma cadeia completa e **verificável no banco** (não só na aplicação):

```
SourceLicense (o que a fonte permite)
  → DataUsageDecision (para que USO: rating_display, derivative, storage)
    → external_rating (fingerprint aprovado + revisor humano + score_type)
      → display_allowed = true
```

Até o Backend B, o fail-closed de ratings era **só aplicação**: o banco aceitava
`UPDATE external_ratings SET display_allowed = true` sem revisor, sem hash e sem
licença. O default protegia o caminho feliz, não o caminho errado. Os dois
triggers abaixo fecham isso — `validateRating`
([`packages/schemas/src/ratings.ts`](../../packages/schemas/src/ratings.ts)) só
protege quem passa por ele; script, seed e `psql` não passam.

## Os dois triggers de `external_ratings`

### `external_ratings_integrity_guard` (toda linha, exibida ou não)

Invariantes 1 e 2 viram lei do banco:

- `provider_api ≠ rating_source` **e** `provider_api` não pode ser o id de
  nenhuma fonte editorial (RapidAPI transportando IMDb não vira "imdb");
- `rating_scale` = escala canônica da fonte (`imdb=10`, `rotten_tomatoes=100`,
  `metacritic=100`, `letterboxd=5`, `filmaffinity=10`);
- valor dentro da escala; votos ≥ 0 (`null` = desconhecido é legítimo);
- **cross-label**: `Tomatometer`/`Popcornmeter` forçam `rotten_tomatoes`, `imdb`
  força `imdb`, `metacritic`/`metascore` forçam `metacritic`;
- Tomatometer ⇒ `score_type = critics`, Popcornmeter ⇒ `score_type = audience`.

### `external_ratings_display_guard` (fail-closed permanente)

Para `display_allowed = true`, exige — por qualquer caminho, inclusive SQL bruto:

1. `approved_payload_hash` = `external_rating_payload_fingerprint_v1(...)` atual
   (**"mudança revoga"**: se a nota muda, o hash deixa de bater e a exibição cai);
2. `reviewed_at` e `reviewed_by` (revisor humano nomeado);
3. `score_type` classificado (critics/audience nunca se misturam);
4. `license_status ∈ {official, licensed, third_party}`;
5. `attribution_text`/`attribution_url` quando exigidos;
6. `data_usage_decision_id` de uma decisão **vigente** de `rating_display` **da
   licença daquela fonte** — sem isto, uma decisão do Metacritic autorizaria IMDb.

## score_type: fail-closed

`classifyRatingScoreType`
([`services/ratings/src/score-type.ts`](../../services/ratings/src/score-type.ts))
classifica por marca → vocabulário da métrica → natureza da fonte. "IMDb 8.4" e
"Tomatometer 92%" não são a mesma espécie de coisa, e Rotten
Tomatoes/Metacritic publicam **duas** notas cada — nem "a nota da fonte X"
identifica uma métrica. O que não dá para afirmar vira **`null`**, e o guard
proíbe exibir nota sem classificação: fica no banco (auditável), fora da
vitrine. Nunca cai em `editorial` de consolo — `editorial` é "nota da casa", e
uma nota de terceiro jamais é isso.

## Frescor (stale policy versionada)

`RATING_STALE_POLICY` ([`@screena/config`](../../packages/config/src/external-intelligence.ts))
tem dois relógios por fonte:

| Fonte | refresh | expira |
| --- | --- | --- |
| imdb | 168h (7d) | 720h (30d) |
| rotten_tomatoes | 168h (7d) | 720h (30d) |
| metacritic | 336h (14d) | 1440h (60d) |

`needs_refresh` (passou do refresh, não do expire) **continua exibível** — se
atraso de worker tirasse nota boa do ar, incidente de infra viraria incidente de
produto. `expired` não exibe: seria afirmar frescor que não temos. Fontes sem
política (letterboxd, filmaffinity) são `unknown-policy` e nunca exibíveis — não
inventamos janela.

Por que a leitura revalida frescor mesmo com o trigger: o trigger dispara em
**escrita**. Uma nota aprovada em janeiro fica `display_allowed = true` para
sempre, porque o tempo passar não é um UPDATE. O trigger é a trava de escrita;
[`apps/web/src/server/entity-ratings.ts`](../../apps/web/src/server/entity-ratings.ts)
é o relógio da leitura. Nenhum substitui o outro.

## CLI `pnpm ratings`

Ver [runbook de ratings-sync](../runbooks/ratings-sync.md). Comandos: `sample`
(inspeção, nunca escreve), `sync` (persiste, dry-run por default), `review`
(lista candidatas, read-only), `promote`/`revoke` (dry-run por default, `--confirm`
exige `--reviewer`). Escrita é sempre dry-run por default; lote limitado a 20.

## O que NÃO existe (e por quê)

- Nenhuma nota real em produção — nenhuma chamada real ao fornecedor foi feita.
- `AggregateRating` de ratings externos não é emitido sem licença/escopo/revisão.
- Reescala entre fontes, cross-conversão IMDb↔Tomatometer: proibidas em todas as
  camadas (schema puro, trigger, guardrails, contrato público).
