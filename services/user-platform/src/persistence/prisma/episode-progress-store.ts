/**
 * episode-progress-store.ts — adapter Prisma de `EpisodeProgressStore` (C8).
 *
 * O ARQUIVO INTEIRO E SOBRE ESCALA. O catalogo real tem series com mais de 21
 * mil episodios (`Tagesschau`), e "marcar a serie toda" e uma acao de um clique.
 * Uma escrita por episodio significaria 21 mil idas ao banco; carregar os
 * objetos no cliente significaria 21 mil linhas no navegador. Nenhum dos dois e
 * aceitavel, entao:
 *
 *  - `markBulk` trabalha em CHUNKS de tamanho fixo, com duas operacoes
 *    SET-BASED por chunk (`createMany` + `updateMany`) — nao uma por episodio;
 *  - cada chunk e IDEMPOTENTE: reprocessar o mesmo chunk nao duplica nem
 *    reescreve o que ja esta no alvo, entao uma falha no meio pode ser
 *    retentada sem compensacao;
 *  - contagens usam `count`, nunca `findMany().length`.
 *
 * O tamanho do chunk e um compromisso explicito: grande o bastante para que 21
 * mil episodios caibam em poucas dezenas de comandos, pequeno o bastante para
 * que nenhum `IN (...)` fique absurdo e para que uma transacao nao fique presa
 * por tempo indeterminado.
 */

import type { EpisodeProgressStore } from "../ports.js";
import type {
  EpisodeBulkMarkInput,
  EpisodeBulkMarkResult,
  EpisodeProgressLookupResult,
  EpisodeProgressUpsertInput,
  EpisodeProgressUpsertResult,
  TransactionScope,
  WatchedEpisodeCount,
} from "../types.js";
import type { PrismaLibraryExecutor } from "./executor.js";
import { toEpisodeProgressRecord } from "./mappers.js";

/**
 * Episodios por comando nas operacoes em lote.
 *
 * 1000 mantem o `IN (...)` do `updateMany` num tamanho que o planner do
 * Postgres lida bem e limita a memoria de cada comando. Para `Tagesschau`
 * (~21 mil episodios) isso da ~22 chunks — duas ordens de grandeza abaixo de
 * uma escrita por episodio.
 */
export const EPISODE_BULK_CHUNK_SIZE = 1000;

const PROGRESS_SELECT = {
  episodeId: true,
  watched: true,
  watchedAt: true,
  progressSeconds: true,
  durationSeconds: true,
  version: true,
  updatedAt: true,
} as const;

/** Divide em blocos de `size`. Puro; nao aloca alem do necessario. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push([...items.slice(i, i + size)]);
  }
  return out;
}

/** Sonda de existencia de episodio (FK real para `episodes`). */
export interface EpisodeProbe {
  existingIds(episodeIds: readonly bigint[]): Promise<readonly bigint[]>;
}

export function createPrismaEpisodeProgressStore(
  executor: PrismaLibraryExecutor,
  probe: EpisodeProbe,
): EpisodeProgressStore {
  return {
    async find(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly episodeId: bigint },
    ): Promise<EpisodeProgressLookupResult> {
      const row = await executor.episodeProgress.findUnique({
        where: { userId_episodeId: { userId: input.userId, episodeId: input.episodeId } },
        select: PROGRESS_SELECT,
      });
      return row === null
        ? { kind: "not_found" }
        : { kind: "found", progress: toEpisodeProgressRecord(row) };
    },

    async upsert(
      _scope: TransactionScope,
      input: EpisodeProgressUpsertInput,
    ): Promise<EpisodeProgressUpsertResult> {
      if (input.expectedVersion === null) {
        // Sonda ANTES do insert: `user_episode_progress.episode_id` tem FK real
        // para `episodes` com ON DELETE RESTRICT, e uma violacao abortaria a
        // transacao interativa inteira.
        const existentes = await probe.existingIds([input.episodeId]);
        if (existentes.length === 0) {
          return { kind: "episode_not_found" };
        }

        const criadas = await executor.episodeProgress.createManyAndReturn({
          data: [
            {
              userId: input.userId,
              episodeId: input.episodeId,
              watched: input.watched,
              watchedAt: input.watchedAt,
              progressSeconds: input.progressSeconds,
              durationSeconds: input.durationSeconds,
              version: input.nextVersion,
            },
          ],
          select: PROGRESS_SELECT,
          skipDuplicates: true,
        });
        const row = criadas[0];
        if (row !== undefined) {
          return { kind: "saved", progress: toEpisodeProgressRecord(row) };
        }
        return {
          kind: "conflict",
          conflict: { reason: "unique_violation", target: "episodeProgress.episode" },
        };
      }

      const aplicado = await executor.episodeProgress.updateMany({
        where: {
          userId: input.userId,
          episodeId: input.episodeId,
          version: input.expectedVersion,
        },
        data: {
          watched: input.watched,
          watchedAt: input.watchedAt,
          progressSeconds: input.progressSeconds,
          durationSeconds: input.durationSeconds,
          version: input.nextVersion,
        },
      });

      if (aplicado.count > 1) {
        throw new Error("invariante violada: mais de um progresso para (usuario, episodio)");
      }
      if (aplicado.count === 0) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "episodeProgress.version" },
        };
      }

      const row = await executor.episodeProgress.findUnique({
        where: { userId_episodeId: { userId: input.userId, episodeId: input.episodeId } },
        select: PROGRESS_SELECT,
      });
      if (row === null) {
        throw new Error("invariante violada: progresso desapareceu apos update bem-sucedido");
      }
      return { kind: "saved", progress: toEpisodeProgressRecord(row) };
    },

    async markBulk(
      _scope: TransactionScope,
      input: EpisodeBulkMarkInput,
    ): Promise<EpisodeBulkMarkResult> {
      if (input.episodeIds.length === 0) {
        return { created: 0, updated: 0 };
      }

      let created = 0;
      let updated = 0;

      for (const bloco of chunk(input.episodeIds, EPISODE_BULK_CHUNK_SIZE)) {
        // 1. Só os ids que EXISTEM no catalogo. Um id invalido no lote
        //    levantaria violacao de FK e abortaria tudo; filtrar antes mantem a
        //    operacao parcial-segura e a transacao utilizavel.
        const validos = [...(await probe.existingIds(bloco))];
        if (validos.length === 0) {
          continue;
        }

        // 2. INSERT ... ON CONFLICT DO NOTHING para quem ainda nao tem linha.
        //    Um unico comando por chunk, nao um por episodio.
        const inseridos = await executor.episodeProgress.createMany({
          data: validos.map((episodeId) => ({
            userId: input.userId,
            episodeId,
            watched: input.watched,
            watchedAt: input.watched ? input.watchedAt : null,
            version: 1,
          })),
          skipDuplicates: true,
        });
        created += inseridos.count;

        // 3. UPDATE set-based para quem JA tinha linha e ainda nao esta no
        //    alvo. O filtro `watched: !input.watched` e o que torna a operacao
        //    idempotente: reprocessar o mesmo chunk atualiza ZERO linhas.
        //
        //    `watchedAt` so e escrito ao MARCAR; ao desmarcar o carimbo e
        //    preservado (o dominio trata `watchedAt` como historico, nao como
        //    espelho de `watched`).
        const atualizados = await executor.episodeProgress.updateMany({
          where: {
            userId: input.userId,
            episodeId: { in: validos },
            watched: !input.watched,
          },
          data: input.watched
            ? { watched: true, watchedAt: input.watchedAt, version: { increment: 1 } }
            : { watched: false, version: { increment: 1 } },
        });
        updated += atualizados.count;
      }

      return { created, updated };
    },

    async countWatchedForSeries(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly episodeIds: readonly bigint[] },
    ): Promise<WatchedEpisodeCount> {
      if (input.episodeIds.length === 0) {
        return { watched: 0 };
      }
      // COUNT por chunk: o total sai somado, sem materializar linha nenhuma.
      let watched = 0;
      for (const bloco of chunk(input.episodeIds, EPISODE_BULK_CHUNK_SIZE)) {
        watched += await executor.episodeProgress.count({
          where: { userId: input.userId, episodeId: { in: bloco }, watched: true },
        });
      }
      return { watched };
    },

    async listWatchedIds(
      _scope: TransactionScope,
      input: { readonly userId: bigint; readonly episodeIds: readonly bigint[] },
    ): Promise<readonly bigint[]> {
      if (input.episodeIds.length === 0) {
        return [];
      }
      const out: bigint[] = [];
      for (const bloco of chunk(input.episodeIds, EPISODE_BULK_CHUNK_SIZE)) {
        const rows = await executor.episodeProgress.findMany({
          where: { userId: input.userId, episodeId: { in: bloco }, watched: true },
          select: { episodeId: true },
        });
        for (const row of rows) {
          out.push(row.episodeId);
        }
      }
      return out;
    },

    async countWatchedTotal(_scope: TransactionScope, userId: bigint): Promise<number> {
      return executor.episodeProgress.count({ where: { userId, watched: true } });
    },
  };
}
