/**
 * @screena/legal — Registro governado de autorização de fontes.
 *
 * Núcleo PURO (spec declarativa, planejamento idempotente, relatório, parser)
 * mais o laço de escrita (`apply.ts`), que é IO-shaped porém livre de Prisma:
 * recebe um executor SQL estrutural. O wiring com Prisma (conexão, transação)
 * vive em `bin/legal.ts` (worker-only, fora do typecheck principal, coberto por
 * `typecheck:catalog-runtime`).
 *
 * Não decide licença: materializa, de forma auditável e reversível por
 * histórico, a decisão formal do proprietário registrada em
 * docs/legal/source-replication-authorization.md. Nunca promove dado, nunca
 * libera logo/citação/derivada, nunca autoriza o Cinerie Score.
 */

export * from "./apply.js";
export * from "./authorization-spec.js";
export * from "./plan.js";
export * from "./public-credits.js";
export * from "./remediation.js";
export * from "./report.js";
export * from "./cli/args.js";
