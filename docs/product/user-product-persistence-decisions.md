# Decisões de persistência da user platform (Backend C — C7A)

> Documento canônico da **fundação de persistência** do produto de usuário.
> Registra a auditoria domínio → tabela → invariantes, os SCHEMA_GAPs, as
> decisões aprovadas/adiadas e a migration proposta. Escrito **antes** de
> qualquer DDL (regra da unidade C7A).
>
> Ordem de precedência: `docs/product/user-product-decisions.md` → domínios puros
> commitados → `schema.prisma` → migration aplicada → convenções do repositório.
> **O domínio define a intenção; o banco deve suportar a execução segura.**
> Nenhuma regra de domínio foi alterada para caber num schema insuficiente.

Escopo desta unidade: **fechar o schema e preparar contratos**. Não há adapter
Prisma concreto, runtime, HTTP nem deploy (C7B/C7C).

---

## 1. Matriz domínio → tabelas → invariantes

Convenções observadas em toda a plataforma: PK `BIGSERIAL`; timestamps
`TIMESTAMP(3)`; JSON como `JSONB`; enums Postgres `PascalCase`; FK de usuário
`ON DELETE CASCADE`; FK polimórfica para o registry `entities(entity_type,
entity_id)` `ON DELETE RESTRICT ON UPDATE CASCADE`; CHECKs nomeados
`<tabela>_<campo>_<regra>`.

| Domínio | Tabelas | Chave natural | Idempotência | Concorrência | Soft delete |
| --- | --- | --- | --- | --- | --- |
| AUTH | `users`, `user_profiles`, `user_password_credentials`, `user_accounts`, `user_sessions`, `user_verification_tokens`, `user_auth_throttles`, `user_auth_audit_logs` | `users.email_normalized` | consumo único de token (hash) | escrita condicional por hash/status | `users.deleted_at` |
| PRIVACY | `user_consent_records`, `user_data_requests` | (user, kind, momento) | append-only | trigger proíbe UPDATE | tombstone via `users.status` |
| LISTS | `user_lists`, `user_list_items` | (user, list key/slug), (list, entidade) | unique por item | transação | — |
| TRACKING | `user_watch_states`, `user_episode_progress`, `user_viewing_events` | (user, entidade) | **`UNIQUE(user_id, idempotency_key)`** em `user_viewing_events` | **`version INTEGER` (CAS)** em watch_states/episode_progress | — |
| RATINGS | `user_ratings` | (user, entidade) | `UNIQUE(user_id, entity_type, entity_id)` | **sem `version`** → CAS por pré-imagem | — |
| REVIEWS | `user_reviews`, `user_review_reports` | `id` (múltiplas por user+entidade) | — | **sem `version`** → CAS por pré-imagem | `deleted_at` |
| RECOMMENDATIONS | `user_recommendation_snapshots`, **`user_recommendation_feedback` (nova)** | (user, context) vigente / (user, idempotency_key) | **`UNIQUE(user_id, idempotency_key)`** (nova) | índice único **parcial** `WHERE is_current` | — (histórico imutável) |

**Evidências** (migration `20260717150000_user_product_platform/migration.sql`):
`version` existe **apenas** em `user_watch_states` (l. 231) e
`user_episode_progress` (l. 251), ambos com `CHECK version >= 1`. Uniques reais:
`user_watch_states(user_id, entity_type, entity_id)` (l. 491),
`user_viewing_events(user_id, idempotency_key)` (l. 498),
`user_ratings(user_id, entity_type, entity_id)` (l. 510). Triggers append-only
(UPDATE proibido) em `user_viewing_events`, `user_auth_audit_logs` e
`user_consent_records` (l. 591-606).

Nenhuma projeção nova foi materializada em tabela: só se persiste o que o
domínio precisa reler para decidir (pré-imagem, vigência, idempotência).

---

## 2. SCHEMA_GAPs encontrados

| # | Gap | Origem | Impacto |
| --- | --- | --- | --- |
| G1 | `user_recommendation_snapshots` **sem `policy_version`** | C6B | `policyVersion` é pré-condição de equivalência/replace; ficava só no JSON |
| G2 | `user_recommendation_snapshots` **sem `fingerprint`** | C6B | equivalência (`noop` vs `replace`) exige lê-lo do snapshot vigente |
| G3 | `user_recommendation_snapshots` **sem `expires_at`** | C6B | renovação/expiração exige filtro e leitura relacional |
| **G4** | `user_recommendation_snapshots` **sem `context`**, e único parcial só por `(user_id)` | **descoberto em C7A** | o domínio mantém 4 contextos (`discovery`/`continue_watching`/`rewatch`/`similar`); hoje o banco só permite **um** snapshot vigente por usuário no total |
| G5 | **Não existe tabela de feedback** de recomendação | C6B | `planRecommendationFeedback` não tem onde aterrissar |

G4 é o achado mais grave desta unidade: sem ele, publicar o snapshot de
`continue_watching` **invalidaria** o de `discovery` do mesmo usuário.

---

## 3. Decisões aprovadas

### 3.1 Snapshot — colunas próprias (G1–G4)

Os quatro campos viram **colunas** (não ficam enterrados no JSON) porque o
domínio os usa como **pré-condição operacional**: equivalência, renovação,
invalidação, consulta, concorrência e observabilidade.

| Coluna | Tipo | Nulo? | Justificativa |
| --- | --- | --- | --- |
| `context` | `"RecommendationContext"` | NOT NULL | escopo do snapshot vigente (G4) |
| `policy_version` | `TEXT` | NOT NULL | `CHECK btrim <> ''`, igual a `algorithm_version` |
| `fingerprint` | `TEXT` | **NULL permitido** | ver 3.2 |
| `expires_at` | `TIMESTAMP(3)` | NULL permitido | `null` = sem TTL (o domínio admite `ttlMs = null`) |

**Backfill.** A tabela é **provadamente vazia** em qualquer ambiente: nenhuma
linha de código escreve nela (só é citada na lista de tabelas esperadas do
validador e num comentário de `snapshot.ts`); os adapters são C7B. Ainda assim a
migration é escrita para ser segura com dados: `context` e `policy_version` são
adicionados com DEFAULT **válido** (`'discovery'`, `'reco-v1'` — valores reais do
domínio, nunca placeholder inválido) e o DEFAULT é **removido em seguida**, para
que o adapter seja obrigado a escrever explicitamente.

### 3.2 Fingerprint — NULL permitido, sem unique global

- Tipo `TEXT` (o digest depende da `HashPort` injetada; C7C usa
  `core/crypto.sha256Hex`, mas o domínio não fixa tamanho). CHECK:
  `fingerprint IS NULL OR btrim(fingerprint) <> ''`.
- **Sem unicidade global** e **sem unique por (user, context, fingerprint)**:
  histórico legítimo de snapshots equivalentes deve continuar possível
  (o histórico é imutável; só `is_current` flipa).
- Índice **não único** `(user_id, context, fingerprint)` para consulta de
  histórico/observabilidade.
- **Por que NULL é permitido:** um fingerprint não pode ser recomputado em SQL
  para linhas legadas. Preencher com valor sintético seria **perigoso**: um
  fingerprint falso poderia casar com o desejado e produzir `noop`, servindo
  recomendação velha para sempre. `NULL` = "sem fingerprint" e o adapter (C7B)
  **deve tratá-lo como não-equivalente** (força `replace`). Fail-safe.

### 3.3 Snapshot vigente — escopo passa a incluir o contexto (G4)

- Índice único parcial passa de `(user_id) WHERE is_current` para
  **`(user_id, context) WHERE is_current`**.
- **Impacto documentado:** a substituição é *estritamente mais permissiva* —
  todo estado que satisfazia o índice antigo satisfaz o novo, logo a troca
  não pode falhar nem violar dados existentes. O índice antigo é removido e
  substituído na mesma migration (substituição segura, não remoção).
- Continua valendo a invariante do domínio: **no máximo um snapshot vigente por
  (usuário, contexto)**.

### 3.4 Expiração

- `expires_at TIMESTAMP(3)` NULL-able; CHECK
  `expires_at IS NULL OR expires_at >= generated_at`.
- Índice parcial `(expires_at) WHERE is_current = true` para varrer vigentes
  expirando/expirados.
- O banco **não** decide expiração: `now` continua injetado no domínio; o
  `CURRENT_TIMESTAMP` só aparece como default de `created_at` (coluna de
  auditoria), nunca como lógica de domínio.

### 3.5 Feedback — nova tabela `user_recommendation_feedback` (G5)

Colunas: `id`, `user_id`, `entity_type`, `entity_id`, `context` (NULL = todos os
contextos), `feedback_type`, `source`, `occurred_at`, `expires_at` (NULL =
permanente), `idempotency_key`, `created_at`.

**Proibido por decisão** (e verificado por teste de governança): texto livre,
corpo de review, PII, nota/rating, estado de moderação.

- CHECK `entity_type <> 'person'` (o domínio só aceita movie/tv/season/episode).
- CHECK `btrim(idempotency_key) <> ''`.
- CHECK `expires_at IS NULL OR expires_at > occurred_at`.
- Índice parcial `(expires_at) WHERE expires_at IS NOT NULL` (filtrar expirados).
- Índice `(user_id, entity_type, entity_id)` (derivação de exclusões por entidade).

### 3.6 Idempotência do feedback

`UNIQUE(user_id, idempotency_key)` — **mesmo padrão já usado em
`user_viewing_events`** (l. 498), portanto consistente com o repositório.

- Usuários **diferentes** podem reutilizar a mesma chave (a unique é por usuário).
- **Sem coluna de assinatura de conteúdo.** O domínio compara a assinatura a
  partir dos campos (`user`, `entity_type`, `entity_id`, `feedback_type`,
  `context`) — as colunas já são suficientes para reconstruir a pré-imagem e
  detectar `conflict`. Uma coluna derivada seria redundante e poderia divergir.
- `occurred_at` **não** entra na identidade idempotente (o domínio o exclui da
  assinatura de propósito: replay com outro instante ainda é `noop`).

### 3.7 Enums

Três enums Postgres novos, espelhando *unions fechadas já existentes* no domínio
(mesma ordem, valor a valor — travado por teste de governança):

- `RecommendationContext` = `discovery, continue_watching, rewatch, similar`
- `RecommendationFeedbackType` = `not_interested, hide, already_seen, dismiss, not_relevant, like, save`
- `RecommendationFeedbackSource` = `app, system`

`entity_type` **reutiliza** o enum `EntityType` existente (nenhum enum duplicado).

### 3.8 Ratings — **NÃO** adicionar `version`

`user_ratings` já tem `UNIQUE(user_id, entity_type, entity_id)` (l. 510) e o
plano de C5A é `create | update | remove | noop` sobre uma pré-imagem.

**Como C7B detecta conflito sem `version`:** *compare-and-swap por pré-imagem*
dentro da transação —
`UPDATE user_ratings SET value=:novo, updated_at=now() WHERE user_id=:u AND entity_type=:t AND entity_id=:e AND value=:valorDaPreImagem`.
`rowcount = 0` ⇒ alguém alterou desde a leitura ⇒ `conflict`. O `create` é
protegido pela unique (violação ⇒ `conflict`); o `remove` usa `DELETE ... WHERE
value=:preImagem`. Não é preciso `version`, logo **não** se adiciona (regra: só
adicionar se ficar provado que o plano não pode ser aplicado com segurança).

### 3.9 Reviews — **NÃO** adicionar `version` e **NÃO** criar unique

- `user_reviews` **não tem** unique por (user, entidade) e isso é
  **intencional**: o domínio C5B registra que a criação **sempre cria** (não há
  dedup por unique; a idempotência recai sobre edit/spoiler/visibility/withdraw/
  report). Criar unique agora **contrariaria** um domínio já commitado e
  testado. Cardinalidade atual: **N reviews por usuário+entidade** (histórico).
- Conflito sem `version`: CAS por pré-imagem na linha **por `id`** —
  `UPDATE user_reviews SET ... WHERE id=:id AND status=:preStatus AND visibility=:preVis AND deleted_at IS NOT DISTINCT FROM :preDeletedAt`;
  `rowcount = 0` ⇒ `conflict`. `withdraw`/`restore` operam sobre `deleted_at` com
  a mesma técnica.
- **Decisão adiada** (ver §4): se o produto quiser "uma review ativa por
  usuário+entidade", o instrumento seria um **índice único parcial**
  `(user_id, entity_type, entity_id) WHERE deleted_at IS NULL`. Não aplicado
  agora por **falta de evidência de produto**.

---

## 4. Decisões adiadas (não implementadas nesta unidade)

| Adiada | Motivo | Quem decide |
| --- | --- | --- |
| Unique de "uma review ativa por usuário+entidade" | contradiz o domínio C5B atual; exige decisão de produto | humano/produto |
| `version` em `user_ratings` / `user_reviews` | CAS por pré-imagem é suficiente (§3.8/3.9) | reavaliar se C7B provar o contrário |
| Coluna de assinatura de conteúdo do feedback | colunas já bastam; evita dado derivado divergente | C7B |
| Retenção/purga de feedback expirado e de snapshots históricos | política de retenção não decidida | produto + LGPD |
| Enum de contexto reutilizado por outros domínios | hoje só recomendações usa | futuro |
| Materializar `user_recommendation_feedback.expires_at` | ver nota abaixo | C7B |

> **SCHEMA_GAP registrado (revisão adversarial C7A):** a coluna
> `user_recommendation_feedback.expires_at` existe (pedida pelo contrato da
> unidade) mas **hoje nenhum produtor do domínio a preenche**: o
> `PersistableFeedbackRecord` de C6B não carrega `expiresAt` — a expiração
> temporária é **derivada** em `deriveFeedbackExclusions` a partir de
> `occurredAt + policy.dismissTtlMs`. A coluna é nullable e fica reservada para
> C7B/C8 decidirem entre *derivar sempre* (mantendo-a NULL) ou *materializar* a
> expiração no momento da escrita. Nenhuma das duas quebra o schema atual.

### 4.1 SCHEMA_GAPs de OUTROS domínios — auditados em C7A, **não** fechados aqui

A auditoria de cobertura encontrou lacunas fora do escopo chartered desta unidade
(que é a fundação de **recomendações**). Elas tocam tabelas de domínios **já
commitados e testados**, então fechá-las altera contratos existentes e exige
**decisão humana explícita** — não são fechadas por inferência. Ficam registradas
aqui, com o DDL recomendado, como pauta de C7B.

| # | Gap | Severidade | Evidência | Correção recomendada (NÃO aplicada) |
| --- | --- | --- | --- | --- |
| **T1** | Um comando de tracking emite 2–4 eventos com a **mesma** `idempotencyKey`, mas `user_viewing_events` tem `UNIQUE(user_id, idempotency_key)` — o 2º evento **não pode ser gravado** | 🔴 **bloqueia C7B** | `tracking/watch-state.ts:190-199`; `episode-progress.ts:217-227`; `migration.sql:498` | ampliar para `UNIQUE(user_id, idempotency_key, event_type)` (substituição *mais permissiva*, preserva a idempotência por tipo de evento) |
| T3/R3 | `rating_set`/`rating_removed` não carregam `idempotencyKey`, mas `user_viewing_events.idempotency_key` é `NOT NULL` | 🔴 bloqueia | `ratings/types.ts:63-74`; `migration.sql:270` | decidir se eventos de rating vão para `user_viewing_events` e, se sim, o domínio precisa fornecer a chave |
| Rv3 | `reasonCode`/`moderationNote`/`decidedBy` da moderação **não têm coluna** — a justificativa de um takedown não tem onde ser gravada | 🔴 bloqueia | `reviews/types.ts:111-124` | audit sink de moderação (tabela própria) |
| Rv2 | `user_reviews` sem `version` **e** sem unique: um edit do autor pode **reverter um takedown** de moderação | 🟠 perda silenciosa | `reviews/mutation.ts:146-148` | `version` + CAS, ou CHECK/trigger de transição de status |
| L1 | Reorder de lista sem `UNIQUE(list_id, position)` e sem `version` | 🟠 | `lists/reorder.ts:39-69`; `migration.sql:309` | unique + CAS |
| P1 | Pedidos LGPD duplicados: sem unique parcial por status ativo | 🟠 | `privacy/export.ts:20-42` | `UNIQUE(user_id, kind) WHERE status IN ('pending','processing')` |
| A1 | `previousLockouts` sem coluna ⇒ lockout progressivo nunca progride | 🟠 | `auth/policy.ts:118,199` | coluna em `user_auth_throttles` |
| L2 | Unique de `slug`/`system_key` não é parcial sobre `deleted_at` ⇒ lista de sistema soft-deletada não pode ser recriada | 🟡 | `migration.sql:502,505` | tornar os uniques parciais `WHERE deleted_at IS NULL` |
| R2 | `user_ratings.contains_spoiler` é coluna **órfã** (sem escritor e sem leitor) | 🟡 | `ratings/types.ts:19-23` | `SCHEMA_CLEANUP_FUTURE` |
| P2 | `defaultListVisibility`/`defaultWatchStateVisibility` do DTO sem coluna | 🟡 | `privacy/preferences.ts:91-101` | colunas em `user_profiles` |

Também **confirmado como correto** (não mexer): `version` + `CHECK >= 1` em
watch_states/episode_progress; os 3 triggers append-only; `CHECK published_at ⇒
approved`; unique parcial de `system_key`; `CHECK (value*2)=floor(value*2)`;
`CHECK token_hash ~ '^[0-9a-f]{64}$'`.

---

## 5. Migration proposta

Nome: `20260721120000_user_product_persistence_foundation` (padrão
`<timestamp>_<slug>` do repositório). **Estritamente aditiva.**

Faz: `CREATE TYPE` (3 enums) · `ALTER TABLE ... ADD COLUMN` (4 colunas no
snapshot, com DEFAULT válido temporário onde `NOT NULL`) · `ALTER COLUMN ... DROP
DEFAULT` · `ADD CONSTRAINT` (CHECKs) · `DROP INDEX` + `CREATE UNIQUE INDEX`
(substituição *mais permissiva* do único parcial) · `CREATE INDEX` (3) ·
`CREATE TABLE user_recommendation_feedback` + CHECKs + 3 índices + 2 FKs.

Não faz: `DROP TABLE`, `DROP COLUMN`, rename, recriação de tabela, alteração de
migrations antigas, `TRUNCATE`, `DELETE`, lógica de aplicação, dado fictício.

**Backfill:** apenas os DEFAULTs temporários descritos em §3.1, determinísticos e
com valores válidos do domínio, seguidos de `DROP DEFAULT`.

### Rollback operacional

Não há `down` no Prisma Migrate. Reversão manual, em transação, **na ordem
inversa** (só se a nova migration ainda não estiver em uso por adapters):

```sql
DROP TABLE IF EXISTS "user_recommendation_feedback";
DROP INDEX IF EXISTS "user_recommendation_snapshots_current_unique";
CREATE UNIQUE INDEX "user_recommendation_snapshots_current_unique"
  ON "user_recommendation_snapshots"("user_id") WHERE "is_current" = true;  -- exige <= 1 vigente por usuario
DROP INDEX IF EXISTS "user_recommendation_snapshots_current_expires_at_idx";
DROP INDEX IF EXISTS "user_recommendation_snapshots_user_id_context_fingerprint_idx";
ALTER TABLE "user_recommendation_snapshots"
  DROP COLUMN "context", DROP COLUMN "policy_version",
  DROP COLUMN "fingerprint", DROP COLUMN "expires_at";
DROP TYPE IF EXISTS "RecommendationFeedbackSource";
DROP TYPE IF EXISTS "RecommendationFeedbackType";
DROP TYPE IF EXISTS "RecommendationContext";
```

⚠ O rollback do índice único **volta a ser mais restritivo**: se já existirem
dois vigentes em contextos diferentes para o mesmo usuário, ele falha — é preciso
rebaixar um antes. Documentado como risco operacional.

---

## 6. Riscos conhecidos

1. **Índice vigente mais permissivo** — reversão pode falhar (acima). Mitigado
   por a tabela estar vazia hoje.
2. **`fingerprint` NULL** — C7B **precisa** tratar NULL como não-equivalente;
   se tratar como igual, serviria recomendação velha. Registrado como
   pré-condição obrigatória de C7B.
3. **Sem `version` em ratings/reviews** — o CAS por pré-imagem depende de o
   adapter incluir as colunas da pré-imagem no `WHERE`. Se C7B usar `UPDATE ...
   WHERE id=?` sem pré-imagem, perde a detecção de conflito.
4. **Enums Postgres** — evoluir exige `ALTER TYPE ... ADD VALUE` (não
   transacional em versões antigas); aceitável porque as unions são fechadas e
   estáveis no domínio.
5. **`ON DELETE CASCADE` do feedback** — apagar usuário apaga seu feedback, o
   que é o comportamento desejado pela LGPD (o feedback é dado pessoal
   comportamental) e coerente com `user_recommendation_snapshots`.
