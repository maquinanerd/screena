# ADR 0017 — Ingestao e autopublicacao sao ATORES diferentes, nao permissoes a mais

- **Status:** aceito.
- **Data:** 2026-07-29.
- **Migration:** nenhuma (a mudanca e de politica; as tabelas de quota vieram em migration propria).
- **Invariantes tocadas:** 5 (indexacao total), 6 (licenca antes de exibir), 12 (automacao nao publica sozinha sem gate registrado).
- **Substitui parcialmente:** a regra da FASE 2B de que "`service` so alcanca `automation_draft`",
  que continua valendo — mas agora apenas para a conta de **ingestao**.

---

## 1. O problema

A FASE 2B modelou UMA conta tecnica: o MNScr entregando rascunho. A maquina de estados
(`apps/cms/src/workflow.ts`) registrou isso de forma explicita:

> `automation_draft` nao alcanca `published` por nenhum caminho direto.

E o hook de governanca (`apps/cms/src/hooks/articles.ts`) confinava **toda** conta de servico a
esse estado:

```
service account so pode manter o artigo em automation_draft
```

A FASE 2F introduz um poder diferente: `editorial_auto_publish`. O MNScr passa a publicar
sozinho, sob politica de autoria, kill switch e teto diario, com revisao humana como desfecho de
fallback.

O caminho obvio para fazer isso funcionar seria **afrouxar `service`** — deixar a conta de servico
alcancar `published`. Essa e a decisao errada, e o motivo e simples: as duas contas se autenticam
pelo mesmo mecanismo e caem no mesmo ramo do hook. Afrouxar o ramo daria a conta de **ingestao de
rascunho** o poder de publicar, sem que ninguem tivesse decidido isso.

---

## 2. A decisao

Existem **dois atores tecnicos distintos**, derivados do **escopo** da credencial, nunca de
`kind === 'service'`:

| Ator | Escopo | Alcanca |
| --- | --- | --- |
| `service` | `draft_ingest` | `automation_draft`, e mais nada |
| `automation_publisher` | `editorial_auto_publish` | `automation_draft`, `needs_review`, `ready_to_publish`, `published`, `needs_update` |

O caminho de publicacao automatica e `automation_draft -> ready_to_publish -> published`.

### 2.1 O que a automacao publicadora NAO alcanca, e por que

| Estado | Por que fica de fora |
| --- | --- |
| `in_review`, `human_reviewed` | Atravessar esses estados **gravaria no historico da materia que um humano revisou** quando nenhum revisou. A mentira sobreviveria a auditoria. |
| `blocked`, `archived`, `retracted` | Tirar do ar e decisao humana. Uma automacao em loop nao pode despublicar sozinha. |

Note que a versao inicial do endpoint fazia o artigo percorrer
`needs_review -> in_review -> human_reviewed -> ready_to_publish -> published` justamente para nao
"pular o gate". O gate e preservado sem essa mentira: `evaluatePublishGate` roda na aresta
`ready_to_publish -> published`, e e por ali que a automacao passa.

### 2.2 Campos fora do alcance

`AUTOMATION_PUBLISHER_FORBIDDEN_FIELDS` (`apps/cms/src/access.ts`) e bem mais curta que a de
`draft_ingest` — quem publica precisa escrever autoria, QA e estado. Ficam de fora:

`publishedAt`, `scheduledFor`, `correctedAt`, `correctionNote`, `retractionReason`, `legalHold`,
`_status`.

`publishedAt` e `_status` sao **derivados pelo servidor**. Deixar a automacao carimbar a data de
publicacao permitiria publicar com data no passado.

---

## 3. O que NAO mudou

- **O gate de publicacao continua no servidor.** A allowlist diz apenas QUEM pode mover o artigo.
  O que a materia precisa ter para virar publica e decidido por `evaluatePublishGate`, contra o
  documento **persistido** — nunca contra o que o pedido afirmou.
- **A conta de ingestao continua confinada.** `draft_ingest` nao alcanca `ready_to_publish` nem
  `published`, e isso e travado por teste nos dois sentidos.
- **Materia de pipeline e declarada `aiAssisted`.** Isso LIGA o gate que exige fonte externa:
  parafrase sem lastro nao publica.

---

## 4. Como isso e travado

`apps/cms/src/__tests__/auto-publication.test.ts` prova a separacao nos dois sentidos — o que o
publicador ganhou **e** o que o ingestor continua sem poder:

- `service` nao alcanca `ready_to_publish` nem `published`;
- `automation_publisher` sobe de `automation_draft` ate `published`;
- `automation_publisher` nao atravessa `in_review` nem `human_reviewed`;
- `automation_publisher` nao alcanca `blocked`, `archived` nem `retracted`;
- `automation_draft -> published` continua proibido em salto direto, para qualquer ator.

`apps/cms/src/__tests__/auto-publication.integration.test.ts` prova o caminho por HTTP real, contra
PostgreSQL efemero, incluindo a recusa de uma credencial com escopo de rascunho (403).

---

## 5. Consequencias

- Uma credencial nova so publica se receber `editorial_auto_publish` **explicitamente**. Escopo
  ausente ou malformado vira lista vazia (fail-closed em `apps/cms/src/actor.ts`).
- Revogar a autopublicacao e remover o escopo da conta — nao ha estado intermediario em que a
  conta "quase" publica.
- A auditoria distingue os dois: `automationActorId`/`automationScopesUsed` gravam qual credencial
  agiu e sob que poder.

Ver tambem: [`docs/operations/editorial-auto-publication-quota.md`](../operations/editorial-auto-publication-quota.md)
(tetos diarios e reserva transacional) e
[`docs/adr/0015-editorial-boundaries.md`](0015-editorial-boundaries.md) (quem e externo).
