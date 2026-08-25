/**
 * persistence/index.ts — Montagem dos adapters Prisma. COBERTO pelo typecheck da raiz
 * (`pnpm typecheck`).
 *
 * Une `content_blocks` (archive + insert), `entity_writer_logs` (1 tentativa) e
 * `entity_writer_jobs` (estado terminal) sobre um unico Prisma Client
 * server-only. Worker-only: o render NUNCA importa este modulo (guarda
 * `audit:render`). Exposto via o export "./runtime" do pacote.
 *
 * ============================================================================
 * POR QUE `persistence/` AQUI E CONFERIDO, E O DA INGESTAO NAO
 * ============================================================================
 * A exclusao em `tsconfig.json` e NOMINAL, nao por convencao de nome de pasta:
 * ela lista `services/ingestion/**\/persistence/**` e
 * `services/news-ingestion/**\/persistence/**`, e mais nada. Entao este
 * diretorio — como o de ratings e o de streaming — sempre esteve DENTRO do
 * programa da raiz, tocando Prisma e compilando.
 *
 * Ate 2026-08-21 os nove arquivos daqui abriam dizendo "EXCLUIDO do typecheck".
 * Era falso, e falso na direcao perigosa: um cabecalho que afirma que os tipos
 * nao sao conferidos autoriza o import de TIPO usado como VALOR — o erro que
 * derruba o container no import, antes de qualquer log. A rede existia; o
 * comentario mandava nao contar com ela. Travado por
 * `tests/governance/typecheck-exclusion-claims.test.ts`.
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
import type { InspectStorePort } from "../inspect/inspect-entity-writer.js";
import { createPrismaContentBlockStore } from "./content-block-store.js";
import { createPrismaEntityWriterLogStore } from "./entity-writer-log-store.js";
import { createPrismaJobStore } from "./job-store.js";
import { createPrismaJobClaim } from "./job-claim.js";
import { createPrismaPayloadSource } from "./payload-source.js";
import { createPrismaEnqueueRead, createPrismaJobEnqueue } from "./job-enqueue.js";
import { createPrismaEnqueueCandidateSource } from "./enqueue-candidates.js";
import { createPrismaInspectStore } from "./inspect-store.js";

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
  /** Inspecao READ-ONLY do estado operacional (nunca escreve). */
  readonly inspect: InspectStorePort;
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
    inspect: createPrismaInspectStore(prisma),
  };
}

export { createPrismaContentBlockStore } from "./content-block-store.js";
export { createPrismaEntityWriterLogStore } from "./entity-writer-log-store.js";
export { createPrismaJobStore } from "./job-store.js";
export { createPrismaJobClaim } from "./job-claim.js";
export { createPrismaPayloadSource } from "./payload-source.js";
export { createPrismaEnqueueRead, createPrismaJobEnqueue } from "./job-enqueue.js";
export { createPrismaEnqueueCandidateSource } from "./enqueue-candidates.js";
export { createPrismaInspectStore } from "./inspect-store.js";
