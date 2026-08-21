/**
 * trending-snapshot.ts — O QUE ESTA EM ALTA, lido do snapshot persistido.
 *
 * Camada SERVER-ONLY. Invariantes 3 e 4: le SOMENTE PostgreSQL local. A captura
 * roda offline, na fila `trending` do agendador (4 requisicoes por ciclo de 6 h,
 * `services/sync/src/scheduler/rhythms.ts`), com log em `api_sync_logs`.
 *
 * ============================================================================
 * POR QUE ESTE MODULO EXISTE
 * ============================================================================
 * Tres superficies afirmavam "em alta" / "essa semana" e ordenavam por
 * `movies.popularity`, que e **acumulada**: um numero sem janela nenhuma. O
 * rotulo prometia um recorte de tempo que a consulta nao tinha.
 *
 * `discovery_snapshots` guarda o recorte de verdade — a lista do TMDB capturada
 * numa janela declarada (`day` ou `week`), com a POSICAO de cada titulo.
 *
 * ============================================================================
 * O SNAPSHOT VIGENTE, NUNCA "O MAIS RECENTE"
 * ============================================================================
 * O filtro e `expires_at > now`. A diferenca decide a honestidade do rotulo: se
 * a captura parar, o ultimo snapshot continua sendo o mais recente PARA SEMPRE,
 * e a tela passaria a exibir o que estava em alta na semana passada sob o rotulo
 * "essa semana". Vencido nao e "quase fresco" — e vencido.
 *
 * ============================================================================
 * SEM FALLBACK PARA POPULARIDADE. NUNCA.
 * ============================================================================
 * A tentacao obvia, quando o snapshot vem vazio, e completar o trilho com
 * `popularity desc`. Isso recria exatamente a mentira que este modulo existe
 * para desfazer, so que em letra miuda: o leitor veria titulos NAO trending sob
 * um rotulo que afirma trending, e ninguem saberia quais.
 *
 * Vazio => a superficie declara a AUSENCIA, com o motivo nomeado. As tres causas
 * pedem acoes diferentes e por isso nao colapsam.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** A janela do trending. Nao ha terceira: o TMDB expoe estas duas. */
export type TrendingWindow = "day" | "week";

/** Por que nao ha trending para exibir. Cada motivo e uma CAUSA acionavel. */
export type TrendingAbsenceReason =
  /**
   * NUNCA houve captura desta lista/janela. E deploy ou configuracao: a fila
   * `trending` do agendador nao rodou nenhuma vez (servico fora do ar, fila
   * desligada em `CINERIE_SCHEDULER_DISABLED_QUEUES`, ou `APPLY` desligado).
   */
  | "no_trending_snapshot"
  /**
   * HOUVE captura, e ela VENCEU. A fila parou de rodar: upstream fora do ar,
   * credencial, cota, container morto. Distinto do anterior de proposito — um
   * pede "ligue"; este pede "descubra por que parou". O alerta de fila parada do
   * agendador ja deve estar gritando quando este motivo aparece.
   */
  | "trending_snapshot_expired"
  /**
   * Snapshot VIGENTE, porem nenhum titulo dele sobreviveu ao filtro de
   * identidade publica (slug canonico pt-BR + traducao). E fato sobre a
   * COBERTURA do catalogo, nao sobre a captura: o que esta em alta no mundo
   * ainda nao esta no nosso catalogo. Some sozinho conforme a semente cresce.
   */
  | "no_trending_overlap";

/** O trending de uma janela, ja na ordem da lista. */
export interface TrendingSnapshotResult {
  /** Ids internos, na ORDEM do trending (posicao 0 primeiro). */
  readonly entityIds: readonly bigint[];
  /** `null` quando veio cheio; senao o motivo, para o log da superficie. */
  readonly absence: TrendingAbsenceReason | null;
  /** Quando a captura vigente foi feita. `null` quando nao ha nenhuma. */
  readonly capturedAt: Date | null;
}

const LOCALE = "pt-BR";
const LIST_TYPE = "trending";

const EMPTY: TrendingSnapshotResult = { entityIds: [], absence: "no_trending_snapshot", capturedAt: null };

/**
 * Le o trending vigente de (tipo, janela).
 *
 * Duas consultas no pior caso, e a segunda so roda quando a primeira volta
 * vazia: e ela que separa "nunca capturou" de "venceu". Uma consulta so
 * devolveria o mesmo vazio para as duas causas, e elas pedem acoes diferentes.
 */
export async function readTrendingSnapshot(
  prisma: PrismaClient,
  entityType: "movie" | "tv",
  window: TrendingWindow,
  now: Date,
): Promise<TrendingSnapshotResult> {
  const vigente = await prisma.discoverySnapshot.findFirst({
    where: {
      listType: LIST_TYPE,
      entityType,
      window,
      locale: LOCALE,
      expiresAt: { gt: now },
    },
    orderBy: { capturedAt: "desc" },
    select: {
      capturedAt: true,
      items: { orderBy: { position: "asc" }, select: { entityId: true } },
    },
  });

  if (vigente === null) {
    // Existe QUALQUER captura desta lista/janela, mesmo vencida?
    const qualquer = await prisma.discoverySnapshot.findFirst({
      where: { listType: LIST_TYPE, entityType, window, locale: LOCALE },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    });
    return qualquer === null
      ? EMPTY
      : { entityIds: [], absence: "trending_snapshot_expired", capturedAt: qualquer.capturedAt };
  }

  return {
    entityIds: vigente.items.map((item) => item.entityId),
    absence: vigente.items.length === 0 ? "no_trending_overlap" : null,
    capturedAt: vigente.capturedAt,
  };
}

/**
 * O trending vigente de um tipo e janela, com o cliente e o relogio do processo.
 *
 * Memoizado por request (`cache`). A versao INJETAVEL (`readTrendingSnapshot`) e
 * a que os loaders com seam de teste usam — `loadPopularRanking` recebe `prisma`
 * e `now` de fora justamente para que o teste possa medir QUAL consulta cada aba
 * dispara, e alcancar `getPrismaClient()` por dentro furaria esse seam.
 */
export const getTrendingSnapshot = cache(
  async (entityType: "movie" | "tv", window: TrendingWindow): Promise<TrendingSnapshotResult> =>
    readTrendingSnapshot(getPrismaClient(), entityType, window, new Date()),
);

/**
 * Ordena `ids` pela posicao no trending e DESCARTA quem nao esta nele.
 *
 * Descartar e o ponto: um titulo fora do trending sob um rotulo que afirma
 * trending e a mentira em letra miuda. Quem nao esta na lista nao entra — nem no
 * fim, nem para completar o trilho.
 */
export function orderByTrending<T>(
  items: readonly T[],
  entityIdOf: (item: T) => bigint,
  trending: readonly bigint[],
): readonly T[] {
  const position = new Map<string, number>();
  trending.forEach((id, index) => position.set(id.toString(), index));
  return items
    .map((item) => ({ item, at: position.get(entityIdOf(item).toString()) }))
    .filter((entry): entry is { item: T; at: number } => entry.at !== undefined)
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.item);
}

/**
 * O motivo a registrar quando o recorte vem curto, dado o que a captura disse e
 * o que sobrou depois do filtro de identidade publica.
 *
 * Se a captura estava CHEIA e mesmo assim sobrou zero, a causa nao e a captura:
 * e a cobertura do catalogo. Reportar `no_trending_snapshot` nesse caso mandaria
 * o operador reiniciar um agendador que esta funcionando.
 */
export function trendingAbsenceFor(
  snapshot: TrendingSnapshotResult,
  survivors: number,
): TrendingAbsenceReason | null {
  if (survivors > 0) return null;
  if (snapshot.absence !== null) return snapshot.absence;
  return "no_trending_overlap";
}
