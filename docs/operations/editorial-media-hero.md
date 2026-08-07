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
| `409` | `article_not_automation_draft` | a materia saiu do alcance da automacao |
| `409` | `hero_not_owned_by_automation` | a capa atual foi escolhida por gente |
| `500` | `hero_write_failed` | a decisao aprovou e a escrita falhou; a causa vai para o log do servidor |

Os `409` sao **todos** de estado, e a ordem em que sao avaliados aponta a causa
mais corrigivel primeiro: pertencimento -> licenca -> estado da materia ->
proveniencia da capa atual. Um emissor que recebe `article_not_automation_draft`
sabe que o `mediaId` estava certo.

## 5. O que a rota NAO faz

- **nao muda `workflowStatus`** (o `data` do update carrega um campo: `heroMedia`);
- **nao consome cota** de autopublicacao;
- **nao le nem escreve `sourceRevision`**, e nao passa por `staleRevision`;
- **nao emite evento na outbox** — apontar capa nao e publicacao, correcao nem
  retratacao, e o lado publico nao tem nada a saber;
- **nao escreve no `screen-db`** nem chama o `screen-app`.

Os cinco sao verificados por teste de integracao contra Payload + PostgreSQL 16
reais, e nao por leitura de codigo.

## 6. Por que isto nao reintroduz o problema do PR #136

O `setAsHero` da rota de ingestao aceitava um booleano e chamava
`payload.update` em `articles`. O motivo declarado da remocao: o hook de
governanca (`hooks/articles.ts`) forca `workflowStatus = 'automation_draft'` para
toda service account sem `editorial_auto_publish`, e subir a foto de uma materia
que um humano deixou em `ready_to_publish` a rebaixaria em silencio.

**A diferenca e a ORDEM.** Esta rota **recusa antes de escrever**: so aceita
materia que **ja esta** em `automation_draft`. Nesse estado o valor que o hook
forca e o valor ja gravado — nao ha degrau para descer.

**Registro do que foi medido, porque contraria a leitura obvia.** Removendo essa
trava e rodando o teste de integracao, a materia em `ready_to_publish` **nao** e
rebaixada: o hook calcula o estado alvo a partir de `originalDoc` e **nega** a
escrita; a linha que rebaixaria so roda depois da negativa. O que se observa e um
`500` opaco.

A trava continua sendo a certa por duas razoes que o `500` deixa claras:

1. **o motivo chega ao emissor.** `500` diz "o servidor quebrou" e nao diz o que
   corrigir; `409 article_not_automation_draft` diz que o `mediaId` estava certo;
2. **a seguranca fica local.** Depender da negativa do hook e depender de
   `originalDoc` estar presente e de o calculo do alvo continuar como esta. Basta
   esta rota um dia mandar `workflowStatus` no `data` — ou o hook passar a
   tolerar payload parcial — para o rebaixamento silencioso voltar inteiro.

Alem disso, esta rota tem duas travas que o `setAsHero` nao tinha:

- **pertencimento.** A foto precisa ter sido ingerida **para aquela materia**.
  Sem isso o `mediaId` seria escrita arbitraria: bastaria enumerar ids para
  pendurar qualquer imagem do acervo em qualquer materia;
- **capa de gente nao e reescrita por robo.** Se a capa atual nao veio da
  ingestao por maquina daquela materia, ela veio de um humano — e a rota recusa.
  Mesma regra dos vinculos de entidade.

## 7. Sequencia recomendada para o MNScr

```
1. POST /api/internal/editorial-drafts        -> articleId
2. POST /api/internal/editorial-media         -> mediaId   (articleId do passo 1)
3. PATCH /api/internal/editorial-media/:mediaId/hero  { articleId }
```

Os tres passos sao idempotentes e podem ser repetidos na integra a cada revisao:
o passo 2 devolve `unchanged` quando os bytes nao mudaram, e o passo 3 devolve
`unchanged` quando a capa ja e aquela. Quando a fonte troca a foto no mesmo
endereco, o passo 2 devolve `replaced` com um `mediaId` novo e o passo 3 devolve
`replaced` — a capa acompanha.

**Depois que a materia sai de `automation_draft`, o passo 3 passa a recusar com
`409`.** Isso e o desenho, nao uma falha: dali em diante a capa e assunto de
quem esta editando a materia.

## 8. Variaveis de ambiente

**Nenhuma nova.** A rota usa a autenticacao por API key do Payload e o mesmo
escopo da ingestao de midia. Nada a configurar em deploy.
