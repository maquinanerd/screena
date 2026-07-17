# Runbook — sync e promoção de ratings

Operação da CLI `pnpm ratings`. **Worker-only, offline — nunca no render.**
Marca: Cinerie. `@screena/*` é namespace técnico legado.

> Antes de qualquer coisa: nenhuma nota nasce exibível. `sync` só grava
> `display_allowed = false`; exibir é decisão humana de licença, via `promote`,
> e o banco recusa qualquer atalho (trigger fail-closed).

## Pré-requisitos

- `DATABASE_URL` apontando para o PostgreSQL (todos os comandos leem/escrevem
  banco).
- Para `sample`/`sync` (fazem chamada real ao fornecedor):
  `RAPIDAPI_FILM_SHOW_RATINGS_KEY`. `review`/`promote`/`revoke` **não** fazem
  rede — só banco.

## Comandos

| Comando | Rede? | Escreve? | Default |
| --- | --- | --- | --- |
| `sample` | sim | nunca | dry-run (relata o que reconheceria) |
| `sync` | sim | sim (com `--apply`) | dry-run |
| `review` | não | não | read-only |
| `promote` | não | sim (com `--confirm`) | dry-run |
| `revoke` | não | sim (com `--confirm`) | dry-run |

## 1. Amostra controlada (a primeira coisa a rodar)

```
pnpm ratings sample --source imdb --entity movie --limit 20 --dry-run
```

Relata, sem escrever nada: campos, reconhecidas, recusadas (por motivo),
escalas, votos, rótulos, licença, decisão de uso presente/ausente, host da
atribuição e hashes. Use para conferir que o fornecedor devolve o que se espera
**antes** de gastar cota em `sync`.

`sample --apply` é **recusado** — quem digita isso quer gravar; a mensagem
aponta para `sync --apply`.

> `sample`/`sync` fazem chamada real e têm entrypoint dedicado (cache, backoff,
> circuit breaker, log em `api_sync_logs`). A CLI `pnpm ratings` reencaminha para:
> `node --import tsx services/ratings/bin/sync-film-show-ratings.ts --type=film --limit=20 --sample`

## 2. Sync (persistência)

```
# dry-run primeiro (default)
pnpm ratings sync --entity movie --limit 20
# só então:
pnpm ratings sync --entity movie --limit 20 --apply
```

Toda linha nasce `display_allowed = false`, `license_status = unknown`,
`score_type` classificado (ou `null` = não exibível), `stale_after` derivado da
política da fonte. **Mudança revoga**: se uma nota já existia e mudou, a
aprovação anterior é limpa (hash/revisor/decisão zerados).

## 3. Revisão (read-only)

```
pnpm ratings review --source imdb --limit 50
```

Lista candidatas e **por que** cada uma pode ou não subir. Motivos de recusa vêm
em precedência: integridade (invariantes 1/2) antes de governança (licença) antes
de frescor. Uma nota com escala errada reporta `scale-mismatch`, não
`no-usage-decision` — não manda o operador atrás da licença de um dado que nunca
deveria existir.

## 4. Promoção (decisão humana de licença)

Pré-condição: existe uma `DataUsageDecision` vigente de `rating_display` para a
fonte, no estágio `approved_for_display`, dentro da licença daquela fonte. Sem
ela, a promoção reporta `no-usage-decision` e não sobe nada.

```
# dry-run (default) — mostra o que aconteceria
pnpm ratings promote --ids=101,102
# executa (exige revisor humano):
pnpm ratings promote --ids=101,102 --confirm --reviewer=ana@cinerie
```

- `--ids` é **obrigatório** (nunca "promova tudo"); lote limitado a **20** —
  aprovar 5 mil não é revisão, é carimbo.
- `--confirm` sem `--reviewer` é recusado. "Quem aprovou isso?" precisa ter
  resposta seis meses depois.
- A promoção resolve o hash + a decisão no próprio UPDATE e grava
  `reviewed_at/reviewed_by`. O trigger valida tudo de novo: nota incompleta
  simplesmente não sobe (fail-closed), uma por statement.

### Exit codes

`0` ok · `2` uso · `3` sem `DATABASE_URL`/chave · `4` gate de produção · `5`
falha do fornecedor · `6` **governança barrou no banco** (não é bug — é a trava)
· `1` inesperado. Um runbook distingue "a trava barrou" de "quebrou".

## 5. Revogação

```
pnpm ratings revoke --ids=101 --confirm
```

Desliga `display_allowed` e limpa a aprovação inteira (hash/revisor/decisão).
Não apaga a nota — o histórico permanece.

## Onde olhar quando algo não sobe

1. `review` mostra o motivo por candidata.
2. Motivo `no-usage-decision` → falta a `DataUsageDecision` (ver
   [checklist legal](../legal/data-source-review-checklist.md)).
3. Motivo `unclassified-score-type` → a métrica é ambígua; ver
   [ratings-platform](../backend/ratings-platform.md) (score_type fail-closed).
4. Motivo `expired`/`unknown-stale-policy` → frescor; ver política em
   `@screena/config`.
5. Promoveu, `updated < elegíveis` e exit `6` → o trigger sabe algo que a camada
   pura não sabia. É a trava funcionando; investigue a licença/decisão da linha.
