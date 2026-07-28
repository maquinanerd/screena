# apps/cms (`@screena/cms`) — CMS editorial da Cinerie

Sala de redacao do Cinerie, sobre **Payload 3**. Aplicacao **isolada**: banco
proprio, migrations proprias, sem Prisma e sem leitura pelo render publico.

Fronteiras canonicas: [`docs/adr/0015-editorial-boundaries.md`](../../docs/adr/0015-editorial-boundaries.md).

---

## 1. O que este servico e

```
RSS Prime  --rss-prime-event-v1-------------> MNScr
Cinerie    --cinerie-editorial-context-v1---> MNScr
MNScr      --editorial-draft-v1-------------> ESTE SERVICO
                                              revisao humana -> publicacao
                                              --publication-event-v1--> outbox
                                                 -> worker de projecao (NAO EXISTE AINDA)
                                                    -> services/news-ingestion -> screen-db -> screen-app
```

**Nao e** o `screen-app`, **nao e** o `apps/admin`, **nao substitui** nenhum dos dois.

| | `apps/web` (screen-app) | `apps/admin` | `apps/cms` (este) |
| --- | --- | --- | --- |
| Papel | site publico | painel operacional/QA | redacao editorial |
| Banco | `screen-db` via Prisma | `screen-db` via Prisma | **banco proprio** do Payload |
| Escrita | nenhuma | 2 campos de estado | conteudo completo |
| Publica? | nao | muda `review_status` da projecao | **sim**, por humano |

---

## 2. Como executar

```bash
pnpm --filter @screena/cms dev
```

Painel em `http://localhost:3002/admin`. Exige as variaveis abaixo.

## 3. Variaveis

| Variavel | Obrigatoria | Para que serve |
| --- | --- | --- |
| `PAYLOAD_DATABASE_URL` | **sim** | Banco **exclusivo** do CMS |
| `PAYLOAD_SECRET` | **sim** | Segredo do Payload (min. 32 caracteres) |
| `PAYLOAD_PUBLIC_SERVER_URL` | nao | URL publica do painel |

**`DATABASE_URL` NUNCA e usada como fallback.** `src/env.ts` recusa a
inicializacao quando: a variavel do CMS falta, o segredo falta ou e curto, a URL
do CMS e **identica** a `DATABASE_URL`, ou a URL **aparenta** apontar para um
banco publico do Cinerie (`screen-db`, `rss_prime`, `production`, ...). Nenhuma
mensagem de erro imprime URL, usuario, senha ou segredo.

## 4. Banco e migrations

Banco **isolado**, migrations proprias em `src/migrations`. `push` esta
desligado: mudanca de schema entra por migration versionada e revisavel.

```bash
pnpm --filter @screena/cms payload:migrate:create
pnpm --filter @screena/cms payload:migrate
pnpm --filter @screena/cms payload:migrate:status
```

Para desenvolvimento e teste, use **PostgreSQL 16 efemero**. Nunca aponte para o
`screen-db`.

## 5. Autenticacao

Duas identidades **separadas**, de proposito — uma so collection com um papel
`automation` faria a conta tecnica herdar, por um `access` mal escrito, poderes
de humano.

**`editorial-users`** (humanos, login local):

| Papel | Publica? | Resumo |
| --- | --- | --- |
| `administrator` | sim | administra CMS e usuarios |
| `editor_in_chief` | sim | revisa, aprova, publica, despublica, retrata |
| `editor` | **nao** | cria, edita, revisa, encaminha para publicacao |
| `reviewer` | **nao** | revisa, pede alteracao, marca revisao humana |
| `writer` | **nao** | cria e edita drafts |

**`service-accounts`** (maquinas — MNScr): **somente API key**, sem login local,
ocultas do painel. Podem chamar o endpoint de drafts e criar/atualizar o proprio
`automation_draft`. **Nao** publicam, nao despublicam, nao apagam, nao
administram usuarios e **nao leem a colecao de artigos**.

## 6. Endpoint de drafts

```
POST /api/internal/editorial-drafts     (API key de service account)
```

Valida `editorial-draft-v1`, calcula hash canonico, aplica idempotencia e cria um
artigo **sempre** em `automation_draft`. Recusa qualquer tentativa de publicacao
embutida no payload (`publish`, `autoPublish`, `workflowStatus`, ... em qualquer
nivel). Limites: 1 MB de corpo, 200 blocos, 50 fontes, 100 claims.

Idempotencia: mesma chave + mesmo corpo devolve o resultado existente; mesma
chave + corpo diferente e conflito; revisao superior atualiza; revisao inferior e
recusada; artigo com autoria humana **nunca** e sobrescrito; artigo publicado
recebe **proposta** de atualizacao, nunca alteracao silenciosa.

## 7. Workflow

`workflowStatus` proprio, com 12 estados. O `_status` do Payload
(`draft|published`) **nao** e o fluxo editorial: ele tem 2 valores e o fluxo tem 12.

```
automation_draft -> draft -> needs_review -> in_review -> human_reviewed
   -> ready_to_publish -> published -> needs_update | blocked | retracted | archived
```

`automation_draft` nunca vai direto a `published`. `blocked` e `retracted` so
voltam para `needs_review`. Publicar exige `ready_to_publish`, QA sem erro
bloqueante, autor **ativo**, slug, e midia autorizada.

**Este ciclo de vida NAO e o de `services/news-ingestion`.** Aquele governa
`article_translations`, o registro da projecao publica; este governa a redacao.
Mesma licao do [ADR 0016](../../docs/adr/0016-content-block-lifecycle-separation.md).

## 8. Outbox

Publicacao humana valida grava um `publication-event-v1` em
`publication-outbox` (`pending`). O CMS **nao** chama o lado publico: se o
`screen-db` estiver fora do ar, a materia nao se perde nem a publicacao trava.
Ninguem cria, edita ou apaga evento pela UI.

## 9. Limitacoes desta fase

Nao implementados: **worker consumidor da outbox**, projecao no `screen-db`,
Cinerie Context Service, integracao real com MNScr e RSS Prime, storage remoto
(R2/S3), leitura pelo frontend publico. Midia usa **filesystem local**, valido
so em desenvolvimento.

## 10. Implantacao pretendida

> **INFORMACAO DECLARADA PELO USUARIO — PENDENTE DE VALIDACAO OPERACIONAL.**
> Nada foi verificado no painel, e nenhum servico, banco, dominio ou secret foi
> criado por esta fase.

Projeto EasyPanel `rss_prime`, com os servicos declarados `feed` (RSS Prime),
`screen-app` (Cinerie publico, `apps/web`) e `screen-db` (PostgreSQL). O Payload
sera, **em fase posterior**, um **novo servico separado** no mesmo projeto,
apontando para este repositorio e executando **exclusivamente `apps/cms`** —
nunca dentro do container do `screen-app`. O MNScr e o mecanismo de projecao
serao igualmente servicos separados.

O que esta fase deixou pronto para isso: build e start independentes (porta
3002), nenhuma dependencia de `apps/web`/`apps/admin`, banco proprio por variavel
exclusiva e migrations proprias. O nome do servico, o dominio, o database real e
os secrets sao decisao manual do usuario em fase posterior.
