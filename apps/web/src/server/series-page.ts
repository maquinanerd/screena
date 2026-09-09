/**
 * series-page.ts - Camada de dados SERVER-ONLY da pagina publica de serie.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini nem qualquer API externa. Ratings e disponibilidade
 *    de streaming sao LIDOS do PostgreSQL (ja ingeridos offline por worker e
 *    filtrados por licenca), nunca buscados ao vivo em RapidAPI/IMDb/RT.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { SITE_URL } from "../lib/site";
import {
  isPublishedLocale,
  publishedLocaleRank,
} from "../lib/synopsis-language";
import {
  buildSeriesPageView,
  evaluateSeriesIndexability,
  SERIES_RENDERABLE_REVIEW_STATUSES,
  type SeriesContentBlockInput,
  type SeriesPageView,
  type SeriesSeasonInput,
} from "../lib/series-presenter";
import { resolveEntityPageSeo } from "./seo/indexability-decision";
import { getRelatedNewsForEntity } from "./related-news";
import { getCastForEntity } from "./entity-cast";
import { getWatchAvailabilityForEntity, watchAbsenceReason } from "./entity-watch";
import type { SectionAbsenceReason } from "../lib/section-absence";
import {
  awardsAbsenceReason,
  getAwardsForEntity,
  type AwardsPanelView,
} from "./entity-awards";
import { getRatingsForEntity } from "./entity-ratings";
import { buildRatingsView, type RatingsPanelView } from "../lib/ratings-presenter";
import { getRecommendedTitlesForEntity } from "./similar-titles";
import type { SimilarTitlesView } from "../lib/similar-titles-presenter";
import { countGalleryMedia } from "./entity-gallery";
import { getTrailerForEntity } from "./entity-trailer";
import { getCinerieScoreForEntity, getGenresForEntity } from "./entity-hero";
import {
  getCompaniesForEntity,
  getCountriesForEntity,
  getNetworksForEntity,
} from "./entity-facts";
import {
  buildSeriesFichaFacts,
  type FichaFact,
} from "../lib/entity-facts-presenter";
import type { CinerieScoreInputView } from "../lib/cinerie-score-presenter";
import type { TrailerView } from "../lib/trailer-presenter";
import type { NewsCardView } from "../lib/news-presenter";
import type { CastMemberView } from "../lib/cast-presenter";
import type { WatchAvailabilityView } from "../lib/watch-availability-presenter";
import type { IndexabilityResult, PageSeoResolution } from "@screena/seo";
import { getImageDisplayAuthorization } from "./image-license";

const LANGUAGE_CODE = "pt-BR";
const ENTITY_TYPE = "tv";
const SERIES_INDEX_PATH = "/pt/series/";

export interface SeriesPageData {
  view: SeriesPageView;
  /**
   * Temporada cujos episodios foram efetivamente lidos, ou `null` quando a
   * serie nao tem temporada nenhuma. Ver `activeSeason` no corpo.
   */
  activeSeasonNumber: number | null;
  /**
   * Trailer do bloco de midia (telas 06/07). `null` quando nao ha.
   *
   * Ate 20/08/2026 este campo NAO existia e o bloco mostrava o backdrop no
   * lugar do trailer. Nao era permissao faltando — a licenca de video do TMDB
   * existe desde 13/08/2026 —, era fiacao: nada consultava `tmdb_videos` para a
   * entidade da pagina.
   */
  trailer: TrailerView | null;
  /**
   * Contagem REAL de imagens e videos da entidade, para a banda de midia.
   *
   * Vem de `countGalleryMedia`, que usa os MESMOS filtros dos leitores da
   * galeria. Um segundo criterio aqui faria a ficha e a galeria discordarem.
   */
  mediaCounts: { images: number; videos: number };
  /** C8: id INTERNO do catalogo, serializado, para o botao de biblioteca. */
  entityId: string;
  indexability: IndexabilityResult;
  /** Resolucao FINAL de SEO (Fase 3): fatos vivos + decisao vigente persistida. */
  seo: PageSeoResolution;
  canonicalSlug: string;
  canonicalUrl: string;
  /** Noticias relacionadas publicaveis (EntityNewsLink); [] quando nao houver. */
  relatedNews: NewsCardView[];
  /** Elenco principal (cast_members/people); [] quando nao houver. */
  cast: CastMemberView[];
  /**
   * "Mais como este" — recomendacoes do TMDB para esta serie.
   *
   * Ate 20/08/2026 a serie NAO tinha este campo: a grade reservava meia faixa e
   * a coluna nao existia, porque nao havia sinal (colecao e so de filme). O
   * sinal existia o tempo todo no append e era descartado. `null` quando o TMDB
   * nao recomenda nada ou nenhum alvo esta no catalogo -> ausencia REGISTRADA.
   */
  similar: SimilarTitlesView | null;
  /** Disponibilidade no Brasil (watch_availability licenciado); `null` omite o painel. */
  watch: WatchAvailabilityView | null;
  /**
   * Por que o painel de "Onde assistir" nao renderizou. Derivado do ESTADO do
   * catalogo (ver `watchAbsenceReason`), nunca fixo na pagina. `null` quando
   * `watch` existe: nao ha ausencia para justificar.
   */
  watchAbsence: SectionAbsenceReason | null;
  /** Faixa de premios licenciada e creditada; `null` omite a faixa. */
  awards: AwardsPanelView | null;
  /**
   * Por que a faixa de premios nao renderizou. Derivado do ESTADO do catalogo
   * (ver `awardsAbsenceReason`), nunca fixo na pagina. `null` quando `awards`
   * existe: nao ha ausencia para justificar.
   */
  awardsAbsence: SectionAbsenceReason | null;
  /** Notas externas licenciadas e creditadas; `null` omite o painel. */
  ratings: RatingsPanelView | null;
  /** IDs externos reais (imdb/tmdb/...) para montar `sameAs` no JSON-LD. */
  externalIds: { source: string; externalId: string }[];
  /**
   * Gêneros do título (junção `tv_show_genres`, 20/08/2026). `[]` quando a
   * ingestão ainda não populou — os chips e o crumb do meio não renderizam.
   */
  genres: string[];
  /**
   * Estado do Cinerie Score para o card do topo: decisão vigente + último
   * cálculo persistido. O render nunca calcula (o worker offline calcula).
   */
  score: CinerieScoreInputView;
  /** A FICHA (Detalhes) do canônico, já composta — fatos apenas. */
  fichaFacts: FichaFact[];
}

function seriesCanonicalUrl(slug: string): string {
  return `${SITE_URL}${SERIES_INDEX_PATH}${slug}/`;
}

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

export const getSeriesPageData = cache(
  async (
    slug: string,
    /**
     * Temporada pedida por `?temporada=`, ou `null` para o default canonico.
     *
     * Ela entra AQUI, e nao so na rota, porque e ela que decide QUAIS episodios
     * valem uma ida ao banco. Quem chama tem de passar sempre o mesmo valor em
     * `generateMetadata` e no componente: esta funcao e memoizada por `cache()`
     * do React, que compara os ARGUMENTOS, e dois valores diferentes fariam a
     * mesma requisicao carregar a serie duas vezes.
     */
    requestedSeasonNumber: number | null = null,
  ): Promise<SeriesPageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;

    const entityId = slugRow.entityId;

    const [series, canonicalSlugRow, translations, contentBlocks, seasons, relatedNews, cast, watch, externalIds] =
      await Promise.all([
        prisma.tvShow.findUnique({
          where: { id: entityId },
          select: {
            // Necessario para DUAS coisas, ambas chaveadas por tmdb_id: o
            // trilho de recomendacao e o trailer (`tmdb_videos`).
            tmdbId: true,
            nameOriginal: true,
            firstAirDate: true,
            lastAirDate: true,
            numberOfSeasons: true,
            numberOfEpisodes: true,
            posterPath: true,
            backdropPath: true,
            status: true,
            originalLanguage: true,
            certification: true,
          },
        }),
        prisma.slug.findFirst({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            isCanonical: true,
          },
          select: { slug: true },
        }),
        // TODAS as traducoes (ver a mesma nota em `movie-page.ts`): a escolha
        // da sinopse virou codigo puro testado, nao o WHERE.
        prisma.entityTranslation.findMany({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
          },
          select: {
            languageCode: true,
            title: true,
            metaTitle: true,
            metaDescription: true,
            summary: true,
          },
        }),
        prisma.contentBlock.findMany({
          where: {
            entityType: ENTITY_TYPE,
            entityId,
            languageCode: LANGUAGE_CODE,
            reviewStatus: { in: [...SERIES_RENDERABLE_REVIEW_STATUSES] },
          },
          select: { blockType: true, content: true, reviewStatus: true },
        }),
        prisma.season.findMany({
          where: { tvShowId: entityId },
          orderBy: { seasonNumber: "asc" },
          select: {
            id: true,
            seasonNumber: true,
            name: true,
            overview: true,
            airDate: true,
            episodeCount: true,
            posterPath: true,
            // A LISTA DE EPISODIOS DE TODAS AS TEMPORADAS SAIU DAQUI.
            //
            // Este `select` aninhado nao tinha `take` e vinha para CADA
            // temporada — enquanto a tela desenha os episodios de UMA SO (a
            // rota escolhe uma em `selectedSeason` e descarta o resto).
            //
            // MEDIDO em producao (2026-09-09): `/pt/series/today/` tem 67
            // temporadas distintas e a temporada 1 sozinha tem 506 episodios.
            // A pagina carregava os episodios das 67, com `overview` (o campo
            // mais longo da linha), montava a view de todos, e renderizava os
            // de uma. E uma ficha INDEXADA e `force-dynamic`: sem cache, isso
            // acontecia a cada acesso.
            //
            // Agora os episodios da temporada ATIVA vem numa consulta propria,
            // abaixo, dentro de um `Promise.all` que ja existia — sem somar
            // viagem ao banco.
          },
        }),
        getRelatedNewsForEntity(prisma, ENTITY_TYPE, entityId),
        getCastForEntity(prisma, ENTITY_TYPE, entityId),
        getWatchAvailabilityForEntity(prisma, ENTITY_TYPE, entityId),
        prisma.entityExternalId.findMany({
          where: { entityType: ENTITY_TYPE, entityId },
          select: { source: true, externalId: true },
        }),
      ]);

    if (series === null) return null;

    const blocks: SeriesContentBlockInput[] = contentBlocks.map((block) => ({
      blockType: String(block.blockType),
      content: block.content,
      reviewStatus: String(block.reviewStatus),
    }));


    /**
     * A TEMPORADA ATIVA — a MESMA regra que a rota aplicava sozinha.
     *
     * Ela mora aqui agora porque e ela que decide quais episodios valem uma
     * consulta. A rota passa a LER `activeSeasonNumber` em vez de re-derivar:
     * duas copias da regra divergiriam no primeiro ajuste, e o sintoma seria a
     * temporada desenhada aparecer sem episodio nenhum.
     *
     * Default canonico: Temporada 1 (a primeira REGULAR). "Especiais"
     * (temporada 0) so entra quando pedida — ela pode ter dezenas de itens e
     * nunca deve ser a carga inicial.
     */
    const activeSeason =
      seasons.find((season) => season.seasonNumber === requestedSeasonNumber) ??
      seasons.find((season) => season.seasonNumber > 0) ??
      seasons[0] ??
      null;

    // Locale publicado: unica fonte de titulo/metadados (ver `movie-page.ts`).
    const translation =
      translations
        .filter((row) => isPublishedLocale(row.languageCode))
        .sort(
          (a, b) =>
            publishedLocaleRank(a.languageCode) -
            publishedLocaleRank(b.languageCode),
        )[0] ?? null;

    // O SEXTO gate. Ver `server/image-license.ts` e o gemeo em movie-page.ts.
    //
    // Os episodios da temporada ATIVA viajam junto: as duas leituras sao
    // independentes, e somar um `await` proprio para a segunda pagaria uma
    // viagem ao PostgreSQL que este `Promise.all` ja estava pagando.
    const [imageAuthorization, activeSeasonEpisodes] = await Promise.all([
      getImageDisplayAuthorization(prisma),
      activeSeason === null
        ? Promise.resolve([])
        : prisma.episode.findMany({
            where: { seasonId: activeSeason.id },
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
    ]);

    /**
     * So a temporada ATIVA carrega episodios; as outras entram com lista vazia.
     *
     * Isso e o que a tela sempre mostrou — a rota renderiza `selectedSeason` e
     * ignora os episodios das demais. A diferenca e que agora eles tambem nao
     * sao lidos do banco nem convertidos em view.
     */
    const seasonInputs: SeriesSeasonInput[] = seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      name: season.name,
      overview: season.overview,
      airYear: yearFromDate(season.airDate),
      episodeCount: season.episodeCount,
      posterPath: season.posterPath,
      episodes:
        activeSeason !== null && season.seasonNumber === activeSeason.seasonNumber
          ? activeSeasonEpisodes.map((episode) => ({
              episodeNumber: episode.episodeNumber,
              name: episode.name,
              overview: episode.overview,
              airYear: yearFromDate(episode.airDate),
              runtimeMinutes: episode.runtimeMinutes,
              stillPath: episode.stillPath,
            }))
          : [],
    }));

    const view = buildSeriesPageView({
      translations,
      imageAuthorization,
      record: {
        nameOriginal: series.nameOriginal,
        firstAirYear: yearFromDate(series.firstAirDate),
        lastAirYear: yearFromDate(series.lastAirDate),
        numberOfSeasons: series.numberOfSeasons,
        numberOfEpisodes: series.numberOfEpisodes,
        posterPath: series.posterPath,
        backdropPath: series.backdropPath,
        status: series.status,
        originalLanguage: series.originalLanguage,
      },
      translation,
      blocks,
      seasons: seasonInputs,
    });

    const indexability = evaluateSeriesIndexability({
      renderableBlockCount: view.renderableBlockCount,
    });
    const canonicalSlug = canonicalSlugRow?.slug ?? slug;
    const canonicalUrl = seriesCanonicalUrl(canonicalSlug);

    // Ver movie-page.ts: ratings vem depois da Promise.all (o `EntityRef` precisa
    // de titulo + URL canonica) e alimentam o gate de licenca do SEO abaixo, que
    // antes recebia `[]` fixo — gate cego da invariante 6.
    const ratingsPayload = await getRatingsForEntity(prisma, ENTITY_TYPE, entityId, {
      kind: "tv",
      id: String(entityId),
      title: view.title,
      canonicalUrl,
    });
    const ratings = buildRatingsView(ratingsPayload);

    // Fonte unica da Fase 3: fatos vivos + decisao vigente persistida (fail-closed).
    const seo = await resolveEntityPageSeo(
      { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        // Exatamente as notas RENDERIZADAS (ver movie-page.ts).
        displayedRatings: (ratings?.items ?? []).map(() => ({
          licenseDisplayAllowed: true,
        })),
        canonicalUrl,
        valueBlocksCount: view.renderableBlockCount,
      },
      prisma,
    );

    // O motivo da AUSENCIA do painel de streaming e derivado do estado, nunca
    // fixo. So consulta quando nao ha painel — quem tem oferta nao paga a sonda.
    const watchAbsence = watch === null ? await watchAbsenceReason(prisma) : null;

    // Premiacao: o FATO ("Venceu 4 Oscars"), nunca uma nota. Mesma disciplina
    // do painel de streaming — o motivo da ausencia e derivado do estado do
    // catalogo, e a sonda so roda quando nao ha faixa.
    const awards = await getAwardsForEntity(prisma, ENTITY_TYPE, entityId);
    const awardsAbsence = awards === null ? await awardsAbsenceReason(prisma) : null;

    // Trailer do bloco de midia (tela 07). Mesmo helper do filme.
    const trailer = await getTrailerForEntity(prisma, "tv", series.tmdbId);

    // As CONTAGENS da banda de midia ("9 videos - 184 fotos"). `COUNT(*)` nas
    // MESMAS condicoes que a galeria usa para listar: se divergissem, a ficha
    // prometeria um numero que a galeria nao entrega.
    const mediaCounts = await countGalleryMedia(prisma, "tv", series.tmdbId);

    // "Mais como este" na SERIE — que ate agora nao tinha trilho nenhum.
    //
    // A recusa anterior estava certa pelo motivo dela: serie nao tem colecao, e
    // `networks`/`production_companies` agrupam milhares de titulos sem
    // parentesco — usar isso seria similaridade falsa, pior que coluna vazia.
    //
    // O que mudou nao foi o criterio, foi o DADO. `recommendations`/`similar`
    // estavam no append de serie desde sempre e eram descartados; agora sao
    // persistidos. A serie ganha o mesmo sinal do filme, e nao um substituto pior.
    //
    // Continua `null` quando o TMDB nao recomenda nada ou nenhum alvo esta no
    // catalogo -> ausencia REGISTRADA e grade de uma coluna, como hoje.
    const similar = await getRecommendedTitlesForEntity(
      prisma,
      "tv",
      series.tmdbId,
      entityId,
    );

    // O topo canonico: generos (chips + crumb do meio) e o estado do Score.
    // A ficha (Detalhes): paises, emissoras e producao.
    const [genres, score, countries, networks, companies] = await Promise.all([
      getGenresForEntity(prisma, ENTITY_TYPE, entityId),
      getCinerieScoreForEntity(prisma, ENTITY_TYPE, entityId),
      getCountriesForEntity(prisma, ENTITY_TYPE, entityId),
      getNetworksForEntity(prisma, entityId),
      getCompaniesForEntity(prisma, ENTITY_TYPE, entityId),
    ]);

    const fichaFacts = buildSeriesFichaFacts({
      titleOriginal: series.nameOriginal,
      displayTitle: view.title,
      genres,
      countries,
      periodLabel: view.periodLabel,
      statusLabel: view.statusLabel,
      seasonsCountLabel: view.seasonsCountLabel,
      episodesCountLabel: view.episodesCountLabel,
      originalLanguageLabel: view.originalLanguageLabel,
      certification: series.certification,
      networks,
      companies,
    });

    return {
      view,
      /**
       * Numero da temporada desenhada. A rota usa ESTE valor em vez de
       * reaplicar a regra de escolha — e a unica temporada cujos episodios
       * foram lidos.
       */
      activeSeasonNumber: activeSeason?.seasonNumber ?? null,
      trailer,
      mediaCounts,
      similar,
      genres,
      score,
      fichaFacts,
      // C8: id INTERNO do catalogo, serializado — o botao de biblioteca o usa
      // para referenciar a entidade canonica (nunca o slug).
      entityId: String(entityId),
      indexability,
      seo,
      canonicalSlug,
      canonicalUrl,
      relatedNews,
      cast,
      watch,
      watchAbsence,
      awards,
      awardsAbsence,
      ratings,
      externalIds,
    };
  },
);
