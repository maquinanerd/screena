/**
 * import-job-store.ts — adapter Prisma de `ImportJobStore` (C8).
 *
 * O CICLO DE VIDA DO JOB E A TRAVA DE CONCORRENCIA DA IMPORTACAO.
 *
 * `transition` faz COMPARE-AND-SWAP sobre o status esperado, e e isso que
 * impede dois `apply` simultaneos do MESMO job: o primeiro move
 * `preview_ready -> applying`, o segundo encontra o status ja mudado e recebe
 * `conflict`. Os uniques das tabelas de destino (watch state, progresso, itens
 * de lista, eventos) protegem o DADO de qualquer forma; o CAS aqui evita o
 * TRABALHO duplicado e a contagem inflada.
 *
 * `preview` e `conflicts` sao colunas Json. `undefined` preserva o valor atual
 * (o Prisma ignora a chave); `null` explicito grava JSON null. A distincao
 * importa: uma transicao de status nao pode apagar o preview por omissao.
 */

import type { ImportJobStore } from "../ports.js";
import type {
  ImportJobCreateInput,
  ImportJobLookupResult,
  ImportJobRecord,
  ImportJobTransitionInput,
  ImportJobTransitionResult,
  TransactionScope,
} from "../types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toImportJobRecord } from "./mappers.js";

/**
 * SELECT do job SEM `preview`/`conflicts`.
 *
 * Os dois sao Json potencialmente grandes (milhares de linhas normalizadas), e
 * a listagem de jobs nao os consome. Trazê-los em toda leitura transformaria
 * "meus imports" numa consulta pesada sem leitor.
 */
const JOB_SELECT = {
  id: true,
  userId: true,
  source: true,
  status: true,
  fileName: true,
  itemCount: true,
  conflictCount: true,
  appliedCount: true,
  error: true,
  appliedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function createPrismaImportJobStore(executor: PrismaLibraryExecutor): ImportJobStore {
  return {
    async create(
      _scope: TransactionScope,
      input: ImportJobCreateInput,
    ): Promise<{ readonly kind: "created"; readonly job: ImportJobRecord }> {
      // Sem unique nesta tabela: o mesmo titular pode importar quantas vezes
      // quiser, e cada tentativa merece o proprio registro de auditoria. A
      // idempotencia do RESULTADO vem dos uniques do destino, nao daqui.
      const row = await executor.importJob.create({
        data: {
          userId: input.userId,
          source: input.source,
          status: input.status,
          fileName: input.fileName,
        },
        select: JOB_SELECT,
      });
      return { kind: "created", job: toImportJobRecord(row) };
    },

    async findById(_scope: TransactionScope, jobId: bigint): Promise<ImportJobLookupResult> {
      // AQUI o preview entra: e o unico caminho que o consome (tela de
      // pre-visualizacao e o apply).
      const row = await executor.importJob.findUnique({
        where: { id: jobId },
        select: { ...JOB_SELECT, preview: true, conflicts: true },
      });
      if (row === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "found",
        job: toImportJobRecord(row),
        preview: row.preview,
        conflicts: row.conflicts,
      };
    },

    async listByUser(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly limit: number; readonly offset: number },
    ): Promise<{ readonly items: readonly ImportJobRecord[]; readonly total: number }> {
      const where = { userId: input.userId };
      const [items, total] = await Promise.all([
        executor.importJob.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: input.offset,
          take: input.limit,
          select: JOB_SELECT,
        }),
        executor.importJob.count({ where }),
      ]);
      return { items: items.map(toImportJobRecord), total };
    },

    async transition(
      _scope: TransactionScope,
      input: ImportJobTransitionInput,
    ): Promise<ImportJobTransitionResult> {
      // CAS sobre o status esperado. `update` simples seria last-write-wins e
      // dois `apply` concorrentes passariam os dois.
      const aplicado = await executor.importJob.updateMany({
        where: { id: input.id, status: input.expectedStatus },
        data: {
          status: input.nextStatus,
          ...(input.itemCount !== undefined ? { itemCount: input.itemCount } : {}),
          ...(input.conflictCount !== undefined ? { conflictCount: input.conflictCount } : {}),
          ...(input.appliedCount !== undefined ? { appliedCount: input.appliedCount } : {}),
          ...(input.error !== undefined ? { error: input.error } : {}),
          ...(input.appliedAt !== undefined ? { appliedAt: input.appliedAt } : {}),
          // `undefined` PRESERVA o Json atual; so grava quem passou a chave.
          ...(input.preview !== undefined ? { preview: input.preview as object } : {}),
          ...(input.conflicts !== undefined ? { conflicts: input.conflicts as object } : {}),
        },
      });

      if (aplicado.count > 1) {
        throw new Error("invariante violada: mais de um job para a mesma chave primaria");
      }
      if (aplicado.count === 1) {
        return { kind: "updated" };
      }

      // Zero linhas: job inexistente ou status ja mudado. A sonda le apenas
      // existencia e nenhum resultado dela vira sucesso (mesma limitacao de
      // atomicidade ja registrada em `identity-store.markEmailVerified`: o que
      // fica impreciso e o MOTIVO, nunca a decisao).
      const existe = await executor.importJob.findUnique({
        where: { id: input.id },
        select: { id: true },
      });
      if (existe === null) {
        return { kind: "not_found" };
      }
      return {
        kind: "conflict",
        conflict: { reason: "stale_preimage", target: "importJob.status" },
      };
    },
  };
}
