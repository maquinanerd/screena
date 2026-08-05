# Log de execucao — editor editorial da Cinerie

> Memoria entre sessoes. **Se nao esta aqui, nao aconteceu** — relatorio em chat
> nao conta. Atualizado a cada fase, ANTES de abrir a PR, e commitado junto com o
> codigo da fase.

## Estado atual

`main = 2a0ee02` · branch ativa = `claude/cms-paste-image-loss` · fase em curso = **F5.1**
(fora da fila, a pedido do operador) · proxima = **F13**, depois **F6**

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

**(i) F6 canvas — escopo definido pelo operador (2026-08-05).** Superficie de
escrita: titulo grande no topo, subtitulo e resumo discretos, corpo continuo no
centro (**nao** cartao por bloco), sidebar colapsavel com o resto, campos
tecnicos e de auditoria fora da vista de quem escreve. Largura de leitura entre
**760 e 900 px**. Tipografia de artigo ENTRA; sumario lateral **NAO** entra.
Reusar o formulario do Payload — nao reimplementar estado de formulario.

**(j) F13 SOBE para antes do F6.** Sao **seis** quedas silenciosas ja conhecidas
(video `internal`, `entityCard` fora de filme/serie, imagem com URL absoluta, o
campo `gallery` que nao vira galeria, imagem colada, `blocksToPlainText`
descartando `factBox`), todas achadas **uma a uma**, por leitura. O teste de
varredura mata a CATEGORIA e passa a cobrir de graca tudo que F6..F12
construirem — construir primeiro e varrer depois seria descobrir a setima do
mesmo jeito que descobrimos as seis.

**(k) Ordem da fila apos esta sessao:** F5.1 (esta PR) → **F13** → F6 → F7 → F8 →
F9 → F10 → F11 → F12.

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

### F4 — Unicidade de slug — ENTREGUE (main `3a5e9ba`, PR #116)

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

### F5 — Amarras do trilho de auditoria — ENTREGUE (main `2a0ee02`, PR #117)

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

### F5.1 — Imagem colada deixa de sumir calada — EM CURSO (`claude/cms-paste-image-loss`)

- **Por que fura a fila:** o fluxo real do operador e colar de portal ilustrado.
  A perda nao era eventual — acontecia em **toda** materia.
- **Estado anterior:** `<img>` colada nao produzia texto nenhum e era ignorada
  pelo scanner (`paste-to-blocks.ts:233-235`). Nada avisava. Quem escreve so
  descobria a perda relendo a materia publicada. O contador `dropped` ja existia
  para o teto de paragrafos e **nem ele era lido** no campo
  (`ParagraphTextField.tsx:180-187`).
- **O que foi feito:**
  - `countPastedImages` conta por **ARQUIVO**, nao por tag: a mesma `src`
    repetida (fallback de `<noscript>`, placeholder de lazy-load, a mesma foto
    duas vezes na pagina) e **um** upload, e o aviso existe para dizer quantos
    arquivos subir. `<img>` sem `src` legivel nao tem como ser deduplicada e
    conta por si — errar para MAIS e melhor do que anunciar menos perda do que
    houve.
  - Conta sobre o HTML ja limpo de `<script>`, `<style>` e comentario: imagem
    dentro de codigo morto nao e imagem da materia (controle negativo no teste).
  - `droppedImagesMessage` vive em `.ts`, e nao no `.tsx` do campo, **por motivo
    mecanico**: o vitest do CMS nao coleta `.tsx`. Escrita la, a frase nasceria
    sem teste e o plural errado so apareceria para o redator.
  - `planPaste` **e** `planRichPaste` passam a relatar `droppedImages`. Dar o
    relatorio a so um dos dois criaria segunda verdade sobre o que a colagem
    custou — e ha teste provando que os dois respondem o mesmo.
  - **Defeito vizinho corrigido de carona:** o aviso de colagem so era emitido
    quando havia paragrafo EXTRA (`if (rest.length > 0) appendSpans(rest)`).
    Colagem que cabia num paragrafo so nao dizia nada — e e exatamente o caso de
    colar um trecho curto com uma foto. Agora o relato sai sempre; o texto de
    "dividido em N paragrafos" continua saindo so quando houve divisao (senao
    diria "dividido em 1 paragrafos").
  - O aviso e elemento PROPRIO (`role="alert"`, linguagem visual do aviso de
    paragrafo vazio), nao uma frase concatenada no aviso neutro: um cobra acao,
    o outro so informa o que o editor fez.
  - O texto de ajuda passa a dizer antes do gesto: "imagens nao vem junto, use o
    bloco de imagem".
- **Migration:** nenhuma. **Contrato:** intocado — nada aqui muda
  `editorialBody` nem `publishedEditorialBody`.
- **O que NAO foi feito, de proposito:** filtro de pixel de rastreamento (`<img>`
  1x1). Nao ha evidencia de que ele apareca em HTML de area de transferencia
  (que carrega o fragmento SELECIONADO), e um filtro por `width`/`height`
  chutado erraria nos dois sentidos. Fica registrado: se o aviso passar a acusar
  imagem onde nao ha, e aqui que se olha.
- **Testes criados (12, em `rich-paste.test.ts`, que vai de 18 para 30):** conta
  uma imagem; dedup por arquivo; arquivos diferentes contados separadamente
  (**controle da dedup** — sem ele, uma implementacao que sempre devolvesse 1
  passaria); imagem sem `src` conta por si; **CONTROLE NEGATIVO** de imagem
  dentro de `<script>`/comentario/`<style>`; **CONTROLE NEGATIVO** de texto sem
  imagem; **CONTROLE NEGATIVO** provando que a imagem no meio nao deixa bloco
  fantasma; singular/plural/`null` da frase; o plano relatando a contagem;
  **CONTROLE NEGATIVO** de colagem em texto puro (um `<img>` DIGITADO nao e
  arquivo perdido); e os dois planos relatando a MESMA perda.
- **Gates (Node 24, local):** cms test `498/498` em 22 arquivos · root test
  `4784/4784` em 362 arquivos · cms typecheck `0` · root typecheck `0` · lint dos
  arquivos alterados `0` · `audit:invariants` PASSOU (7 ok) · `audit:render`
  PASSOU (2 ok) · **cms build OK** (`✓ Compiled successfully`, page data
  coletada).
  - Nota de ambiente: `pnpm --filter @screena/cms build` **sem env** falha em
    `Failed to collect page data` — sao as guardas de `env.ts` e
    `upload-storage-config.ts` funcionando (`PAYLOAD_DATABASE_URL`,
    `PAYLOAD_SECRET`, `PAYLOAD_UPLOAD_STORAGE_DRIVER`,
    `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED`, `PAYLOAD_UPLOAD_LOCAL_ROOT`).
    O build acima rodou com valores DESCARTAVEIS de verificacao; nada real.
  - O worktree estava sem `node_modules`: `pnpm install` completo (nunca
    filtrado) + `pnpm --filter @screena/db db:generate`. Sem o generate, o
    typecheck da raiz acusa 7 erros em `services/user-platform/**` que **nao**
    sao do codigo — sao o client do Prisma faltando.
- **O que NAO foi visto rodando:** o painel. O E2E local nao roda em Node 24
  (pendencia 4) e a colagem depende de `ClipboardEvent` real. **Quem prova a
  tela e o CI.** O que esta provado aqui e a contagem, a frase e o plano — a
  parte pura, que e onde estavam os dois defeitos.

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

### F6, F7, F9..F13 — PENDENTES (nova ordem: F13 primeiro — decisao (j))

**F13** teste de varredura de contrato · F6 canvas · F7 editor e menu `/` ·
F8 embeds e galeria · F9 midia · F10 SEO · F11 preview · F12 limpeza e as quedas
silenciosas restantes.

---

## Diagnostico registrado — default de licenca da midia (2026-08-05)

**Pergunta do operador.** Ele e o unico operador: sobe, decide e responde pelos
direitos. Quanto custa (a) upload feito por administrador nascer `approved` +
`allowedForEditorial`, ou (b) um controle unico de "respondo por esta" no proprio
upload? **NAO IMPLEMENTADO — registrado para leitura humana.**

### O que trava hoje, e onde

| Camada | Regra | Arquivo |
| --- | --- | --- |
| Nascimento | `licenseStatus: 'unknown'`, tres permissoes `false` | `apps/cms/src/collections.ts:575-588` |
| Gate de publicacao (CMS) | conta como nao autorizada toda midia que nao seja `approved` **e** `allowedForEditorial`; capa exige `allowedForHero` | `apps/cms/src/hooks/articles.ts:185-195` → `workflow.ts:223` |
| Contrato do evento | recusa midia com `requiresAttribution` e sem `credit` | `packages/editorial-contracts/src/publication-event-v1.ts:251-259` |
| Entrega dos bytes | `approved` (so ele), licenca nao vencida, permissao da finalidade, credito quando exigido | `apps/cms/src/media-authorization.ts:81-140` |
| Projecao | recusa o EVENTO INTEIRO se houver midia sem credito exigido | `services/news-ingestion/src/editorial-projection.ts:348-350`, `:406-418` |

### Achado 1 — mudar o default nao quebra teste nenhum, e isso e o problema

Varri `apps/cms/src/__tests__/**` e `tests/governance/**`: **nenhum teste afirma
o default da collection `media`**. Os dois que travam `licenseStatus: 'unknown'`
falam de OUTRA coisa — `schema-safe-defaults.test.ts:66` e sobre a tabela
`source_licenses` do banco PUBLICO (Prisma), e `rapidapi-offline-only.test.ts:203`
e sobre o store de ratings. Controle negativo executado: `grep` por
`defaultValue` nos testes do CMS nao retorna nada.

Ou seja: hoje o fail-closed da midia do CMS e sustentado por um **comentario**
(`collections.ts:578`, `:585`), nao por uma trava. Qualquer das duas opcoes pode
ser implementada sem nenhum teste ficar vermelho — o que significa que a decisao
nao tem rede de seguranca. **Se qualquer uma for adiante, o teste que falta vem
JUNTO, nao depois.**

### Achado 2 — o custo real da opcao (a) nao e a licenca, e o CREDITO

`requiresAttribution` nasce **`true`** (`collections.ts:584`) e nao muda com a
licenca. Entao, com upload nascendo `approved`, o caminho comum passa a ser:
imagem liberada, credito vazio. E ai o desfecho **depende de onde a imagem foi
usada**, o que hoje e assimetrico:

- **Capa ou galeria** — o evento e montado com `hero` + `gallery`
  (`publication.ts:249`), o contrato recusa (`publication-event-v1.ts:252`), e o
  hook **lanca `APIError` 500 e derruba a transacao**
  (`hooks/articles.ts:506-513`). Publicar responde com erro tecnico em vez de
  publicar. Barulhento, mas feio.
- **Imagem do CORPO** — `mediaIds` **nao** inclui a midia dos blocos de imagem.
  O evento passa, a materia publica, e a recusa so acontece la na frente: o
  worker pede os bytes e recebe `attribution_missing`
  (`media-authorization.ts:117-124`), com o pedido marcado `required: true`
  (`services/news-ingestion/src/media/media-plan.ts:44-49`). Resultado: **materia
  publicada no CMS que nao aparece no site** — exatamente o desfecho que o
  comentario do gate diz existir para evitar (`hooks/articles.ts:105-108`).

**Esta assimetria ja existe hoje**; ela e apenas rara, porque hoje toda midia
passa pela mao de alguem que ve o campo de credito ao liberar. A opcao (a) tira
esse momento do caminho e transforma o caso raro em caso comum. **Achado novo
desta sessao — entra na lista de quedas silenciosas do F13 (seria a setima).**

### Achado 3 — o que se perde com um segundo redator

- `canAuthorContent` inclui `administrator`, `editor_in_chief`, `editor` e
  `writer` (`access.ts:31-36`), e **qualquer um deles** cria e edita `media`
  (`access.ts:97-102`). Amarrar o nascimento-aprovado a `administrator` cria dois
  comportamentos para o mesmo gesto: a mesma foto, subida por duas pessoas,
  nasce com licencas diferentes. Quem sobe pelo caminho "errado" nao ve erro —
  ve a publicacao ser recusada depois, sem entender por que.
- **A collection `media` nao tem `versions`** (`collections.ts:534-560`, comparar
  com `Authors`, `:442`). Nao existe registro de QUEM liberou uma imagem nem
  QUANDO. Hoje isso e tolerável porque ha um operador so; com dois, a pergunta
  "quem respondeu por esta foto?" **nao tem resposta no sistema**. Isso vale para
  as duas opcoes, e e o unico ponto em que (b) e estritamente melhor que (a): um
  ato explicito tem onde ser carimbado; um default nao tem.

### Custo comparado

| | (a) nascer approved para administrador | (b) controle unico "respondo por esta" |
| --- | --- | --- |
| Superficie de codigo | 1 arquivo (`collections.ts`) + hook para nao valer para service account | 1 componente + 1 campo (o `MediaReleaseControl` ja existe e ja faz isso em 1 clique, `admin/MediaReleaseControl.tsx:50-60`) |
| Credito vazio | vira o caso comum → achado 2 | o controle pode exigir credito no mesmo gesto |
| Trilha de quem decidiu | nenhuma (default nao carimba) | tem onde carimbar |
| Invariante 6 | passa a ser "confio no papel" | continua sendo "alguem decidiu" |
| Segundo redator | dois comportamentos para o mesmo gesto | mesmo gesto para todo mundo |
| Teste que falta | o que trava o default (achado 1) | o mesmo, mais o do controle |

**O que eu recomendo, se me perguntarem:** (b) — e menor do que parece, porque o
controle **ja existe**; o que falta e ele estar no formulario de UPLOAD e nao so
no documento ja salvo, e exigir o credito quando `requiresAttribution` estiver
ligado. Mas a decisao e do operador e nao esta tomada.

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
6. **Credito de imagem do CORPO nao e checado na publicacao** (achado de
   2026-08-05, ver diagnostico abaixo). `mediaIds` do evento e so capa +
   galeria (`apps/cms/src/publication.ts:249`), entao a regra de credito do
   contrato (`publication-event-v1.ts:251-259`) **nao alcanca** a imagem do
   corpo. Ela e barrada so na ENTREGA dos bytes
   (`media-authorization.ts:117-124`), com o pedido `required: true`
   (`media/media-plan.ts:44-49`) — ou seja, materia publicada no CMS que nao
   aparece no site. Hoje e raro porque a liberacao passa pela mao de alguem que
   ve o campo de credito. **Entra no F13.**

---

## Ordem de deploy quando terminar

Quando o contrato muda, **consumidor antes de produtor**:

1. `screen-app` (`apps/web`) — passa a saber desenhar o que vai chegar;
2. worker de projecao (`services/news-ingestion`);
3. `cinerie-cms` (`apps/cms`) — so entao passa a emitir.

`Dockerfile.cms` roda `cms:migrations:deploy` na subida e **derruba o container**
se a migration falhar — por isso a migration de F4 aborta com mensagem humana em
vez de deixar o PostgreSQL falhar com o nome do indice.
