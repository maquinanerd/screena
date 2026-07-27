/**
 * catalog-probes.ts — SONDAS de existencia do catalogo (C8).
 *
 * Existem por uma razao unica e estrutural: as FKs de `user_watch_states`,
 * `user_list_items` (para `entities`) e `user_episode_progress` (para
 * `episodes`) recusariam uma referencia invalida com VIOLACAO — e uma violacao
 * deixa a transacao interativa do Postgres ABORTADA, de modo que capturar a
 * excecao nao a ressuscita (regra da camada, C7B1.1: conflito esperado nao pode
 * envenenar a transacao).
 *
 * Sondar antes transforma "a escrita explode e derruba tudo" em "o servico
 * recebe `entity_not_found` e decide". A janela entre a sonda e a escrita
 * existe, mas o catalogo so cresce nesse intervalo — entidades nao sao
 * removidas (a propria FK e ON DELETE RESTRICT), entao a sonda nao pode virar
 * um falso positivo perigoso.
 */

import type { PrismaCatalogExecutor } from "./executor.js";

/** Sonda de `entities` (chave composta das referencias polimorficas). */
export function createEntityProbe(executor: PrismaCatalogExecutor): {
  exists(entityType: string, entityId: bigint): Promise<boolean>;
} {
  return {
    async exists(entityType: string, entityId: bigint): Promise<boolean> {
      const row = await executor.entity.findUnique({
        where: {
          entityType_entityId: {
            // O enum do Prisma e fechado; o chamador ja restringiu o valor pelo
            // tipo do dominio (`RatableEntityType`/`WatchableEntityType`).
            entityType: entityType as "movie" | "tv" | "season" | "episode" | "person",
            entityId,
          },
        },
        select: { entityId: true },
      });
      return row !== null;
    },
  };
}

/**
 * Sonda de `episodes`. Devolve os ids QUE EXISTEM, nao um booleano: as
 * operacoes em lote do tracker precisam filtrar um conjunto de ate milhares de
 * ids, e um booleano por id significaria uma consulta por episodio.
 */
export function createEpisodeProbe(executor: PrismaCatalogExecutor): {
  existingIds(episodeIds: readonly bigint[]): Promise<readonly bigint[]>;
} {
  return {
    async existingIds(episodeIds: readonly bigint[]): Promise<readonly bigint[]> {
      if (episodeIds.length === 0) {
        return [];
      }
      const rows = await executor.episode.findMany({
        where: { id: { in: [...episodeIds] } },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },
  };
}
