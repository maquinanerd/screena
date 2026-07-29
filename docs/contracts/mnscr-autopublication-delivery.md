# Pacote de entrega ao MNScr — autopublicação editorial

> **Status: NÃO ENVIADO.** Este documento existe no repositório da Cinerie e
> descreve o que o MNScr precisa saber para publicar sozinho. O envio ao
> repositório do MNScr é uma decisão humana explícita e ainda não aconteceu.

O MNScr vive em repositório próprio (ver
[ADR 0015](../adr/0015-editorial-boundaries.md)). Este pacote é o que atravessa a
fronteira: contrato, exemplos válidos, contraexemplos com o motivo da recusa, e
as regras que decidem o desfecho.

---

## 1. O contrato

| Item | Valor |
|---|---|
| Nome | `editorial-publication-request-v1` |
| Versão | `1.0.0` |
| Endpoint | `POST /api/internal/editorial-publications` |
| Autenticação | API key da service account, escopo `editorial_auto_publish` |
| Descoberta | `GET /api/internal/contracts` |

**Nome e versão são conceitos separados.** O nome identifica o contrato (e carrega
o `-v1` porque uma quebra incompatível cria um contrato *novo*, com outro nome).
A versão evolui dentro dele: `1.1.0` acrescenta campo opcional, `1.0.1` corrige
documentação. Colapsar os dois impediria dizer "mesmo contrato, versão mais nova".

O `schemaHash` é conferido junto com nome e versão. Os três importam: nome errado
é outro contrato; versão errada é outra semântica; **hash errado é outro schema
com o mesmo rótulo** — o caso mais perigoso, porque parece certo.

Busque o hash vigente em `/api/internal/contracts`. Não fixe um literal no
código: ele muda a cada campo novo, e um literal desatualizado transforma toda
publicação em `BLOCKED`.

---

## 2. Os quatro desfechos

| Desfecho | HTTP | Significa | Reenviar igual resolve? |
|---|---|---|---|
| `PUBLISHED` | 201 | matéria publicada | — |
| `ROUTED_TO_REVIEW` | 202 | conteúdo aceito, aguardando humano | **não** — aguarde |
| `CONFLICT` | 409 | estado divergente (revisão antiga, hash diferente) | não, sem mudar algo |
| `BLOCKED` | 422 | defeito permanente no pedido | **não** — repete o defeito |

`ROUTED_TO_REVIEW` **não é erro**. O conteúdo passou por todas as validações de
forma; o que falta é julgamento humano. O texto foi guardado — não reenvie.

Quando o motivo é teto diário, a resposta traz `nextEligibleAt`: é a hora em que
aquela dimensão volta a ter espaço. A exceção é o teto de **reescrita de um
artigo**, que não é diário e por isso não promete horário — reenviar ali seria um
laço infinito.

---

## 3. O que o produtor NÃO decide

O contrato **recusa** estes campos. Não é preferência de estilo: cada um deles é
uma decisão que pertence ao CMS ou ao lado público, e aceitá-los criaria duas
fontes discordando.

| Categoria | Exemplos recusados | Por quê |
|---|---|---|
| Estado público | `post_status`, `published`, `publishedAt` | publicar é decisão do CMS, sob política |
| Identidade interna | `articleId`, `payloadDocumentId` | o CMS resolve identidade por `idempotencyKey` |
| SEO estrutural | `canonical`, `robots`, `noindex`, `jsonLd` | derivados no lado público de `slugs` e da decisão de indexabilidade |
| Semântica de outro CMS | `_yoast_wpseo_*` | traria o modelo de um CMS que não é o nosso |

O ator técnico **nunca** vem do payload. Ele é derivado da credencial
autenticada. Enviar um campo de "quem sou eu" seria aceitar a palavra do
chamador sobre a própria identidade.

---

## 4. SEO: você propõe, o CMS decide

O objeto `seo` é uma **proposta**. O CMS valida e o que atravessa para o site é a
decisão dele.

Faixas de **transporte** (o que o contrato aceita) e de **autopublicação** (o que
publica sem humano) são diferentes de propósito — um título de 100 caracteres é
transportável e não é publicável:

| Campo | Transporte | Autopublica |
|---|---|---|
| `title` | 15–120 | 15–65 |
| `metaDescription` | 70–320 | 120–160 |

Fora da faixa de autopublicação e dentro da de transporte → `ROUTED_TO_REVIEW`.
Fora da de transporte → `BLOCKED`.

`schemaTypeRecommendation` é **recomendação**. O lado público recusa `Review`
(schema falso sem review própria), `ItemList` e `HowTo` (descrevem a estrutura da
página, que só o render conhece).

---

## 5. Autoria

`publicAuthorId` é o **autor público** — a pessoa ou redação que assina. Ele é
diferente do ator técnico, e os dois ficam registrados.

A autorização é do **autor**, não do pipeline: cada `Author` declara se aceita
publicação automática, em quais tipos de conteúdo, em quais seções, e sob qual
modo de assinatura. Um autor pode aceitar `news` e recusar `review`.

**Trocar o autor de uma matéria já publicada exige humano.** A resposta é
`ROUTED_TO_REVIEW` com `AUTHOR_CHANGE_REQUIRES_HUMAN`, e **nada do update é
aplicado** — nem o corpo. Aplicar metade seria pior: a matéria ficaria com texto
novo e assinatura antiga, sem ninguém ter decidido isso.

---

## 6. Tetos diários

Cinco dimensões: global, tipo de conteúdo, seção, autor e reescrita por artigo.
O teto do autor é o **menor** entre o que ele declarou e o da plataforma.

O dia é o **dia civil da redação** (fuso IANA configurado), não o dia UTC.

Detalhe operacional completo:
[`docs/operations/editorial-auto-publication-quota.md`](../operations/editorial-auto-publication-quota.md).

---

## 7. Idempotência

`requestId` identifica **a tentativa**; `idempotencyKey` identifica **o trabalho**.

Um retry com o mesmo `requestId` responde `idempotent: true` e **não reaplica
nada** nem consome teto de novo. Um retry cujo HTTP se perdeu já consumiu o teto
na primeira tentativa — consumir outra vez faria você gastar o dia reenviando o
mesmo pedido, e o teto protegeria contra a coisa errada.

Gere `requestId` novo a cada tentativa **apenas** se quiser que ela conte como
publicação nova. Para retry de rede, repita o mesmo.

---

## 8. Onde estão os exemplos

Tudo em `packages/editorial-contracts/src/publication-fixtures.ts`:

- `validPublicationRequest` — pedido válido de referência
- `validPublicationUpdate` — atualização de matéria existente
- `routedToReviewRequest` — válido, porém encaminhado a humano
- `conflictingUpdateRequest` — conflito de estado
- `invalidPublicationRequests` — **12 contraexemplos**, cada um com **um** defeito
  isolado e o motivo no nome

Isolar o defeito importa: uma fixture com três erros não ensina qual gate pegou.

O JSON Schema vigente sai de `GET /api/internal/contracts` — gerado do mesmo Zod
que valida no servidor, então não há como divergir.

---

## 9. Antes de integrar

1. Buscar `schemaHash` de `/api/internal/contracts` e conferir contra o que você
   envia.
2. Publicar contra o CMS de **canário**, nunca direto em produção.
3. Tratar `202` como sucesso-com-espera, não como falha.
4. Não reenviar `BLOCKED` sem corrigir o pedido.
5. Confirmar que a service account tem `editorial_auto_publish` e **só** ele.
