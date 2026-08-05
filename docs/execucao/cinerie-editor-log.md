# Log de execucao — editor editorial da Cinerie

> Memoria entre sessoes. **Se nao esta aqui, nao aconteceu** — relatorio em chat
> nao conta. Atualizado a cada fase, ANTES de abrir a PR, e commitado junto com o
> codigo da fase.

## Estado atual

`main = 0f1a4da` · branch ativa = `claude/cms-slug-uniqueness` · fase em curso = **F4**

Baseline verde registrado na Fase 0 (2026-08-04): root typecheck `0` · root test
`4687` em `357` arquivos · cms test `453/453` · cms build `0` ·
`audit:invariants` `0` · `audit:render` `0`.

Comandos com armadilha conhecida:
- `pnpm --filter @screena/db exec prisma generate` — o `npx prisma` puxa a CLI
  `7.9.1` em vez da `6.19.3` fixada e falha com erro de validacao.
- `pnpm install` SEMPRE completo, nunca `--filter`: install filtrado deixa
  `@payloadcms/ui` fora de `node_modules` e produz erros que parecem
  pre-existentes.

---

## Decisoes vigentes

**(a) Trilho de auditoria do Publicar-em-um-clique — opcao (a).** As cinco
transicoes sao gravadas de verdade, com o MESMO ator, e com
`collapsedAt` + `collapseId` + `collapsedFrom` + `collapseReason` identicos nas
cinco linhas. O `updatedAt` do Payload **nao** e sobrescrito — ele continua
honesto sobre quando cada linha foi escrita, e brigar com o ORM em campo de
sistema quebra em silencio numa atualizacao futura, que e exatamente o modo de
falha que a amarra existe para evitar. A permissao e validada nas CINCO
transicoes, nao so na final.

**(b) Avanco parcial.** Quem nao pode publicar nao recebe recusa seca: a materia
avanca ate o estado mais adiantado alcancavel por aquele papel e a UI explica em
pt-BR o que faltou, sem nome de estado cru. "Mais adiantado" = menos passos
restantes ate `published`, por BFS reverso sobre o grafo cru; `blocked`,
`archived` e `retracted` ficam de fora por serem estados que IMPEDEM publicacao.

**(c) Bloco novo (list, embed, gallery)** entra SO em `publishedEditorialBlock`,
depois de `editorialBody`, exatamente como o `marks` entrou na #106. Gate
mecanico: capturar os hashes do contrato de ENTRADA antes e depois; se moverem,
a fase falhou. Sem bump de versao, sem sincronizar snapshot do MNScr.

**(d) Indice de slug:** unico PARCIAL em `(language, slug)`, espelhando
`@@unique([languageCode, slug])` do banco publico. **Nao** `unique` de campo
unico — quebraria pt-BR vs en da mesma materia.

**(e) Incidente de indexacao ENCERRADO.** Variaveis setadas em producao, a
materia serve `index, follow`, `robots.txt` tem `Allow: /` e os dois `Sitemap:`.
Nao reabrir.

**(f) Regra de merge.** Tokens, rotulos, estilo e testes podem auto-mergear com
CI verde. Workflow, permissao, contrato e schema PARAM em "PR aberta, aguardando
revisao" — abrir a PR, registrar aqui, e SEGUIR para a proxima fase.

**(g) Slug vazia entra na condicao do indice parcial** — decisao desta sessao. O
campo aceita `''` alem de `NULL`, e em PostgreSQL varios `NULL` nunca colidem mas
`''` colide com `''`. Sem `AND slug <> ''`, dois rascunhos ainda sem titulo se
recusariam mutuamente. Evidencia: `slug` nao e `required` nem `NOT NULL`
(`apps/cms/src/collections.ts:681`, `migrations/20260728_224559_initial.ts:328`).

**(h) A regra inegociavel** vale em todas as fases: bloco no contrato ⟺ editor no
CMS ⟺ renderer no `apps/web`. Os tres na mesma PR ou nenhum, mais validacao,
fallback e teste que prove que o renderer desenha.

---

## Premissas derrubadas

| Afirmacao original | Por que e falsa | Prova |
| --- | --- | --- |
| "Enter insere quebra de linha no mesmo bloco e fura o contrato" | Enter JA cria o proximo bloco; Shift+Enter e a quebra. Veio na #106 | `apps/cms/src/admin/ParagraphTextField.tsx:171`, texto de ajuda em `:573` |
| "ID tecnico aparece como titulo dominante" | `useAsTitle` aponta para `title` desde sempre | `apps/cms/src/collections.ts:592` |
| "Tabs e checklist se sobrepoem" | Corrigido na #105, com regras FORA da camada | `apps/cms/app/(payload)/custom.scss:1551-1569` |
| "Publicar exige operar um select cinco vezes" | E um `<button>` por transicao permitida, nao um select | `apps/cms/src/admin/WorkflowTransitionBar.tsx:231` |
| "~45 interacoes para publicar 4 paragrafos" | ~28, porque Enter-cria-bloco ja tinha baixado o numero | derivacao estrutural, Fase 0 |
| "Faltam tipos de bloco no renderer" | Os 10 tipos batem entre contrato, CMS e renderer. Os buracos sao de VALOR | `packages/editorial-contracts/src/blocks.ts:212-223` vs `apps/web/src/lib/article-body-presenter.ts:408-454` |
| "Os artigos publicados servem noindex porque `isSufficientBody` le a coluna legada vazia" | REFUTADA: o worker achata os blocos e escreve as DUAS colunas no mesmo upsert, e grava `index_status='index'` explicitamente | `services/news-ingestion/src/editorial-projection.ts:494`, `:558`, `:561`, `:577` |
| "`apps/cms/src/styles/` guarda os tokens" | O diretorio nao existe. Os tokens estao fora de `@layer` | `apps/cms/app/(payload)/cinerie-tokens.scss` |

---

## Fases

### Fase 0 — Baseline e mapa — ENTREGUE

- **Escopo:** estado do git, prova de que o contrato de ENTRADA nao tem consumidor
  vivo, mapa contrato x editor x renderer, contagem de interacoes, baseline dos gates.
- **O que foi feito:** varredura com CONTROLE NEGATIVO (o detector achou o consumidor
  conhecido, `services/news-ingestion/src/editorial-event-mapper.ts:13`, antes de eu
  afirmar zero para o contrato de entrada). O contrato de entrada tem duas ocorrencias,
  ambas COMENTARIO (`apps/cms/src/draft-intake.ts:141`, `apps/cms/src/workflow.ts:21`);
  o endpoint `/internal/editorial-drafts` (`apps/cms/src/endpoints/editorial-drafts.ts:128`)
  e SERVIDO pelo CMS e chamado por ninguem no repositorio. `MNSCR_*` so aparece em
  guardas que ABORTAM quando as variaveis existem.
- **Gates:** todos verdes (ver "Estado atual").
- **Risco em aberto:** MNScr e repositorio externo — a verificacao vale para ESTE
  repositorio, nao para o mundo.

### Fase 1 — Publicar em um clique — ENTREGUE (main `05f17bb`, PR #114)

- **Escopo:** um clique publica, sem afrouxar governanca.
- **Estado anterior:** cinco cliques na barra
  (`apps/cms/src/admin/WorkflowTransitionBar.tsx:231`), gate avaliado so no ultimo
  degrau (`apps/cms/src/hooks/articles.ts`, ramo `becomingPublic`).
- **O que foi feito:** `planPublishPath` (puro) faz BFS sobre `canTransition` e
  descobre a escada mais curta PARA AQUELE PAPEL; o endpoint
  `/internal/publish-now` sobe degrau por degrau, um `payload.update` por degrau,
  cada um disparando os hooks de sempre. O cliente nunca manda a lista de degraus.
  Pre-voo do gate ANTES do primeiro passo, com `assemblePublishGateInput`
  exportada e usada pelos DOIS chamadores para nao criar segunda verdade.
- **Migration:** nenhuma.
- **Testes:** 13 no planejador (com controle negativo provando que nenhum plano
  contem salto que `canTransition` recuse) + 8 de integracao contra PostgreSQL real
  + 1 E2E de navegador.
- **Gates:** E2E `8/8` · integracao `157/157` · unitarios `468/468` · typecheck `0`
  · build `0`.
- **O que foi visto rodando:** o E2E do CI (Node 22) abriu o painel, clicou o botao,
  e conferiu o documento PRINCIPAL virando `published`.
- **TRES defeitos, TODOS achados pelo CI e nenhum pelos gates locais:**
  1. dois botoes chamados "Publicar" na mesma barra (ambiguidade de seletor);
  2. o botao nascia PERMANENTEMENTE DESABILITADO em `draft` — `previewPublishGate`
     julga o estado ATUAL e sempre devolve `not_ready_to_publish`, que e a pendencia
     que o proprio botao existe para resolver. Teria ido para producao decorativo;
  3. `response.text()` do Playwright estoura apos `location.reload()`.
- **Divida reconhecida:** a Fase 1 foi mergeada ANTES das tres amarras chegarem.
  O trilho hoje grava cinco transicoes sem nada que as marque como colapsadas —
  um leitor pode entender que houve revisao de terceiro. **F5 corrige.**

### F4 — Unicidade de slug — EM CURSO (branch `claude/cms-slug-uniqueness`)

- **Escopo:** indice unico parcial `(language, slug)`, checagem de duplicatas
  preexistentes ANTES de criar, fim do `catch` silencioso do suffixing, teste da
  colisao real.
- **Estado anterior com ancora:**
  - `articles.slug`: `index: true`, sem `unique`, sem `required`
    (`apps/cms/src/collections.ts:681`); coluna `varchar` NULLABLE
    (`apps/cms/src/migrations/20260728_224559_initial.ts:328`); indice COMUM
    (`:826`).
  - `authors.slug`: `required` + `unique` (`apps/cms/src/collections.ts:451`),
    `CREATE UNIQUE INDEX` (`:761`). A assimetria era o defeito.
  - Unica constraint real vivia DEPOIS, no banco publico:
    `@@unique([languageCode, slug])` (`packages/db/prisma/schema.prisma:1690`) —
    entao a colisao so aparecia na projecao, com erro de outro sistema, depois de
    o redator ver "salvo".
  - Suffixing com `catch {}` vazio que engolia a falha e seguia com a slug
    colidida (`apps/cms/src/endpoints/editorial-publications.ts:619-636`), e sem
    filtrar por idioma.
- **O que foi feito:** migration `20260805_013000_articles_slug_unique_per_language`
  com bloco `DO $$` que ABORTA com mensagem em portugues nomeando as colisoes antes
  de tentar criar o indice; busca de colisao agora escopada por idioma; `catch`
  vazio substituido por `SlugCollisionError` com mensagem que diz qual slug,
  em que idioma e por qual materia (`describeArticleHolder`).
- **Migration e rollback:** aditiva, so cria indice — `down` faz
  `DROP INDEX IF EXISTS`. Nenhuma coluna nova, nenhum dado reescrito, nenhum
  default: voltar devolve o banco ao estado exato anterior. A tabela de VERSOES
  (`_articles_v`) fica de fora de proposito — dezenas de autosaves compartilham a
  mesma slug legitimamente, e um indice unico ali quebraria o segundo salvamento.
- **Testes criados:** `src/__tests__/slug-collision.test.ts` — colisao real,
  sufixo pulando os tomados, determinismo, teto esgotado devolvendo `null`, e
  CONTROLE NEGATIVO provando que com uma vaga no meio NAO devolve `null`
  (sem ele, um resolvedor quebrado que sempre devolvesse `null` passaria).
- **O QUE A MIGRATION REVELOU — o defeito maior nao estava onde o brief apontava.**
  Assim que o indice entrou, a integracao quebrou em
  `publication.integration.test.ts` ("artigo com autoria humana NAO e sobrescrito
  pela automacao") com `duplicate key ... "articles_language_slug_unique_idx",
  Key (language, slug)=(pt-BR, duna-parte-tres-data-de-estreia)`. O caminho que
  estourou **nao** era `editorial-publications.ts`: era
  `endpoints/editorial-drafts.ts:239`, a ingestao de rascunho do MNScr, que
  gravava a `slugProposal` crua (`draft-intake.ts:192`) e **nunca teve resolucao
  de colisao nenhuma**. Enquanto nao havia constraint isso passava despercebido —
  duas materias conviviam com a mesma slug e a briga so aparecia na projecao. A
  constraint nao criou o defeito; ela o tornou visivel na hora certa.
  **Licao:** havia DOIS caminhos que criam materia e so um resolvia colisao. Por
  isso a logica virou modulo compartilhado (`src/slug-availability.ts`) em vez de
  um segundo trecho copiado — foi a duplicacao que deixou um deles para tras.
- **Gates:** integracao `157/157` contra PostgreSQL 16 real (a migration APLICA e
  o indice ENFORCA — provado, nao presumido) · unitarios `480/480` · typecheck `0`.
- **O que foi visto rodando:** a migration correndo no harness de integracao, e o
  indice recusando o INSERT duplicado antes da correcao. Painel nao foi aberto:
  esta fase nao tem superficie.
- **Riscos em aberto:** a corrida entre a checagem e o INSERT continua existindo
  (read-then-write); o indice agora a converte de "duas materias com a mesma URL"
  para "erro no INSERT", que e o desfecho correto, mas a mensagem desse caminho
  ainda e do PostgreSQL, nao a frase humana. Cobrir isso exigiria capturar o
  codigo `23505` na fronteira dos dois endpoints — fica registrado, nao feito.

### F5 — Amarras do trilho de auditoria — PENDENTE

Parte ja pronta em `claude/cms-amarras-colapso` (`99d60c1`): avanco parcial com
`partialPath`, 17/17 verdes. Falta a migration dos quatro campos e a UI da
explicacao.

### F8 — Decisao por provedor (registrada ANTES de implementar) — PENDENTE

Pesquisa de 2026-08-05. **Chamar oEmbed acontece na COLAGEM, dentro do painel —
nunca no caminho de render publico.** Isso mantem a invariante 3 intacta: a
pagina publica continua lendo so PostgreSQL.

**YouTube — embed de verdade.** `<iframe>` montado a partir do `externalId`
guardado, com clique-para-carregar. Sem API, sem chave, sem custo. O `iframe` e
montado por NOS a partir de um id validado, nunca colado pelo redator — a
proibicao e de iframe ARBITRARIO, e este nao e. E o unico dos tres que entrega
render nativo.

**Instagram — cartao estatico, opcao (a). NAO e embed nativo.** Desde
**2026-06-15** os oEmbed da Meta respondem **sem token e sem App Review**, o que
derruba o custo que antes inviabilizava a opcao: nao precisa mais de app
aprovado. Mas o render NATIVO do post continua exigindo o script deles, e script
de terceiro sem acao do usuario esta proibido. Entao guardamos os metadados na
colagem (autor, legenda, permalink) e desenhamos um cartao proprio.
*Entrega menos que embed nativo: o leitor ve um cartao com link, nao o post do
Instagram renderizado.*

**X — cartao estatico, opcao (a). NAO e embed nativo.** O custo mudou de forma
relevante: o **free tier acabou em fevereiro de 2026**, substituido por
pay-per-use ($0.005 por leitura de post), e o Basic de $200/mes foi aposentado
com migracao forcada em 2026-06-01. O endpoint publico de oEmbed para post unico
**ainda responde**, mas com rate limit para uso automatizado/em massa. Como a
chamada acontece uma vez, no momento em que uma PESSOA cola a URL, o volume e de
redacao e nao de robo — cabe no endpoint publico sem entrar no pay-per-use. Se
um dia precisar de volume, o custo passa a ser real e a decisao volta.
*Entrega menos que embed nativo, pelo mesmo motivo do Instagram.*

**Descartado para os dois:** (b) cartao preenchido a mao — trabalho manual em
toda colagem, e o dado envelhece sem ninguem perceber; (c) link enriquecido sem
cartao — nao resolve o pedido editorial.

**Ressalva de licenca a resolver na implementacao:** cachear miniatura de
terceiro e re-hospedagem. O cartao guarda TEXTO e permalink; a imagem, se
entrar, passa pela biblioteca de midia com decisao editorial de licenca, como
qualquer outra foto.

### F6, F7, F9..F13 — PENDENTES

F6 canvas · F7 editor e menu `/` · F8 embeds e galeria · F9 midia · F10 SEO ·
F11 preview · F12 limpeza e os dois defeitos de queda silenciosa · F13 teste de
varredura de contrato.

---

## Pendencias herdadas

1. **`blocksToPlainText` perde conteudo.** O whitelist `TEXT_KEYS`
   (`services/news-ingestion/src/editorial-projection.ts:239`) colhe seis chaves e
   so `items` que sejam STRING (`:250-253`), entao descarta `entityCard.note`,
   `factBox.title` e `factBox.items[].label/value`. Uma materia cujo valor esteja
   concentrado nesses blocos achata para menos de 200 caracteres, bate em
   `MIN_ARTICLE_BODY_CHARS` (`apps/web/src/lib/news-presenter.ts:43`) e sai
   `noindex, follow`. **Nenhum teste cobre "materia indexavel so por `bodyBlocks`".**
2. **Duas quedas silenciosas** (F12): `entityCard` fora de `movie`/`tv` nao e
   hidratado (`apps/web/src/server/news-pages.ts:523`) e `video.provider:'internal'`
   devolve `null` (`apps/web/src/lib/article-body-presenter.ts:217-221`). Ambos
   legais no contrato e selecionaveis no CMS; hoje mitigados so pelo ROTULO.
3. **`schemaTypeRecommendation`**: `Review`, `ItemList` e `HowTo` sao oferecidos no
   CMS e ignorados no JSON-LD.
4. **Node 24 impede o E2E local.** `engines` pede `>=22 <23`; o `globalSetup` do
   Playwright morre num ciclo `require(esm)` do `drizzle-orm`. A integracao roda
   porque `vitest.integration.config.ts` inlina os pacotes; o Playwright nao tem
   esse desvio. Consequencia: toda mudanca de superficie so e vista no CI, ~25 min
   por volta.
5. **`isSufficientBody` le so a coluna legada** (`apps/web/src/server/news-pages.ts:282`),
   com `bodyBlocks` selecionado e ignorado (`:171`). Nao e o bloqueio de hoje
   (ver premissa derrubada), mas e fragilidade estrutural.

---

## Ordem de deploy quando terminar

Quando o contrato muda, **consumidor antes de produtor**:

1. `screen-app` (`apps/web`) — passa a saber desenhar o que vai chegar;
2. worker de projecao (`services/news-ingestion`);
3. `cinerie-cms` (`apps/cms`) — so entao passa a emitir.

`Dockerfile.cms` roda `cms:migrations:deploy` na subida e **derruba o container**
se a migration falhar — por isso a migration de F4 aborta com mensagem humana em
vez de deixar o PostgreSQL falhar com o nome do indice.
