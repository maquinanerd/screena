/**
 * entity-facts.ts — Helper SERVER-ONLY dos FATOS DA FICHA TÉCNICA que vivem em
 * relações: equipe (direção/roteiro), países de origem, produtoras e emissoras.
 *
 * Invariantes 3 e 4: lê somente PostgreSQL local (Prisma), read-only, zero IA.
 *
 * A ficha é lista de FATOS, não formulário: helper devolve `[]`/`null` e a
 * linha correspondente simplesmente não existe na página.
 */

import { getPrismaClient } from "@screena/db/server";

const LANGUAGE_CODE = "pt-BR";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** Títulos que têm ficha (subset de EntityType). */
export type FactsEntityType = "movie" | "tv";

/** Uma pessoa da equipe, com link quando ela tem página. */
export interface CrewFactPerson {
  readonly name: string;
  /** `/pt/pessoas/{slug}/` quando há slug canônico pt-BR; senão `null`. */
  readonly href: string | null;
}

/** Direção e roteiro do título, deduplicados e na ordem dos créditos. */
export interface CrewFacts {
  readonly directors: CrewFactPerson[];
  readonly writers: CrewFactPerson[];
}

/**
 * Cargos que contam como DIREÇÃO e como ROTEIRO. Vocabulário FECHADO do TMDB
 * (`job` dos créditos): um cargo fora da lista não entra — a ficha afirma
 * "Direção", não "trabalhou no departamento".
 */
const DIRECTOR_JOBS: ReadonlySet<string> = new Set(["Director"]);
const WRITER_JOBS: ReadonlySet<string> = new Set(["Writer", "Screenplay", "Teleplay", "Story"]);

export async function getCrewFactsForEntity(
  prisma: PrismaClient,
  entityType: FactsEntityType,
  entityId: bigint,
): Promise<CrewFacts> {
  const rows = await prisma.crewMember.findMany({
    where: {
      entityType,
      entityId,
      job: { in: [...DIRECTOR_JOBS, ...WRITER_JOBS] },
    },
    orderBy: { id: "asc" },
    select: {
      job: true,
      personId: true,
      person: { select: { name: true } },
    },
  });
  if (rows.length === 0) return { directors: [], writers: [] };

  const personIds = [...new Set(rows.map((row) => row.personId.toString()))].map((id) =>
    BigInt(id),
  );
  const slugRows = await prisma.slug.findMany({
    where: {
      entityType: "person",
      entityId: { in: personIds },
      languageCode: LANGUAGE_CODE,
      isCanonical: true,
    },
    select: { entityId: true, slug: true },
  });
  const slugByPerson = new Map<string, string>();
  for (const row of slugRows) slugByPerson.set(row.entityId.toString(), row.slug);

  const toPerson = (row: (typeof rows)[number]): CrewFactPerson => {
    const slug = slugByPerson.get(row.personId.toString()) ?? null;
    return {
      name: row.person.name,
      href: slug === null ? null : `/pt/pessoas/${slug}/`,
    };
  };

  const dedupe = (list: CrewFactPerson[]): CrewFactPerson[] => {
    const vistos = new Set<string>();
    return list.filter((person) => {
      if (vistos.has(person.name)) return false;
      vistos.add(person.name);
      return true;
    });
  };

  return {
    directors: dedupe(rows.filter((r) => r.job !== null && DIRECTOR_JOBS.has(r.job)).map(toPerson)),
    writers: dedupe(rows.filter((r) => r.job !== null && WRITER_JOBS.has(r.job)).map(toPerson)),
  };
}

/**
 * Países de origem do título, na ordem do payload, com o nome pt quando o
 * código existir em `countries` (tabela-escopo, ~13 códigos). Código fora do
 * escopo sai como o próprio ISO — fato, nunca fabricação.
 */
export async function getCountriesForEntity(
  prisma: PrismaClient,
  entityType: FactsEntityType,
  entityId: bigint,
): Promise<string[]> {
  const rows =
    entityType === "movie"
      ? await prisma.movieProductionCountry.findMany({
          where: { movieId: entityId },
          orderBy: { position: "asc" },
          select: { countryCode: true },
        })
      : await prisma.tvShowOriginCountry.findMany({
          where: { tvShowId: entityId },
          orderBy: { position: "asc" },
          select: { countryCode: true },
        });
  if (rows.length === 0) return [];

  const codes = rows.map((row) => row.countryCode);
  const named = await prisma.country.findMany({
    where: { code: { in: codes } },
    select: { code: true, namePt: true },
  });
  const nameByCode = new Map(named.map((row) => [row.code, row.namePt]));
  return codes.map((code) => nameByCode.get(code) ?? code);
}

/**
 * Produtoras/distribuidoras ligadas ao título (junção populada pelo sync de
 * entidades de referência). Ordem estável por nome; teto pequeno — a ficha
 * lista as principais, não o catálogo societário inteiro.
 */
export async function getCompaniesForEntity(
  prisma: PrismaClient,
  entityType: FactsEntityType,
  entityId: bigint,
  limit = 3,
): Promise<string[]> {
  if (entityType === "movie") {
    const rows = await prisma.movieProductionCompany.findMany({
      where: { movieId: entityId },
      select: { company: { select: { name: true } } },
      take: limit * 2,
    });
    return [...new Set(rows.map((row) => row.company.name))].sort().slice(0, limit);
  }
  const rows = await prisma.tvProductionCompany.findMany({
    where: { tvShowId: entityId },
    select: { company: { select: { name: true } } },
    take: limit * 2,
  });
  return [...new Set(rows.map((row) => row.company.name))].sort().slice(0, limit);
}

/** Emissoras/plataformas de exibição da série (junção `tv_networks`). */
export async function getNetworksForEntity(
  prisma: PrismaClient,
  entityId: bigint,
  limit = 3,
): Promise<string[]> {
  const rows = await prisma.tvNetwork.findMany({
    where: { tvShowId: entityId },
    select: { network: { select: { name: true } } },
    take: limit * 2,
  });
  return [...new Set(rows.map((row) => row.network.name))].sort().slice(0, limit);
}
