# Runbook — integrar o MNScr ao canal de autopublicacao

> Para quem vai escrever o lado do MNScr (ou depurar por que uma materia nao
> apareceu). Nao pressupoe conhecimento do codigo do CMS: cada regra esta
> explicada em portugues, com a ancora do arquivo entre parenteses para quem
> quiser conferir.
>
> O que este documento cobre: **o que o CMS responde e o que o produtor deve
> fazer com cada resposta**. O que ele nao cobre: como o MNScr decide o que
> publicar — isso e do outro lado da fronteira
> ([`docs/adr/0015-editorial-boundaries.md`](../adr/0015-editorial-boundaries.md)).

---

## 1. O endpoint

```
POST /api/internal/editorial-publications
Content-Type: application/json
Authorization: <credencial da conta de servico>
```

Implementacao: [`apps/cms/src/endpoints/editorial-publications.ts`](../../apps/cms/src/endpoints/editorial-publications.ts).

### Escopo exigido

A conta de servico precisa do escopo **`editorial_auto_publish`**. Sem ele a
resposta e `403 forbidden_scope`, e nao adianta reenviar.

Os tres poderes editoriais sao **disjuntos de proposito** — uma conta so tem o
que foi concedido a ela:

| Escopo | Pode |
| --- | --- |
| `draft_ingest` | propor rascunho em `/api/internal/editorial-drafts`. **Nao publica.** |
| `editorial_auto_publish` | publicar por este endpoint |
| `publication_projection` | consumir a outbox e projetar no site publico |

Se a integracao so precisa **propor** conteudo para revisao humana, use
`draft_ingest` e o endpoint de rascunho. Este runbook e sobre o canal que
publica sozinho.

### Contrato do pedido

| Campo | Valor atual |
| --- | --- |
| `contractName` | `editorial-publication-request-v1` |
| `contractVersion` | `1.0.0` |
| `schemaHash` | `sha256:930243294465802778f73151d53ee510a2313d44673de9e6e7866032bfe6c6f8` |

Os tres viajam **dentro do corpo do pedido** e sao conferidos os tres: nome,
versao e hash. Divergencia em qualquer um recusa o pedido com `409 CONFLICT` —
fail-closed, e de proposito. Um schema diferente pode ter um campo de mesmo nome
com outra semantica, e "quase compativel" e como se publica materia errada.

**Descubra os valores em vez de fixa-los no codigo.** O CMS publica um manifesto:

```
GET /api/internal/contracts
```

Ele devolve nome, versao, hash, compatibilidade e direcao de cada contrato — so
identidade, nada de schema. E barato o suficiente para ser chamado a cada boot
do MNScr, e e assim que ele deve ser usado: leia o manifesto, compare com o que
voce tem, e **pare antes de enviar** se divergir. Descobrir a incompatibilidade
na hora do envio significa descobrir com o conteudo ja pronto.

O JSON Schema completo, para gerar tipos do seu lado:

```
GET /api/internal/contracts/editorial-publication-request-v1
```

A comparacao de versao e por **igualdade exata**, nao por intervalo
(`checkContractCompatibility` em
[`packages/editorial-contracts/src/manifest.ts`](../../packages/editorial-contracts/src/manifest.ts)).
`1.0.0` nao aceita `1.0.1`.

---

## 2. Tabela de desfechos

Toda resposta traz um campo `outcome`. E ele — nao o codigo HTTP sozinho — que
diz o que aconteceu.

| `outcome` | HTTP | Significado | Persiste? | Retentar? |
| --- | --- | --- | --- | --- |
| `PUBLISHED` | **201** | Publicou. A materia esta no ar e o evento entrou na outbox. | sim, `published` | nao — ja terminou |
| `ROUTED_TO_REVIEW` | **202** | Conteudo aceito, falta julgamento humano. | **sim, `needs_review`** | **nao** |
| `DEFERRED` | **429** | Conteudo aceito, cota do dia esgotada. | **nao — nada** | **SIM** |
| `BLOCKED` | **422** | Defeito permanente no pedido. | nao | nao |
| `CONFLICT` | **409** | O pedido nao encaixa no estado atual. | nao | nao (sem mudar algo) |

Alem desses, um desfecho de plataforma:

| Campo | HTTP | Significado | Retentar? |
| --- | --- | --- | --- |
| `outcome: "OPERATIONAL_ERROR"` | **503** | Falha do CMS, nao do pedido. | **SIM, com backoff** |

---

## 3. A regra curta

> **Retente apenas o 429.** Reenvie o **mesmo pedido, byte por byte** — incluindo
> `requestId` e `idempotencyKey` — depois do `Retry-After`.

O 429 tambem e o unico desfecho que traz `retryable: true` no corpo. Se voce
quiser uma unica condicao no codigo, use essa.

### Por que o mesmo `requestId`

Porque e ele que impede a duplicata. Quando a cota esgota, o CMS **nao grava
nada**: nem a materia, nem o registro de consumo. Na tentativa seguinte, o
`requestId` nao e encontrado em lugar nenhum e o pedido percorre o caminho
inteiro como se fosse o primeiro — resultando em **exatamente uma** materia.

Se voce gerar um `requestId` novo a cada tentativa, perde essa protecao: numa
situacao em que a primeira resposta se perdeu na rede mas o CMS **publicou**, o
pedido com id novo publicaria de novo. O `requestId` estavel e o que deixa o CMS
reconhecer "isto eu ja fiz" e responder `idempotent: true` sem reaplicar nada.

O mesmo vale para `idempotencyKey`: e por ela que o CMS encontra a materia
existente quando o `publicationIntent` e `update`.

---

## 4. Por que NAO retentar os outros

### 202 `ROUTED_TO_REVIEW` — ja existe algo, e nao e seu

Este e o mais facil de errar, porque "202" parece provisorio. Nao e: **a materia
foi gravada** em `needs_review` e esta na fila de um editor. Nao ha nada a
retentar — ha algo a **esperar**, e a espera e humana.

Reenviar cria um segundo rascunho do mesmo material para o editor descartar.

Chega-se aqui por quatro caminhos, e o campo `reasons[]` diz qual:

| `reasons[].code` | O que fazer |
| --- | --- |
| `SEO_TITLE_OUTSIDE_AUTO_PUBLISH_RANGE`, `SEO_META_TOO_SHORT_FOR_AUTO_PUBLISH`, `SEO_META_TOO_LONG_FOR_AUTO_PUBLISH` | O SEO cabe no transporte, mas nao na faixa da publicacao automatica. Ajustavel **na origem**: gere titulo/meta dentro da faixa e o proximo pedido publica sozinho. |
| `qa_not_passed` | Seu QA reprovou e voce mandou assim mesmo. O CMS aceitou para revisao. Corrija na origem. |
| `auto_publish_disabled` | Kill switch operacional desligado no CMS. Nao e defeito seu, e nao adianta reenviar: alguem precisa religar. |
| `AUTHOR_CHANGE_REQUIRES_HUMAN` | O pedido troca o autor de uma materia **ja publicada**. Nada foi aplicado — nem o corpo. Um humano decide. |

### 422 `BLOCKED` — o pedido tem defeito

Reenviar identico repete o defeito. Corrija a origem. Motivos comuns:

- `contract_invalid` — o corpo nao passa no schema. `reasons[].detail` nomeia o
  campo (nunca ecoa o valor).
- `author_not_found`, `automation_not_allowed`, `attribution_mode_not_allowed`,
  `content_type_not_allowed`, `section_not_allowed` — o autor nao existe, nao
  aceita automacao, ou nao aceita **aquele** modo de assinatura / secao / tipo.
  Essa e uma decisao do proprio autor sobre o nome dele; nao ha o que negociar.
- `unauthorized_media` — o pedido referencia midia que o CMS nao consegue
  autorizar. Midia sem licenca clara nao vira pagina publica (invariante 6).
  Referencia a midia **inexistente** conta igual: nao publicamos apontando para
  o que nao da para verificar.
- `slug_invalid` — nao da para derivar endereco da sugestao enviada.
- `SEO_TITLE_MISSING`, `SEO_META_MISSING`, `SEO_KEYWORD_STUFFING`,
  `SEO_*_OUT_OF_TRANSPORT_RANGE` — SEO fora do que o contrato aceita.
- `schema_howto_without_steps`, `schema_itemlist_without_list`,
  `schema_review_without_rating` — voce recomendou um tipo de Schema.org que o
  corpo nao sustenta. Marcar `HowTo` sem passos e structured data falso: o
  buscador promete ao leitor algo que a pagina nao entrega.
- **`AUTO_PUBLISH_ARTICLE_UPDATE_LIMIT_REACHED`** — ver secao 5.

### 409 `CONFLICT` — o pedido nao encaixa no estado atual

Nao e defeito de forma; e desencontro de estado. Reenviar identico nao resolve,
mas **mudar algo do seu lado** pode:

- `contract_incompatible` — versao ou hash divergente. Releia o manifesto e
  atualize seu schema. Depois disso, reenviar funciona.
- `stale_revision` — voce mandou `sourceRevision` menor ou igual a que ja foi
  aplicada. Evento antigo nunca sobrescreve versao nova. Mande a revisao atual.
- `idempotency_conflict` — a mesma `idempotencyKey` ja existe com conteudo
  **diferente**. Ou voce reusou a chave por engano, ou o conteudo mudou e o
  intent deveria ser `update`.

---

## 5. O caso especial: `AUTO_PUBLISH_ARTICLE_UPDATE_LIMIT_REACHED`

**422, sem `Retry-After`, e isso e intencional.**

Existe um teto de quantas vezes **uma mesma materia** pode ser reescrita
automaticamente. Quando ele esgota, a resposta e `BLOCKED` — nao `DEFERRED` —
mesmo que os outros quatro tetos sejam adiaveis.

O motivo nao e tecnico, e de produto: esse teto existe para conter **automacao
em laco**. Dizer "volte amanha" seria autorizar o pipeline a reescrever a mesma
materia todo dia, indefinidamente — exatamente o comportamento que o teto foi
criado para impedir.

**O que fazer:** pare de reenviar aquele update. Se a materia realmente precisa
de outra revisao automatica, isso passa por decisao humana no CMS.

> Nota tecnica, para quem for auditar: o contador **de fato** reabre a
> meia-noite, porque a data civil faz parte da chave da linha nas cinco
> dimensoes. A escolha de nao prometer horario e deliberada — o CMS pode dar
> mais espaco amanha, mas nao convida o produtor a usa-lo. Isso esta em revisao
> de produto; se a politica mudar, esta dimensao passa a responder `DEFERRED`
> como as outras e este paragrafo sai.

---

## 6. 503 `OPERATIONAL_ERROR` — falha de plataforma

O pedido pode estar perfeito: quem falhou foi o CMS. **Retente com backoff
exponencial**, mantendo o mesmo `requestId`.

| `code` | O que aconteceu |
| --- | --- |
| `AUTO_PUBLISH_TIME_ZONE_INVALID` | O fuso da redacao esta ausente ou invalido na configuracao. Nada foi criado, nenhum limite consumido. Alguem precisa corrigir a env. |
| `AUTO_PUBLISH_PERSISTENCE_FAILED` | A gravacao falhou e a transacao foi desfeita. Nada publicado, nenhum contador sobreviveu. |

A resposta e deliberadamente generica — erro de banco carrega valor de coluna, e
valor de coluna aqui e trecho de materia inedita. A causa fica no log do CMS.

Diferenca em relacao ao 429: no 503 **nao ha horario prometido**. Use backoff do
seu lado, nao um relogio.

---

## 7. As cinco dimensoes de quota

Cada publicacao (e cada update) consome varias linhas de contador, sempre nesta
ordem. A primeira que nao couber decide a resposta — e as ja consumidas sao
**desfeitas** pelo rollback, entao uma tentativa recusada nao custa nada.

| Dimensao | O que limita | Esgotou → |
| --- | --- | --- |
| `global` | tudo que a automacao publica no dia | `DEFERRED` 429 |
| `content_type` | por tipo de conteudo (ex.: `news`) | `DEFERRED` 429 |
| `section` | por editoria (ex.: `Series`) | `DEFERRED` 429 |
| `author` | por autor assinante | `DEFERRED` 429 |
| `article_update` | reescritas de **um** artigo | **`BLOCKED` 422** |

Detalhes que importam para o produtor:

- **`update` tambem consome os tetos diarios.** Uma atualizacao automatica
  tambem publica bytes no site e tambem assina em nome do autor. Contar so o
  `create` deixaria a automacao reescrever o dia inteiro sem tocar em teto
  nenhum.
- **`section` so existe se voce declarar uma.** Sem `articleSectionSuggestion`,
  essa dimensao nao e consumida.
- **O teto do autor e o mais restritivo entre dois.** A plataforma tem um
  limite, e cada autor pode declarar o dele. Vence o menor: um autor que aceita
  3 por dia nao passa a aceitar 50 porque a plataforma permite 50.
- **O dia e civil, no fuso da redacao** — nao UTC. A virada acontece a
  meia-noite local, e `nextEligibleAt` ja vem convertido para UTC.

O `reasons[].detail` da resposta nomeia qual dimensao estourou.

---

## 8. Pseudocodigo de referencia

```
resposta = POST /api/internal/editorial-publications  (corpo)

se resposta.status == 429:
    # unico caso retentavel com horario
    espera = resposta.header["Retry-After"]        # segundos, ja arredondado
    agenda_reenvio(mesmo_corpo, depois_de=espera)  # MESMO requestId

senao se resposta.status == 503:
    agenda_reenvio(mesmo_corpo, backoff_exponencial())   # MESMO requestId

senao se resposta.status == 201:
    marca_publicado(resposta.body.articleId)

senao se resposta.status == 202:
    marca_aguardando_humano(resposta.body.reasons)   # NAO reenviar

senao:   # 403, 409, 422
    registra_defeito(resposta.body.reasons)          # NAO reenviar
```

`Retry-After` e `nextEligibleAt` apontam para o **mesmo instante** — o header em
segundos a partir da resposta, o corpo em ISO 8601 UTC. Use o que for mais
conveniente; eles nao se contradizem por construcao.

---

## 9. Como testar sem publicar nada de verdade

- Use uma conta de servico de **staging**, nunca a de producao.
- O kill switch (`EDITORIAL_AUTO_PUBLISH_ENABLED`) desligado faz todo pedido
  valido cair em `202 ROUTED_TO_REVIEW` com `auto_publish_disabled`. E a forma
  mais barata de exercitar o caminho ate o gate sem publicar.
- Para exercitar o `429` sem gastar um dia inteiro de cota, configure um teto
  baixo em staging (`EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT`).
- O comportamento descrito aqui esta coberto por testes de integracao contra
  PostgreSQL 16 real em
  [`apps/cms/src/__tests__/auto-publication.integration.test.ts`](../../apps/cms/src/__tests__/auto-publication.integration.test.ts) —
  inclusive o reenvio do mesmo `requestId` apos a janela liberar, que prova a
  ausencia de duplicata.

---

## Documentos vizinhos

- [`docs/operations/editorial-auto-publication-quota.md`](../operations/editorial-auto-publication-quota.md) — os tetos por dentro: dia civil, reserva transacional, contadores.
- [`docs/adr/0017-automation-publisher-actor.md`](../adr/0017-automation-publisher-actor.md) — por que ingestao e autopublicacao sao atores diferentes.
- [`docs/adr/0015-editorial-boundaries.md`](../adr/0015-editorial-boundaries.md) — quem e externo, quem esta fora, o que e o CMS.
- [`docs/operations/editorial-projection-worker.md`](../operations/editorial-projection-worker.md) — o que acontece com o evento depois que ele entra na outbox.
