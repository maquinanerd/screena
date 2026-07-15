# ADR 0002 — Hardening do schema e da governança de dados (Fase 2)

- **Status:** proposto (Fase 2 / `feat/data-governance-hardening-v2`) — **requer revisão humana de banco antes do merge**.
- **Data:** 2026-07-15 (revisto após a 1ª e a 2ª revisão humana de banco).
- **Migration:** `packages/db/prisma/migrations/20260715120000_data_governance_hardening/migration.sql` (forward-only).
- **Invariantes tocadas:** 2 (RatingSource ≠ ApiProvider), 5/6 (indexabilidade/licença), 9 (publicação editorial).

## Contexto

A Auditoria 360 apontou 5 lacunas de banco. Duas revisões humanas de banco
endureceram o resultado: a **1ª** exigiu perda-zero, identidade extensível e
histórico real; a **2ª** exigiu separar identidade de payload, tornar o
fail-closed **permanente no banco** (não adiado), corrigir os **consumidores
reais** (stores de streaming) e travar os testes de migration na **CI**. Este
ADR reflete o estado final. Validado em PostgreSQL 16 efêmero: Cenário A
(scratch) 45/45, Cenário B (upgrade) 23/23, integração dos stores 8/8.

## Princípio central

**Perda-zero + fail-closed estrutural.** Nenhum `DELETE`/`NULL` destrutivo sem
snapshot em quarentena (`entity_reference_orphans`, `data_migration_quarantine`).
E `display_allowed=true` é **impossível no banco** sem governança completa.

## Decisões por gap

### 1. Referências polimórficas — registro `entities` + FK composta (§13)

`entities (entity_type, entity_id)` mantida por triggers das 5 raízes; FK
composta (`ON DELETE RESTRICT`) em 12 tabelas; órfãos → quarentena antes de
removidos; FK `NOT VALID → VALIDATE`. Deletar raiz com dependente é RESTRINGIDO
(A21).

### 2. `WatchAvailability` — IDENTIDADE ≠ PAYLOAD + fail-closed permanente

- **Duas funções SQL versionadas (SHA-256 via pgcrypto — não MD5):**
  - `watch_offer_identity_key_v1(...)` = **identidade estável** (índice único
    funcional). Só o que identifica o MESMO objeto: entidade, país, **modalidade**,
    `provider_api`, e **`external_offer_id`** (prioritário, escopado por
    `provider_api`) OU provider **técnico** (`provider_key`; fallback ao
    `provider_name` normalizado **só quando null**, sem tocar a coluna) + package.
    **Não** inclui preço/moeda/URLs/validade. ⇒ mesmo id em `provider_api`
    diferentes não colide (A39); modalidades diferentes não colidem; rebranding
    com `provider_key` estável não muda a identidade (A37); mudança de preço não
    cria nova identidade (A38).
  - `watch_offer_payload_fingerprint_v1(...)` = tudo que, ao mudar, exige nova
    revisão (identidade + `provider_name` + package + quality + preço/moeda +
    URLs + validade + licença/atribuição). `approved_payload_hash` guarda ESTE
    fingerprint. Serialização documentada: campos por `chr(31)`, nulls via
    `COALESCE(...,'')`, texto `lower(btrim)`, numeric/timestamp `::text`
    determinístico, enums `::text`. **Computado sempre no banco** (nunca em TS) —
    sem divergência de linguagem.
- **`provider_key` NUNCA derivado de `provider_name`** (nome é instável); ausente
  ⇒ NULL (`missing-provider`) (A36).
- **Trigger PERMANENTE `watch_availability_display_guard`** (não adiado): toda
  INSERT/UPDATE que ligue `display_allowed` exige `approved_payload_hash` =
  fingerprint atual + `reviewed_at`/`reviewed_by` + licença permitida +
  atribuição/linkback quando exigidos. **É impossível publicar oferta sem
  governança** (A33; integração store 8).
- **Dedup por identidade, com arquivamento:** duplicatas de identidade → survivor
  aprovado/recente; removidas → `data_migration_quarantine` (snapshot + surviving_id).
- **Reconciliação (backfill):** `display_allowed=false` onde o hash aprovado ≠
  fingerprint do payload (B21).

### 3. `SourceLicense` — histórico imutável + relações verificáveis (§12)

FKs distintas `rating_source_key`/`provider_key`/`territory_code` (inv. 2). CHECKs
rating-exige-fonte e `rating_source_key ≠ provider_key`. **Histórico real:**
`is_current` + `supersedes_id` + **cadeia construída por `LAG`** (cada licença
liga à anterior por grupo) + **índice único PARCIAL WHERE is_current** + **guard
trigger** (supersedes só do MESMO source_key/content_type/provider/território; sem
autorreferência/ciclo direto). A40, A45, B19. `provider_key` inválido →
quarentenado + fail-closed (B17/B18).

### 4. `PageIndexabilityDecision` — vigente + cadeia real (§9)

`is_current` + partial-unique + **cadeia `supersedes_id` construída por `LAG`** +
guard trigger cross-grupo. A34/A42/B22.

### 5. Editorial (§14)

`articles`: CHECK category/author não-vazios com backfill `'' → NULL` antes
(B15). `article_translations`: **não** acopla review/index/published por CHECK
(decisão consciente; fail-closed vive no presenter).

### 6. Contrato de licença cobre vídeo (§7 rev.1)

Enum `SourceLicenseContentType` ganhou `video` (Fase 7). A41.

## Consumidores reais (stores de streaming) — corrigidos

O contrato novo só é seguro porque os stores existentes deixaram de violá-lo:

- **`watch-store.ts`**: era `DELETE`+`INSERT` (apagava revisão/histórico). Agora
  **reconciliação por identidade** (`INSERT ... ON CONFLICT (identidade) DO
  UPDATE`): atualiza só payload do sync, **revoga `display_allowed` quando o
  payload aprovado muda** (aprovação não sobrevive), e ofertas **sumidas** são
  revogadas + marcadas stale, **nunca apagadas**. `display_allowed` nunca é ligado
  aqui.
- **`watch-review-store.ts`**: `promote(ids, reviewer)` exige **revisor humano** e
  grava atomicamente `display_allowed` + `reviewed_at` + `reviewed_by` +
  `approved_payload_hash` (= fingerprint). O trigger valida licença/atribuição;
  oferta incompleta fica fail-closed (não promove). `--reviewer` obrigatório no
  CLI para `--confirm`.
- **Typecheck:** os adapters de `src/persistence/**` do streaming saíram da
  exclusão do `tsconfig` raiz — agora são type-checados.
- **Testes:** integração real contra PostgreSQL efêmero
  (`services/streaming/scripts/validate-stores-real-postgres.ts`, 8/8): sync
  preserva revisão, re-sync não duplica, promoção sem revisor falha, oferta
  incompleta é fail-closed, promoção governada liga display+hash, mudança de
  payload revoga, oferta sumida é revogada (não apagada), banco rejeita display
  inválido.

## Migration: forward-only, locks, rollout

Forward-only, sem down migration. Ordem: quarentena/backfill/dedup **antes** de
constraint; FK `NOT VALID → VALIDATE`; índices únicos e triggers após
normalização; `pgcrypto` criada de forma idempotente. `CREATE UNIQUE INDEX` não
concorrente (aceitável no volume atual; escala → `CONCURRENTLY` dedicado). Rollout
via `prisma migrate deploy` no release (Fase 14). Nunca contra banco remoto.

## CI

O workflow passa a rodar, em runner Linux, após o Prisma generate:
`db:validate:real`, `db:validate:upgrade` e `validate:stores` (streaming). Os
Cenários A/B e a integração dos stores deixam de ser só locais.

## Impacto nos consumidores

Prisma Client ganha campos novos, todos opcionais/`@default` (build `@screena/web`
verde; `validate:all` 118/118). Novos: `Entity`, `entity_reference_orphans`,
`data_migration_quarantine`, enum `video`, coluna `external_offer_id`.

## Contratos congelados para as próximas fases

- **Fase 3:** ler a decisão vigente (`is_current`) de
  `page_indexability_decisions`.
- **Fase 9:** popula `external_offer_id`/licença/atribuição via os stores já
  governança-compatíveis; pode evoluir o fingerprint (`wa:v2`) numa migration
  dedicada.
- **Fase 10:** usa `content_type` + `rating_source_key` (FK) e o histórico de
  licença.

## Riscos residuais

1. `CREATE UNIQUE INDEX` não-concorrente (mitigado pelo volume atual).
2. Deleção de entidade-raiz com dependentes é RESTRINGIDA (integridade por design).

## O que este ADR NÃO afirma (correções das revisões)

- **NÃO** afirma que `provider_key` nulo é "preservado" enquanto o inventa — a
  migration/stores **não** inventam.
- **NÃO** afirma cadeia histórica de `supersedes_id` sem construí-la — é
  construída por `LAG` em `page_indexability_decisions` **e** `source_licenses`,
  com guard triggers.
- **NÃO** afirma identidade "congelada" — é fingerprint **versionado** (`wai:v1`),
  separado do payload (`wap:v1`).
- **NÃO** afirma "nada apagado sem preservação" sem cumprir — dedup arquiva em
  quarentena; stores não fazem DELETE cego.
- **NÃO** adia o fail-closed para a Fase 9 — o trigger permanente já o garante no
  banco, e os stores reais foram corrigidos.
- **NÃO** afirma que a CI comprova os cenários sem rodá-los — os três validadores
  entraram no workflow.
