/**
 * season-page.ts — Camada de dados SERVER-ONLY da pagina publica de temporada.
 *
 * Invariantes 3/4: le SOMENTE PostgreSQL local via @screena/db (Prisma); nunca
 * chama TMDB, Gemini ou qualquer host externo; read-only.
 *
 * A temporada NAO tem slug proprio: a URL usa o slug canonico da SERIE + o
 * numero real da temporada. `notFound()` (retorno null) quando a serie/temporada
 * nao existe ou a temporada pertence a outra serie (o filtro por `tvShowId`
 * garante a coerencia).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";
import type { PageSeoResolution } from "@screena/seo";

import {
  buildSeasonPageView,
  type SeasonPageView,
} from "../lib/season-episode-presenter";
import type { TrailerView } from "../lib/trailer-presenter";
import { seasonCanonicalUrl, seriesCanonicalUrl } from "../lib/site";
import { getTrailerForEntity } from "./entity-trailer";
import { resolveEntityPageSeo } from "./seo/indexability-decision";
import { applyPageSuspension } from "./seo/suspended-pages";

const LANGUAGE_CODE = "pt-BR";
const SERIES_ENTITY_TYPE = "tv";

export interface SeasonPageData {
  view: SeasonPageView;
  /**
   * O trailer DA TEMPORADA, já aprovado pelo gate de licença, ou `null`.
   *
   * `null` cobre quatro estados que a página não precisa distinguir (a
   * temporada não tem `tmdb_id` próprio, não há vídeo coletado, há vídeo sem
   * licença, há vídeo não promovido) — todos significam "não exibir". Quem
   * chama transforma em ausência REGISTRADA, nunca em bloco vazio.
   *
   * Até 2026-08-27 era `null` para TODAS as temporadas do catálogo, e a causa
   * era a primeira da lista: `sync_media` recusava `kind='season'`, então
   * `tmdb_videos` nunca teve uma linha com esse `entity_type`. A 2ª temporada
   * de Ted Lasso tem dois trailers oficiais no TMDB desde 2021.
   */
  trailer: TrailerView | null;
  /** Resolucao FINAL de SEO da temporada (fatos vivos + decisao vigente). */
  seo: PageSeoResolution;
  /** Slug canonico pt-BR da serie. */
  canonicalSlug: string;
  /** URL canonica absoluta da temporada. */
  canonicalUrl: string;
  /** URL canonica absoluta da serie (breadcrumb + partOfSeries). */
  seriesUrl: string;
}

function isoDate(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10);
}

function prevNext(
  numbers: number[],
  current: number,
): { prev: number | null; next: number | null } {
  const sorted = [...numbers].filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  const index = sorted.indexOf(current);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? (sorted[index - 1] ?? null) : null,
    next: index < sorted.length - 1 ? (sorted[index + 1] ?? null) : null,
  };
}

export const getSeasonPageData = cache(
  async (seriesSlug: string, seasonNumber: number): Promise<SeasonPageData | null> => {
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) return null;
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: SERIES_ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug: seriesSlug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;
    const seriesId = slugRow.entityId;

    const [series, canonicalSlugRow, seriesTranslation, season, seasonNumbers] =
      await Promise.all([
        prisma.tvShow.findUnique({
          where: { id: seriesId },
          select: { nameOriginal: true, posterPath: true, backdropPath: true },
        }),
        prisma.slug.findFirst({
          where: {
            entityType: SERIES_ENTITY_TYPE,
            entityId: seriesId,
            languageCode: LANGUAGE_CODE,
            isCanonical: true,
          },
          select: { slug: true },
        }),
        prisma.entityTranslation.findFirst({
          where: { entityType: SERIES_ENTITY_TYPE, entityId: seriesId, languageCode: LANGUAGE_CODE },
          select: { title: true },
        }),
        prisma.season.findFirst({
          where: { tvShowId: seriesId, seasonNumber },
          select: {
            id: true,
            // A CHAVE da mídia da temporada. `tmdb_videos` guarda o trailer pelo
            // id PRÓPRIO da temporada, nunca pelo da série — se fosse o da
            // série, todas as temporadas mostrariam o mesmo vídeo.
            tmdbId: true,
            seasonNumber: true,
            name: true,
            overview: true,
            airDate: true,
            episodeCount: true,
            posterPath: true,
            // A LISTA DE EPISODIOS SAIU DESTE `select`, mas NAO ENCOLHEU.
            //
            // Ela vira uma consulta propria logo abaixo, com exatamente as
            // mesmas linhas, as mesmas colunas e a mesma ordem — a tela continua
            // mostrando a temporada INTEIRA. O motivo da mudanca e outro: como
            // consulta separada ela viaja no mesmo `Promise.all` do trailer e da
            // resolucao de SEO, que antes eram dois `await` em serie depois
            // deste lote. Menos ida e volta ao PostgreSQL, mesmo resultado.
          },
        }),
        prisma.season.findMany({
          where: { tvShowId: seriesId },
          select: { seasonNumber: true },
          orderBy: { seasonNumber: "asc" },
        }),
      ]);

    if (series === null || season === null) return null;

    const canonicalSlug = canonicalSlugRow?.slug ?? seriesSlug;
    const canonicalUrl = seasonCanonicalUrl(canonicalSlug, season.seasonNumber);
    const seriesUrl = seriesCanonicalUrl(canonicalSlug);
    if (canonicalUrl === null || seriesUrl === null) return null;

    /**
     * SEGUNDA E ULTIMA IDA AO BANCO — tres leituras independentes juntas.
     *
     * Antes eram tres esperas em SERIE depois do lote inicial: a lista aninhada
     * de episodios vinha no lote 1, depois `await` do trailer, depois `await`
     * da resolucao de SEO. Nenhuma das tres depende do resultado da outra —
     * todas dependem so de `season`, que ja esta resolvida aqui.
     *
     * O `findMany` NAO tem `take` de proposito: a ficha de temporada mostra a
     * temporada inteira, e esse e o comportamento a preservar. O custo de uma
     * temporada de novela (centenas ou milhares de linhas com `overview`) e
     * consequencia declarada dessa decisao de produto, nao um descuido.
     */
    const [episodeRows, trailer, resolved] = await Promise.all([
      prisma.episode.findMany({
        where: { seasonId: season.id },
        orderBy: { episodeNumber: "asc" },
        select: {
          episodeNumber: true,
          name: true,
          overview: true,
          airDate: true,
          runtimeMinutes: true,
          stillPath: true,
        },
      }),
      // Sem `tmdb_id` próprio não há chave: `null` direto, sem consultar. Cair
      // para o id da série mostraria o trailer de OUTRA temporada.
      season.tmdbId === null
        ? Promise.resolve(null)
        : getTrailerForEntity(prisma, "season", season.tmdbId),
      resolveEntityPageSeo(
        { entityType: "season", entityId: season.id, languageCode: LANGUAGE_CODE },
        {
          language: LANGUAGE_CODE,
          hasReliableStructuredData: true,
          displayedRatings: [],
          canonicalUrl,
        },
        prisma,
      ),
    ]);

    const seriesTitle = seriesTranslation?.title?.trim() || series.nameOriginal;
    const { prev, next } = prevNext(
      seasonNumbers.map((row) => row.seasonNumber),
      season.seasonNumber,
    );

    const view = buildSeasonPageView({
      seriesTitle,
      seriesSlug: canonicalSlug,
      seasonNumber: season.seasonNumber,
      name: season.name,
      overview: season.overview,
      airDateIso: isoDate(season.airDate),
      episodeCount: season.episodeCount,
      seasonPosterPath: season.posterPath,
      seriesPosterPath: series.posterPath,
      seriesBackdropPath: series.backdropPath,
      episodes: episodeRows.map((episode) => ({
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        overview: episode.overview,
        airDateIso: isoDate(episode.airDate),
        runtimeMinutes: episode.runtimeMinutes,
        stillPath: episode.stillPath,
      })),
      prevSeasonNumber: prev,
      nextSeasonNumber: next,
    });

    // VALVULA 2026-08-27: o par obrigatorio da saida do sitemap.
    // Sair do sitemap nao desindexa; a meta tag desindexa.
    const seo = applyPageSuspension("season", resolved);

    return { view, trailer, seo, canonicalSlug, canonicalUrl, seriesUrl };
  },
);
