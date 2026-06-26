/**
 * @screena/entity-writer — Core puro do Entity Writer (Fase 3A).
 *
 * Superficie PURA: somente tipos e ports (interfaces). Nenhuma implementacao,
 * nenhum IO, nenhuma chamada a Gemini, nenhuma persistencia. Os adapters reais
 * (Gemini worker-only, persistencia Prisma, fila/runner) entram em fases
 * posteriores e NUNCA sao importados pelo render publico (apps/web).
 */

export * from "./types.js";
export * from "./ports.js";
export * from "./utils/hash.js";
export * from "./prompt/select-prompt.js";
export * from "./gemini/fake.js";
export * from "./pipeline/decide-status.js";
export * from "./pipeline/run-generation.js";
