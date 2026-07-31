# Worker de projecao editorial (CMS -> banco publico)

> Documento operacional. O contrato de fronteira esta em
> [`docs/adr/0015-editorial-boundaries.md`](../adr/0015-editorial-boundaries.md);
> este arquivo descreve **como o worker roda** e o que fazer quando ele falha.

## 1. O que ele e

Processo **offline** que consome a outbox de publicacao do CMS (Payload) e
projeta o resultado no banco publico (`screen-db`).

```
Payload (banco proprio)                 screen-db (banco publico)
   publication-outbox  ── HTTP ──►  worker  ── Prisma ──►  articles
                                                            article_translations
                                                            editorial_projection_receipts
                                                            search_documents
                                                            page_indexability_decisions
```

E o **unico** processo que fala com os dois lados, e a ponte e **ASSIMETRICA**:

| Lado | Como o worker acessa | Como NAO acessa |
| --- | --- | --- |
| CMS (Payload) | API interna HTTP autenticada por API key | conexao Postgres, Drizzle, tabelas ou migrations do Payload |
| Banco publico (screen-db) | Prisma sobre `SCREEN_DATABASE_URL` | — |

Dizer "o worker acessa os dois bancos" descreveria outra arquitetura, pior: a
outbox deixaria de ser fronteira e viraria tabela compartilhada, e toda mudanca
de schema interno do CMS quebraria o pipeline publico. A proibicao e travada por
`tests/governance/editorial-worker-boundary.test.ts`, que percorre o fecho
TRANSITIVO de imports do worker — nao basta um modulo intermediario para
escapar.

O `apps/web` nunca fala com o Payload, e o Payload nunca escreve no `screen-db`.

Invariantes 3 e 4 continuam intactas: nenhuma pagina publica depende deste
worker estar de pe. Se ele parar, o site segue servindo o que ja foi projetado;
o que atrasa e a **chegada** de conteudo novo, nao a disponibilidade do antigo.

## 2. Como rodar

```bash
pnpm --filter @screena/news-ingestion project:editorial -- --once
```

| Modo | Efeito |
| --- | --- |
| `--once` | Reclama um lote, projeta, confirma e sai. E o modo de systemd timer. |
| `--loop` | Cicla ate receber `SIGINT`/`SIGTERM`, dormindo `PROJECTION_POLL_INTERVAL_MS` quando a fila esta vazia. |
| `--dry-run` | Decide tudo, **nao escreve** e **nao confirma**. Inspeciona o que uma fila acumulada faria. |

## 3. Ambiente

| Variavel | Obrigatoria | Papel |
| --- | --- | --- |
| `SCREEN_DATABASE_URL` | sim | Banco publico. **Nunca** reaproveitar `PAYLOAD_DATABASE_URL`. |
| `PAYLOAD_INTERNAL_SERVICE_URL` | sim | Base http(s) do CMS. |
| `PAYLOAD_PROJECTION_API_KEY` | sim | Chave da conta tecnica com escopo `publication_projection`. |
| `PROJECTION_WORKER_ID` | sim | Identidade do processo. Vai para `locked_by` e para o recibo. |
| `PAYLOAD_PROJECTION_API_KEY_COLLECTION` | nao | Default `service-accounts`. |
| `PROJECTION_BATCH_SIZE` | nao | Default 10, teto 25. |
| `PROJECTION_LEASE_MS` | nao | Default 60s. |
| `PROJECTION_POLL_INTERVAL_MS` | nao | Default 15s. |
| `PROJECTION_REQUEST_TIMEOUT_MS` | nao | Default 20s. |

O worker **recusa subir** quando:

- `SCREEN_DATABASE_URL` e `PAYLOAD_DATABASE_URL` apontam para o mesmo banco;
- `SCREEN_DATABASE_URL` tem cara de producao (`rss_prime`, `_prod`,
  `production`) sem `--allow-production-url` explicito.

`--allow-production-url` vale para o **processo inteiro**, inclusive para o
`/readyz`: o readiness reavalia a mesma configuracao a cada batida do
orquestrador e usa a mesma autorizacao. Enquanto ele nao usava, o container
subia com `/healthz` 200 e `/readyz` 503 permanente dizendo
`SCREEN_DATABASE_URL parece apontar para producao; recusado` — o worker
trabalhava, mas o orquestrador o tratava como nao-pronto. Travado por
[`worker-readiness.test.ts`](../../services/news-ingestion/src/__tests__/worker-readiness.test.ts).

> O `publication-worker:preflight` **nao** tem essa flag por design: ele e uma
> verificacao pre-deploy contra um alvo nao-produtivo. Rodado contra uma URL de
> producao, ele continua (corretamente) acusando `BLOCKED`.

Nenhuma mensagem de erro imprime valor de variavel — so o **nome**. Um timer
mal configurado nao pode virar vazamento de credencial no journal.

## 4. Escopos da conta tecnica

| Escopo | Quem usa | Pode |
| --- | --- | --- |
| `draft_ingest` | MNScr | `POST /api/internal/editorial-drafts` |
| `publication_projection` | este worker | `claim` / `ack` / `fail` da outbox |

Sao **disjuntos por design**. Um booleano generico de "automacao" daria ao MNScr
o poder de drenar a fila de publicacao e ao worker o poder de criar rascunho —
dois sistemas herdando os poderes um do outro por descuido.

Conta com lista de escopos **vazia** autentica e nao pode nada. E assim que se
revoga acesso sem apagar a conta (e sem perder a trilha de quem ela era).

## 5. Ciclo de um evento

1. **claim** — o worker pede ate `batchSize` eventos. Cada linha e tomada por
   *compare-and-swap* sobre `(id, status)`; dois workers concorrentes nunca
   levam o mesmo evento. A tentativa e contada **no claim**, nao no fail: um
   worker que morre sem reportar nada nunca incrementaria o contador e seria
   retentado para sempre.
2. **projecao** — artigo, traducao e **recibo** sao escritos numa transacao
   unica. A unique em `editorial_projection_receipts.event_id` e a trava de
   replay: uma segunda projecao do mesmo evento colide e a transacao inteira e
   desfeita.
3. **ack** — o evento vira `processed` e a lease e devolvida. Repetir o ack de
   um evento ja processado responde `already_processed` com 200 — e exatamente
   o que acontece quando o worker cai entre o commit e o ack.
4. **fail** — falha retentavel agenda nova tentativa com backoff exponencial
   (2s, 4s, 8s..., teto 5min). Falha permanente (`retryable: false`) ou
   tentativas esgotadas vao para `dead_letter`.

Lease **expirada** e recuperavel: um worker morto no meio nao prende o evento
para sempre. Lease **valida** e intocavel — e o que impede projecao dupla.

## 6. Desfechos possiveis

| Recibo | Significado |
| --- | --- |
| `applied` | O banco publico mudou. |
| `skipped_duplicate` | Evento ja tinha recibo (replay). Nada foi reescrito. |
| `skipped_stale` | Chegou fora de ordem; uma emissao mais nova ja foi projetada. |
| `skipped_unlicensed` | Bloqueado pela invariante 6 (ex.: midia exigindo atribuicao sem credito). |

A ordem vem da **sequencia de emissao** (o `id` serial da linha na outbox), nao
do campo `aggregateVersion` — aquele guarda um **hash do conteudo** publicado e
nao ordena nada.

## 7. O que a projecao NAO faz

- **Nao publica sozinha.** Ela reflete uma decisao humana ja registrada no CMS
  (invariante 12). Nenhum evento nasce de automacao.
- **Nao traz midia.** `articles.hero_image_path` e consumida por
  `normalizeNewsLocalImagePath`, que recusa URL http(s) por design; gravar a URL
  do CMS ali criaria dado morto. Trazer imagem exige pipeline de download e
  derivada local — deliberadamente fora desta fase. Toda materia com midia gera
  um **aviso** no log; silenciar seria pior, porque a redacao acharia que a foto
  foi publicada.
- **Nao indexa idioma incompleto.** Idioma fora de `PUBLISHED_LOCALES` projeta
  como `draft`/`noindex` (invariante 7).
- **Nao apaga materia.** Despublicar rebaixa para `archived`; retratar rebaixa
  para `blocked` e grava o motivo em `correction_note`. O texto permanece.

## 8. Diagnostico

| Sintoma | Causa provavel |
| --- | --- |
| `configuracao invalida: ...` na subida | Falta variavel, ou os dois bancos coincidem. O erro nomeia a variavel. |
| Evento parado em `processing` | Worker morreu com a lease aberta. Ela expira em `PROJECTION_LEASE_MS` e o proximo ciclo recupera. |
| Evento em `dead_letter` com `contract_invalid` | O evento nao passa em `publication-event-v1`. Nao adianta retentar: o corpo nao muda sozinho. Investigar o emissor no CMS. |
| Materia publicada mas fora da busca | O refresh do modelo derivado roda **depois** do commit. Rodar o worker de novo converge: o replay refresca a busca mesmo pulando a escrita. |
| `lastError` com `[redigido]` | Sanitizacao funcionando: a mensagem original carregava connection string ou header de autorizacao. |

## 9. Testes

| Gate | O que prova |
| --- | --- |
| `pnpm test` | Nucleo puro: elegibilidade de claim, lease, backoff, decisao de projecao, fronteira de configuracao. |
| `pnpm test:cms:integration` | CMS real: escopo, autenticacao por API key, hooks, outbox. |
| `pnpm test:publication-projection:integration` | **Dois PostgreSQL 16 efemeros**: publicacao ponta a ponta, concorrencia de dois workers, replay, evento fora de ordem, dead-letter, retratacao. |
| `pnpm --filter @screena/db db:validate:real` | Migration real em PG16: ancora unica, CHECKs dos blocos, trava de replay do recibo. |
