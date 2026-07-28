# ADR 0016 — `content_blocks` e `article_translations` compartilham o enum, NAO o ciclo de vida

- **Status:** aceito. Corrige uma decisao errada tomada na Fase 1 (commit `a044730`).
- **Data:** 2026-07-28.
- **Migration:** nenhuma.
- **Invariantes tocadas:** 12 (Entity Writer nao publica sozinho), 13 (blocos versionados e revisaveis).
- **Contexto:** a Fase 1 aplicou a allowlist de transicao de `article_translations`
  (`services/news-ingestion/src/lifecycle.ts`) tambem a `content_blocks`, com a justificativa de que
  "usam o mesmo enum e a mesma semantica de revisao". A primeira metade e verdade. **A segunda nao.**

---

## 1. A evidencia que derruba a premissa

### 1.1 `blocked` significa coisas diferentes

| Dominio | O que `blocked` significa | Evidencia |
| --- | --- | --- |
| `article_translations` | **Retratacao**: algo que foi publico e foi retirado. | `lifecycle.ts:74` — `RETRACTED_ARTICLE_REVIEW_STATUSES = ["blocked", "archived"]`, comentado como "estados de RETRATACAO/despublicacao". |
| `content_blocks` | **Falha de validacao na geracao**. O bloco **nasce** assim e nunca foi publico. | `services/entity-writer/src/pipeline/decide-status.ts` — forma invalida -> `blocked`; saida sem bloco util -> `blocked`. |

Um bloco `blocked` nao e uma retratacao editorial: e uma saida de IA que nao passou na validacao.
Tratar os dois como o mesmo estado e um erro de dominio, nao um detalhe de implementacao.

### 1.2 `archived` significa coisas diferentes

| Dominio | O que `archived` significa | Evidencia |
| --- | --- | --- |
| `article_translations` | Retratacao deliberada por um humano. | `lifecycle.ts:74`. |
| `content_blocks` | **Versao superada**, arquivada AUTOMATICAMENTE pelo worker ao inserir a versao seguinte. Sem revisao humana. | `services/entity-writer/src/persistence/content-block-store.ts:47-57` (`updateMany` para `archived`) + `pipeline/persistence-plan.ts:34,111` (`AI_OWNED_ACTIVE_STATES`, "archive + insert"). |

### 1.3 O modelo de mudanca e outro

- `article_translations`: **uma linha que transiciona de estado**. O ciclo de vida e uma maquina de
  estados sobre a mesma linha.
- `content_blocks`: **archive + insert**. O writer nunca transiciona um bloco existente para um novo
  conteudo — ele arquiva a versao ativa e **cria** uma linha nova (invariante 13: blocos sao
  versionados). Nao ha "ciclo de vida da linha" no mesmo sentido.

### 1.4 A regressao concreta que a Fase 1 introduziu

A allowlist de artigo diz:

```
ai_generated -> needs_review, draft, blocked, archived
```

`human_reviewed` **nao esta la**. Mas o caminho feliz do Entity Writer produz exatamente
`ai_generated` (`decide-status.ts`: bloco util, sem warnings -> `ai_generated` + `passed`). Com a
allowlist de artigo aplicada a blocos, **um bloco limpo nao poderia mais ser aprovado em um passo**
pelo revisor no admin: teria de passar por `needs_review` primeiro, um estado que, para blocos,
significa "saiu com warning de anti-alucinacao" — o que seria falso.

Isso quebra o fluxo documentado do Entity Writer para satisfazer uma regra de outro dominio.

---

## 2. Decisao

**`content_blocks` NAO usa a allowlist de transicao de `article_translations`.**

- `apps/admin` continua permitindo que um revisor humano mova um bloco entre estados do enum, como
  antes da Fase 1. **Nenhuma allowlist nova foi inventada**: sem evidencia de dominio, criar uma
  maquina de estados para blocos seria escolher por conveniencia, nao por prova.
- O que **permanece** da Fase 1 para blocos e a protecao de **concorrencia** (compare-and-swap sobre
  o estado lido). Ela e ortogonal ao ciclo de vida e vale nos dois dominios: ninguem deve sobrescrever
  em silencio uma decisao que outro operador acabou de tomar.
- O Entity Writer continua proibido de escrever `published`/`human_reviewed`
  (`persistence-plan.ts:46` — `FORBIDDEN_WRITE_STATES`). Essa e a trava real da invariante 12 para
  blocos, e ela ja existia: e do lado do **writer**, nao do revisor humano.

---

## 3. Por que o enum e compartilhado, entao

Porque os dois dominios tem os mesmos **rotulos de maturidade editorial** (rascunho, gerado por IA,
aguardando revisao, revisado, publicado, precisa de atualizacao, bloqueado, arquivado). Reusar o enum
evita duas listas de strings que significam quase a mesma coisa. O erro e concluir, a partir do enum
compartilhado, que as **transicoes** tambem sao compartilhadas.

> Enum compartilhado descreve o vocabulario. Maquina de estados descreve as regras. Sao coisas
> diferentes, e este repositorio agora afirma isso por escrito e por teste.

---

## 4. Protecao contra divergencia silenciosa

`tests/admin/editorial-lifecycle-single-source.test.ts` passa a travar as duas metades:

1. **Artigo usa a fonte unica** — varredura dos 64 pares contra `canTransition`, com controle negativo.
2. **Bloco NAO usa** — o caminho de content block nao chama `evaluateReviewStatusTransition`, e a
   diferenca de dominio esta afirmada em teste (`ai_generated -> human_reviewed` e proibido para
   artigo e continua possivel para bloco).

Se alguem reaplicar a allowlist de artigo aos blocos, o teste falha e aponta este ADR.

---

## 5. O que este ADR nao decide

- **Nao** cria um ciclo de vida proprio para `content_blocks`. Se a evidencia de dominio aparecer
  (por exemplo, quando a redacao editorial existir no Payload), a decisao pode ser retomada — com
  prova, nao por simetria.
- **Nao** altera `services/news-ingestion/src/lifecycle.ts`, que continua sendo a fonte unica para
  `article_translations`.
- **Nao** altera schema, migration ou o Entity Writer.
