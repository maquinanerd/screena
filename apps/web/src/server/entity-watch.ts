/**
 * entity-watch.ts — Helper SERVER-ONLY: dado um titulo (filme|serie), traz a
 * disponibilidade legal de "Onde assistir" via `watch_availability`.
 *
 * Invariantes 3, 4 e 6:
 *  - Le somente PostgreSQL local via @screena/db (Prisma). Read-only.
 *  - LICENCA antes de exibir: a query ja filtra `display_allowed = true` (gate
 *    de origem); o presenter reaplica o filtro (defesa em profundidade).
 *  - Pais do MVP = Brasil (pt-BR publica primeiro). Sem oferta permitida no
 *    pais -> WatchView vazia e a pagina omite a secao. Nunca exibe pirataria.
 */

import { getPrismaClient } from "@screena/db/server";

import {
  buildWatchView,
  type WatchOfferInput,
  type WatchView,
} from "../lib/watch-presenter";

/** Titulos que tem "onde assistir" (subset de EntityType). */
export type WatchEntityType = "movie" | "tv";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Pais do MVP (pt-BR publica primeiro): disponibilidade legal no Brasil. */
const WATCH_COUNTRY = "BR";

/** Teto defensivo de linhas buscadas (o presenter agrupa por provedor). */
const WATCH_FETCH_LIMIT = 40;

/**
 * Retorna a secao "Onde assistir" (ja licenciada e agrupada) de um titulo. Sem
 * oferta permitida -> `providers: []` e a pagina omite a secao.
 */
export async function getWatchForEntity(
  prisma: PrismaClient,
  entityType: WatchEntityType,
  entityId: bigint,
): Promise<WatchView> {
  const rows = await prisma.watchAvailability.findMany({
    where: {
      entityType,
      entityId,
      countryCode: WATCH_COUNTRY,
      displayAllowed: true,
    },
    take: WATCH_FETCH_LIMIT,
    select: {
      providerName: true,
      offerType: true,
      displayAllowed: true,
      fetchedAt: true,
    },
  });

  const inputs: WatchOfferInput[] = rows.map((row) => ({
    providerName: row.providerName,
    offerType: String(row.offerType),
    displayAllowed: row.displayAllowed,
    fetchedAtIso: row.fetchedAt === null ? null : row.fetchedAt.toISOString(),
  }));

  return buildWatchView(inputs);
}
