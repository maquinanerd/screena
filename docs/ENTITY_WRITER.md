# Entity Writer — Especificação do Screen

> **As APIs fornecem os dados. Screen escreve a camada editorial.**

Este documento especifica o **Entity Writer**: o motor editorial offline que gera
**blocos editoriais evergreen** (`content_blocks`) a partir de **dados estruturados do
PostgreSQL**, usando **Gemini** apenas fora do render. É o único componente autorizado a
produzir texto editorial assistido por IA para o Screen.

Esta especificação reforça, de ponta a ponta, as invariantes **4** (_zero Gemini no
render_), **12** (_só escreve com base em payload controlado do PostgreSQL; não inventa
fatos, não cria entidades, não chama APIs externas, não publica sozinho_) e **13**
(_`content_blocks` são versionados e revisáveis_).

> **Estado atual.** A Fase 3A esta parcialmente implementada em TypeScript/Node em
> `services/entity-writer`: pipeline offline, FakeGemini para testes, adapter Gemini
> real separado do render, validacao, hashes, jobs/logs e persistencia de
> `content_blocks`. O escopo funcional atual gera apenas `editorial_intro` e
> `cast_intro` em pt-BR. Nao ha publicacao automatica.

---

## 1. O que é

O **Entity Writer** é o **motor editorial derivado do MN26**, adaptado para o mundo
_entity-first_ do Screen. Em vez de partir de feeds de notícias, ele parte da **entidade
canônica** (filme, série, temporada, episódio, pessoa) já consolidada no PostgreSQL e
produz blocos editoriais **evergreen** — textos que envelhecem bem porque descrevem a obra,
seu contexto e seu valor, e não um acontecimento datado.

Cada execução:

1. recebe um **payload controlado**, montado a partir das tabelas canônicas do
   PostgreSQL. Na **Fase 3A**, esse payload fica restrito ao recorte necessário para
   `editorial_intro` e `cast_intro`; ratings, streaming e notícias ficam para fases
   futuras;
2. chama o **Gemini offline** para gerar blocos dos tipos suportados;
3. **valida** a saída contra o payload (anti-alucinação);
4. **persiste** o resultado em `content_blocks`, versionado e auditável;
5. registra a tentativa de geração/validação em `entity_writer_logs`, usando somente as
   colunas reais do schema atual.

O Entity Writer **nunca** decide sozinho publicar, **nunca** chama APIs externas e
**nunca** roda no caminho de render de uma página pública. A IA (Gemini) só toca conteúdo
**offline**; a página pública lê apenas `content_blocks` já salvos e validados.

### Onde vive no monorepo

- **Serviço atual:** `services/entity-writer/` (TypeScript/Node, offline, fora do render).
- **Prompts versionados:** `prompts/` (ex.: `entity_intro_pt.md`, `ratings_explanation_pt.md`,
  `where_to_watch_pt.md`, `faq_entity_pt.md`).
- **Tabelas:** `content_blocks`, `entity_writer_jobs`, `entity_writer_logs`
  (ver `database/schema.md`).

---

## 2. Diferença para o MN26 News

O Entity Writer **herda do MN26** a disciplina de pipeline offline, versionamento de prompts
e geração assistida por IA — mas opera sobre um **insumo diferente** e produz um **artefato
diferente**.

| Aspecto         | **MN26 News**                              | **Entity Writer**                                  |
| --------------- | ------------------------------------------ | -------------------------------------------------- |
| Insumo          | RSS/feeds externos (`RSSPRIME`)            | **PostgreSQL** (tabelas canônicas da entidade)     |
| Etapa central   | `RSSPRIME → clusters → articles`           | `PostgreSQL → payload → Gemini → content_blocks`   |
| Natureza        | Notícia datada (perecível)                 | **Editorial evergreen** (descreve a obra)          |
| Saída           | `articles` / `news_clusters`               | `content_blocks` (por entidade, tipo e idioma)     |
| Disparo         | Chegada de feed                            | Job em `entity_writer_jobs`                         |
| Fonte de fatos  | Texto do feed                              | **Apenas o payload controlado do PostgreSQL**      |

Fluxo de cada um, lado a lado:

```
MN26 News:       RSSPRIME ──▶ clusters ──▶ articles
Entity Writer:   PostgreSQL ──▶ payload ──▶ Gemini ──▶ content_blocks
```

A diferença mais importante: o **MN26 News** lê texto livre de feeds; o **Entity Writer**
**só** enxerga o que está no payload montado a partir do banco. Ele não tem acesso à
internet, não vê a sinopse "crua" de uma API e não pode descobrir fatos novos — se um dado
não está no payload, ele **não existe** para o Entity Writer.

---

## 3. Fluxo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. payload controlado    (montado a partir do PostgreSQL — tabelas canônicas) │
│        │                                                                       │
│ 2. Gemini (offline)      (gera os blocos a partir SOMENTE do payload)         │
│        │                                                                       │
│ 3. JSON                  (saída estritamente no formato esperado)             │
│        │                                                                       │
│ 4. validação vs payload  (cada fato citado precisa existir no payload)        │
│        │                                                                       │
│ 5. bloqueio de alucinação (divergência ⇒ warnings + needs_review/blocked)     │
│        │                                                                       │
│ 6. content_blocks        (persistência versionada e auditável)                │
│        │                                                                       │
│ 7. gate anti-thin        (≥ 2 blocos de valor próprios para indexar)          │
│        │                                                                       │
│ 8. noindex / publish     (decisão registrada em page_indexability_decisions)  │
│        │                                                                       │
│ 9. revisão humana        (obrigatória para páginas prioritárias e en/es)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Detalhamento das etapas:**

1. **Payload controlado.** O worker consome um job de `entity_writer_jobs`, resolve a
   entidade e monta um payload **somente** a partir do PostgreSQL. Na **Fase 3A**, o
   payload usado pelo contrato atual contém `director` e `cast`; campos contextuais
   opcionais podem ser adicionados em etapa própria, desde que continuem controlados e
   validados. **Nenhuma chamada externa** ocorre aqui.
2. **Gemini (offline).** O prompt versionado da fase é resolvido em `prompts/`, combinado
   com o payload, e enviado ao Gemini **fora do render**. O modelo só pode usar o que está
   no payload.
3. **JSON.** O Gemini responde **exclusivamente** em JSON válido, no formato da seção 5.
   Qualquer coisa fora do JSON é descartada.
4. **Validação vs payload.** Na Fase 3A, os nomes citados em `editorial_intro` e
   `cast_intro` são conferidos contra `director` e `cast`. Validações de nota,
   plataforma, overview/sinopse, gêneros e fatos mais ricos ficam para fases futuras,
   quando esses campos entrarem no payload controlado.
5. **Bloqueio de alucinação.** Se a validação encontra fato que **não existe** no payload,
   o bloco recebe `warnings_json` e vai para `needs_review` ou `blocked`. **Não publica.**
6. **content_blocks.** O bloco aprovado é persistido com versionamento completo
   (`prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`,
   `review_status`) — invariante 13.
7. **Gate anti-thin.** Fora da Fase 3A. Antes de qualquer indexação futura, a página
   precisa de **≥ 2 blocos de valor próprios** além do dado cru de API (invariante 5; ver
   seção 11).
8. **noindex / publish.** Fora da Fase 3A. A decisão de indexabilidade futura é registrada
   em `page_indexability_decisions` (`index | noindex | draft | stale | blocked`).
9. **Revisão humana.** Publicação fica fora da Fase 3A. Páginas prioritárias e todo
   conteúdo `en`/`es` nascem em `draft`/`noindex` e só publicam após **revisão humana**
   (invariante 7).

---

## 4. Payload controlado

O payload é sempre montado a partir do PostgreSQL. O Entity Writer **só** pode usar o que
está nesse payload; qualquer fato ausente deve ser omitido ou registrado em `warnings`.

Na **Fase 3A / Etapa 0**, o contrato textual acompanha o `EntityPayload` atual de
`@screena/schemas`:

```json
{
  "director": "Denis Villeneuve",
  "cast": [
    "Timothée Chalamet",
    "Zendaya",
    "Rebecca Ferguson",
    "Javier Bardem"
  ]
}
```

Campos contextuais opcionais (por exemplo `entityType`, `title`, `year`,
`runtimeMinutes`, `languageCode` e `castMembers`) podem entrar em etapa posterior da Fase
3A, junto com a extensão correspondente de `EntityPayload` e dos testes. Enquanto isso, o
prompt **não** deve exigir esses campos.

Ficam **fora da Fase 3A** como insumo do writer:

- ratings externos (`imdb_rating`, Rotten Tomatoes, Metacritic etc.);
- disponibilidade/streaming (`watch_availability`, onde assistir);
- slugs, URLs públicas, redirects e páginas;
- overview/sinopse crua, `tmdb_summary` e cópia de texto externo;
- gêneros, franquias, similares, notícias e reviews;
- idiomas `en`/`es`.

---

## 5. Saída JSON obrigatória

O Gemini responde **exclusivamente** em JSON válido. O contrato canônico é o
`EntityWriterOutput` de `packages/schemas/src/entity-writer-output.ts`: **flat**, com campos
de bloco no topo do objeto e `warnings` obrigatório. O formato aninhado `blocks: {}` **não**
é contrato de saída.

Na **Fase 3A**, a saída permitida fica restrita a `editorial_intro`, `cast_intro` e
`warnings`:

```json
{
  "editorial_intro": "Introdução editorial própria em pt-BR, curta, factual e sem spoiler.",
  "cast_intro": "Apresentação comentada do elenco, baseada apenas em director e cast.",
  "warnings": [
    "string — dados faltantes, ambiguidades ou qualquer fato que o modelo não conseguiu sustentar no payload"
  ]
}
```

**Regras da saída:**

- Nada fora do JSON. Sem markdown, sem comentários, sem texto de moldura.
- Não incluir `entity_type`, `entity_id`, `language_code`, `block_type`, `content` nem
  `blocks`. Esses dados pertencem ao job/persistência, não ao `EntityWriterOutput` flat.
- `warnings` é **sempre** um array (pode ser `[]`). Quando há dado faltante, ambiguidade ou
  tentativa de citar fato fora do payload, o aviso alimenta o bloqueio de alucinação e o
  `warnings_json` do bloco.
- Campos ausentes no payload **não** geram texto. Dado que falta **não** é mencionado.
- Campos do contrato que existem em `EntityWriterOutput`, mas ficam fora da Fase 3A
  (`summary_without_spoilers`, `ratings_explanation`, `where_to_watch_text`,
  `similar_titles_intro`, `faq`), continuam opcionais e **não** devem ser exigidos pelo
  prompt da 3A.
- **Saída sem nenhum bloco textual** (ex.: `{"warnings": []}` sem `editorial_intro`
  nem `cast_intro`) é **inválida para persistência**: o pipeline **não** gera
  `content_blocks`. O job vai para `blocked` (saída formalmente válida, porém sem
  bloco útil) ou `failed` (erro técnico/parsing/modelo), e a tentativa é registrada
  em `entity_writer_logs` com `validation_status = failed` e o motivo em
  `warnings_json`/`error_message`. Esse comportamento é exigido como teste na
  implementação (ver o plano da fase).

---

## 6. Tipos de bloco

O `block_type` de cada `content_block` é um destes valores canônicos. Na **Fase 3A**,
apenas `editorial_intro` e `cast_intro` são gerados; os demais permanecem para fases
posteriores.

| `block_type`               | Conteúdo                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `editorial_intro`          | Introdução editorial própria da entidade.                            |
| `summary_without_spoilers` | Resumo do enredo **sem spoilers**.                                   |
| `ratings_explanation`      | Explicação das notas externas, cada uma **atribuída** à sua fonte.   |
| `where_to_watch_text`      | Texto de onde assistir, baseado em `watch_availability`.             |
| `cast_intro`               | Apresentação comentada do elenco.                                   |
| `similar_titles_intro`     | Introdução a obras parecidas.                                       |
| `franchise_context`        | Contexto de franquia/coleção.                                       |
| `season_guide`             | Guia de temporadas (séries).                                        |
| `episode_context`          | Contexto de episódio (séries).                                       |
| `faq`                      | Perguntas e respostas úteis (vira `FAQPage` só se visível).         |
| `news_context`             | Contexto de notícias relacionadas.                                   |
| `review_summary`           | Resumo de review própria do Screen.                             |

> A diferenciação **filme vs. série** nunca depende só da cor: o bloco respeita o
> `entity_type` do payload e a linguagem correta (label + badge + breadcrumb + schema + URL).

---

## 7. Tabela `content_blocks`

Armazena cada bloco editorial gerado, versionado e auditável (invariante 13).

| Coluna           | Descrição                                                                       |
| ---------------- | ------------------------------------------------------------------------------- |
| `id`             | Identificador do bloco.                                                          |
| `entity_type`    | Tipo da entidade (`movie`, `tv_show`, `season`, `episode`, `person`).           |
| `entity_id`      | Entidade à qual o bloco pertence.                                               |
| `language_code`  | Idioma do bloco (`pt-BR`, `en`, `es`).                                          |
| `block_type`     | Tipo do bloco (ver seção 6).                                                    |
| `content`        | Texto do bloco.                                                                 |
| `source_type`    | Origem (`ai`, `human`, `hybrid`).                                               |
| `model_provider` | Provedor do modelo (ex.: `google`).                                            |
| `model_name`     | Nome/versão do modelo (ex.: `gemini-...`).                                     |
| `prompt_version` | Versão do prompt usado (rastreável em `prompts/`).                             |
| `input_hash`     | Hash do payload de entrada (auditoria).                                         |
| `output_hash`    | Hash da saída gerada (auditoria).                                              |
| `review_status`  | Estado de revisão (ver estados de bloco abaixo).                               |
| `warnings_json`  | Avisos/divergências detectados na geração e validação.                         |
| `published_at`   | Data de publicação (quando aplicável).                                         |
| `created_at`     | Criação.                                                                        |
| `updated_at`     | Última atualização.                                                            |

**Estados de bloco (`review_status`):** `draft`, `ai_generated`, `needs_review`,
`human_reviewed`, `published`, `needs_update`, `blocked`, `archived`. Na Fase 3A, blocos
gerados por IA podem nascer apenas como `ai_generated`, `needs_review` ou `blocked`;
`published` exige fluxo futuro e revisão humana.

---

## 8. Tabela `entity_writer_jobs`

Fila de trabalho do Entity Writer.

**Estados (`status`):**

| Status      | Significado                                                       |
| ----------- | ---------------------------------------------------------------- |
| `queued`    | Job enfileirado, aguardando processamento.                      |
| `claimed`   | Worker reivindicou o job (evita processamento duplicado).       |
| `running`   | Geração/validação em andamento.                                 |
| `completed` | Bloco(s) gerado(s), validado(s) e persistido(s) com sucesso.    |
| `failed`    | Falha técnica (ex.: erro de modelo, timeout) — elegível a retry.|
| `blocked`   | Bloqueado por validação/licença/alucinação — **não publica**.   |
| `cancelled` | Cancelado (manual ou por superseção).                           |

> **Resiliência obrigatória:** cache, retry com backoff, rate-limit do provedor de IA,
> circuit-breaker e logs. Um `failed` transitório é re-tentável; um `blocked` exige decisão
> humana.

---

## 9. Tabela `entity_writer_logs`

Na Fase 3A sem migration, `entity_writer_logs` registra **uma tentativa de
geração/validação por job**, usando somente as colunas reais do schema atual. Não existe
log por passo no schema atual.

| Coluna | Descrição |
| --- | --- |
| `id` | Identificador do log. |
| `job_id` | Job de `entity_writer_jobs` que originou a tentativa. |
| `entity_type` | Tipo da entidade processada. |
| `entity_id` | Entidade processada. |
| `language_code` | Idioma da tentativa (`pt-BR` na Fase 3A). |
| `model_provider` | Provedor do modelo, quando a tentativa chega à chamada de IA. |
| `model_name` | Modelo usado, quando disponível. |
| `prompt_version` | Versão do prompt resolvido. |
| `input_hash` | Hash do payload controlado de entrada. |
| `output_hash` | Hash da saída gerada, quando houve saída. |
| `token_input` | Uso de tokens de entrada quando o provider informar. |
| `token_output` | Uso de tokens de saída quando o provider informar. |
| `validation_status` | Resultado da validação (`passed`, `warnings` ou `failed`). |
| `warnings_json` | Warnings de forma + anti-alucinação serializados. |
| `error_message` | Mensagem de erro técnico quando a tentativa falha. |
| `created_at` | Carimbo de tempo da tentativa. |

As colunas `step`, `status`, `latency_ms` e `block_type` **não existem** em
`entity_writer_logs`. `block_type` pertence a `content_blocks`; métricas de latência por
passo exigiriam migration futura e ficam fora da Fase 3A.

---

## 10. As 12 regras obrigatórias do Entity Writer

Estas regras são **inegociáveis** e materializam as invariantes 4, 12 e 13.

Na **Fase 3A**, as regras de ratings, streaming, indexação e publicação permanecem como
governança geral, mas esses recursos não entram no payload, no prompt nem na saída. A 3A
gera apenas `editorial_intro` e `cast_intro` em pt-BR, sem páginas públicas, slugs,
indexação, overview/sinopse, en/es ou publicação automática.

1. **Só payload.** Escreve **somente** com base no payload controlado vindo do PostgreSQL.
   Se um dado não está no payload, ele não existe.
2. **Não inventa.** Não inventa notas, elenco, diretores, temporadas nem plataformas — nada
   que não esteja explicitamente no payload.
3. **Não copia sinopses longas.** Reescreve com voz editorial própria; nunca reproduz a
   sinopse externa (ex.: `tmdb_summary`) como texto.
4. **Não afirma streaming sem `watch_availability`.** Disponibilidade por país/plataforma só
   é afirmada se houver entrada correspondente em `watch_availability`.
5. **Não mistura IMDb com Rotten Tomatoes.** Fontes, escalas, ícones e linguagem permanecem
   separados (invariante 1).
6. **Não transforma IMDb em Tomatometer.** A nota do IMDb (escala 10) **nunca** vira
   Tomatometer/Popcornmeter, que pertencem só ao Rotten Tomatoes.
7. **Não usa `provider_api` como fonte editorial.** O fornecedor técnico (ex.: RapidAPI)
   nunca é citado como fonte ou voz editorial (`provider_api != rating_source`, invariante 2).
8. **Não cria `AggregateRating` próprio sem permissão.** Nenhuma nota agregada "própria"
   fingindo avaliação do Screen; `AggregateRating` só quando permitido e corretamente
   atribuído.
9. **Não publica automaticamente.** O Entity Writer nunca publica sozinho — publicação é
   decisão de fluxo com revisão (invariante 12).
10. **Salva tudo versionado.** Todo bloco é persistido com `prompt_version`, `input_hash`,
    `output_hash`, `model_provider`, `model_name` e `review_status` (invariante 13).
11. **Gate anti-thin antes de indexar.** Nenhuma página indexa sem **≥ 2 blocos de valor
    próprios** além do dado cru de API (invariante 5; seção 11).
12. **Exige revisão humana para páginas prioritárias.** Conteúdo prioritário e todo `en`/`es`
    nascem em `draft`/`noindex` e só publicam após **revisão humana** (invariante 7).

---

## 11. Regra de indexação (gate anti-thin)

Uma página **só indexa** quando tem **≥ 2 blocos de valor próprios** além do dado cru de API
(invariante 5). Um bloco gerado por IA **só conta como valor** se:

- veio de **payload controlado** do PostgreSQL;
- passou pela **validação anti-alucinação**;
- está **salvo** em `content_blocks`;
- tem `prompt_version` e `input_hash`;
- **não** copia sinopse externa;
- tem `review_status` permitido.

**Blocos de valor aceitos** (cada um conta como 1, respeitadas as condições acima):

1. introdução editorial própria
2. onde assistir por país
3. ratings externos atribuídos
4. comparação crítica vs. audiência
5. review própria
6. notícias relacionadas
7. FAQ útil
8. trailer incorporado
9. elenco comentado
10. contexto de franquia
11. ordem cronológica
12. guia de temporadas
13. obras parecidas
14. histórico de atualização
15. análise sem/com spoiler separada

**Combinações válidas (exemplos de "≥ 2 blocos de valor"):**

- **Filme:** `editorial_intro` + `ratings_explanation` (introdução própria + notas
  atribuídas) ⇒ **indexa**.
- **Filme com streaming:** `where_to_watch_text` (baseado em `watch_availability`) +
  `cast_intro` ⇒ **indexa**.
- **Série:** `season_guide` + `editorial_intro` ⇒ **indexa**.
- **Página fina:** apenas dado cru de API, sem bloco próprio, **ou** um único bloco ⇒
  **`noindex`** (decisão registrada em `page_indexability_decisions`).

A decisão final é gravada em `page_indexability_decisions`
(`index | noindex | draft | stale | blocked`).

---

## 12. Invariantes reforçadas

Este documento existe para reforçar, sem reescrever o sentido:

- **Invariante 4 — Zero Gemini no render.** A IA só gera `content_blocks` **offline**,
  salvos e validados. Nenhuma chamada ao Gemini acontece durante a renderização de uma
  página pública.
- **Invariante 12 — Entity Writer só escreve com payload controlado.** Não inventa fatos,
  não cria entidades, não chama APIs externas e **não publica sozinho**.
- **Invariante 13 — `content_blocks` são versionados e revisáveis.** `prompt_version`,
  `input_hash`, `output_hash`, `model_provider`, `model_name` e `review_status` são
  **obrigatórios** em todo bloco.

---

## 13. Notas de fase

- **Fase 3A / Etapa 0 (agora):** apenas reconciliação documental do contrato flat e do
  prompt `entity_intro_pt.md`. Sem runtime, sem cliente Gemini, sem schema/migration, sem
  `apps/web`, sem dependências novas e sem publicação.
- **Fase 3A (implementação futura):** pipeline offline que gera somente `editorial_intro`
  e `cast_intro` em pt-BR, persiste em `content_blocks`, registra uma tentativa em
  `entity_writer_logs` e nunca nasce com `review_status = published`.
- **Fases posteriores:** ratings, streaming/onde assistir, slugs, páginas públicas,
  indexação, overview/sinopse, `en`/`es`, FAQ, similares, franquias, notícias, reviews e
  qualquer publicação editorial.
