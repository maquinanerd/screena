/**
 * entity-watch.ts — Helper SERVER-ONLY: dado um titulo (filme|serie), traz a
 * disponibilidade legal de streaming no Brasil via `watch_availability`, para o
 * painel "Disponibilidade no Brasil".
 *
 * Invariantes 3, 4 e 6:
 *  - Le somente PostgreSQL local via @screena/db (Prisma). Read-only. NUNCA
 *    consulta RapidAPI/streaming_availability ao vivo — este e o caminho de
 *    LEITURA; a ingestao roda offline em worker (PR #57).
 *  - LICENCA antes de exibir: a query ja filtra `display_allowed = true` (gate
 *    de origem, invariante 6); o presenter reaplica o filtro (defesa em
 *    profundidade). Este PR NAO promove nenhuma linha para `display_allowed`.
 *  - Pais do MVP = Brasil (pt-BR publica primeiro) e provider tecnico
 *    `streaming_availability`. Sem oferta permitida -> `null` e a pagina omite o
 *    painel. Ofertas vencidas (`available_until` no passado) sao excluidas.
 *    Nunca exibe pirataria.
 */

import { getPrismaClient } from "@screena/db/server";
import type { Prisma } from "@screena/db/server";

import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
  type WatchAvailabilityView,
} from "../lib/watch-availability-presenter";

/** Titulos que tem disponibilidade de streaming (subset de EntityType). */
export type WatchEntityType = "movie" | "tv";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Pais do MVP (pt-BR publica primeiro): disponibilidade legal no Brasil. */
const WATCH_COUNTRY = "BR";

/** Fornecedor tecnico do slice de streaming (nunca e a fonte editorial). */
const WATCH_PROVIDER_API = "streaming_availability";

/** Teto defensivo de linhas buscadas (o presenter agrupa/deduplica). */
const WATCH_FETCH_LIMIT = 60;

/**
 * Retorna o painel "Disponibilidade no Brasil" (ja licenciado, agrupado e
 * deduplicado) de um titulo. Sem oferta permitida -> `null` e a pagina omite o
 * painel inteiro.
 */
/**
 * Clausula compartilhada do gate de licenca (invariante 6 + Backend B):
 * so oferta exibivel, nao vencida e com DataUsageDecision VIGENTE cuja
 * licenca-mae continua vigente e exibivel. Reusada pelo painel por entidade e
 * pelo hub /pt/onde-assistir — um unico lugar para a regra critica.
 */
export function licensedWatchWhere(now: Date): Prisma.WatchAvailabilityWhereInput {
  return {
    countryCode: WATCH_COUNTRY,
    providerApi: WATCH_PROVIDER_API,
    displayAllowed: true,
    OR: [{ availableUntil: null }, { availableUntil: { gt: now } }],
    dataUsageDecision: {
      is: {
        useCase: "watch_offer_display" as const,
        isCurrent: true,
        stage: "approved_for_display" as const,
        displayAllowed: true,
        validFrom: { lte: now },
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          { OR: [{ territory: null }, { territory: WATCH_COUNTRY }] },
        ],
        sourceLicense: {
          is: {
            isCurrent: true,
            displayAllowed: true,
            contentType: "watch_availability" as const,
            licenseStatus: { in: ["official", "licensed", "third_party"] as const },
          },
        },
      },
    },
  };
}

export async function getWatchAvailabilityForEntity(
  prisma: PrismaClient,
  entityType: WatchEntityType,
  entityId: bigint,
): Promise<WatchAvailabilityView | null> {
  const now = new Date();

  const rows = await prisma.watchAvailability.findMany({
    // Gate de licenca compartilhado (ver licensedWatchWhere acima): ofertas
    // vencidas fora; exibicao exige DataUsageDecision VIGENTE cuja licenca-mae
    // continua vigente e exibivel (achado A1 da revisao adversarial da PR #74).
    where: { entityType, entityId, ...licensedWatchWhere(now) },
    take: WATCH_FETCH_LIMIT,
    select: {
      providerName: true,
      providerKey: true,
      offerType: true,
      deepLink: true,
      quality: true,
      price: true,
      currency: true,
      displayAllowed: true,
      fetchedAt: true,
      // Credito da fonte agregadora: a licenca que autoriza exibir a oferta e a
      // mesma que exige creditar (docs/legal/source-authorization-matrix.md).
      // Sem estes campos o painel exibia oferta licenciada SEM o credito
      // obrigatorio; o presenter agora descarta a oferta que nao os tenha.
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: true,
      attributionUrl: true,
    },
  });

  const inputs: WatchAvailabilityRow[] = rows.map((row) => ({
    providerName: row.providerName,
    providerKey: row.providerKey,
    offerType: row.offerType === null ? null : String(row.offerType),
    deepLink: row.deepLink,
    quality: row.quality,
    priceAmount: row.price === null ? null : row.price.toString(),
    currency: row.currency,
    displayAllowed: row.displayAllowed,
    fetchedAtIso: row.fetchedAt === null ? null : row.fetchedAt.toISOString(),
    requiresAttribution: row.requiresAttribution,
    requiresLinkback: row.requiresLinkback,
    attributionText: row.attributionText,
    attributionUrl: row.attributionUrl,
  }));

  return buildWatchAvailabilityView(inputs);
}
