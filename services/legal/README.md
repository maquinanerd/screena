# @screena/legal

Registro **governado** de autorização de fontes da Cinerie.

> `@screena/*` é namespace técnico legado. A marca pública é **Cinerie**.

Materializa a **decisão formal do proprietário**
([`docs/legal/source-replication-authorization.md`](../../docs/legal/source-replication-authorization.md))
em `source_licenses` + `data_usage_decisions`, de forma **idempotente** e com
**histórico** (`supersedes_id`; nenhuma linha antiga é apagada).

Não decide licença — traduz a decisão registrada. Worker-only; **nunca** no
render.

## Garantias (provadas por `validate:source-authorization-and-attribution`, 18/18)

- **Nunca promove dado**: não liga `display_allowed` de rating ou oferta.
- **Nunca libera** citação integral de crítica. Logo e a derivada do Cinerie
  Score entram **somente** pela decisão registrada do proprietário (20/08/2026,
  [`docs/legal/owner-authorization-2026-08-20.md`](../../docs/legal/owner-authorization-2026-08-20.md)),
  com a base gravada (`owner_decision`) e allowlist nominal em `plan.ts` — fora
  dela, o apply recusa antes de escrever.
- **Idempotente**: rodar de novo sem mudança no spec não escreve nada.
- **Histórico preservado**: supersede a licença-semente conservadora, não apaga.

## Uso

```bash
# Mostra o plano (read-only): fontes, registro vigente, nova versão, permissões,
# território, atribuição, linkback, usos bloqueados.
pnpm legal sources review

# Dry-run por default (não escreve):
pnpm legal sources apply

# Aplica de verdade (exige revisor humano + leva):
pnpm legal sources apply \
  --reviewer="Pablo Eduardo — proprietario da Cinerie" \
  --policy-version="cinerie-source-auth/2026-08-v2" \
  --confirm
```

`review`/`apply` leem/escrevem só PostgreSQL (`DATABASE_URL`), nunca a rede.

## Estrutura

| Caminho | Papel |
| --- | --- |
| `src/authorization-spec.ts` | Spec declarativa (fontes reais + papéis). Pura. |
| `src/plan.ts` | Planejamento idempotente (create/supersede/keep). Puro. |
| `src/report.ts` | Renderização do plano. Pura. |
| `src/cli/args.ts` | Parser da CLI. Puro. |
| `bin/legal.ts` | Wiring Prisma + transação (worker-only; runtime typecheck). |
| `scripts/validate-source-authorization-and-attribution.ts` | Validator em PG efêmero. |

Streaming: as decisões `watch_offer_display` são geradas **por provedor real**
em `watch_providers` (nunca inventadas). Com zero provedores registrados, zero
decisões de streaming — correto até o onboarding.
