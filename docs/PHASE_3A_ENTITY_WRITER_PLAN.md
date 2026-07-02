# PHASE 3A — Entity Writer (pipeline editorial offline) — Plano

> Plano **aprovado** para a Fase 3A (recorte da Fase 3). Branch: `feat/fase-3a-entity-writer`.
>
> Escopo: **pipeline offline** do Entity Writer em **TypeScript/Node + Prisma**,
> que consome a fila `entity_writer_jobs`, monta um **payload controlado** a
> partir do PostgreSQL, chama um **`GeminiPort`** (fake no CI, real worker-only),
> valida forma + anti-alucinacao, persiste em `content_blocks` versionado e
> registra execucao em `entity_writer_logs`. **Somente** os blocos
> `editorial_intro` e `cast_intro`, **somente pt-BR**.
>
> **Estado atual:** a Fase 3A esta parcialmente implementada em
> `services/entity-writer` (TypeScript/Node + Prisma), com FakeGemini em testes,
> adapter Gemini real worker-only e persistencia de `content_blocks`/logs. Este
> plano permanece como registro de decisao/escopo, nao como prova de ausencia de
> runtime.
>
> Em conflito com este documento, vence `CLAUDE.md` (as 13 invariantes) e as
> regras em `.claude/rules/entity-writer.md`.

---

## 1. Contexto

O **Entity Writer** e o motor editorial offline que gera
`content_blocks` a partir de dados estruturados do PostgreSQL, usando IA
(Gemini) **apenas fora do render** (invariantes 3, 4, 12, 13). A especificacao
canonica vive em [`docs/ENTITY_WRITER.md`](ENTITY_WRITER.md) e as regras
operacionais em [`.claude/rules/entity-writer.md`](../.claude/rules/entity-writer.md).

Estado atual do repositorio (pre-Fase 3A):

- **Schema ja existe (Fase 1).** Os modelos `ContentBlock`, `EntityWriterJob` e
  `EntityWriterLog` ja estao em
  [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) com
  os enums `ContentBlockType`, `ReviewStatus`, `ContentSource`, `JobType`,
  `JobStatus`, `ValidationStatus`, `EntityType`. **Nenhuma migration nova e
  necessaria para a Fase 3A.**
- **Contrato puro ja existe.** [`packages/schemas/src/entity-writer-output.ts`](../packages/schemas/src/entity-writer-output.ts)
  ja expoe `EntityWriterOutput`, `EntityPayload`, `validateEntityWriterOutput`
  (forma/tipos) e `validateAgainstPayload` (anti-alucinacao barata por nomes
  proprios).
- **Dados ja ingeridos (Fase 2).** A ingestao TMDB
  ([`docs/PHASE_2_TMDB_PLAN.md`](PHASE_2_TMDB_PLAN.md)) populou `movies`,
  `tv_shows`, `people`, `cast_members`, `crew_members` etc. via Prisma — fonte
  do payload controlado.
- **Scaffold existe.** [`services/entity-writer/README.md`](../services/entity-writer/README.md)
  descreve o worker (hoje vazio). A Fase 2 estabeleceu o **precedente de runtime
  TS/Node + Prisma** para servicos de dominio (decisao D2.1/D2.4).

A Fase 3A converte esse scaffold no **primeiro pipeline real** do Entity Writer,
de ponta a ponta, mas **sem nunca publicar nem indexar** e **sem Gemini real no
CI**.

---

## 2. Decisoes aprovadas (D3.1–D3.7)

### D3.1 — Runtime
A Fase 3A e implementada em **TypeScript/Node + Prisma**, seguindo o padrao da
Fase 2 (ports/adapters; logica pura tipada e testada; codigo que toca Prisma
isolado em adapters excluidos do typecheck). Os **workers Python permanecem
legado/scaffold** para esta parte (desvio do `CLAUDE.md` ja registrado em D2.4 e
em [`workers/README.md`](../workers/README.md)).

### D3.2 — Contrato canonico
O **contrato canonico e o de
[`packages/schemas/src/entity-writer-output.ts`](../packages/schemas/src/entity-writer-output.ts),
em formato plano (flat)**. **Nao** usar o formato aninhado `blocks: {}`.

> **Etapa 0 concluida nesta branch:** antes de qualquer runtime, a divergencia de
> contrato foi reconciliada para o formato flat:
> - `packages/schemas/src/entity-writer-output.ts` — **flat** (alvo canonico);
> - `docs/ENTITY_WRITER.md` §5 — **flat**, sem `blocks: {}`;
> - `prompts/entity_intro_pt.md` — **flat**, sem `{ block_type, content }` na saida.

### D3.3 — EntityPayload
O `EntityPayload` pode ser **estendido com campos opcionais**, mantendo
compatibilidade com o contrato atual (`{ director, cast }`). Campos propostos
(todos opcionais, nenhum quebra o consumidor existente):

- `entityType`
- `title`
- `year`
- `runtimeMinutes`
- `languageCode`
- `director` (ja existe)
- `cast` (ja existe)
- `castMembers` — `{ name, character, billingOrder }[]`, quando fizer sentido.

**Nenhum** desses campos autoriza o modelo a inventar dados fora do payload. Ao
contrario: `castMembers` amplia o conjunto de **nomes permitidos** que a
anti-alucinacao reconhece, sem afrouxar a regra (tudo que nao estiver no payload
continua virando warning).

### D3.4 — Gemini
- Gemini **real** so atras de um **port/adaptador worker-only** (`GeminiPort` +
  `GeminiAdapter`). O adaptador real e isolado e **nunca** importavel por
  `apps/web`.
- **CI usa fake** (`FakeGeminiPort` deterministico). **Zero chamada Gemini no
  CI.**
- **Zero Gemini no render** (invariante 4).
- `GEMINI_API_KEY` **so por env** (nunca no front, bundle ou versionada).
- O **modelo Gemini e configuravel por env** (ex.: `GEMINI_MODEL`), **nao
  hardcoded** como verdade de produto. O `model_name` gravado reflete o modelo
  efetivamente usado na chamada.

### D3.5 — Versionamento
Todo bloco persistido registra (invariante 13; ja suportado pelas colunas de
`ContentBlock`):

- `prompt_version`
- `input_hash`
- `output_hash`
- `model_provider`
- `model_name`
- `review_status`

Modelo e prompt sao **versionados**. **Nao publica automaticamente.**

### D3.6 — Regeneracao
- **Nao** fazer update in-place em `content_blocks`. **Regeneracao cria nova
  versao** (nova linha).
- A versao anterior deve ser **arquivada ou marcada como substituida**, usando o
  **schema existente**: `review_status = archived`.
- **Limite do schema atual (documentado, sem migration nesta fase):** nao existe
  coluna de ponteiro de supersessao bloco→bloco (ex.: `superseded_by_id`) nem
  coluna de numero de versao em `content_blocks`. Consequencias e convencao
  adotada:
  - O **bloco ativo** de um alvo `(entity_type, entity_id, language_code,
    block_type)` e a linha mais recente (`created_at`) com `review_status` **nao**
    `archived`/`blocked`.
  - Ao regenerar: dentro de **uma transacao**, marca a versao ativa anterior como
    `archived` e insere a nova linha; nao ha unique em
    `(entity_type, entity_id, language_code, block_type)` no schema, entao
    multiplas versoes coexistem por design.
  - A rastreabilidade da geracao se da por `input_hash`/`output_hash` (no bloco e
    no log) e por `EntityWriterJob.result_block_id` (job → bloco). A linhagem
    bloco→bloco perfeita (ponteiro explicito) fica como **proposta de schema
    futura**, fora desta fase.

### D3.7 — Escopo de blocos
A Fase 3A gera **apenas**:

- `editorial_intro`
- `cast_intro`

**Somente pt-BR.**

**Prompt combinado (posse do `cast_intro`).** Na Fase 3A/Etapa 0,
`prompts/entity_intro_pt.md` e o **unico** prompt e gera `editorial_intro` **e**
`cast_intro` na **mesma chamada**. **`prompts/cast_intro_pt.md` nao sera criado na
Fase 3A**, salvo decisao futura explicita. Se um dia houver um prompt proprio de
`cast_intro`, isso e **refactor futuro** — fora do escopo da implementacao inicial.

**Fora da Fase 3A** (gerados em fases posteriores): `ratings_explanation`,
`where_to_watch_text`, `season_guide`, `episode_context`,
`summary_without_spoilers`, `similar_titles_intro`, `franchise_context`,
`news_context`, `review_summary`.

---

## 3. Escopo

### Dentro da Fase 3A
- Pipeline **offline** do Entity Writer (TS/Node + Prisma).
- Fila `entity_writer_jobs` (claim, run, complete/fail/blocked) — usando o schema
  existente.
- **Payload controlado** montado a partir do PostgreSQL (entidade + elenco).
- **`GeminiPort`** com **fake** no CI; adaptador real worker-only atras do port.
- **Validacao de forma** (`validateEntityWriterOutput`).
- **Validacao anti-alucinacao** (`validateAgainstPayload`, estendida ao payload
  ampliado de D3.3).
- **Persistencia** em `content_blocks` (versionada — D3.5).
- **Logs** em `entity_writer_logs` — **um registro por tentativa de
  geracao/validacao**, compativel com o schema atual (sem log por passo; ver
  secao 5.5).
- `review_status` apenas **`ai_generated`**, **`needs_review`** ou **`blocked`**;
  **nunca `published`**.
- Apenas `editorial_intro` e `cast_intro`, **somente pt-BR** (D3.7).

### Fora da Fase 3A
- Schema/migration (nenhuma alteracao em `schema.prisma`).
- Paginas publicas / render / SEO final / indexacao.
- Slugs / redirects.
- Admin UI.
- Publicacao automatica (e qualquer transicao para `published`/`human_reviewed`).
- Ratings externos (IMDb/RT/Metacritic).
- Streaming availability / `where_to_watch_text`.
- Gemini no render.
- en/es (nascem em draft/noindex em fase futura; aqui nem sao gerados).
- Conteudo baseado em overview/sinopse **nao persistida** (o pipeline so usa o
  payload controlado; nao le sinopse crua de API).

---

## 4. Arquitetura proposta

Padrao **ports/adapters** identico ao da Fase 2: nucleo puro tipado e testavel; o
que toca Prisma e o que toca a rede (Gemini) fica em adapters isolados,
worker-only, **excluidos do typecheck** (mesmo padrao de `prisma/seed.ts` e dos
adapters de `services/ingestion`).

```
entity_writer_jobs (queued)
      │  claim (transacao: queued → claimed/running)
      ▼
 build payload controlado  ──►  (Prisma, read-only: movies/tv_shows/people/cast_members…)
      │   EntityPayload (flat, D3.3)
      ▼
 resolve prompt versionado (prompts/, registra prompt_version)
      │
      ▼
 GeminiPort.generate(payload, prompt)      ◄── FakeGeminiPort no CI
      │   EntityWriterOutput (flat, D3.2)
      ▼
 validateEntityWriterOutput (forma/tipos)
      │
 validateAgainstPayload (anti-alucinacao)  ──►  warnings[]
      │
      ▼
 decide review_status  (ai_generated | needs_review | blocked) — nunca published
      │
      ▼
 persist (transacao):                            log (entity_writer_logs)
   - archive versao anterior (D3.6)               1 registro por tentativa:
   - insert content_blocks (versionado)           model/prompt/input_hash/output_hash
   - update entity_writer_jobs.result_block_id    validation_status/warnings_json/error
```

> O bloco "log" acima e **uma linha por tentativa** de geracao/validacao, com as
> colunas que o schema atual de `entity_writer_logs` ja tem (secao 5.5). **Nao** ha
> log por passo (`step`), nem colunas `status`, `latency_ms` ou `block_type`.

Componentes:

- **`services/entity-writer/` (nucleo puro)** — orquestracao por interfaces
  (`GeminiPort`, repositorios), montagem de payload (pura, a partir de structs ja
  lidas), selecao de prompt, decisao de `review_status`, calculo de hashes. Sem
  rede, sem DB direto.
- **Adapters (excluidos do typecheck/worker-only):**
  - `persistence/` — leitura do payload e escrita de `content_blocks` /
    `entity_writer_jobs` / `entity_writer_logs` via Prisma (`@screena/db/server`).
  - `gemini/` — `GeminiAdapter` real (worker-only) implementando `GeminiPort`.
  - `bin/` — runner CLI/systemd (offline).
- **`FakeGeminiPort`** — implementacao deterministica para testes/CI (sem rede).
- **`@screena/schemas`** — `validateEntityWriterOutput` + `validateAgainstPayload`
  (estendido a D3.3). Fonte unica do contrato (D3.2).

Pureza de render (invariantes 3, 4): nada de `services/entity-writer` e
importavel por `apps/web`. O auditor `scripts/audit/check-render-purity.mjs` deve
proibir esse import (extensao da regra ja aplicada a `services/ingestion`/`sync`).

---

## 5. Contrato de entrada e saida

### 5.1 Contrato reconciliado na Etapa 0

| Fonte | Formato apos Etapa 0 | Observacao |
| --- | --- | --- |
| `packages/schemas/src/entity-writer-output.ts` | **Flat** — `EntityWriterOutput` com campos de bloco no topo + `warnings: string[]`; `EntityPayload = { director, cast }`. | **Alvo canonico (D3.2).** |
| `docs/ENTITY_WRITER.md` §5 | **Flat** — `editorial_intro`, `cast_intro` e `warnings` no topo do objeto; sem `blocks: {}`. | Alinhado ao contrato canonico. |
| `prompts/entity_intro_pt.md` | **Flat** — saida `EntityWriterOutput` com `editorial_intro`, `cast_intro` e `warnings`; entrada sem `facts: {}`. | Alinhado ao recorte 3A; nao exige campos fora da fase. |

### 5.2 Entrada — `EntityPayload` (flat, estendido — D3.3)

Forma-alvo (todos os novos campos **opcionais**; o consumidor atual continua
valido):

```ts
interface EntityPayload {
  readonly entityType?: "movie" | "tv" | "season" | "episode" | "person";
  readonly title?: string;
  readonly year?: number;
  readonly runtimeMinutes?: number;
  readonly languageCode?: string;       // "pt-BR" na Fase 3A
  readonly director: string;            // ja existe
  readonly cast: string[];              // ja existe
  readonly castMembers?: ReadonlyArray<{
    readonly name: string;
    readonly character?: string;
    readonly billingOrder?: number;
  }>;
}
```

Regras do payload:
- Montado **somente** a partir do PostgreSQL (entidade + `cast_members`/`crew_members`).
- **Nao** inclui sinopse crua/overview como insumo de texto (fora de escopo, D3.7).
- Os **unicos** nomes/fatos permitidos no texto sao os do payload; `castMembers`
  e `director`/`cast` definem o conjunto reconhecido pela anti-alucinacao.

### 5.3 Saida — `EntityWriterOutput` (flat — D3.2)

Mantem a forma ja existente; a Fase 3A so popula `editorial_intro` e/ou
`cast_intro` (+ `warnings` obrigatorio):

```ts
interface EntityWriterOutput {
  readonly editorial_intro?: string;
  readonly cast_intro?: string;
  // demais campos do contrato permanecem opcionais e nao usados na 3A
  readonly warnings: string[];          // sempre presente (pode ser [])
}
```

**Saida vazia (ambos os blocos omitidos) — invalida para persistencia.** Os campos
`editorial_intro`/`cast_intro` sao opcionais, mas uma saida **sem nenhum bloco
textual geravel** (ex.: `{"warnings": []}`, sem `editorial_intro` nem `cast_intro`)
e tratada assim:

- **Nao** e persistida: o pipeline **nao** insere linha em `content_blocks`.
- O job de `entity_writer_jobs` termina conforme a causa:
  - **`blocked`** — quando a saida e **formalmente valida** (passou em
    `validateEntityWriterOutput`) mas **nao contem bloco util**;
  - **`failed`** — quando houve **erro tecnico/parsing/modelo** (saida nao
    parseavel, recusa do modelo, timeout etc.).
- Registra **uma tentativa** em `entity_writer_logs` com `validation_status =
  failed` (compativel com o enum real `passed|warnings|failed`) e o motivo em
  `warnings_json` (caso `blocked`) ou `error_message` (caso `failed`).
- Este comportamento **deve virar teste** na implementacao (ver secao 7).

### 5.4 Persistencia em `content_blocks` (colunas reais)

Por bloco gerado, uma linha em `content_blocks` (mapeamento Prisma já existente):

| Coluna | Valor na Fase 3A |
| --- | --- |
| `entity_type` | `movie` ou `tv` (enum `EntityType`) |
| `entity_id` | id interno da entidade |
| `language_code` | `pt-BR` |
| `block_type` | `editorial_intro` ou `cast_intro` |
| `content` | texto gerado (flat) |
| `source_type` | `ai` (enum `ContentSource`) |
| `model_provider` | ex.: `google`/`gemini` (obrigatorio quando `source_type != human`) |
| `model_name` | modelo efetivo (de env — D3.4) |
| `prompt_version` | versao do prompt usado (D3.5) |
| `input_hash` | hash do payload controlado |
| `output_hash` | hash do conteudo gerado |
| `review_status` | `ai_generated` \| `needs_review` \| `blocked` — **nunca `published`** |
| `warnings_json` | warnings de forma + anti-alucinacao serializados |
| `published_at` | **sempre `null`** nesta fase |

### 5.5 Logs em `entity_writer_logs` (colunas reais — sem migration)

> **Correcao importante (revisao Codex).** Na Fase 3A **sem migration**,
> `entity_writer_logs` registra **uma tentativa de geracao/validacao por job**,
> usando **apenas** as colunas que o schema atual ja possui. **Nao** existe log
> "por passo" e **nao** existem as colunas `step`, `status`, `latency_ms` nem
> `block_type` nesta tabela.

Colunas reais de `entity_writer_logs` (de
[`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma)) e como
a Fase 3A as preenche:

| Coluna | Uso na Fase 3A |
| --- | --- |
| `job_id` | job de `entity_writer_jobs` que originou a tentativa |
| `entity_type` / `entity_id` | entidade processada (enum `EntityType`) |
| `language_code` | `pt-BR` |
| `model_provider` / `model_name` | modelo usado na chamada (de env — D3.4); pode ser nulo se a falha for antes da chamada |
| `prompt_version` | versao do prompt resolvido |
| `input_hash` | **linhagem do payload** controlado de entrada |
| `output_hash` | **linhagem da saida** gerada (quando houve saida) |
| `token_input` / `token_output` | **uso do modelo quando disponivel** (do retorno do provider); nulo se indisponivel |
| `validation_status` | resultado da validacao (`passed` \| `warnings` \| `failed`, enum `ValidationStatus`) |
| `warnings_json` | warnings de forma + anti-alucinacao serializados |
| `error_message` | mensagem de erro tecnico quando a tentativa falha |
| `created_at` | carimbo da tentativa |

Notas (esclarecimentos da correcao):

- **`block_type` pertence a `content_blocks`, nao a `entity_writer_logs`.** A
  correlacao bloco↔log se da por `input_hash`/`output_hash` e por
  `EntityWriterJob.result_block_id`.
- **Resultado de validacao/erro** e registrado em `validation_status` +
  `warnings_json` + `error_message` (colunas existentes) — nao em uma coluna
  `status` (que nao existe).
- **Metricas de latencia por passo ficam fora da Fase 3A.** Nao ha coluna
  `latency_ms`; medir latencia por passo (ou logar por passo) exigiria
  **migration futura** — fora desta fase.
- Se a implementacao quiser registrar uma sub-estrutura "por passo"
  (payload/generate/validate/persist) **dentro** de `warnings_json`, isso e uma
  **convencao interna opcional** e **nao substitui** colunas inexistentes; o
  schema canonico continua sendo o acima. A premissa permanece: **Fase 3A nao cria
  migration**.

---

## 6. Governanca (invariantes preservadas)

- **Inv. 12 — so payload controlado.** O writer nao inventa fatos, nao cria
  entidades, nao chama APIs externas e **nao publica sozinho**. O payload e a
  unica fonte de verdade.
- **Inv. 13 — versionamento obrigatorio.** `prompt_version`, `input_hash`,
  `output_hash`, `model_provider`, `model_name`, `review_status` em todo bloco
  (D3.5).
- **Inv. 4 — zero Gemini no render.** Gemini so offline, atras de port
  worker-only; fake no CI (D3.4).
- **Inv. 3 — zero API externa no render.** `services/entity-writer` nao
  importavel por `apps/web`. **A regra de `audit:render` ainda precisa ser
  estendida na implementacao** para bloquear explicitamente o import de
  `services/entity-writer` e de qualquer client Gemini no render (ver R8).
- **Inv. 5 — gate anti-thin.** O writer **nao** marca pagina como `index`; nesta
  fase nao ha decisao de indexabilidade nenhuma. So produz blocos `draft`-like.
- **Inv. 7 — pt-BR primeiro.** Apenas pt-BR; en/es nem sao gerados.
- **Inv. 1, 2 — fontes de rating.** Nao aplicaveis diretamente (sem ratings na
  3A), mas a anti-copia e a proibicao de inventar nota continuam: o writer nao
  cita nota nenhuma porque o payload da 3A nao traz ratings.
- **Inv. anti-copia.** Nao copia sinopse externa; alias, a sinopse crua nem entra
  no payload (D3.7).
- **Segredos so em env.** `GEMINI_API_KEY` e `GEMINI_MODEL` so via env; nunca no
  front/bundle/versionados.
- **Publicacao nunca automatica.** Nenhuma transicao para `published` ou
  `human_reviewed`; revisao humana fica para fase posterior.

---

## 7. Testes necessarios (sem rede)

- **Schema/contrato (puro):**
  - `validateEntityWriterOutput` aceita saida flat valida (so `editorial_intro`/
    `cast_intro` + `warnings`) e rejeita formas invalidas.
  - `validateAgainstPayload` com `EntityPayload` estendido (D3.3): nome em
    `castMembers`/`director`/`cast` **passa**; nome fora do payload vira
    `fato fora do payload: <nome>`.
- **Montagem de payload (pura):** structs de entidade+creditos → `EntityPayload`
  esperado; sinopse/overview nunca entra.
- **Decisao de `review_status`:** sem warnings → `ai_generated`; com warnings de
  anti-alucinacao → `needs_review`; violacao dura (ex.: forma invalida do modelo)
  → `blocked`. **Nunca `published`** (teste de governanca).
- **Governanca de `review_status` (autopublish proibido):** teste explicito
  (`tests/governance/entity-writer-no-publish.test.ts`, secao 8) garante que o
  pipeline **nunca** persiste `content_blocks.review_status` como `published` nem
  `human_reviewed` na Fase 3A. Valores permitidos: **`ai_generated`**,
  **`needs_review`**, **`blocked`**. Qualquer tentativa de autopublish **falha** o
  teste.
- **Saida vazia (sem bloco geravel):** teste garante que `{"warnings": []}` — ou
  qualquer saida sem `editorial_intro`/`cast_intro` — **nao** gera `content_blocks`,
  leva o job a `blocked` (valida porem sem bloco util) ou `failed` (erro tecnico) e
  registra log com `validation_status = failed` e motivo em
  `warnings_json`/`error_message` (ver secao 5.3).
- **`FakeGeminiPort`:** deterministico; pipeline completo com fake **nao** toca
  rede (teste prova ausencia de chamada real). **Aviso:** o fake **nao** valida o
  contrato real de resposta do Gemini (formato/campos do provider) — isso so e
  exercitado em smoke/manual test fora do CI (ver R10/R11).
- **Log de tentativa:** uma linha em `entity_writer_logs` por tentativa,
  preenchendo `validation_status` + `warnings_json` (sucesso/warnings) ou
  `error_message` (falha) e `input_hash`/`output_hash`; o teste confirma que
  **nenhum** campo `step`/`status`/`latency_ms`/`block_type` e exigido (eles nao
  existem no schema — secao 5.5).
- **Versionamento (governanca):** todo bloco persistido tem `prompt_version`,
  `input_hash`, `output_hash`, `model_provider`, `model_name`; `model_name` vem do
  env, nao hardcoded.
- **Regeneracao (D3.6):** regenerar marca a versao anterior como `archived` e
  insere nova linha (mesmo alvo coexiste); sem update in-place.
- **Pureza de render:** apos estender a regra (R8), `audit:render` **deve** falhar
  se `apps/web` importar `services/entity-writer` ou um client Gemini.
- **Persistencia idempotente (integracao, opcional/manual):** via
  `embedded-postgres`, **fora do CI** (mesmo padrao da Fase 2). Qualquer
  validacao com Gemini real e **manual e nunca no CI**.

---

## 8. Arquivos provaveis (proxima rodada — nao criados agora)

**A criar**
- `services/entity-writer/` — `package.json`, `tsconfig.json`,
  `src/{index,types,ports}.ts`, `src/payload/build-payload.ts` (puro),
  `src/prompt/select-prompt.ts`, `src/pipeline/{generate,decide-status,hash}.ts`,
  `src/gemini/fake.ts` (FakeGeminiPort), adapters `src/persistence/*` e
  `src/gemini/adapter.ts` (excluidos do typecheck), `bin/run.ts` (excluido),
  `systemd/*.{service,timer}` (doc), testes `src/__tests__/*`.
- `tests/governance/entity-writer-no-publish.test.ts` — garante que a 3A nunca
  produz `published`/`human_reviewed` (ver secao 7).

> **`prompts/cast_intro_pt.md` NAO esta em "A criar".** Na Fase 3A o `cast_intro`
> e gerado pelo prompt combinado `entity_intro_pt.md` (ver D3.7). Um prompt proprio
> de cast so por decisao futura explicita (refactor), fora do escopo inicial.

**Alterados na Etapa 0**
- `docs/ENTITY_WRITER.md` §5 — substitui o formato aninhado `blocks: {}` pelo
  **flat canonico** (D3.2).
- `prompts/entity_intro_pt.md` — alinha entrada/saida ao contrato flat e ao recorte
  3A; **prompt combinado** que gera `editorial_intro` + `cast_intro` numa chamada.

**A alterar em etapas futuras**
- `packages/schemas/src/entity-writer-output.ts` — estender `EntityPayload`
  (D3.3) e `validateAgainstPayload` para considerar `castMembers`.
- `pnpm-workspace.yaml` / `tsconfig.json` / `vitest.config.ts` — incluir
  `services/entity-writer/**` (e excluir adapters do typecheck).
- `scripts/audit/check-render-purity.mjs` — proibir import de
  `services/entity-writer` em `apps/web`.
- `scripts/audit/check-invariants.mjs` — incluir o novo servico na varredura.
- `.env.example` — `GEMINI_API_KEY`, `GEMINI_MODEL` (worker-only).
- `services/entity-writer/README.md` — registrar runtime TS/Node + Prisma.

> Esta Etapa 0 toca somente docs/prompt. Nenhum runtime, schema/migration,
> `apps/web`, persistence, auditor ou dependencia e criado nesta rodada.

---

## 9. Criterios de aceite (da Fase 3A, quando implementada)

- [ ] Pipeline offline gera `editorial_intro` e `cast_intro` em **pt-BR** a partir
      de payload controlado.
- [ ] Contrato **flat** unico (D3.2); `docs/ENTITY_WRITER.md` e prompts alinhados;
      `blocks: {}` eliminado.
- [ ] `EntityPayload` estendido (D3.3) sem quebrar consumidores; anti-alucinacao
      reconhece `castMembers`.
- [ ] `GeminiPort` com **fake no CI**; **zero chamada Gemini no CI**; modelo via
      env (D3.4); `GEMINI_API_KEY` so em env.
- [ ] Todo bloco persistido versionado (D3.5).
- [ ] Regeneracao cria nova versao e arquiva a anterior (`archived`), sem update
      in-place (D3.6); limite de linhagem documentado, **sem migration**.
- [ ] `review_status` sempre em `ai_generated`/`needs_review`/`blocked`;
      **nunca `published`/`human_reviewed`**.
- [ ] `entity_writer_logs` com **um registro por tentativa** de geracao/validacao,
      usando **so as colunas do schema atual** (`validation_status`,
      `warnings_json`, `error_message`, `input_hash`/`output_hash`,
      `token_input`/`token_output`). **Sem** log por passo e **sem** colunas
      `step`/`status`/`latency_ms`/`block_type` (secao 5.5).
- [ ] **Zero** alteracao de `schema.prisma`/migration.
- [ ] **Zero** paginas/render/SEO/indexacao/slugs/redirects/admin/ratings/
      streaming/en/es.
- [ ] `audit:render` **estendido** (R8) e verde: bloqueia import de
      `services/entity-writer` e de client Gemini em `apps/web`.
- [ ] `pnpm typecheck/lint/test/audit:invariants/audit:render` verdes.
- [ ] Trabalho em `feat/fase-3a-entity-writer`; merge so via PR + revisao humana.

---

## 10. Riscos

- **R1 — Regressao de contrato (tres pontas).** A divergencia original (schema flat
  vs doc aninhado vs prompt bloco-unico) foi reconciliada na Etapa 0. **Mitigacao:**
  manter `packages/schemas/src/entity-writer-output.ts`, `docs/ENTITY_WRITER.md` e
  `prompts/entity_intro_pt.md` sincronizados; flat e o canonico (D3.2).
- **R2 — Anti-alucinacao e heuristica.** `validateAgainstPayload` e um gate barato
  por nomes proprios; nao captura toda alucinacao (datas, numeros, afirmacoes).
  **Mitigacao:** review_status nunca chega a `published` na 3A; revisao humana
  fica para fase posterior; warnings sempre registrados.
- **R3 — Linhagem de versao imperfeita (D3.6).** Sem `superseded_by_id`/numero de
  versao no schema, a "versao ativa" depende de convencao (`created_at` +
  `review_status != archived`). **Mitigacao:** transacao archive+insert; ponteiro
  explicito fica como proposta de schema futura (com aprovacao humana). **Sem
  migration nesta fase.**
- **R4 — Acoplamento Gemini.** Adaptador real precisa ficar worker-only e fora do
  bundle. **Mitigacao:** port/adapter + exclusao do typecheck + `audit:render`
  estendido (ver R8).
- **R5 — `model_provider` obrigatorio.** Ha CHECK SQL exigindo `model_provider`
  quando `source_type != human`. **Mitigacao:** o pipeline sempre preenche
  `model_provider`/`model_name` (de env) para blocos de IA.
- **R6 — Desvio do CLAUDE.md (workers Python).** Runtime TS para o Entity Writer
  diverge de "Workers: Python 3.12". **Mitigacao:** registrado em D3.1/D2.4 e no
  README do servico.
- **R7 — Custo/cota Gemini fora do CI.** Execucoes reais consomem cota.
  **Mitigacao:** resiliencia obrigatoria (cache/retry/backoff/rate-limit/breaker/
  logs) + execucao manual controlada; CI usa fake.
- **R8 — `audit:render` ainda nao bloqueia o writer/Gemini.** A regra atual nao
  conhece `services/entity-writer` nem um client Gemini. **Mitigacao:** a
  implementacao **deve estender** `scripts/audit/check-render-purity.mjs` para
  proibir explicitamente o import de `services/entity-writer` e de qualquer
  client/SDK Gemini no caminho de render (`apps/web`). Ate la, a pureza depende de
  disciplina, nao de gate automatizado — por isso e risco aberto, nao garantia.
- **R9 — Texto editorial raso por payload enxuto (D3.7).** A Fase 3A
  **deliberadamente** nao inclui overview/sinopse nem `genres` no payload, para
  nao copiar fonte externa e nao inventar. Efeito colateral: `editorial_intro`/
  `cast_intro` podem sair **curtos/genericos** por falta de insumo factual.
  **Mitigacao:** aceitar o trade-off nesta fase (qualidade < seguranca anti-
  alucinacao); blocos nascem `ai_generated`/`needs_review`, nunca `published`;
  enriquecer o payload (ex.: `genres`, papeis) com fonte licenciada fica para fase
  futura, com validacao correspondente.
- **R10 — Adapters fora do typecheck.** `persistence/`, `gemini/adapter.ts` e
  `bin/` ficam excluidos do `tsc` (padrao Fase 2), logo **nao** sao cobertos por
  typecheck nem testes puros do CI. **Mitigacao:** exigir **smoke/manual tests**
  desses adapters (ex.: integracao via `embedded-postgres` fora do CI; smoke do
  `GeminiAdapter` manual com chave de env) e mante-los finos (so I/O), com a logica
  no nucleo puro testado.
- **R11 — CI com fake nao valida o contrato real do Gemini.** `FakeGeminiPort`
  garante o pipeline, mas **nao** prova que a resposta real do provider casa com o
  formato esperado (campos, JSON, recusas). **Mitigacao:** smoke/manual test do
  adaptador real fora do CI antes de confiar em saida de producao; tratar
  divergencia de formato real como `blocked` + `error_message` no log.

---

## 11. Plano de implementacao (etapas pequenas)

Cada etapa = uma branch curta / um PR revisavel a partir de
`feat/fase-3a-entity-writer`, com `typecheck/lint/test/audit:invariants/
audit:render` verdes.

- **Etapa 0 — Resolver contrato (D3.2).** **Concluida nesta branch:** `docs/ENTITY_WRITER.md`
  §5 usa o formato **flat** (sem `blocks: {}`) e `prompts/entity_intro_pt.md`
  esta alinhado ao payload/saida flat. So docs/prompts; sem runtime.
- **Etapa 1 — Estender `EntityPayload` (D3.3).** Em `@screena/schemas`: adicionar
  campos opcionais e fazer `validateAgainstPayload` reconhecer `castMembers`.
  Testes puros.
- **Etapa 2 — Scaffolding do servico.** `services/entity-writer/` (package,
  tsconfig, index/types/ports), entrada no workspace/tsconfig/vitest; auditores
  proibindo import por `apps/web`. Sem logica ainda.
- **Etapa 3 — Montagem de payload (pura).** `build-payload.ts` a partir de
  structs de entidade+creditos; testes de contrato.
- **Etapa 4 — `GeminiPort` + `FakeGeminiPort`.** Interface + fake deterministico;
  selecao de prompt versionado; calculo de hashes. Testes sem rede.
- **Etapa 5 — Validacao + decisao de status.** Encadear
  `validateEntityWriterOutput` + `validateAgainstPayload`; mapear para
  `ai_generated`/`needs_review`/`blocked` (nunca `published`). Testes de
  governanca.
- **Etapa 6 — Persistencia (adapters Prisma).** Escrita em `content_blocks`
  (versionada), `entity_writer_jobs` (claim/result_block_id), `entity_writer_logs`
  (**uma linha por tentativa**, so colunas do schema atual — secao 5.5);
  regeneracao archive+insert (D3.6). Adapters excluidos do typecheck; teste de
  integracao opcional via embedded-postgres (fora do CI).
- **Etapa 7 — Runner offline.** `bin/run.ts` (excluido) + systemd doc;
  `GeminiAdapter` real worker-only. **Nao** cria `prompts/cast_intro_pt.md`: o
  `cast_intro` permanece no prompt combinado `entity_intro_pt.md` (ver D3.7); um
  prompt proprio so por decisao futura (refactor).
- **Etapa 8 — Fechamento.** README do servico, `.env.example`
  (`GEMINI_API_KEY`/`GEMINI_MODEL`), checklist de aceite (secao 9) verde. PR final
  com revisao humana; sem merge automatico.

> Nenhuma etapa cria schema/migration, paginas, render, indexacao, slugs,
> publicacao automatica ou en/es. Gemini real nunca entra no CI nem no render.
