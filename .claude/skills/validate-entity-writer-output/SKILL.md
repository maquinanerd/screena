---
name: validate-entity-writer-output
description: >-
  Valida a saida gerada pelo Screena Entity Writer antes de ela virar um
  content_block confiavel: confere forma/tipos via packages/schemas, detecta
  alucinacao com validateAgainstPayload, bloqueia blocos que afirmem fato fora
  do payload, garante IMDb != Rotten Tomatoes, impede afirmar streaming sem
  watch_availability e registra warnings_json + review_status. Use sempre depois
  de gerar um bloco com generate-content-block e antes de qualquer revisao
  humana ou publicacao.
---

# Skill: validate-entity-writer-output

> Validar a saida do Entity Writer (forma, tipos e anti-alucinacao) contra o
> payload controlado, aplicar as invariantes de fonte (IMDb != Rotten) e de
> streaming, e decidir o `review_status` resultante. Esta skill e o gate entre
> "JSON gerado pela IA" e "content_block que um humano pode revisar".

Documento normativo. Fonte de verdade do codigo:
`packages/schemas/src/entity-writer-output.ts` e
`packages/schemas/src/ratings.ts` (ambos reexportados por `@screena/schemas`).

---

## 0. Invariantes que esta skill faz cumprir

- **Invariante 1 — IMDb != Rotten Tomatoes.** Nunca misturar fontes, escalas,
  icones ou linguagem. Um bloco que confunda fontes e bloqueado.
- **Invariante 12 — Entity Writer nao inventa fatos.** Todo fato citado deve
  existir no payload controlado; o que estiver fora vira warning e bloqueia
  promocao do bloco.
- **Invariante 13 — content_blocks versionados e revisaveis.** A saida so e
  aceita com `warnings_json` preenchido e `review_status` coerente.
- Complementar: **nada de afirmar disponibilidade de streaming** que nao esteja
  em `watch_availability` (com `display_allowed = true`).

---

## 1. Entradas

Esta skill recebe:

1. `output` — o JSON gerado pelo Entity Writer (candidato a `EntityWriterOutput`).
2. `payload` — o MESMO payload controlado usado na geracao (a unica fonte de
   fatos permitida; ver `EntityPayload`). Se o `input_hash` do payload nao bater
   com o registrado na geracao, ABORTE: o par saida/payload e inconsistente.
3. Metadados de versao do bloco: `prompt_version`, `input_hash`, `output_hash`,
   `model_provider`, `model_name`, `block_type`, `language_code`.

Se faltar payload ou qualquer metadado de versao, a validacao falha por
governanca (invariante 13) — nao prossiga.

---

## 2. Etapa A — Forma e tipos (`validateEntityWriterOutput`)

1. Chame `validateEntityWriterOutput(output)` de `@screena/schemas`.
2. Se `ok === false`, a saida e malformada: retorne os `errors`, marque o bloco
   como rejeitado e NAO o salve como confiavel. (Quem chama deve re-gerar ou
   marcar o job `failed`.)
3. Garantias dessa checagem (puras, sem rede/DB):
   - `warnings` existe e e `string[]`;
   - campos textuais opcionais (`editorial_intro`, `summary_without_spoilers`,
     `ratings_explanation`, `where_to_watch_text`, `cast_intro`,
     `similar_titles_intro`), quando presentes, sao string;
   - `faq`, quando presente, e um array de `{ question: string, answer: string }`.

So avance para a Etapa B se `ok === true`.

---

## 3. Etapa B — Anti-alucinacao (`validateAgainstPayload`)

1. Chame `validateAgainstPayload(payload, output)` de `@screena/schemas`.
2. Cada warning no formato `"fato fora do payload: <nome>"` indica um nome
   proprio citado em `cast_intro`/`editorial_intro` que NAO existe no payload
   (`director` + `cast`).
3. Politica de bloqueio (invariante 12):
   - **Qualquer** warning de "fato fora do payload" impede que o bloco seja
     promovido a `human_reviewed`/`published`.
   - O bloco, no maximo, vai para `needs_review`, com TODOS os warnings em
     `warnings_json` para o revisor humano decidir.
4. A heuristica e barata e de primeira linha (comparacao de strings); ela NAO
   substitui revisao humana. Falsos positivos sao tratados pelo revisor, nunca
   suprimindo o warning silenciosamente.

---

## 4. Etapa C — IMDb != Rotten Tomatoes (integridade de fonte)

Quando a saida menciona notas/ratings (ex.: em `ratings_explanation`):

1. Para cada rating estruturado que acompanhe o bloco, rode `validateRating`
   (de `@screena/schemas`/`ratings.ts`). Bloqueie se:
   - a `rating_source` nao pertence a `RATING_SOURCES`;
   - a escala nao casa com `RATING_SCALES[rating_source]`;
   - ha cross-label (ex.: texto chama de "Tomatometer" uma nota atribuida ao
     IMDb) — proibido;
   - `provider_api === rating_source` ou `provider_api` e uma fonte editorial.
2. No texto livre, sinalize (warning) se a linguagem misturar marcas: "IMDb" e
   "Tomatometer"/"Popcornmeter" jamais descrevem a mesma nota; a **nota do IMDb
   nunca vira Tomatometer**. `Tomatometer`/`Popcornmeter` pertencem so ao Rotten
   Tomatoes.
3. Nada de `AggregateRating` fingindo nota propria: o bloco nunca apresenta nota
   de terceiro como autoral nem agrega fontes distintas num unico numero.

Qualquer violacao aqui e bloqueio (review_status nao pode passar de
`needs_review`/`blocked`).

---

## 5. Etapa D — Streaming so com `watch_availability`

Quando a saida afirma onde assistir (tipicamente `where_to_watch_text`):

1. Toda plataforma/forma de assistir citada DEVE corresponder a uma linha de
   `watch_availability` presente no payload, com `display_allowed = true` e
   licenca clara (invariante 6).
2. Se o texto menciona uma plataforma que NAO esta no payload de
   disponibilidade, emita warning "afirmacao de streaming sem watch_availability:
   <plataforma>" e bloqueie a promocao do bloco.
3. **Sem pirataria** (invariante 8): qualquer mencao a torrent, IPTV, player
   ilegal, link de download ou embed pirata e bloqueio imediato (`blocked`),
   nunca apenas warning.

---

## 6. Consolidar warnings e decidir review_status

1. Junte todos os warnings das Etapas A–D em `warnings_json` (forma + nomes fora
   do payload + integridade de fonte + streaming/pirataria).
2. Decida `review_status` por severidade:

| Situacao                                                              | `review_status` resultante |
| -------------------------------------------------------------------- | -------------------------- |
| Forma invalida (`validateEntityWriterOutput.ok === false`)           | rejeitar (nao salvar)      |
| Sem warnings de fato/fonte/streaming                                 | `ai_generated`             |
| Warnings de fato fora do payload, fonte ou streaming                 | `needs_review`             |
| Pirataria, fato grave fora do payload ou cross-source de rating      | `blocked`                  |

3. Em NENHUM caso esta skill marca `human_reviewed` ou `published` — promocao a
   esses estados e ato humano posterior (invariante: nunca publicar
   automaticamente).
4. Garanta que `prompt_version`, `input_hash` e `output_hash` continuam gravados
   no bloco; sem eles, a saida nao e revisavel (invariante 13) e deve ser
   rejeitada.

---

## 7. Saida desta skill

Retorne um veredito estruturado:

- `ok` — true apenas quando a forma e valida E nao ha bloqueio.
- `errors` — erros de forma/tipo (Etapa A).
- `warnings` — lista consolidada (Etapas B–D), espelhada em `warnings_json`.
- `review_status` — decisao da secao 6 (`ai_generated`, `needs_review` ou
  `blocked`; ou "rejeitar" quando a forma e invalida).

Registre o veredito em `entity_writer_logs` (com job id e hashes) para
auditoria.

---

## 8. Nota de governanca (resumo inegociavel)

- **Fato fora do payload nao passa.** Anti-alucinacao via
  `validateAgainstPayload`; warning bloqueia promocao (invariante 12).
- **IMDb != Rotten Tomatoes.** Cross-label, troca de escala ou
  `provider_api` como fonte sao bloqueio (invariantes 1 e 2).
- **Streaming so com `watch_availability`** licenciado; mencao a pirataria e
  bloqueio imediato (invariantes 6 e 8).
- **Nunca promover sozinha.** Esta skill no maximo deixa em `ai_generated`/
  `needs_review`/`blocked`; `human_reviewed`/`published` sao humanos.
- **Versionamento obrigatorio.** Sem `prompt_version`/`input_hash`/`output_hash`,
  a saida e rejeitada (invariante 13).
- **Codigo e a verdade.** Esta skill descreve o processo; as checagens puras
  vivem em `@screena/schemas` (`entity-writer-output.ts`, `ratings.ts`).
  Divergencia entre este texto e o codigo e bug — alinhe pelo codigo.
