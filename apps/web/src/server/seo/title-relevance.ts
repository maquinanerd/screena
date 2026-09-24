/**
 * title-relevance.ts — o PORTAO DE RELEVANCIA do lado da pagina.
 *
 * DECISAO DO DONO, ASSINADA EM 24/09/2026 (`docs/seo/DECISOES-DO-DONO-2026-09-24.md`):
 * filme ou serie fica no indice se tiver pais de origem EUA ou Brasil, OU pelo
 * menos 500 votos no TMDB, OU oferta de streaming no Brasil. Os demais — inclusive
 * o SEM PAIS — ficam `noindex, follow` e fora do sitemap. Nada e apagado.
 *
 * O MESMO PREDICADO DO SITEMAP. A regra pura e `evaluateRelevanceGate`
 * (`@screena/seo`); o SQL de `sitemap-index.ts` e a segunda traducao dela, com os
 * mesmos numeros de `@screena/config`. Esta funcao so le os tres fatos que a
 * regra pede, das MESMAS tabelas que o SQL le:
 *
 *   - paises: `movie_production_countries` / `tv_show_origin_countries`, em
 *     qualquer posicao;
 *   - votos: `vote_count_tmdb` (o chamador ja leu a linha do titulo);
 *   - oferta: QUALQUER linha de `watch_availability` do titulo com
 *     `country_code = 'BR'`.
 *
 * CHAVE DE EMERGENCIA: com `CINERIE_RELEVANCE_GATE=off` a funcao nem consulta o
 * banco e devolve o veredito que passa — a pagina fica exatamente como era antes
 * da decisao. A chave e lida a cada chamada (runtime), nunca no import.
 *
 * Invariantes 3 e 4: le so PostgreSQL local. Falha de banco LANCA (5xx) — nunca
 * vira "fora do indice" em silencio.
 */

import { getPrismaClient } from "@screena/db/server";
import { isRelevanceGateEnabled, RELEVANCE_GATE_OFFER_COUNTRY } from "@screena/config";
import {
  evaluateRelevanceGate,
  RELEVANCE_GATE_OFF_VERDICT,
  type QualityGateVerdict,
} from "@screena/seo";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** O titulo cuja relevancia se avalia — o chamador ja leu a linha dele. */
export interface TitleRelevanceSubject {
  readonly entityType: "movie" | "tv";
  readonly entityId: bigint;
  /** `movies.vote_count_tmdb` / `tv_shows.vote_count_tmdb`. */
  readonly voteCount: number | null;
}

/** Os paises de origem gravados do titulo, em qualquer posicao. */
async function readOriginCountries(
  prisma: PrismaClient,
  subject: TitleRelevanceSubject,
): Promise<string[]> {
  if (subject.entityType === "movie") {
    const rows = await prisma.movieProductionCountry.findMany({
      where: { movieId: subject.entityId },
      select: { countryCode: true },
      orderBy: { position: "asc" },
    });
    return rows.map((row) => row.countryCode);
  }
  const rows = await prisma.tvShowOriginCountry.findMany({
    where: { tvShowId: subject.entityId },
    select: { countryCode: true },
    orderBy: { position: "asc" },
  });
  return rows.map((row) => row.countryCode);
}

/**
 * Veredito do portao de relevancia para UM titulo. Ligado por padrao; so
 * `CINERIE_RELEVANCE_GATE=off` desliga.
 */
export async function evaluateTitleRelevance(
  prisma: PrismaClient,
  subject: TitleRelevanceSubject,
): Promise<QualityGateVerdict> {
  if (!isRelevanceGateEnabled()) return RELEVANCE_GATE_OFF_VERDICT;

  const [countries, offer] = await Promise.all([
    readOriginCountries(prisma, subject),
    prisma.watchAvailability.findFirst({
      where: {
        entityType: subject.entityType,
        entityId: subject.entityId,
        countryCode: RELEVANCE_GATE_OFFER_COUNTRY,
      },
      select: { id: true },
    }),
  ]);

  return evaluateRelevanceGate({
    entityType: subject.entityType,
    countries,
    voteCount: subject.voteCount,
    hasBrazilOffer: offer !== null,
  });
}
