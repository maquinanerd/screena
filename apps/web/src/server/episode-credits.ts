/**
 * episode-credits.ts — Elenco, elenco CONVIDADO e equipe técnica de UM episódio.
 *
 * Invariantes 3 e 4: lê SOMENTE PostgreSQL local via `@screena/db` (Prisma).
 * Zero TMDB, zero rede, zero IA no caminho de render. Read-only.
 *
 * ============================================================================
 * POR QUE UM MÓDULO SEPARADO DE `entity-cast.ts`
 * ============================================================================
 * `getCastForEntity` serve filme e série, e é chaveado só por
 * (`entityType`, `entityId`). O episódio precisa de três coisas que aquele
 * helper não tem e que não cabem nele sem torná-lo pior:
 *
 *  1. A SEPARAÇÃO entre elenco regular e guest star. `cast_members.is_guest`
 *     existe justamente porque o TMDB separa `credits.cast` de `guest_stars`, e
 *     na página de episódio é o CONVIDADO que é a informação — quem é regular
 *     já está na ficha da série.
 *  2. A EQUIPE (`crew_members`), que a faixa de elenco de título não mostra.
 *  3. Teto de exibição próprio: um episódio de série pode ter 31 convidados
 *     (Ted Lasso T2E1 tem), e a faixa de título é desenhada para 12.
 *
 * ============================================================================
 * O DADO SÓ EXISTE DESDE 2026-08-27
 * ============================================================================
 * As duas tabelas aceitam `entity_type='episode'` desde a Fase 1, e nunca
 * receberam uma linha: `syncEpisodes` passava aos normalizadores o item de
 * `episodes[]` da temporada, que não tem bloco `credits`. Este módulo lê o que
 * `getTvEpisode` passou a coletar — a página não estava escondendo dado, o dado
 * não estava sendo gravado.
 */

import { getPrismaClient } from "@screena/db/server";

import { buildCastStrip, type CastMemberInput, type CastMemberView } from "../lib/cast-presenter";
import { buildCrewGroups, type CrewGroupView, type CrewMemberInput } from "../lib/crew-presenter";

const LANGUAGE_CODE = "pt-BR";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/**
 * Tetos de exibição.
 *
 * Convidados: 18. O TMDB lista 31 em Ted Lasso T2E1, e uma grade de 31
 * retratos empurra a navegação entre episódios para fora da tela. Dezoito são
 * seis linhas de três em telefone e três linhas de seis em desktop — bastante
 * para que o elenco convidado seja um BLOCO, e não uma página.
 *
 * Regulares: 8. Eles já estão por inteiro na ficha da série; aqui servem de
 * contexto, não de catálogo.
 *
 * Grupos de equipe: 8. Cobre direção, roteiro e as produções sem virar lista
 * telefônica — e o corte é por GRUPO, nunca por pessoa dentro de um grupo (ver
 * `buildCrewGroups`).
 */
const GUEST_LIMIT = 18;
const REGULAR_LIMIT = 8;
const CREW_GROUP_LIMIT = 8;

/** Quantas linhas buscar antes dos tetos acima (folga para descarte por nome vazio). */
const CAST_FETCH_LIMIT = 60;
const CREW_FETCH_LIMIT = 60;

/** Os três blocos de crédito de um episódio. */
export interface EpisodeCredits {
  /** `guest_stars` do TMDB — o elenco que só aparece NESTE episódio. */
  readonly guestStars: readonly CastMemberView[];
  /** `credits.cast` — elenco regular creditado neste episódio. */
  readonly regularCast: readonly CastMemberView[];
  /** Equipe agrupada por função (direção e roteiro primeiro). */
  readonly crew: readonly CrewGroupView[];
  /** Total REAL de convidados no banco, antes do teto. A tela mostra este número. */
  readonly guestStarsTotal: number;
}

/** Nenhum crédito. Objeto único para que a ausência tenha uma forma só. */
const SEM_CREDITOS: EpisodeCredits = {
  guestStars: [],
  regularCast: [],
  crew: [],
  guestStarsTotal: 0,
};

/**
 * Resolve o slug canônico pt-BR de um conjunto de pessoas.
 *
 * Uma consulta para todas: N+1 aqui seria uma consulta por pessoa numa página
 * que pode citar 44 delas.
 */
async function slugsPorPessoa(
  prisma: PrismaClient,
  personIds: readonly bigint[],
): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await prisma.slug.findMany({
    where: {
      entityType: "person",
      entityId: { in: [...personIds] },
      languageCode: LANGUAGE_CODE,
      isCanonical: true,
    },
    select: { entityId: true, slug: true },
  });
  const mapa = new Map<string, string>();
  for (const row of rows) mapa.set(row.entityId.toString(), row.slug);
  return mapa;
}

/**
 * Os créditos de um episódio. Sem crédito nenhum → {@link SEM_CREDITOS}, e a
 * página omite os blocos (nunca desenha uma seção vazia).
 */
export async function getEpisodeCredits(
  prisma: PrismaClient,
  episodeId: bigint,
): Promise<EpisodeCredits> {
  const [castRows, crewRows, guestStarsTotal] = await Promise.all([
    prisma.castMember.findMany({
      where: { entityType: "episode", entityId: episodeId },
      orderBy: [{ billingOrder: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      take: CAST_FETCH_LIMIT,
      select: {
        character: true,
        billingOrder: true,
        isGuest: true,
        personId: true,
        person: { select: { name: true, profilePath: true } },
      },
    }),
    prisma.crewMember.findMany({
      where: { entityType: "episode", entityId: episodeId },
      orderBy: [{ id: "asc" }],
      take: CREW_FETCH_LIMIT,
      select: {
        department: true,
        job: true,
        personId: true,
        person: { select: { name: true } },
      },
    }),
    // A contagem REAL, sem o teto: a tela diz "31 convidados" e mostra 18.
    // Mostrar 18 e dizer 18 esconderia 13 pessoas sem avisar que escondeu.
    prisma.castMember.count({
      where: { entityType: "episode", entityId: episodeId, isGuest: true },
    }),
  ]);

  if (castRows.length === 0 && crewRows.length === 0) return SEM_CREDITOS;

  const personIds = [
    ...new Set([
      ...castRows.map((row) => row.personId.toString()),
      ...crewRows.map((row) => row.personId.toString()),
    ]),
  ].map((id) => BigInt(id));
  const slugs = await slugsPorPessoa(prisma, personIds);

  const paraElenco = (row: (typeof castRows)[number]): CastMemberInput => ({
    name: row.person.name,
    character: row.character,
    billingOrder: row.billingOrder,
    profilePath: row.person.profilePath,
    slug: slugs.get(row.personId.toString()) ?? null,
  });

  const crewInputs: CrewMemberInput[] = crewRows.map((row) => ({
    name: row.person.name,
    department: row.department,
    job: row.job,
    slug: slugs.get(row.personId.toString()) ?? null,
  }));

  return {
    guestStars: buildCastStrip(castRows.filter((row) => row.isGuest).map(paraElenco), GUEST_LIMIT),
    regularCast: buildCastStrip(
      castRows.filter((row) => !row.isGuest).map(paraElenco),
      REGULAR_LIMIT,
    ),
    crew: buildCrewGroups(crewInputs, CREW_GROUP_LIMIT),
    guestStarsTotal,
  };
}
