# Adapters de persistência da user platform (Backend C)

> Índice de estado da camada de persistência: qual domínio tem **contrato**
> (port) e qual já tem **adapter** concreto. Criado no C7B0.
>
> Regra de leitura: `IMPLEMENTED` em *Contrato* significa que o port existe e é
> testado; `PENDING_*` em *Adapter* significa que **não há** implementação
> Prisma — nada aqui deve ser lido como "pronto para uso".

## Matriz

| Domínio | Port | Contrato | Adapter Prisma | PostgreSQL real | Unidade |
| --- | --- | --- | --- | --- | --- |
| identity | `IdentityStore` | IMPLEMENTED (C7B0) | **PENDING_C7B1** | PENDING_C7B1 | C7B1 |
| credential | `PasswordCredentialStore` | IMPLEMENTED (C7B0) | **PENDING_C7B1** | PENDING_C7B1 | C7B1 |
| recommendation snapshot | `RecommendationSnapshotStore` | IMPLEMENTED (C7A) | PENDING_C7B6 | PENDING_C7B6 | C7B6 |
| recommendation feedback | `RecommendationFeedbackStore` | IMPLEMENTED (C7A) | PENDING_C7B6 | PENDING_C7B6 | C7B6 |
| transação (genérico) | `TransactionRunner` | IMPLEMENTED (C7A) | PENDING_C7C | PENDING_C7C | C7C |
| sessões / tokens | — | **PENDING_C7B2** | PENDING_C7B2 | PENDING_C7B2 | C7B2 |
| verificação / recuperação | — | PENDING_C7B2 | PENDING_C7B2 | PENDING_C7B2 | C7B2 |
| privacidade / LGPD | — | PENDING_C7B3 | PENDING_C7B3 | PENDING_C7B3 | C7B3 |
| listas | — | PENDING_C7B4 | PENDING_C7B4 | PENDING_C7B4 | C7B4 |
| tracking | — | PENDING_C7B4 | PENDING_C7B4 | PENDING_C7B4 | C7B4 |
| ratings | — | PENDING_C7B5 | PENDING_C7B5 | PENDING_C7B5 | C7B5 |
| reviews | — | PENDING_C7B5 | PENDING_C7B5 | PENDING_C7B5 | C7B5 |

**Nenhum adapter Prisma existe no repositório neste momento.** Não há
`persistence/prisma/`, nenhum `PrismaClient` na user platform e nenhuma
composição de runtime.

## Fronteira arquitetural

```
dominio puro  ->  (não conhece persistência)
persistence/  ->  contratos: types.ts (DTOs/resultados) + ports.ts (interfaces)
persistence/prisma/  ->  (C7B1+) ÚNICO lugar autorizado a importar o client
```

Direção da dependência: `persistence -> domínio`, nunca o contrário. Travado por
`persistence/__tests__/boundary.test.ts`, que varre a fonte real.

## Detalhe por contrato

- **Identidade e credencial**: ver
  [`user-product-identity-credential-ports.md`](./user-product-identity-credential-ports.md)
  (DTOs, conflitos com alvo semântico, compare-and-swap da senha, método único
  autorizado a devolver o hash).
- **Recomendações**: ver
  [`user-product-persistence-decisions.md`](./user-product-persistence-decisions.md)
  §3 (snapshot vigente por `(user_id, context)`, `fingerprint` nullable) e §5.1
  (identidade idempotente dos eventos de tracking).

## Pré-condições que o C7B1+ **deve** honrar

1. `fingerprint IS NULL` num snapshot significa **não-equivalente** — jamais
   `noop` (serviria recomendação velha para sempre).
2. Replay de tracking compara **pré-imagem**; `occurredAt` participa da
   equivalência, não da identidade.
3. Identidade de viewing event = `(user_id, idempotency_key, event_type)`.
4. Ratings e reviews não têm coluna `version`: conflito por compare-and-swap
   sobre a pré-imagem.
5. `IdentityRecord` nunca carrega hash; só `findForVerification` o devolve.
