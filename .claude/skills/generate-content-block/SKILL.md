---
name: generate-content-block
description: >-
  Roda o Entity Writer para UMA entidade: monta payload controlado a
  partir do PostgreSQL, chama o Gemini OFFLINE, recebe JSON, valida contra o
  payload (anti-alucinacao) e salva o resultado em content_blocks com status
  draft/ai_generated. NUNCA publica automaticamente. Use quando precisar gerar
  um bloco de valor editorial (editorial_intro, faq, cast_intro etc.) para
  filme, serie, temporada, episodio ou pessoa.
---

# Skill: generate-content-block

> Gerar um `content_block` com o Entity Writer, de forma controlada,
> versionada e auditavel. Esta skill descreve o PROCESSO de governanca; a forma
> da saida e a checagem anti-alucinacao vivem em `packages/schemas`
> (`validateEntityWriterOutput`, `validateAgainstPayload`).

Este documento e normativo. Qualquer execucao que contrarie estes passos esta
errada e deve ser bloqueada antes de tocar o banco.

Estado atual: o Entity Writer roda offline em **TypeScript/Node + Prisma**, com
Gemini fora do render. O slice ativo cobre principalmente `editorial_intro` e
`cast_intro` em pt-BR; demais tipos de bloco dependem de prompt versionado,
payload controlado, licenca e escopo explicitos.

---

## 0. Invariantes que esta skill faz cumprir

- **Invariante 4 — Zero Gemini no render.** O Gemini so roda OFFLINE, neste
  fluxo de geracao. Paginas publicas indexaveis NUNCA chamam IA: elas leem
  apenas `content_blocks` ja salvos e validados.
- **Invariante 12 — Entity Writer so escreve com base em payload controlado.**
  Nao inventa fatos, nao cria entidades, nao chama APIs externas, nao publica
  sozinho. A unica fonte de fatos e o payload montado a partir do PostgreSQL.
- **Invariante 13 — content_blocks sao versionados e revisaveis.**
  `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`
  e `review_status` sao obrigatorios em todo bloco gerado.

Se qualquer um destes nao puder ser garantido, NAO gere o bloco.

---

## 1. Pre-condicoes

Antes de comecar, confirme:

1. Existe um `entity_writer_jobs` para a entidade-alvo (status inicial `queued`).
   A skill claima esse job (`queued` -> `claimed` -> `running`).
2. A entidade existe no PostgreSQL e tem dados suficientes para um bloco de
   valor (ver lista de `block_type` na secao 4).
3. O idioma-alvo (`language_code`) esta definido. Lembre da invariante 7:
   **pt-BR publica primeiro; en/es nascem em draft/noindex** ate revisao humana.
4. O `prompt_version` da chamada esta fixado e registrado (nunca "ultima versao"
   implicita).

---

## 2. Montar o payload controlado (PostgreSQL -> objeto)

O payload e o CONTRATO de fatos. O Entity Writer so pode afirmar o que estiver
nele.

1. Leia da base apenas as colunas necessarias ao `block_type` pedido (ex.: para
   `cast_intro`, leia `people`/`cast_members`; para `where_to_watch_text`, leia
   `watch_availability` com `display_allowed = true`).
2. Monte um objeto plano e minimalista (ex.: `EntityPayload` em
   `packages/schemas/src/entity-writer-output.ts`: `{ director, cast }`). NUNCA
   inclua dado sem licenca clara (`license_status` em `unknown`/`blocked` ou
   `display_allowed = false`) — invariante 6.
3. Calcule `input_hash` = hash deterministico do payload serializado. Esse hash
   amarra o bloco gerado ao snapshot exato de fatos usado.
4. NAO chame nenhuma API externa (TMDB, RapidAPI, etc.) aqui. Se um fato nao
   esta no PostgreSQL, ele simplesmente nao entra no payload — e o writer nao
   pode mencionar.

Regra de ouro: **payload faltando fato = bloco sem aquele fato.** Nunca
"complete" o payload com conhecimento do modelo.

---

## 3. Chamar o Gemini OFFLINE

1. Monte o prompt a partir do template versionado correspondente ao `block_type`
   e ao `language_code`. Injete o payload controlado como unica fonte de fatos e
   instrua explicitamente: "use somente os fatos do payload; nao invente nomes,
   datas, notas ou disponibilidade de streaming".
2. Chame o Gemini em ambiente OFFLINE (servico TypeScript/Node atual ou job
   batch fora do render; Python fica como roadmap/shim), NUNCA no caminho de
   render de pagina. A chave de API vive apenas em env var, nunca no frontend.
3. Registre `model_provider` (ex.: `google`/`gemini`), `model_name` (ex.:
   `gemini-2.x`) e o `prompt_version` usados.
4. Exija saida em JSON estruturado compativel com `EntityWriterOutput`
   (`editorial_intro?`, `summary_without_spoilers?`, `ratings_explanation?`,
   `where_to_watch_text?`, `cast_intro?`, `similar_titles_intro?`, `faq?`,
   `warnings[]`).

Nao gere `ratings_explanation`, `where_to_watch_text`, `news_context` ou
`review_summary` por inferencia: ratings, streaming/onde assistir,
RSSPRIME/MN26 e reviews proprias ainda nao estao ativos como produto publico.

Nunca peca ao modelo que copie sinopse externa: bloco gerado so conta como valor
se for proprio (gate anti-thin, invariante 5).

---

## 4. Validar a saida ANTES de salvar

A validacao tem duas etapas, ambas puras (sem rede/DB), via `@screena/schemas`:

1. **Forma e tipos:** `validateEntityWriterOutput(output)` deve retornar
   `ok === true`. Se houver `errors`, descarte a saida e marque o job `failed`
   (com os erros) ou re-tente com prompt corrigido. Nao salve saida malformada.
2. **Anti-alucinacao:** `validateAgainstPayload(payload, output)` compara nomes
   proprios citados contra o payload. Cada warning `"fato fora do payload: <x>"`
   indica fato potencialmente alucinado.

Decisao sobre warnings:

- Saida com warnings de "fato fora do payload" NAO pode ir para
  `human_reviewed`/`published`. No maximo `needs_review`, com `warnings_json`
  preenchido para o revisor humano.
- A validacao detalhada de saida (incl. IMDb != Rotten, nada de afirmar
  streaming sem `watch_availability`) e responsabilidade da skill
  `validate-entity-writer-output`. Esta skill SEMPRE delega a ela antes de
  persistir.

Calcule `output_hash` = hash do JSON final aceito.

`block_type` validos (ver `content_blocks`): `editorial_intro`,
`summary_without_spoilers`, `ratings_explanation`, `where_to_watch_text`,
`cast_intro`, `similar_titles_intro`, `franchise_context`, `season_guide`,
`episode_context`, `faq`, `news_context`, `review_summary`.

Valido no schema nao significa ativo automaticamente. Para qualquer bloco fora
do slice atual, exija escopo explicito, payload controlado, licenca clara e
validacao correspondente antes de salvar.

---

## 5. Salvar em content_blocks (status draft / ai_generated)

Persista UMA linha em `content_blocks` com:

| Coluna           | Valor                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| `entity_type`    | tipo da entidade (movie, tv_show, season, episode, person).              |
| `entity_id`      | id da entidade no PostgreSQL.                                            |
| `language_code`  | idioma-alvo (pt-BR primeiro; en/es em draft/noindex).                     |
| `block_type`     | um dos tipos validos da secao 4.                                         |
| `content`        | conteudo gerado e validado.                                             |
| `source_type`    | origem do bloco (ex.: `ai_generated`).                                   |
| `model_provider` | provedor da IA (ex.: `gemini`).                                         |
| `model_name`     | nome do modelo (ex.: `gemini-2.x`).                                     |
| `prompt_version` | versao fixada do prompt (obrigatorio).                                  |
| `input_hash`     | hash do payload controlado (secao 2, obrigatorio).                      |
| `output_hash`    | hash da saida aceita (secao 4, obrigatorio).                            |
| `review_status`  | **`draft`** ou **`ai_generated`** — NUNCA `published`.                   |
| `warnings_json`  | warnings de `validateAgainstPayload` e da validacao detalhada.          |
| `published_at`   | **NULL** (publicacao e ato humano separado).                            |

Status de `review_status` permitidos nesta skill: `draft`, `ai_generated`,
`needs_review`. **Proibido** sair daqui com `human_reviewed` ou `published`.

---

## 6. Encerrar o job

1. Atualize o `entity_writer_jobs` para `completed` (sucesso) ou `failed`/
   `blocked` conforme o caso. Cancelamento manual usa `cancelled`.
2. Registre em `entity_writer_logs` a execucao: job id, `prompt_version`,
   `input_hash`, `output_hash`, `model_provider`/`model_name`, contagem de
   warnings e decisao final.
3. Nao dispare publicacao, nao toque em `page_indexability_decisions`, nao
   invalide cache de pagina. Publicacao e indexabilidade sao etapas humanas/
   automatizadas SEPARADAS desta skill.

---

## 7. Nota de governanca (resumo inegociavel)

- **Nunca publicar automaticamente.** A saida nasce em `draft`/`ai_generated`;
  so um humano move para `published`.
- **Gemini so offline.** Esta skill jamais roda no render; pagina publica le
  apenas `content_blocks` salvos (invariante 4).
- **So fatos do payload.** Qualquer afirmacao fora do payload e alucinacao e
  deve virar warning + `needs_review` (invariante 12).
- **Tudo versionado.** Sem `prompt_version`, `input_hash` e `output_hash`, o
  bloco nao pode ser salvo (invariante 13).
- **Licenca primeiro.** Dado sem licenca clara nunca entra no payload nem no
  bloco (invariante 6).
- **Delegue a validacao detalhada** a `validate-entity-writer-output` antes de
  persistir como bloco confiavel.
