/**
 * persistence/index.ts — Montagem dos adapters Prisma. EXCLUIDO do typecheck.
 *
 * Une `content_blocks` (archive + insert), `entity_writer_logs` (1 tentativa) e
 * `entity_writer_jobs` (estado terminal) sobre um unico Prisma Client
 * server-only. Worker-only: o render NUNCA importa este modulo (guarda
 * `audit:render`). Exposto via o export "./runtime" do pacote.
 */

import { getPrismaClient, type PrismaClient } from "@screena/db/server";
import type {
  ContentBlockStorePort,
  EnqueueCandidateSourcePort,
  EnqueueReadPort,
  EntityWriterJobStorePort,
  EntityWriterLogPort,
  JobClaimPort,
  JobEnqueuePort,
  PayloadSourcePort,
} from "../ports.js";
import { createPrismaContentBlockStore } from "./content-block-store.js";
import { createPrismaEntityWriterLogStore } from "./entity-writer-log-store.js";
import { createPrismaJobStore } from "./job-store.js";
import { createPrismaJobClaim } from "./job-claim.js";
import { createPrismaPayloadSource } from "./payload-source.js";
import { createPrismaEnqueueRead, createPrismaJobEnqueue } from "./job-enqueue.js";
import { createPrismaEnqueueCandidateSource } from "./enqueue-candidates.js";

/** Adapters Prisma do Entity Writer prontos para a orquestracao (worker-only). */
export interface EntityWriterPersistence {
  readonly prisma: PrismaClient;
  readonly contentBlocks: ContentBlockStorePort;
  readonly logs: EntityWriterLogPort;
  readonly jobs: EntityWriterJobStorePort;
  readonly claim: JobClaimPort;
  readonly payloadSource: PayloadSourcePort;
  /** Leitura para enqueue (blocos ativos + job ativo). */
  readonly enqueueRead: EnqueueReadPort;
  /** Criacao de jobs (race-safe). */
  readonly jobEnqueue: JobEnqueuePort;
  /** Descoberta de candidatos para enqueue em lote (`--missing`). */
  readonly candidateSource: EnqueueCandidateSourcePort;
}

/** Monta os adapters Prisma sobre o client singleton (server-only). */
export function createEntityWriterPersistence(): EntityWriterPersistence {
  const prisma = getPrismaClient();
  return {
    prisma,
    contentBlocks: createPrismaContentBlockStore(prisma),
    logs: createPrismaEntityWriterLogStore(prisma),
    jobs: createPrismaJobStore(prisma),
    claim: createPrismaJobClaim(prisma),
    payloadSource: createPrismaPayloadSource(prisma),
    enqueueRead: createPrismaEnqueueRead(prisma),
    jobEnqueue: createPrismaJobEnqueue(prisma),
    candidateSource: createPrismaEnqueueCandidateSource(prisma),
  };
}

export { createPrismaContentBlockStore } from "./content-block-store.js";
export { createPrismaEntityWriterLogStore } from "./entity-writer-log-store.js";
export { createPrismaJobStore } from "./job-store.js";
export { createPrismaJobClaim } from "./job-claim.js";
export { createPrismaPayloadSource } from "./payload-source.js";
export { createPrismaEnqueueRead, createPrismaJobEnqueue } from "./job-enqueue.js";
export { createPrismaEnqueueCandidateSource } from "./enqueue-candidates.js";
