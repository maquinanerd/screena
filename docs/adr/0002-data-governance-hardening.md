# ADR 0002 — Hardening do schema e da governança de dados (Fase 2)

- **Status:** proposto (Fase 2 / `feat/data-governance-hardening-v2`) — **requer revisão humana de banco antes do merge**.
- **Data:** 2026-07-15 (revisto após a 1ª revisão humana de banco).
- **Migration:** `packages/db/prisma/migrations/20260715120000_data_governance_hardening/migration.sql` (forward-only).
- **Invariantes tocadas:** 2 (RatingSource ≠ ApiProvider), 5/6 (indexabilidade/licença), 9 (publicação editorial).

## Contexto

A Auditoria 360 apontou 5 lacunas estruturais de banco. A 1ª revisão humana de
banco encontrou 6 problemas estruturais nos quais **a migration poderia destruir
justamente o dado histórico que a governança pretende proteger**. Este ADR
reflete a versão **corrigida**: nenhuma linha some sem preservação, `provider_key`
não é inventado, a identidade de oferta é extensível, e licença/indexabilidade
têm histórico real. Validado em **PostgreSQL 16 efêmero**, dois cenários
(Cenário A do zero: 43/43; Cenário B upgrade sobre estado anterior: 23/23).

## Princípio central

**Perda-zero.** Nenhum `DELETE`/`NULL` destrutivo ocorre sem antes gravar um
snapshot em quarentena auditável:
- `entity_reference_orphans` — refs polimórficas órfãs removidas.
- `data_migration_quarantine` (genérica, JSONB) — duplicatas de streaming
  removidas (`watch_dedup_removed`) e `provider_key` inválido anulado
  (`source_license_invalid_provider`), com snapshot completo + campos-chave.

## Decisões por gap

### 1. Referências polimórficas — registro `entities` + FK composta (§13)

Tabela fina `entities (entity_type, entity_id)` (PK composta) mantida por
**triggers** das 5 raízes; toda tabela polimórfica ganha **FK composta**
(`ON DELETE RESTRICT`). Órfãos → `entity_reference_orphans` **antes** de
removidos; FK `NOT VALID → VALIDATE` (locks breves). Deletar entidade-raiz com
dependente é RESTRINGIDO (integridade por design; testado — A21).

### 2. `WatchAvailability` — identidade extensível, sem inventar provider (§10/§11/§2/§3 da revisão)

- **`provider_key` NÃO é derivado de `provider_name`.** O nome de exibição é
  instável (muda, é traduzido, tem acentos/caixa, varia comercialmente, colide
  entre marcas). `provider_key` vem de identificador **técnico** da API / tabela
  canônica / mapeamento governado; ausente ⇒ permanece **NULL** (sinal
  `missing-provider`, nunca inventado). Testado: A36 (fica NULL), A37 (acentos
  geram identidades distintas — "Max" ≠ "Máx").
- **Identidade da oferta = fingerprint canônico versionado** `watch_offer_fingerprint(...)`
  (função IMMUTABLE, versão `wa:v1`, delimitador `chr(31)`), usada num **índice
  único funcional** e na deduplicação. **Prioriza `external_offer_id`** (ID
  estável da API); na ausência dele, usa a **tupla completa** que diferencia
  ofertas reais (provider técnico, +fallback só-de-comparação ao `provider_name`
  normalizado; modalidade, **package, qualidade, preço+moeda, deep_link,
  web_url, validade**). Ofertas legitimamente distintas por package/preço/
  validade/URL **nunca colapsam** (A38 preço, A43 package, A39 external_offer_id
  como identidade). Trocar o algoritmo = `wa:v2` em migration dedicada.
- **Dedup preservando integralmente:** só colapsa fingerprints idênticos; a
  linha sobrevivente é a aprovada mais recente; **todas as removidas vão para
  `data_migration_quarantine`** com snapshot JSONB + `surviving_id` +
  `dedupe_fingerprint` (statement único: arquiva-antes-de-apagar). Testado: B20,
  B23 (removidas = arquivadas).
- **Reconciliação aprovação × payload (fail-closed):** uma oferta só aparece
  publicamente se `approved_payload_hash` = fingerprint atual. A migration
  força `display_allowed=false` onde não corresponde (ou hash nulo). Aprovação
  **não** sobrevive a payload diferente (B21). *Deferido à Fase 9:* CHECK
  permanente + o CLI de promoção (mergeado, anterior a esta coluna) passando a
  setar `approved_payload_hash = fingerprint`. Enquanto isso, o enforcement é no
  upgrade; a Fase 9 o torna permanente.

### 3. `SourceLicense` — histórico imutável + relações verificáveis (§4/§5 da revisão)

- **RatingSource ≠ ApiProvider (inv. 2):** `rating_source_key` (FK→rating_sources),
  `provider_key` (FK→api_providers), `territory_code` (FK→countries). CHECKs:
  rating exige fonte; `rating_source_key ≠ provider_key`.
- **Histórico real** (mesmo padrão de PageIndexabilityDecision): `is_current`,
  `supersedes_id` (auto-FK), `decision_origin`, `policy_version`, `valid_from/until`,
  `decided_by/at`. **Índice único PARCIAL WHERE is_current** por
  (source_key, content_type, provider, território) — múltiplas decisões
  sucessivas coexistem; nenhuma é sobrescrita (A40, B19).
- **`provider_key` inválido não some em silêncio:** snapshot + valor antigo →
  `data_migration_quarantine`, **depois** anula a FK e força a linha
  **fail-closed** (`display_allowed=false`, `license_status=unknown`). Testado:
  B17 (quarentena), B18 (fail-closed).

### 4. `PageIndexabilityDecision` — decisão vigente + CADEIA histórica (§6 da revisão)

`is_current` + índice único parcial. **A cadeia `supersedes_id` é realmente
construída** (backfill com `LAG`: cada decisão aponta para a imediatamente
anterior por grupo; a mais antiga fica NULL). Troca atômica insere
`supersedes_id = id da vigente anterior`. **Guarda estrutural** (trigger):
`supersedes_id` só referencia decisão do MESMO (entity_type, entity_id,
language_code). Testado: B22 (cadeia index→draft→noindex), A34 (troca atômica),
A42 (guarda barra cross-group).

### 5. Editorial (§14) — `articles`/`article_translations`

`articles`: CHECK category/author não-vazios **com backfill `'' → NULL` antes**
(B15). `article_translations`: decisão consciente de **não** acoplar
review/index/published por CHECK (quebraria o fluxo editorial real; fail-closed
vive no presenter `isPublishableArticle`).

### 6. Contrato de licença cobre vídeo (§7 da revisão)

Enum `SourceLicenseContentType` ganhou `video` (Fase 7 — biblioteca de vídeo
TMDB: trailers/teasers/clips/featurettes). Distingue rating/watch_availability/
review/video/news/image/other. Testado: A41.

## Migration: forward-only, locks, rollout

- Forward-only, sem down migration (correção = migration corretiva).
- Ordem segura: quarentena/backfill/dedup **antes** de cada constraint; FK
  composta `NOT VALID → VALIDATE`; índices únicos após normalização.
- Idempotente (`ON CONFLICT DO NOTHING`, `WHERE IS NULL`, `IS DISTINCT FROM`).
- **Locks:** `CREATE UNIQUE INDEX` (não CONCURRENTLY) trava a tabela alvo —
  aceitável agora (watch/licença/indexabilidade vazias/mínimas em produção);
  escala futura → `CONCURRENTLY` em migration dedicada. Triggers e `NOT VALID`
  tomam lock breve.
- Rollout via `prisma migrate deploy` no job de release (Fase 14). Nunca contra
  banco remoto nesta PR.

## Impacto nos consumidores

Prisma Client ganha campos novos, todos **opcionais/`@default`** → código
existente compila e roda sem mudança (build `@screena/web` verde; `validate:all`
118/118). Novos: modelo `Entity`, tabelas raw `entity_reference_orphans` e
`data_migration_quarantine`, valor de enum `video`.

## Contratos congelados para as próximas fases

- **Fase 3:** ler a decisão **vigente** (`is_current`) de
  `page_indexability_decisions` como fato persistido de indexabilidade.
- **Fase 9:** popula `external_offer_id`/licença/atribuição/`reviewed_*`/
  `approved_payload_hash`/`web_url`/`package`; decide se algum campo novo entra
  no fingerprint (`wa:v2`); torna a reconciliação aprovação×payload um CHECK
  permanente e atualiza o CLI de promoção.
- **Fase 10:** usa `content_type` + `rating_source_key` (FK) e o histórico de
  licença.

## Riscos residuais

1. `CREATE UNIQUE INDEX` não-concorrente (mitigado pelo baixo volume atual).
2. Deleção de entidade-raiz com dependentes é RESTRINGIDA (integridade por design).
3. Reconciliação aprovação×payload é enforçada no **upgrade**; o **CHECK
   permanente** + update do CLI de promoção é Fase 9 (o CLI mergeado antecede a
   coluna `approved_payload_hash`). Documentado, não silencioso.

## O que este ADR NÃO afirma (correções da revisão)

- **NÃO** afirma que `provider_key` nulo é "preservado" enquanto a migration o
  inventa — a migration **não** inventa (removido).
- **NÃO** afirma cadeia histórica de `supersedes_id` enquanto os campos ficam
  nulos — a cadeia é **construída** por backfill (B22).
- **NÃO** afirma que a chave natural de streaming está "congelada" — é um
  fingerprint **versionado e extensível** (`wa:v1`), com a Fase 9 podendo evoluir
  para `wa:v2`.
- **NÃO** afirma "nenhuma linha apagada sem preservação" sem cumprir — o dedup de
  streaming **arquiva** cada linha removida em `data_migration_quarantine`.
