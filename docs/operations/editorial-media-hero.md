# Apontar a capa por maquina (`PATCH /api/internal/editorial-media/:mediaId/hero`)

> Fecha o no de ordem que sobrou da ingestao de midia. Complementa
> [`editorial-media-ingest.md`](./editorial-media-ingest.md), que cobre o trecho
> ANTERIOR (bytes -> acervo), e
> [`editorial-media-projection.md`](./editorial-media-projection.md), que cobre o
> SEGUINTE (CMS -> storage publico -> site).

## 1. O no que esta rota desfaz

O log de producao registrou o sintoma exato:

```
mediaId=14 obtido para article_id=19, mas a capa NAO foi apontada
nesta rodada (resubmissao com media[] nao implementada)
```

As fotos entram no acervo, ficam vinculadas a materia certa — e nenhuma materia
tem capa. A causa e de **ordem**, nao de permissao:

```
POST /internal/editorial-drafts   ── exige nada da foto      ──► materia (id 19)
POST /internal/editorial-media    ── exige articleId (19)    ──► foto (id 14)
                                     ^^^^^^^^^^^^^^^^^^^^
                                     so existe DEPOIS da materia

contrato de publicacao            ── exige media[].mediaId NO ENVIO
                                     ^^^^^^^^^^^^^^^^^^^^^^
                                     so existe DEPOIS da foto
```

Quem entrega texto e foto em duas chamadas nunca tem as duas coisas na mesma
rodada. **Esta rota e a terceira chamada**, e ela existe porque as saidas obvias
nao servem:

| Saida | Por que nao |
| --- | --- |
| reenviar a materia com `media[]` | bate em `staleRevision`: a revisao nao mudou |
| reenviar como `update` | reescreve `workflowStatus` e consome cota `article_update` (5/materia/dia) |
| trazer de volta o `setAsHero` | e o desenho removido no PR #136 — ver §6 |
| esperar a materia voltar a `automation_draft` | ela nunca volta: o intake de publicacao a tira de la na mesma chamada — ver §7 |

## 2. Credencial

Conta tecnica com o escopo **`editorial_media_ingest`** — o **mesmo** da ingestao
de bytes, e nao um terceiro.

Quem ja pode POR a foto no acervo daquela materia nao ganha poder novo ao dizer
qual delas e a capa. Criar um escopo separado sugeriria uma fronteira que nao
existe e daria mais uma chave para rotacionar.

`draft_ingest` continua **sem alcance nenhum** aqui, e isso e travado por teste
de integracao.

```
Authorization: service-accounts API-Key <chave>
```

## 3. Pedido

```
PATCH /api/internal/editorial-media/14/hero
Content-Type: application/json

{ "articleId": "19" }
```

`mediaId` vem do **caminho** e `articleId` do **corpo**. A assimetria e
deliberada: a foto e o recurso alterado (por isso identifica a URL), e a materia
e a afirmacao que sera **conferida** contra `media.ingestedForArticle`.

## 4. Respostas

| Status | `outcome` | Quando |
| --- | --- | --- |
| `200` | `linked` | a materia nao tinha capa; agora tem |
| `200` | `unchanged` | ja era esta capa — **nenhuma escrita, nenhuma versao nova** |
| `200` | `replaced` | tinha outra capa, tambem ingerida por maquina para esta materia |

Corpo: `{ outcome, articleId, mediaId, previousMediaId }`.

`unchanged` nao escrever nao e otimizacao: cada `update` cria uma linha de versao,
e um pipeline que reenvia a cada revisao encheria o historico da materia com
versoes que nao mudaram nada.

### Recusas

| Status | `error` | Significado |
| --- | --- | --- |
| `401` | `unauthenticated` | credencial ausente ou nao reconhecida |
| `403` | `forbidden_scope` | conta reconhecida, sem `editorial_media_ingest` |
| `400` | `invalid_json` | corpo nao e um objeto JSON |
| `422` | `validation_failed` | `mediaId`/`articleId` ausente ou nao numerico — **todos em `issues[]`** |
| `404` | `media_not_found` | a foto nao existe |
| `404` | `article_not_found` | a materia nao existe |
| `409` | `media_not_ingested_for_article` | a foto nao foi ingerida **para aquela materia** |
| `409` | `media_not_hero_eligible` | licenca editorial revogada, ou `allowedForHero` desligado |
| `409` | `article_not_automation_origin` | a materia nao veio do pipeline — capa de materia humana e decisao humana |
| `409` | `article_withdrawn` | a materia esta `retracted`, `blocked` ou `archived` |
| `409` | `hero_not_owned_by_automation` | a capa atual foi escolhida por gente |
| `500` | `hero_write_failed` | a decisao aprovou e a escrita falhou; a causa vai para o log do servidor |

A ordem em que os `409` sao avaliados aponta a causa mais corrigivel primeiro:
pertencimento -> licenca -> **proveniencia da materia** -> materia fora de
circulacao -> proveniencia da capa atual. Um emissor que recebe
`article_not_automation_origin` sabe que o `mediaId` estava certo.

> **Mudou desde o PR #139.** O codigo `article_not_automation_draft` **nao
> existe mais**. Ele recusava toda materia fora de `automation_draft` — e,
> como a §7 explica, isso era **toda materia** no caminho real. Quem tratava
> esse codigo pode remover o tratamento: ele nunca mais e emitido.

## 5. O que a rota NAO faz

- **nao muda `workflowStatus`** nem `_status` — os dois sao reescritos com o
  valor ANTERIOR, e o teste de integracao confere isso numa materia
  `ready_to_publish` e numa materia `published`;
- **nao consome cota** de autopublicacao;
- **nao le nem escreve `sourceRevision`**, e nao passa por `staleRevision`;
- **nao escreve no `screen-db`** nem chama o `screen-app`.

Os quatro sao verificados por teste de integracao contra Payload + PostgreSQL 16
reais, e nao por leitura de codigo.

### A excecao: materia JA PUBLICADA emite `article.updated`

Materia que ainda nao esta no ar **nao gera evento** (medido: a outbox nao muda).
Materia **`published`** gera um `article.updated` — e precisa gerar.

Nao e esta rota que emite: quem emite e `emitPublicationEvent`, pela regra que ja
valia para qualquer edicao de materia publicada. E ela nao pode ser suprimida
aqui, porque o evento e o unico caminho pelo qual a capa chega ao lado publico.
Suprimir deixaria a foto vinculada no CMS e a pagina publica sem capa —
exatamente a falha silenciosa que esta rota existe para fechar.

A consequencia operacional e uma reprojecao a mais por materia autopublicada que
recebe capa. Nenhuma cota e consumida, e o evento e idempotente.

## 6. Por que isto nao reintroduz o problema do PR #136

O `setAsHero` da rota de ingestao aceitava um booleano e chamava
`payload.update` em `articles`. O motivo declarado da remocao: o hook de
governanca (`hooks/articles.ts`) forca `workflowStatus = 'automation_draft'` para
toda service account sem `editorial_auto_publish`, e subir a foto de uma materia
que um humano deixou em `ready_to_publish` a rebaixaria em silencio.

**O PR #139 tratou isso com uma trava de ESTADO** (so aceitar materia ja em
`automation_draft`). A trava funcionava contra o rebaixamento e tornou a rota
inalcancavel — ver §7. Ela foi substituida, e a substituicao **fecha o mesmo
defeito por dentro**, em vez de por fora:

1. **o hook nao escreve estado nesta rota.** A escrita viaja com
   `context.heroMediaLink`, montado no processo pelo handler (nenhum corpo HTTP
   preenche `req.context`). Nessa excecao o hook reescreve `workflowStatus` e
   `_status` com **os valores anteriores** — nao ha degrau para descer porque
   nao ha escrita de estado nenhuma. Antes a garantia era "a rota nunca escreve
   fora de `automation_draft`"; agora e "a rota nunca escreve estado";
2. **a excecao e estreita.** Ela exige as tres coisas ao mesmo tempo:
   `req.context.heroMediaLink`, o escopo `editorial_media_ingest` e
   `operation === 'update'`. `draft_ingest` nao alcanca; o painel nao alcanca;
   nenhum cliente HTTP consegue ligar a chave.

**O que protegia a decisao humana nunca foi o estado.** Era — e continua sendo —
a **proveniencia da capa atual**: se a capa ja gravada nao veio da ingestao por
maquina daquela materia, ela veio de gente, e a rota recusa
(`hero_not_owned_by_automation`). Esse teste nao mudou uma linha.

**O que foi medido**, com o teste de integracao rodando contra Payload +
PostgreSQL reais: materia em `ready_to_publish` recebe a capa e **continua** em
`ready_to_publish`; materia `published` recebe a capa e **continua** `published`
(inclusive `_status`); materia sem marca de automacao e recusada com `409`.

Alem disso, esta rota tem duas travas que o `setAsHero` nao tinha:

- **pertencimento.** A foto precisa ter sido ingerida **para aquela materia**.
  Sem isso o `mediaId` seria escrita arbitraria: bastaria enumerar ids para
  pendurar qualquer imagem do acervo em qualquer materia;
- **capa de gente nao e reescrita por robo.** Se a capa atual nao veio da
  ingestao por maquina daquela materia, ela veio de um humano — e a rota recusa.
  Mesma regra dos vinculos de entidade;
- **materia de gente nao recebe capa de robo**, nem quando ainda nao tem capa
  nenhuma (`article_not_automation_origin`). O acervo e compartilhado: sem isto
  bastaria ingerir uma foto "para" uma pauta humana para pendurar a capa nela.

## 7. Sequencia para o MNScr

Vale para **os dois** intakes. O passo 1 e o que o pipeline ja usa:

```
1a. POST /api/internal/editorial-drafts        -> articleId  (materia fica em automation_draft)
1b. POST /api/internal/editorial-publications  -> articleId  (materia fica em needs_review OU published)
2.  POST /api/internal/editorial-media         -> mediaId    (articleId do passo 1)
3.  PATCH /api/internal/editorial-media/:mediaId/hero  { articleId }
```

Os tres passos sao idempotentes e podem ser repetidos na integra a cada revisao:
o passo 2 devolve `unchanged` quando os bytes nao mudaram, e o passo 3 devolve
`unchanged` quando a capa ja e aquela. Quando a fonte troca a foto no mesmo
endereco, o passo 2 devolve `replaced` com um `mediaId` novo e o passo 3 devolve
`replaced` — a capa acompanha.

### O que estava errado aqui, e foi medido em producao

A versao anterior desta secao listava **so o `1a`** e afirmava: *"depois que a
materia sai de `automation_draft`, o passo 3 passa a recusar com `409` — isso e o
desenho"*. A recomendacao descrevia uma sequencia que o codigo do mesmo
repositorio proibia.

`/internal/editorial-publications` cria a materia em `automation_draft` e, na
**mesma chamada**, caminha por `['ready_to_publish', 'published']` (desfecho
`201`) ou `['needs_review']` (desfecho `202`) **antes** de a resposta com o
`articleId` sair. Quando o emissor tem o id para chamar o passo 3, a materia ja
saiu do unico estado que o passo 3 aceitava — nos **dois** desfechos. Medido:
materia 23, midia 18, `409 article_not_automation_draft`.

O passo 3 hoje pergunta pela **proveniencia**, nao pelo estado: ele aceita
qualquer materia que carregue marca de automacao
(`sourceClusterId`/`automationDraftId`/`automationActorId` — campos que
`HUMAN_FORBIDDEN_FIELDS` impede qualquer pessoa de escrever ou apagar), e recusa
so o que saiu de circulacao (`retracted`, `blocked`, `archived`).

**Nao ha mais passo manual, e nao ha janela para perder.** O passo 3 continua
valendo depois que um humano promove a materia — e nao mexe no estado dela.

## 8. Variaveis de ambiente

**Nenhuma nova.** A rota usa a autenticacao por API key do Payload e o mesmo
escopo da ingestao de midia. Nada a configurar em deploy.
