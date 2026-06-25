# Screena Entity Writer — Especificação

> **As APIs fornecem os dados. A Screena escreve a camada editorial.**

Este documento especifica o **Screena Entity Writer**: o motor editorial offline que gera
**blocos editoriais evergreen** (`content_blocks`) a partir de **dados estruturados do
PostgreSQL**, usando **Gemini** apenas fora do render. É o único componente autorizado a
produzir texto editorial assistido por IA na Screena.

Esta especificação reforça, de ponta a ponta, as invariantes **4** (_zero Gemini no
render_), **12** (_só escreve com base em payload controlado do PostgreSQL; não inventa
fatos, não cria entidades, não chama APIs externas, não publica sozinho_) e **13**
(_`content_blocks` são versionados e revisáveis_).

> **Fase 0.** Este é um documento de especificação. **Não** há implementação real,
> migrations, cliente Gemini funcional ou worker rodando nesta fase. O que segue define o
> contrato que a Fase 1+ deve cumprir.

---

## 1. O que é

O **Entity Writer** é o **motor editorial derivado do MN26**, adaptado para o mundo
_entity-first_ da Screena. Em vez de partir de feeds de notícias, ele parte da **entidade
canônica** (filme, série, temporada, episódio, pessoa) já consolidada no PostgreSQL e
produz blocos editoriais **evergreen** — textos que envelhecem bem porque descrevem a obra,
seu contexto e seu valor, e não um acontecimento datado.

Cada execução:

1. recebe um **payload controlado**, montado a partir das tabelas canônicas (entidade,
   elenco, ratings atribuídos, disponibilidade, notícias relacionadas);
2. chama o **Gemini offline** para gerar blocos dos tipos suportados;
3. **valida** a saída contra o payload (anti-alucinação);
4. **persiste** o resultado em `content_blocks`, versionado e auditável;
5. registra cada passo em `entity_writer_logs`.

O Entity Writer **nunca** decide sozinho publicar, **nunca** chama APIs externas e
**nunca** roda no caminho de render de uma página pública. A IA (Gemini) só toca conteúdo
**offline**; a página pública lê apenas `content_blocks` já salvos e validados.

### Onde vive no monorepo

- **Worker:** `services/entity-writer/` (worker Python 3.12, agendado por systemd timers).
- **Prompts versionados:** `prompts/` (ex.: `entity_intro_pt.md`, `ratings_explanation_pt.md`,
  `where_to_watch_pt.md`, `faq_entity_pt.md`).
- **Tabelas:** `content_blocks`, `entity_writer_jobs`, `entity_writer_logs`
  (ver `database/schema.md`).

---

## 2. Diferença para o MN26 News

O Entity Writer **herda do MN26** a disciplina de pipeline offline, versionamento de prompts
e geração assistida por IA — mas opera sobre um **insumo diferente** e produz um **artefato
diferente**.

| Aspecto         | **MN26 News**                              | **Screena Entity Writer**                          |
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
   entidade e monta um payload **somente** a partir do PostgreSQL: ficha da entidade,
   elenco, ratings **atribuídos** (com fonte, escala e licença), disponibilidade por país e
   notícias relacionadas. **Nenhuma chamada externa** ocorre aqui.
2. **Gemini (offline).** O prompt versionado correspondente ao `block_type` é resolvido em
   `prompts/`, combinado com o payload, e enviado ao Gemini **fora do render**. O modelo só
   pode usar o que está no payload.
3. **JSON.** O Gemini responde **exclusivamente** em JSON válido, no formato da seção 5.
   Qualquer coisa fora do JSON é descartada.
4. **Validação vs payload.** Cada nome, data, número, nota, plataforma e fato citado é
   conferido contra o payload. Notas externas precisam bater em **fonte, escala e valor**.
   Sinopses longas externas não podem ser copiadas.
5. **Bloqueio de alucinação.** Se a validação encontra fato que **não existe** no payload,
   nota com fonte/escala trocada, mistura de IMDb com Rotten Tomatoes, ou streaming afirmado
   sem `watch_availability`, o bloco recebe `warnings_json` e vai para `needs_review` ou
   `blocked`. **Não publica.**
6. **content_blocks.** O bloco aprovado é persistido com versionamento completo
   (`prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`,
   `review_status`) — invariante 13.
7. **Gate anti-thin.** Antes de qualquer indexação, a página precisa de **≥ 2 blocos de
   valor próprios** além do dado cru de API (invariante 5; ver seção 11).
8. **noindex / publish.** A decisão de indexabilidade é registrada em
   `page_indexability_decisions` (`index | noindex | draft | stale | blocked`). Sem 2
   blocos de valor, a página recebe `noindex`.
9. **Revisão humana.** Publicação exige `review_status` permitido. Páginas prioritárias e
   todo conteúdo `en`/`es` nascem em `draft`/`noindex` e só publicam após **revisão humana**
   (invariante 7).

---

## 4. Exemplo de payload

Payload de exemplo para um **filme**. Todos os campos são montados a partir do PostgreSQL;
o Entity Writer **só** pode usar o que está aqui.

```json
{
  "entity_type": "movie",
  "entity_id": "mv_0abc123",
  "language_code": "pt-BR",
  "title": "Duna: Parte Dois",
  "year": 2024,
  "director": "Denis Villeneuve",
  "cast": [
    "Timothée Chalamet",
    "Zendaya",
    "Rebecca Ferguson",
    "Javier Bardem"
  ],
  "genres": ["Ficção científica", "Aventura", "Drama"],
  "runtime_minutes": 166,
  "tmdb_summary": "Paul Atreides se une aos Fremen em uma jornada de vingança contra os conspiradores que destruíram sua família.",
  "imdb_rating": {
    "value": 8.5,
    "scale": 10,
    "source": "imdb",
    "url": "https://www.imdb.com/title/tt15239678/",
    "fetched_at": "2026-06-20T03:00:00Z"
  },
  "rotten_tomatometer": {
    "value": 92,
    "scale": 100,
    "source": "rotten_tomatoes",
    "metric": "tomatometer",
    "url": "https://www.rottentomatoes.com/m/dune_part_two",
    "fetched_at": "2026-06-20T03:00:00Z"
  },
  "watch_availability": [
    {
      "country": "BR",
      "platform": "Max",
      "modality": "subscription",
      "url": "https://www.max.com/br",
      "license_status": "licensed",
      "display_allowed": true
    },
    {
      "country": "BR",
      "platform": "Apple TV",
      "modality": "rent",
      "url": "https://tv.apple.com/br",
      "license_status": "official",
      "display_allowed": true
    }
  ]
}
```

**Notas de uso do payload:**

- `tmdb_summary` é **referência de fato**, não texto para copiar. O bloco reescreve com voz
  própria, sem reproduzir a sinopse externa (invariante anti-cópia).
- `imdb_rating` e `rotten_tomatometer` são **fontes distintas** (invariante 1). Nunca somar,
  nunca converter uma na outra, nunca chamar a nota do IMDb de "Tomatometer".
- `watch_availability` é a **única** base para afirmar onde assistir. Sem entrada para um
  país/plataforma, **não** se afirma disponibilidade ali. Itens com `display_allowed=false`
  ou `license_status` `unknown`/`blocked` **não** entram em texto indexável (invariante 6).
- O `provider_api` (fornecedor técnico) **não** aparece no payload editorial como fonte —
  ele nunca é citado como voz ou autoridade (invariante 2).

---

## 5. Saída JSON obrigatória

O Gemini responde **exclusivamente** em JSON válido. A forma canônica para um payload de
filme cobre os blocos abaixo. Cada execução pode pedir um subconjunto, mas o formato de cada
bloco é fixo.

```json
{
  "entity_type": "movie",
  "entity_id": "mv_0abc123",
  "language_code": "pt-BR",
  "blocks": {
    "editorial_intro": "Introdução editorial própria, 1–2 parágrafos, sem spoiler, sem clichê de IA.",
    "summary_without_spoilers": "Resumo do enredo sem revelar reviravoltas, com voz editorial própria.",
    "ratings_explanation": "Explicação das notas externas, cada uma atribuída à sua fonte e escala, sem misturar IMDb e Rotten Tomatoes.",
    "where_to_watch_text": "Texto sobre onde assistir, baseado SOMENTE em watch_availability, por país e modalidade.",
    "cast_intro": "Apresentação comentada do elenco principal, com base apenas nos nomes do payload.",
    "similar_titles_intro": "Introdução a obras parecidas, sem inventar títulos fora do payload."
  },
  "faq": [
    {
      "question": "Onde assistir Duna: Parte Dois no Brasil?",
      "answer": "Resposta baseada apenas em watch_availability (Max por assinatura; Apple TV por aluguel)."
    },
    {
      "question": "Qual a nota de Duna: Parte Dois no IMDb?",
      "answer": "8,5/10 no IMDb (fonte atribuída, escala explícita)."
    }
  ],
  "warnings": [
    "string — dados faltantes, ambiguidades ou qualquer divergência detectada na geração"
  ]
}
```

**Regras da saída:**

- Nada fora do JSON. Sem markdown, sem comentários, sem texto de moldura.
- `faq` só vira `FAQPage` no schema se as perguntas/respostas forem **visíveis** na página.
- `warnings` é **sempre** preenchido quando há dado faltante ou ambiguidade — ele alimenta o
  bloqueio de alucinação e o `warnings_json` do bloco.
- Campos ausentes no payload **não** geram texto. Dado que falta **não** é mencionado.

---

## 6. Tipos de bloco

O `block_type` de cada `content_block` é um destes valores canônicos:

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
| `review_summary`           | Resumo de review própria da Screena.                                |

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
| `source_type`    | Origem (`ai_generated`, `human`, etc.).                                         |
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
`human_reviewed`, `published`, `needs_update`, `blocked`, `archived`. A publicação exige
um estado permitido e **revisão humana** nos casos prioritários e em `en`/`es`.

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

Log de execução, um registro por passo relevante do pipeline (auditoria de ponta a ponta).

| Coluna           | Descrição                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| `id`             | Identificador do log.                                                  |
| `job_id`         | Job de `entity_writer_jobs` ao qual o passo pertence.                 |
| `entity_type`    | Tipo da entidade processada.                                          |
| `entity_id`      | Entidade processada.                                                   |
| `block_type`     | Tipo de bloco sendo gerado (quando aplicável).                        |
| `step`           | Etapa do pipeline (`payload`, `generate`, `validate`, `persist`, …).  |
| `status`         | Resultado do passo (`ok`, `warning`, `error`, `blocked`).            |
| `model_provider` | Provedor do modelo na chamada (quando aplicável).                     |
| `model_name`     | Modelo na chamada (quando aplicável).                                 |
| `prompt_version` | Versão do prompt usado.                                               |
| `input_hash`     | Hash do payload (correlação com o bloco).                            |
| `output_hash`    | Hash da saída (correlação com o bloco).                              |
| `warnings_json`  | Avisos/divergências do passo.                                         |
| `latency_ms`     | Duração do passo, para observabilidade.                              |
| `created_at`     | Carimbo de tempo do registro.                                        |

---

## 10. As 12 regras obrigatórias do Entity Writer

Estas regras são **inegociáveis** e materializam as invariantes 4, 12 e 13.

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
   fingindo avaliação da Screena; `AggregateRating` só quando permitido e corretamente
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

- **Fase 0 (agora):** apenas esta especificação e os esqueletos em `services/entity-writer/`
  e `prompts/`. Sem cliente Gemini funcional, sem worker rodando, sem schema real.
- **Fase 1+:** worker Python 3.12 implementado, prompts versionados conectados, tabelas
  reais (`content_blocks`, `entity_writer_jobs`, `entity_writer_logs`) e o pipeline completo
  de geração → validação → gate anti-thin → revisão → publicação.
