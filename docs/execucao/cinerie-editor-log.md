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

### F5 — Amarras do trilho de auditoria — EM CURSO (`claude/cms-amarras-colapso`)

- **Escopo:** as tres amarras da opcao (a) — mesmo ator, carimbo identico nas
  cinco linhas, permissao validada nas cinco transicoes — mais a UI da explicacao
  do avanco parcial.
- **Estado anterior:** a Fase 1 mergeou ANTES das amarras chegarem. O trilho
  gravava cinco transicoes sem nada que as marcasse como colapsadas; um leitor
  podia entender que houve revisao de terceiro.
- **O que foi feito:**
  - Quatro colunas em `articles` **e** em `_articles_v` (`version_*`): as cinco
    linhas do rastro sao linhas de VERSAO — carimbar so a tabela viva deixaria
    justamente o rastro sem a marca.
  - `collapseId` (uuid) alem de `collapsedAt`, porque carimbo de tempo sozinho e
    chave fragil: a mesma materia pode ser colapsada duas vezes e dois relogios
    iguais ao milissegundo agrupariam operacoes diferentes.
  - **Quem estampa e o HOOK**, a partir de `req.context.publishCollapse`, e os
    quatro campos entraram em `HUMAN_FORBIDDEN_FIELDS`. A ordem importa: o hook
    remove os campos do corpo (junto com o resto do que humano nao escreve) e SO
    DEPOIS estampa os proprios. Sem isso, uma pessoa poderia **forjar** "isto foi
    publicacao direta" numa materia revisada de verdade, ou **apagar** a marca de
    um colapso real — nos dois sentidos o trilho passaria a mentir.
  - Permissao nas cinco: ja era assim — `planPublishPath` chama `canTransition`
    (que checa papel) em CADA degrau candidato. A amarra estava atendida; o que
    faltava era o avanco parcial, agora executado pelo endpoint.
  - UI: `partialAdvanceMessage` diz ate onde foi e o que falta, sem nome de
    estado cru. `PUBLISHER_ROLES` e **derivado** de `transitionsFrom`, nao escrito
    a mao — lista literal viraria segunda verdade e sobreviveria calada a uma
    mudanca de governanca.
- **Migration e rollback:** `20260805_175144_publish_collapse_trail` — aditiva,
  oito colunas NULLABLE + dois indices. `down` derruba tudo. Nada reescrito,
  nenhum default: `NULL` significa "nao veio de colapso", que e a verdade para
  todas as materias existentes.
- **DESVIO DE CARONA, e a armadilha do snapshot.** O gerador propos junto a
  conversao de `articles.language` de `varchar` para enum (e o par em `_v`) e um
  `DEFAULT '2'` no `level` do heading — o MESMO desvio que a #106 ja recusara.
  Trimei o SQL, como la. **Mas desta vez o `.json` gerado REGISTRAVA o desvio**
  (na #106 nao registrava — verificado, `grep -c` = 0). Manter o snapshot como
  veio esconderia a conversao PARA SEMPRE: o gerador nunca mais a proporia.
  Corrigi o `.json` a mao para descrever o banco real (`language` = `varchar`,
  `level` sem default, os dois enums fora).
  **CONTROLE EXECUTADO:** rodei `payload migrate:create` de novo depois da
  correcao. O gerador continuou propondo **so** o desvio (enum + default) e
  **nenhuma** das minhas colunas — provando que o snapshot registra as minhas
  como aplicadas e mantem o desvio visivel para a migration propria que ele
  merece. Artefatos do controle removidos.
- **Testes criados:** quatro em `partialAdvanceMessage`, incluindo controle
  negativo que varre TODOS os estados provando que nenhum nome cru vaza para a
  frase (um `STATUS_LABELS` incompleto produziria "avancou ate undefined", pior
  que o silencio que isto veio corrigir).
- **Provas de integracao (as centrais da amarra):**
  - o carimbo sai IDENTICO nas cinco linhas de versao — um `collapseId`, um
    `collapsedAt`, `collapsedFrom='draft'`, `collapseReason='publicacao_direta'`;
  - **controle negativo** no mesmo teste: `updatedAt` VARIA entre as linhas. Se
    alguem "consertar" isso igualando os carimbos do ORM, o teste avisa;
  - humano nao consegue FORJAR o carimbo por `PATCH` direto na API.
- **Dois testes da Fase 1 mudaram de expectativa, de proposito.** "editor nao
  publica, e a recusa nao move nada" e o par do writer afirmavam o comportamento
  ANTIGO (recusa seca). A amarra 2 o substituiu: agora a materia avanca ate a
  fronteira da alcada. Reescritos para afirmar a garantia NOVA — avanca ate
  `ready_to_publish`/`needs_review` e **continua sem publicar** —, nao
  enfraquecidos.
- **Gates:** integracao `159/159` com PostgreSQL real · unitarios `474/474` ·
  typecheck `0`.
- **O que foi visto rodando:** a migration aplicando no harness e o carimbo
  gravado nas cinco versoes, lido de volta do banco. A FRASE do avanco parcial na
  tela ainda nao foi vista em navegador — o E2E local nao roda em Node 24 (ver
  pendencia 4). Quem prova e o CI.

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

### F6 — Canvas editorial — DECISAO ARQUITETURAL REGISTRADA (implementacao em curso)

**A pergunta que o mandato mandou confirmar antes de prometer: a sidebar e
possivel?** Resposta verificada no PAYLOAD INSTALADO (3.86.0), nao em
documentacao de outra versao.

**(i) `admin.position: 'sidebar'` so funciona em campo de TOPO.** O predicado
`fieldIsSidebar` (`payload/dist/fields/config/types.js:34-36`) tem UM unico
consumidor em todo o pacote de UI:
`@payloadcms/ui/dist/elements/DocumentFields/index.js:26-41`, que particiona
`docConfig.fields` — o array de topo da collection. `RenderFields`, que desenha
todos os niveis aninhados (inclusive o conteudo das abas,
`fields/Tabs/index.js:361`), **nunca** consulta `fieldIsSidebar`.
**Consequencia: `position: 'sidebar'` num campo dentro de `tabs` TYPECHECKA e e
silenciosamente ignorado** — o campo aparece inline na aba. E armadilha de tipo,
nao erro de compilacao. Hoje TODO campo de `articles` vive dentro de um unico
`tabs`, entao hoje a sidebar esta vazia por construcao.

**(ii) Edit View customizada e possivel, e e a escolha ERRADA aqui.** O slot
existe: `admin.components.views.edit.default.Component`
(`payload/dist/config/types.d.ts:1372-1411`). Mas o provider `<Form>` e montado
DENTRO do `DefaultEditView` (`@payloadcms/ui/dist/views/Edit/index.js:452`), e a
view customizada e renderizada ACIMA dele
(`@payloadcms/next/dist/views/Document/index.js:364-369`). Substituir a view
substitui o provider junto.

Reusar `Form` + `RenderFields` por conta propria obrigaria a reescrever a cola do
`DefaultEditView` (~600 linhas): a `action`, o `onChange -> getFormState`, o
`onSuccess`, os modais de lock/takeover, `LeaveWithoutSaving`,
`SetDocumentStepNav`. **Perder o `onChange -> getFormState` quebra
`admin.condition` e todo componente de campo renderizado no servidor** — em
silencio, do jeito que este projeto ja foi mordido tres vezes. Recusado.

**(iii) O caminho seguro, e o que sera usado:** ordenar `collection.fields[]` no
TOPO (a ordem do array E o mecanismo de ordenacao) e usar
`admin.components.Field` num campo CONTENEDOR (`group`/`row`/`collapsible`/
`tabs`), que recebe `field.fields` + `path`/`schemaPath`/`permissions` e pode
reemitir com `RenderFields` no layout que quisermos — **rodando dentro do `Form`
de verdade, com zero estado de formulario reimplementado**.

**(iv) Nao existe** `beforeFields`/`afterFields` em nivel de collection em 3.86
(grep nos `.d.ts`: zero). Nao existe API de reordenacao declarativa. O
`Description` de collection existe mas so aparece no cabecalho.

**Consequencia de escopo, dita com todas as letras:** entregar o canvas
(titulo grande no topo, corpo no centro, resto na sidebar) exige **tirar campos
de dentro do `tabs` e promove-los ao topo**. Isso mexe em dois testes travados —
`manual-editorial.test.ts` ("as 8 abas cobrem TODOS os campos") e o E2E que
clica nas abas pelo nome. O mandato permite, exigindo atualizar os dois sem
reduzir cobertura. E o unico caminho: enquanto tudo viver dentro do `tabs`,
nenhuma sidebar e possivel, por construcao do Payload.

**IMPLEMENTACAO (branch `claude/cms-canvas-editorial`):**

- **O que foi feito:** `title`, `subtitle`, `summary` e `body` promovidos ao TOPO
  de `collection.fields[]`, antes do `tabs` — a ordem do array E o mecanismo de
  ordenacao, entao a tela abre escrevendo em vez de abrir num formulario. `slug`
  promovida ao topo com `position: 'sidebar'`, onde a propriedade finalmente e
  lida.
- **As 8 abas ficaram intactas** de proposito: cada uma continua com campo, o
  rotulo nao mudou, e o E2E que clica nelas pelo nome segue valendo. So o teste
  de cobertura mudou — e ficou MAIS forte (abaixo).
- **ACIDENTE REAL, e o que ele ensinou.** Um recorte automatizado removeu
  `articles.slug` do formulario e **o typecheck passou** — campo perdido e so um
  item a menos num array. Foi pego por `grep -c` na conferencia, nao por gate.
  Por isso o teste antigo ("as 8 abas cobrem TODOS os campos") NAO foi apenas
  ajustado para o numero novo: baixar o numero teria escondido exatamente esse
  acidente. A invariante agora e `topo + abas === total`, mais uma verificacao
  NOMINAL de que `title`, `slug`, `body`, `summary`, `language` e `contentType`
  continuam existindo.
- **Testes criados:** canvas no topo com ordem congelada; `slug` como unico campo
  de sidebar; controle negativo de campo perdido.
- **Migration:** nenhuma. Promover campo entre `tabs` e topo **nao muda o
  schema** — as abas sao SEM NOME, entao o armazenamento ja era plano. Confirmado
  pelo teste de snapshot de colunas, que continua verde.
- **Gates:** unitarios `482/482` · typecheck `0`.
- **SEM CONFIRMACAO VISUAL:** o canvas e a sidebar nao foram vistos no navegador
  (Node 24 impede o Playwright local). Conferir depois: titulo grande no topo,
  corpo no centro, slug na coluna da direita.

### F7 — Bloco `list` (contrato + CMS + renderer) — ENTREGUE

- **Escopo:** lista com marcador e numerada, a primeira aplicacao da regra (c) e
  da regra inegociavel na mesma PR.
- **GATE MECANICO DA REGRA (c) — PASSOU.** Hashes do contrato de ENTRADA
  capturados antes e depois, e IDENTICOS:
  - `editorial-draft-v1` = `sha256:46a21c99...f77ba` (antes = depois)
  - `editorial-publication-request-v1` = `sha256:93024329...c6f8` (antes = depois)
  `listBlock` entrou SO em `publishedEditorialBlock`, depois de `editorialBody`,
  como o `marks` na #106. Nenhum pedido do MNScr em voo vira `hash_mismatch`.
- **Os tres lados, na mesma PR:** contrato (`blocks.ts`), editor no CMS (bloco
  `list` com `ordered` + `items`), renderer no `apps/web` (presenter devolve
  `kind: 'list'`; JSX escolhe `<ol>` ou `<ul>` **conforme o dado**, nunca CSS
  fingindo semantica — leitor de tela anuncia a lista a partir do elemento).
- **Fallback em duas camadas:** item vazio e descartado (por item, nao por
  bloco); lista sem nenhum item some em vez de virar `<ul>` vazia. O mapeador do
  CMS descarta antes de publicar — lista com buraco seria publicar o descuido.
- **Migration:** `20260805_224024_list_block` — quatro tabelas NOVAS, nada
  alterado, `down` derruba so elas. Materia existente nao tem bloco `list` e
  renderiza igual.
- **Desvio herdado removido a mao pela TERCEIRA vez** (enum de idioma + default
  do heading), e o `.json` corrigido para o banco real. Sem a correcao o gerador
  nunca mais proporia a conversao.
- **Testes:** 9, incluindo DOIS controles negativos — lista sem item some, e o
  detector reconhece tipo inexistente (sem ele os outros casos poderiam passar
  por acidente).
- **Gates:** root test `4783/4783` · cms test `488/488` · root typecheck `0` ·
  cms typecheck `0`.
- **NAO ENTREGUE nesta fase, e por que:** menu `/`, colagem limpa e toolbar
  contextual sao componentes `.tsx` — o vitest deste app nao coleta `.tsx`, e o
  Playwright nao sobe em Node 24. Entrariam sem teste local nenhum. Ficam para
  uma fase propria, com a logica extraida para `.ts` testavel.
- **Ctrl+B NAO foi tocado:** o mandato manda reproduzir antes de mexer, e o
  componente implementa Ctrl+B/I/K com `preventDefault` (`ParagraphTextField`).
  Sem reproducao, mexer seria consertar relato.
- **SEM CONFIRMACAO VISUAL:** o bloco `list` no painel e a lista na pagina.

### F8 — Embeds e galeria — ENTREGUE (PR aberta, CI bloqueado por cobranca)

- **GATE (c) — PASSOU.** Hashes de ENTRADA identicos antes e depois
  (`editorial-draft-v1` = `sha256:46a21c99...`, `editorial-publication-request-v1`
  = `sha256:93024329...`). `embedBlock` e `galleryBlock` entraram SO em
  `publishedEditorialBlock`.
- **DADO TIPADO, nunca HTML.** O bloco guarda `provider`, `externalId`,
  `canonicalUrl`, `originalUrl`, `caption` e metadados opcionais. **Nao existe
  campo de HTML**, e isso e testado: `z.object` remove chave desconhecida em
  silencio, entao um `html` colado nao sobrevive ao parse. O site MONTA o player
  a partir do id.
- **`parseEmbedUrl` — allowlist FECHADA, em `.ts` puro e testado.** Recusa
  `javascript:`, `data:`, `file:`, host parecido (`youtube.com.evil.test`),
  provedor certo sem recurso (`/@canal`), e id fora do alfabeto seguro.
  **Descoberta durante o teste:** `new URL()` NORMALIZA o caminho, entao
  `youtu.be/../../etc` chegava como `/etc` e `etc` passava no alfabeto — virava
  embed com id inventado. Corrigido exigindo os 11 caracteres reais do id do
  YouTube.
- **Clique-para-carregar.** O `<iframe>` do YouTube so entra no DOM apos acao da
  pessoa, via `srcDoc` (sem JavaScript nosso, sem estado de cliente), em
  `youtube-nocookie`, com `sandbox` SEM `allow-same-origin`. E o que sustenta a
  promessa "nenhum script de terceiro sem acao do usuario".
- **INSTAGRAM E X ENTREGAM MENOS QUE EMBED NATIVO.** Viram CARTAO com link, nao
  o post renderizado — render nativo exigiria o script deles. A garantia e
  mecanica, nao de intencao: `embedPlayerUrl` devolve `null` para os dois, entao
  nao ha iframe possivel. O rotulo do select no CMS diz isso ao redator ANTES de
  publicar.
- **Galeria:** varias imagens, ordem preservada, `alt`/`caption`/`credit` POR
  IMAGEM (credito de foto e por foto; um credito so mentiria sobre as demais),
  e imagem de abertura com indice — fora da faixa cai para a primeira.
  `imageOf` foi extraida para `image` e `gallery` compartilharem a montagem:
  duas paralelas divergiriam no primeiro campo novo.
- **Migration:** `20260805_225957_embed_gallery`, aditiva, so tabelas novas,
  `down` derruba so elas. Desvio herdado removido a mao pela QUARTA vez e
  snapshot corrigido.
- **Testes:** 14 no parser de URL + 14 no renderer, com controles negativos nos
  dois lados.
- **Gates:** root test `4811/4811` · cms test `502/502` · root typecheck `0` ·
  cms typecheck `0`.
- **SEM CONFIRMACAO VISUAL:** o clique-para-carregar, o cartao de Instagram/X e a
  galeria na pagina. O CI esta parado por cobranca (ver bloqueio acima), entao
  esta fase nao teve nem a janela de navegador do CI.

### F9 — Midia: miniatura, licenca e busca no seletor — ENTREGUE

- **O defeito:** dava para vincular midia BLOQUEADA a uma materia e so descobrir
  na publicacao, quando o gate recusa com `unauthorized_media`. O redator
  escolhia a foto, escrevia a legenda, tentava publicar — e ai aprendia que
  aquela imagem nunca poderia ter sido usada. A resposta precisava estar onde a
  escolha acontece.
- **Estado anterior com ancora:** `upload` sem `adminThumbnail` (nenhuma
  miniatura em lugar nenhum), `defaultColumns` com `licenseStatus` CRU, e sem
  `listSearchableFields` — achar imagem exigia rolar a lista.
- **O que foi feito:**
  - `adminThumbnail: 'thumbnail'` + `imageSizes` — o seletor de relacionamento
    reusa as colunas da collection, entao a miniatura aparece nos dois lugares;
  - `MediaUsabilityCell` no lugar da coluna crua: responde "Liberada" / "Só no
    corpo" / "Bloqueada", em pt-BR, com o motivo no `title`;
  - `listSearchableFields` com alt, credito, fonte, detentor e nome do arquivo —
    o que a redacao lembra de uma foto.
- **TRES desfechos, nao dois:** "liberada para o corpo mas nao para capa" e
  estado real e frequente. Dizer so "bloqueada" faria o redator descartar foto
  que ele PODE usar no texto.
- **A regra e PURA e reusa a existente.** `mediaUsability` delega a
  `mediaBlockReason`, que ja e a fonte do aviso na tela de materia. Uma segunda
  regra divergiria da primeira no primeiro caso novo — e as duas falariam sobre a
  MESMA foto. O `.tsx` so desenha.
- **FAIL-CLOSED, testado:** fato ausente, `null`, numero ou string no lugar de
  booleano NAO viram "liberada". O erro seguro e recusar demais.
- **NAO foi tocado**, como o mandato exige: o botao "Liberar para uso editorial e
  capa" e o semaforo de tres estados (`MediaReleaseControl`).
- **Migration:** `20260805_231638_media_thumbnail` — colunas novas e NULLABLE de
  `sizes.thumbnail`. Sem regeneracao retroativa: gerar derivada de todo o acervo
  dentro da migration seria trabalho pesado no caminho de subida, e o
  `Dockerfile.cms` derruba o container se ela falhar. Midia antiga continua
  servida pelo original e ganha miniatura quando for reenviada.
- **Testes:** 7, incluindo fail-closed e controle negativo.
- **Gates:** cms test `509/509` · cms typecheck `0`.
- **SEM CONFIRMACAO VISUAL:** miniatura e rotulo de liberacao no seletor.

### F10 — SEO: preview, contadores e tres defeitos de JSON-LD — ENTREGUE

- **`publisher` estava AUSENTE.** `NewsArticle` sem editora perde a atribuicao
  que distingue materia de jornal de texto solto. Agora emitido, com a URL
  DERIVADA da canonical ja resolvida — fixar constante faria ambiente de teste
  anunciar o dominio de producao.
- **`articleSection` saia `"news"`**, em ingles, num site em pt-BR: o presenter
  caia para `category`, que carrega o TIPO de conteudo, nao a editoria. Tipo de
  conteudo passa a ser recusado, com controle negativo provando que "Crítica" e
  "Notícias" continuam passando.
- **`author.url` NAO foi "corrigido", e a ausencia virou deliberada.** O banco
  publico guarda so `authorName` — nao existe pagina de autor nem slug para
  apontar. Emitir URL para pagina inexistente promete perfil verificavel e
  entrega 404. Documentado no codigo e no teste.
- **PREMISSA DERRUBADA — `alt` vazio no hero NAO e defeito.** E decisao de
  acessibilidade documentada e TRAVADA por
  `tests/governance/editorial-media-route.test.ts`: a capa fica sob scrim com a
  manchete em TEXTO por cima, entao a imagem e decorativa e descreve-la faria o
  leitor de tela repetir o titulo. Ha teste do outro lado garantindo que card de
  listagem NAO usa alt vazio — a distincao e deliberada. Eu mudei, o teste pegou,
  e eu revertí.
- **Painel de SEO (`seo-preview.ts`, puro):** preview de SERP com a URL REAL
  (`/pt/noticias/<slug>/`, e lacuna visivel quando a slug esta vazia), contador
  com limite de truncamento, e derivacao que **nunca sobrescreve o escrito** —
  `manual` vence sempre, com controle negativo provando que o texto volta byte a
  byte. Os limites sao referencia de corte, nao promessa de exibicao: o buscador
  monta o snippet do conteudo, e prometer ranqueamento seria folclore.
- **Testes:** 12 no painel + 8 no JSON-LD.
- **Gates:** root test `4838/4838` · cms test `521/521` · root typecheck `0`.

### F11 — Preview — DECISAO REGISTRADA

**Escolhida a rota A (preview dentro do CMS), e nao por preferencia — por custo
medido.**

A rota B (`/pt/preview/[id]` no `apps/web` buscando o rascunho na API do CMS)
custa muito mais do que parece:

1. **Atravessa a fronteira que `tests/governance/editorial-worker-boundary.test.ts`
   protege.** Hoje o worker de projecao e o UNICO processo que fala com os dois
   lados, e a ponte e assimetrica de proposito. Um segundo atravessador
   enfraquece a garantia arquitetural mais forte deste sistema — e a excecao,
   uma vez aberta, e reusada.
2. **Poe o `apps/web` chamando servico externo em tempo de request.** Mesmo numa
   rota nao indexavel, e o padrao que a invariante 3 existe para impedir; a
   proxima rota copia o padrao.
3. Exige emissao e verificacao de token curto, endpoint de leitura de rascunho no
   CMS, e tratamento de erro/expiracao — superficie nova em DOIS aplicativos.

A rota A tem um limite honesto: **nao e a pagina real**, e nao vai ter o CSS do
site. Mas responde a pergunta que a redacao faz de verdade — e, principalmente,
responde a pergunta que este repositorio erra ha quatro vezes: **o que vai
SUMIR**. `entityCard` de pessoa, `video` interno, lista sem item, galeria sem
imagem — todos legais no CMS e todos invisiveis na pagina.

Por isso o preview desta fase nao imita a pagina: ele responde, bloco a bloco, se
aquele bloco vai aparecer, usando o MESMO contrato que a projecao usa. E o
material tambem serve de base para a F13.

### F12 — As duas quedas silenciosas, FECHADAS — ENTREGUE

**A regra era "ou ganham renderer, ou saem do contrato". Sair estava vedado:**
`entityCardBlock` e `videoBlock` vivem tambem em `editorialBody`, o contrato de
ENTRADA. Estreitar `entityKind` ou o enum de `provider` moveria o hash que o
MNScr declara a cada pedido — a fase falharia pelo proprio gate da regra (c).
Entao: renderer.

- **`entityCard` fora de movie/tv.** O presenter devolvia `null` quando a
  hidratacao faltava, e levava junto a NOTA que o redator escreveu. Agora existe
  `entityNote`: a ficha nao e inventada (exigiria titulo e slug reais), mas o
  TEXTO sobrevive. Sem nota, o bloco ainda some — nota inventada seria pior.
- **`video` com provider `internal`.** Sumia mesmo com URL preenchida: o video
  existia, o link existia, e a pagina nao mostrava nada. Agora vira link quando
  ha endereco utilizavel; esquema perigoso continua recusado.
- **Rotulos do CMS e preview da F11 sincronizados.** As frases diziam "ainda nao
  aparece no site", o que deixou de ser verdade nesta fase. Duas verdades sobre o
  mesmo bloco e exatamente o defeito que este projeto persegue — entao os
  rotulos passaram a "vira nota, sem ficha" e "vira link, sem player", e os
  testes da F11 foram atualizados para o comportamento novo, sem enfraquecer.
- **Testes:** 8 novos no renderer, com controle negativo provando que o fallback
  depende da HIDRATACAO e nao do tipo (senao toda ficha viraria nota).
- **Gates:** root test `4858/4858` · cms test `533/533` · typecheck `0`.
- **NAO ENTREGUE da F12, e fica registrado:** `Language` como select, aba de
  automacao escondida quando `autoPublished` for falso, confirmacao ao remover
  bloco, e "Nova materia" parar de criar rascunho antes de escrever. Os quatro
  sao mudanca de superficie no painel, sem cobertura possivel neste ambiente
  (Node 24 impede o Playwright; o CI esta parado por cobranca). Entram quando
  houver como ver.

### F13 — PENDENTE

F6 canvas · F7 editor e menu `/` · F8 embeds e galeria · F9 midia · F10 SEO ·
F11 preview · F12 limpeza e os dois defeitos de queda silenciosa · F13 teste de
varredura de contrato.

---

## BLOQUEIO EXTERNO — CI parado por cobranca (2026-08-05)

**O CI nao roda mais.** A partir da PR #120 os tres jobs falham em 3-9 segundos,
antes de qualquer passo, com a anotacao do proprio GitHub:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings.

Nao e defeito de codigo: nenhum job chegou a iniciar. **So o dono da conta
resolve** (Billing & plans no GitHub).

**O que isso muda, e o que NAO muda:**
- PRs a partir da #120 **nao podem ser mergeadas** — nao ha CI verde para
  autorizar. Elas ficam abertas, empilhadas, prontas.
- Os gates LOCAIS continuam valendo e continuam sendo rodados: `typecheck`,
  `test` (root e cms) e `test:integration` contra PostgreSQL 16 real. E o que da
  para provar daqui.
- O que se perde e a unica janela de verificacao de NAVEGADOR que este ambiente
  tinha (o E2E do CI roda Node 22; a maquina local tem 24). Ou seja: da #120 em
  diante, **nenhuma mudanca de superficie tem confirmacao visual de especie
  alguma** ate a cobranca ser resolvida.
- Merges anteriores (#114, #116, #117, #118) passaram por CI verde e estao na
  main.

**Decisao:** seguir implementando as fases seguintes com gates locais e deixar as
PRs abertas. Quando o CI voltar, elas sao mergeadas na ordem.

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
