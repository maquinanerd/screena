# Regras do Entity Writer

> Documento canonico de regras para o **Entity Writer** (o agente de
> redacao editorial assistida por IA). Em portugues (pt-BR). Codigo e
> identificadores permanecem em ingles. Estas regras valem para qualquer
> execucao do writer, em qualquer entidade (filme, serie, temporada,
> episodio, pessoa) e em qualquer idioma (pt-BR primeiro; en/es publicam quando
> completos, via `PUBLISHED_LOCALES`).

Estado atual: o Entity Writer roda **offline em TypeScript/Node + Prisma**,
com adapter Gemini separado do render. O slice ativo de geracao editorial cobre
principalmente `editorial_intro` e `cast_intro` em pt-BR; demais `block_type`
listados abaixo sao contratos/roadmap ate haver prompt, payload, validacao,
licenca e revisao humana explicitos.

## 1. Proposito e limite do agente

O Entity Writer **redige** blocos de conteudo editorial. Ele **nao decide a
verdade factual**: a verdade vem exclusivamente do PostgreSQL. A Gemini (ou
qualquer modelo) escreve o texto, mas **nunca** estabelece, corrige ou
"completa" um fato. Se o fato nao esta no payload controlado, ele nao existe
para o writer.

Regra-mestra (invariante 12): **o Entity Writer so escreve com base no
payload controlado do PostgreSQL.** Ele nao inventa fatos, nao cria
entidades, nao chama APIs externas e nao publica sozinho.

## 2. Fonte unica de verdade: o payload controlado

- Toda redacao parte de um **payload controlado** montado a partir do
  PostgreSQL (entidade, relacoes e, quando a feature estiver ativa e licenciada,
  ratings atribuidos/disponibilidade/licencas). O writer **nao** consulta o banco diretamente, nao acessa rede,
  nao le APIs e nao usa "conhecimento de mundo" do modelo como fonte.
- O contrato de saida e a validacao anti-alucinacao de primeira linha vivem
  em [`packages/schemas/src/entity-writer-output.ts`](../../packages/schemas/src/entity-writer-output.ts).
  Em especial:
  - `EntityPayload` — subconjunto controlado do PostgreSQL (ex.: `director`,
    `cast`) que define os **unicos** nomes/fatos permitidos.
  - `EntityWriterOutput` — forma da saida (blocos textuais opcionais +
    `warnings[]` obrigatorio).
  - `validateEntityWriterOutput(output)` — valida forma e tipos.
  - `validateAgainstPayload(payload, output)` — gate barato anti-alucinacao:
    todo nome proprio citado em `editorial_intro`/`cast_intro` que **nao**
    exista no payload vira o warning `fato fora do payload: <nome>`.
- Qualquer divergencia entre o que o modelo escreveu e o payload e tratada
  como **alucinacao**: gera warning e bloqueia indexacao ate revisao humana.
  A validacao automatica **nao substitui** revisao humana — e apenas a
  primeira linha de defesa.

## 3. O que o Entity Writer NUNCA faz (proibicoes factuais)

O writer **nao inventa** nem deduz, em hipotese alguma:

- **Notas / ratings.** Nao cria, estima ou arredonda nota. So usa valores que
  ja vieram do payload com `rating_source` e `rating_value` definidos.
- **Elenco e equipe.** Nao adiciona, completa ou corrige nomes de elenco,
  diretores ou roteiristas. So cita quem esta em `cast`/`director` no payload.
- **Temporadas e episodios.** Nao inventa numero de temporadas, contagem de
  episodios, titulos ou datas que nao estejam no payload.
- **Plataformas e disponibilidade.** Nao afirma que algo "esta na Netflix /
  Prime / Max" sem uma `watch_availability` confirmada no payload, com pais e
  `display_allowed` validos. Sem disponibilidade confirmada, o texto descreve
  a ausencia ("ainda nao confirmado") ou omite — nunca afirma streaming.
- **Entidades.** Nao cria filme, serie, pessoa, franquia ou plataforma que
  nao exista. Nao "liga" entidades por conta propria.
- **Datas, premios, bilheteria, fatos historicos** ausentes do payload.

Se faltar dado para um bloco, o writer **omite o bloco** ou registra a lacuna
em `warnings` — nunca preenche com suposicao.

## 4. Nao copiar sinopses externas

- O writer **nao copia literalmente** sinopses longas (de TMDB, IMDb,
  estudios, imprensa ou qualquer fonte). Conteudo proprio = redacao original.
- Resumos sem spoiler (`summary_without_spoilers`) sao **reescritos** com voz
  editorial da Cinerie; nao sao paragrafos copiados de terceiros.
- Citacao curta atribuida (ex.: trecho de critica) so e permitida quando a
  licenca permite (`review_quote_allowed = true`) e com atribuicao
  (`requires_attribution`) e linkback (`requires_linkback`) respeitados.

## 5. Separacao de fontes de rating (invariantes 1, 2)

- **IMDb != Rotten Tomatoes.** Nunca misturar fontes, escalas, icones ou
  linguagem. Cada fonte aparece com seu proprio `rating_source`,
  `rating_label`, `rating_scale` e atribuicao.
- **Nota IMDb nunca vira Tomatometer/Popcornmeter.** O writer nao "converte",
  nao reescala e nao apresenta uma nota como se fosse de outra fonte.
  Tomatometer/Popcornmeter pertencem so ao Rotten Tomatoes.
- **`provider_api` != `rating_source`.** O fornecedor tecnico (ex.: RapidAPI,
  TMDB) **nunca** e citado como fonte editorial. O texto atribui ao
  `rating_source` real, com `attribution_text`/`attribution_url`, jamais ao
  provedor da API.
- Escalas canonicas a respeitar: imdb=10, rotten_tomatoes=100,
  metacritic=100, letterboxd=5, filmaffinity=10. O writer descreve cada nota
  na sua propria escala, sem normalizar entre fontes.
- Para a logica de rating, ver `packages/schemas/src/ratings.ts`. Prompt de
  referencia: [`prompts/ratings_explanation_pt.md`](../../prompts/ratings_explanation_pt.md).

## 6. AggregateRating proprio: proibido sem permissao (invariante)

- O writer **nao cria `AggregateRating` proprio** fingindo nota da Cinerie.
- `AggregateRating` so aparece quando a nota e **permitida e atribuida** a uma
  fonte (com `display_allowed`/`score_allowed`), nunca como media inventada
  pelo writer.
- Nada de "nota Cinerie" agregada que nao tenha origem real e atribuivel.

## 7. Licenca antes de exibir (invariante 6)

- Dado com `license_status` em `unknown`/`blocked`, ou com
  `display_allowed = false`, **nao** entra em pagina indexavel e **nao** e
  redigido como fato exibivel.
- Logos so com `logo_allowed`; nota so com `score_allowed`; citacao de
  critica so com `review_quote_allowed`. O writer respeita cada flag de
  `source_licenses`.

## 8. Saida obrigatoria: persistencia em `content_blocks` (invariante 13)

Todo bloco produzido pelo writer e **versionado e revisavel**. Ao salvar em
`content_blocks`, sao **obrigatorios**:

- `prompt_version` — versao do prompt usado (dos prompts versionados em
  [`prompts/`](../../prompts/)).
- `input_hash` — hash do payload controlado de entrada.
- `output_hash` — hash do conteudo gerado.
- `model_provider` — provedor do modelo (ex.: gemini).
- `model_name` — nome/versao do modelo.
- `review_status` — estado de revisao (ver maquina de estados abaixo).
- `warnings_json` — warnings da validacao (`EntityWriterOutput.warnings` +
  anti-alucinacao), serializados.

Demais colunas de `content_blocks`: `id`, `entity_type`, `entity_id`,
`language_code`, `block_type`, `content`, `source_type`, `published_at`,
`created_at`, `updated_at`.

Tipos de bloco validos: `editorial_intro`, `summary_without_spoilers`,
`ratings_explanation`, `where_to_watch_text`, `cast_intro`,
`similar_titles_intro`, `franchise_context`, `season_guide`,
`episode_context`, `faq`, `news_context`, `review_summary`.

Valido no schema nao significa ativo como produto. `ratings_explanation`,
`where_to_watch_text`, `news_context` e `review_summary` so podem ser gerados
quando houver payload controlado, licenca clara, prompt versionado e escopo
explicito para a feature correspondente.

Status (`review_status`): `draft`, `ai_generated`, `needs_review`,
`human_reviewed`, `published`, `needs_update`, `blocked`, `archived`.

> **`content_blocks` compartilha o ENUM com `article_translations`, nao a maquina
> de estados.** Aqui `blocked` significa **falha de validacao na geracao** (o bloco
> nasce assim) e `archived` significa **versao superada**, arquivada
> automaticamente pelo writer no `archive + insert`. Em artigo, os mesmos dois
> rotulos significam **retratacao**. Nao aplique a allowlist de transicao de
> artigo a blocos — ver
> [`docs/adr/0016-content-block-lifecycle-separation.md`](../../docs/adr/0016-content-block-lifecycle-separation.md).

Um bloco **so conta como valor** de qualidade/ranqueamento se: veio de payload
controlado; passou na validacao anti-alucinacao; esta salvo em
`content_blocks`; tem `prompt_version` e `input_hash`; nao copia sinopse
externa; e tem `review_status` permitido.

## 9. Indexacao total; blocos = qualidade (invariante 5) _(politica atualizada 2026-07)_

- O antigo **gate anti-thin** (`>= 2` blocos para indexar) foi **removido**. A
  indexacao e **total**: a entidade indexa por padrao (`noindex` so em caso
  tecnico; a licenca da invariante 6 continua bloqueando dado sem permissao; o
  idioma segue `PUBLISHED_LOCALES`).
- O writer continua **nunca** marcando uma pagina como `index`/publicando por
  conta propria — a decisao de `index`/publicacao e registrada fora do writer.
- Os blocos que o writer produz sao **alavanca de qualidade e ranqueamento**
  (E-E-A-T, profundidade), nao pre-requisito de indexacao. Blocos de valor
  incluem (entre outros): introducao editorial propria; onde assistir por pais;
  ratings externos atribuidos; comparacao critica vs audiencia; review propria;
  FAQ util; elenco comentado; contexto de franquia; guia de temporadas; ordem
  cronologica; obras parecidas.

## 10. Publicacao: nunca automatica (invariante 12)

- O Entity Writer **nao publica automaticamente** pagina indexavel. Ele
  produz `draft`/`ai_generated`/`needs_review`; a transicao para `published`
  com `index` depende de gate + decisao registrada.
- **Revisao humana obrigatoria** antes de indexar quando a entidade for:
  - pagina **prioritaria** (alto trafego/SEO estrategico);
  - **lancamento** recente / pre-estreia;
  - **franquia grande** ou universo com muitas ligacoes;
  - **entidade sensivel** (tema delicado, pessoa real exposta, conteudo que
    exige cuidado editorial/juridico).
- pt-BR publica primeiro; **en/es so entram em `PUBLISHED_LOCALES`** (e so
  entao indexam) quando completos e revisados por humano — nao nascem mais
  permanentemente noindex, mas tambem nao ligam sozinhos (invariante 7).

## 11. Zero IA no render (invariantes 3, 4)

- **Zero Gemini no render.** A IA so gera `content_blocks` **offline**,
  salvos e validados. Nenhuma chamada a modelo acontece durante a
  renderizacao de pagina.
- **Zero API externa no render.** Paginas publicas indexaveis leem apenas
  PostgreSQL/cache local. O writer roda em pipeline offline, nunca no caminho
  de request do usuario.

## 12. Diferenciacao filme/serie no texto (invariantes 9, 10, 11)

- Filmes usam o acento vermelho (`--screena-movie-red`, nome tecnico/legado do
  token); series usam o acento verde (`--screena-series-green`). **Cinerie** e a
  marca publica; **Screena** aparece aqui apenas como namespace tecnico legado.
- A diferenciacao filme/serie **nunca** depende so da cor: o texto e os
  metadados sempre carregam **label + badge + breadcrumb + schema + URL**
  coerentes com o `entity_type`. O writer escreve respeitando esse tipo (ex.:
  "filme" vs "serie", schema `Movie` vs `TVSeries`).

## 13. Sem pirataria (invariante 8)

O writer nunca menciona, sugere ou linka torrent, IPTV, player ilegal, link
de download ou embed pirata. "Onde assistir" so cita disponibilidade legal e
licenciada vinda de `watch_availability`. Prompt de referencia:
[`prompts/where_to_watch_pt.md`](../../prompts/where_to_watch_pt.md).

## 14. Prompts versionados

Os prompts do writer sao versionados e vivem em [`prompts/`](../../prompts/):
`entity_intro_pt.md`, `ratings_explanation_pt.md`, `where_to_watch_pt.md`,
`faq_entity_pt.md`, `review_summary.md`, `news_linking.md`, entre outros. Toda
geracao registra qual `prompt_version` foi usada em `content_blocks`. Trocar
o prompt exige nova versao — nunca editar silenciosamente um prompt em uso.

## 15. Resumo do fluxo (checklist)

1. Montar `EntityPayload` controlado a partir do PostgreSQL.
2. Selecionar prompt versionado em `prompts/` (registrar `prompt_version`).
3. Gerar `EntityWriterOutput` com a Gemini (offline) — a IA redige, **nao**
   decide verdade.
4. `validateEntityWriterOutput` (forma/tipos) + `validateAgainstPayload`
   (anti-alucinacao). Acumular `warnings`.
5. Salvar em `content_blocks` com `prompt_version`, `input_hash`,
   `output_hash`, `model_provider`, `model_name`, `review_status`,
   `warnings_json`.
6. Indexacao total: a entidade indexa por padrao (blocos de valor sao
   qualidade/ranqueamento, nao gate); `noindex` so em caso tecnico e licenca.
7. Exigir revisao humana quando prioritario/lancamento/franquia
   grande/sensivel; en/es so indexam quando em `PUBLISHED_LOCALES` (completos
   + revisados).
8. Registrar decisao em `page_indexability_decisions`. O writer **nunca**
   publica nem indexa sozinho.
