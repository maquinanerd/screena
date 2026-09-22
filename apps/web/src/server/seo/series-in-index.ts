/**
 * series-in-index.ts — a SERIE dona esta no indice?
 *
 * E a pergunta que temporada e episodio fazem antes de se oferecerem ao indice:
 * pagina de temporada de uma serie fora do indice nao se sustenta sozinha, e a
 * URL dela carrega o slug da serie.
 *
 * O MESMO PREDICADO DO SITEMAP. A serie esta no indice quando tem slug canonico
 * no locale, titulo original, passa no portao de localizacao (D3) e tem decisao
 * efetiva `index` — a persistida, ou a "ausente" que a cobertura do tipo manda.
 * E exatamente o que poe a serie no sitemap (`sitemap-index.ts`, tipo `series`),
 * e as consultas de temporada e de episodio de la repetem o texto. Esta funcao e
 * a traducao do lado da pagina: se as duas divergirem, a meta tag de uma
 * temporada diz uma coisa e o sitemap outra.
 *
 * Invariantes 3 e 4: le so PostgreSQL local. Falha de banco LANCA — nunca vira
 * "fora do indice" em silencio.
 */

import { getPrismaClient } from "@screena/db/server";
import { evaluateLocalizationGate, TMDB_FALLBACK_SLUG_PATTERN } from "@screena/seo";

import { PUBLISHED_LOCALES } from "../../lib/synopsis-language";
import { absentDecisionFor, readDecisionCoverageForPage } from "./decision-coverage";

type PrismaClient = ReturnType<typeof getPrismaClient>;

/** O que o chamador ja leu da serie — a funcao nao le de novo. */
export interface SeriesIndexFacts {
  readonly seriesId: bigint;
  /** Slug CANONICO da serie no locale; `null` quando so existe slug antigo. */
  readonly canonicalSlug: string | null;
  /** `tv_shows.name_original`. */
  readonly nameOriginal: string | null;
}

export async function isSeriesInIndex(
  prisma: PrismaClient,
  facts: SeriesIndexFacts,
  language: string,
): Promise<boolean> {
  if (facts.canonicalSlug === null) return false;
  if ((facts.nameOriginal ?? "").trim() === "") return false;
  const slug = facts.canonicalSlug.trim();

  const [translations, persisted, coverage] = await Promise.all([
    // So o slug de fallback `tmdb-{id}` paga a consulta de traducao: e so nele
    // que o portao de localizacao se aplica.
    TMDB_FALLBACK_SLUG_PATTERN.test(slug)
      ? prisma.entityTranslation.findMany({
          where: {
            entityType: "tv",
            entityId: facts.seriesId,
            languageCode: { in: [...PUBLISHED_LOCALES] },
          },
          select: { title: true, summary: true, metaDescription: true },
        })
      : Promise.resolve([]),
    prisma.pageIndexabilityDecision.findFirst({
      where: {
        entityType: "tv",
        entityId: facts.seriesId,
        languageCode: language,
        isCurrent: true,
      },
      select: { decision: true },
    }),
    readDecisionCoverageForPage(language),
  ]);

  // O `NOT EXISTS` do sitemap reprova a serie so quando NENHUMA linha publicada
  // passa no portao; sem linha nenhuma, decide o slug.
  const localizada = (
    translations.length === 0 ? [null] : translations
  ).some(
    (row) =>
      evaluateLocalizationGate({
        canonicalSlug: slug,
        localizedTitle: row?.title ?? null,
        originalTitle: facts.nameOriginal,
        hasLocalizedDescription:
          (row?.summary ?? "").trim() !== "" || (row?.metaDescription ?? "").trim() !== "",
      }).passed,
  );
  if (!localizada) return false;

  const efetiva =
    persisted !== null ? String(persisted.decision) : absentDecisionFor(coverage, "tv");
  return efetiva === "index";
}
