# Revisão técnica final da migration — PR #74

> Revisão técnica produzida pelo **agente** para aceite final do **proprietário**.
> **Não é parecer jurídico** e **não é revisão humana** — é uma verificação
> técnica objetiva, em PostgreSQL efêmero, para embasar a decisão de deploy
> controlado. A decisão de licença e a de fórmula do Cinerie Score continuam
> sendo humanas e permanecem pendentes.

- **PR:** https://github.com/maquinanerd/screena/pull/74
- **Head SHA:** `e6c67f5c44e78bd117e6155fc719bc325384bfa8` (verificado no início desta revisão)
- **Migration:** `packages/db/prisma/migrations/20260717120000_external_intelligence_product/migration.sql` (forward-only)
- **Data:** 17 de julho de 2026

## Arquivos revisados

- `packages/db/prisma/migrations/20260717120000_external_intelligence_product/migration.sql`
- `packages/db/prisma/schema.prisma`
- `packages/db/scripts/validate-real-postgres.ts` (Cenário A)
- `packages/db/scripts/validate-upgrade-real-postgres.ts` (Cenário B)
- `services/ratings/scripts/validate-external-intelligence-product.ts`
- `docs/adr/0013-external-intelligence-product.md`

## Gates executados (PostgreSQL 16 efêmero; nenhum banco de produção tocado)

| Gate | Resultado |
| --- | --- |
| `db:validate:real` (Cenário A — do zero) | **45/45** |
| `db:validate:upgrade` (Cenário B — upgrade em ordem cronológica) | **23/23** |
| `validate:external-intelligence-product` (integridade + exibição + revisão adversarial) | **51/51** |
| `validate:source-authorization-and-attribution` (registro + atribuição + bloqueios) | **18/18** |

## Confirmações objetivas

| Item | Confirmação | Evidência |
| --- | --- | --- |
| Migration forward-only | **Sim** | Zero `DELETE FROM`, `DROP TABLE`, `TRUNCATE` ou `DROP COLUMN` no arquivo. |
| Nenhuma linha apagada | **Sim** | Backfills usam apenas `UPDATE ... SET display_allowed=false` (revogação) — nunca `DELETE`. |
| Colunas novas compatíveis com tabelas populadas | **Sim** | Todo `ADD COLUMN` é nullable ou tem `DEFAULT`; nenhum `NOT NULL` sem default. |
| Backfills fail-closed | **Sim** | `external_ratings` e `watch_availability` que estavam `display_allowed=true` sem a cadeia nova são revogados (linhas 347, 362, 742, 750); `screen_score_display` idem (874-875). Revogar é barato; vazar não tem volta. |
| Ordem correta (backfill → constraints → índices → triggers) | **Sim** | Extensão pgcrypto e enums primeiro; colunas + backfill de classificação; funções de fingerprint; triggers; FKs de `provider_api` só após o `UPDATE` que anula fornecedor fantasma (evita violar a FK ao criá-la). |
| Nenhuma licença/decisão criada por inferência | **Sim** | A migration não insere `source_licenses`/`data_usage_decisions`. O registro é ato humano explícito (`pnpm legal sources apply --confirm`). |
| Nenhum rating promovido | **Sim** | Nenhum `UPDATE external_ratings SET display_allowed=true` na migration; o único toque é revogação. Confirmado por `validate:source-authorization` check 10. |
| Nenhuma oferta promovida | **Sim** | Idem `watch_availability`. Check 11. |
| Cinerie Score bloqueado | **Sim** | `cinerie_score_display_guard` recusa `screen_score_display=true` sem `DataUsageDecision` vigente; nenhuma decisão dessas é criada. Checks 9, 12. |
| Upgrade real em ordem cronológica | **Sim** | Cenário B remove Fase 2 + posteriores do 1º deploy e aplica em ordem no 2º (correção A10). 23/23. |
| Schema Prisma corresponde ao SQL | **Sim** | `db:validate` (prisma validate) verde; models `DataUsageDecision`, `WatchProvider`, `WatchProviderAlias`, `CinerieScoreCalculation` + colunas novas espelham o SQL; enums `DataUsageStage`/`RatingScoreType`/`CinerieScoreStatus` presentes nos dois. |
| FKs e índices necessários existem | **Sim** | FK composta `cinerie_score_calculations → entities` (A8); FK `data_usage_decisions → source_licenses`/`countries`/self; FK `watch_availability.provider_api → api_providers` e `→ watch_providers`; índices de `use_case`, `stage`, `is_current`, `territory`, `stale_after`, `score_type`, `data_usage_decision_id`; únicos parciais `..._current_unique` e `watch_provider_aliases (provider_api, external_key)`. |
| Triggers não permitem bypass | **Sim** | `external_ratings_display_guard`, `watch_availability_display_guard`, `data_usage_decision_guard`, `external_ratings_integrity_guard`, `cinerie_score_display_guard` são `BEFORE INSERT OR UPDATE FOR EACH ROW` — valem para `$executeRaw`, seed, psql. Neutralizar o cross-label faz o product check 5 reprovar (mutation spot-check). |
| Revogação e supersessão funcionam | **Sim** | `is_current` + `supersedes_id` com guard de grupo; product checks 24, 25; source-auth check 14 (semente supersedida, não apagada). |
| Licença expirada/substituída bloqueia leitura | **Sim** | Guards + read paths revalidam `license.is_current`/status/`display_allowed`/`score_allowed` (A1); product check 49 e source-auth check 16 (fetched_at isolado). |
| Território BR respeitado | **Sim** | Decisões e read paths só aceitam `territory ∈ {NULL, BR}` (A2); product check 48; source-auth checks 4, 5, 18. |
| pgcrypto qualificado (`public.digest`) | **Sim** | Funções de fingerprint usam `public.digest` — lição da hotfix #73 (search_path do runtime). |

## Riscos residuais (aceitos; documentados como A9 na revisão adversarial)

- `CREATE OR REPLACE` do `watch_availability_display_guard` referencia
  `data_usage_decision_id` criada mais abaixo no arquivo — funciona (plpgsql
  resolve na execução, transação única, primeira escrita vem depois), mas um
  write intermediário futuro entre os dois pontos quebraria. Comentário no SQL
  registra a dependência.
- `UPDATE ... provider_api = NULL` para fornecedor fantasma altera a identity
  key da oferta e, em teoria, poderia colidir com uma duplicata NULL-provider no
  índice único — cenário que exige fantasma + duplicata exata simultâneos; risco
  nulo no estado atual (produção sem ofertas promovidas).
- Timestamps `timestamp(3)` sem timezone comparados a `CURRENT_TIMESTAMP` —
  convenção do repositório; irrelevante para janelas de meses. O registry e o
  branch de frescor sem-mudança já normalizam datas em raw via
  `AT TIME ZONE 'UTC'`.
- Nomes de FK fora da convenção Prisma (`_source_license_fkey`) — mesma
  convenção da Fase 2; sem efeito em runtime.

Nenhum risco residual bloqueia o deploy controlado.

## Confirmação de que nenhuma linha real foi promovida

Todos os testes rodam em PostgreSQL efêmero. A migration não promove dado; o
registry (`pnpm legal`) roda em dry-run por default e, mesmo sob `--confirm`, só
escreve `source_licenses`/`data_usage_decisions` — nunca liga `display_allowed`
de rating ou oferta (provado por `validate:source-authorization` checks 10/11).
Nenhuma chamada externa real foi executada. Nenhuma fórmula foi definida.

## Veredito técnico

**TECHNICALLY_APPROVED_FOR_CONTROLLED_DEPLOYMENT**

A migration é forward-only, segura sobre tabelas populadas, com backfills
fail-closed, ordem correta, triggers sem bypass e schema Prisma consistente com
o SQL. O deploy controlado depende, ainda, de duas decisões **humanas** fora do
escopo técnico: (1) a revisão humana da matriz legal de fontes e o `apply` da
autorização; (2) a decisão de produto sobre a fórmula do Cinerie Score. Enquanto
não houver essas decisões, ratings, streaming e Cinerie Score permanecem
bloqueados — o que é o comportamento correto e verificado.
