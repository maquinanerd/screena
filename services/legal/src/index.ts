/**
 * @screena/legal — Registro governado de autorização de fontes.
 *
 * Núcleo PURO (spec declarativa, planejamento idempotente, relatório, parser).
 * O wiring com Prisma vive em `bin/legal.ts` (worker-only, fora do typecheck
 * principal, coberto por `typecheck:catalog-runtime`).
 *
 * Não decide licença: materializa, de forma auditável e reversível por
 * histórico, a decisão formal do proprietário registrada em
 * docs/legal/source-replication-authorization.md. Nunca promove dado, nunca
 * libera logo/citação/derivada, nunca autoriza o Cinerie Score.
 */

export * from "./authorization-spec.js";
export * from "./plan.js";
export * from "./report.js";
export * from "./cli/args.js";
