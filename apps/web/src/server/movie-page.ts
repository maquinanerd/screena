/**
 * movie-page.ts — Camada de dados SERVER-ONLY da pagina de filme.
 *
 * INVARIANTES 3 e 4 (pureza de render):
 *  - Le SOMENTE o PostgreSQL local via @screena/db (Prisma). Nenhuma chamada a
 *    TMDB, RapidAPI, Rotten Tomatoes, Gemini ou qualquer host externo.
 *  - Nao gera IA: apenas LE content_blocks ja gerados, validados e revisados
 *    (human_reviewed/published). O Entity Writer roda offline, nunca aqui.
 *  - Read-only: nunca escreve no banco.
 *
 * Server-only por convencao estrutural: vive em apps/web/src/server, nunca
 * carrega a diretiva "use client" e nunca e importado por um client component
 * (travado por `pnpm audit:render` e por tests/governance/web-render-layering).
 * O pacote `server-only` ainda nao esta instalado neste estagio; por isso a
 * delimitacao e por diretorio + ausencia de "use client", nao por import.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import {
  presentMovie,
  type MovieContentBlockInput,
  type MoviePageView,
} from "../lib/movie-presenter";
import {
  evaluateMovieIndexability,
  RENDERABLE_REVIEW_STATUSES,
  type IndexabilityResult,
} from "../lib/movie-indexability";
import {
  isPublishedLocale,
  publishedLocaleRank,
} from "../lib/synopsis-language";
import { movieCanonicalUrl } from "../lib/site";
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
import type { NewsCardView } from "../lib/news-presenter";
import type { CastMemberView } from "../lib/cast-presenter";
import type { WatchAvailabilityView } from "../lib/watch-availability-presenter";
import type { PageSeoResolution } from "@screena/seo";

/** Idioma de publicacao do MVP (invariante 7): pt-BR indexa primeiro. */
const LANGUAGE_CODE = "pt-BR";
/** Tipo de entidade desta rota (schema Movie, URL /pt/filmes/...). */
const ENTITY_TYPE = "movie";

/** Tudo que a pagina e o `generateMetadata` precisam, ja resolvido do banco. */
export interface MoviePageData {
  view: MoviePageView;
  /** C8: id INTERNO do catalogo, serializado, para o botao de biblioteca. */
  entityId: string;
  indexability: IndexabilityResult;
  /**
   * Resolucao FINAL de SEO (Fase 3): fatos vivos + decisao VIGENTE persistida em
   * page_indexability_decisions. Fonte unica de robots/canonical/sitemap.
   */
  seo: PageSeoResolution;
  canonicalSlug: string;
  canonicalUrl: string;
  /** Noticias relacionadas publicaveis (EntityNewsLink); [] quando nao houver. */
  relatedNews: NewsCardView[];
  /** Elenco principal (cast_members/people); [] quando nao houver. */
  cast: CastMemberView[];
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
}

/**
 * Le os dados da pagina de filme pelo slug pt-BR.
 *
 * Retorna `null` quando o slug nao existe ou nao ha filme correspondente — a
 * rota responde 404. Memoizado por request (`react` cache) para nao consultar o
 * banco duas vezes (generateMetadata + render do mesmo request).
 */
export const getMoviePageData = cache(
  async (slug: string): Promise<MoviePageData | null> => {
    const prisma = getPrismaClient();

    const slugRow = await prisma.slug.findFirst({
      where: { entityType: ENTITY_TYPE, languageCode: LANGUAGE_CODE, slug },
      select: { entityId: true },
    });
    if (slugRow === null) return null;

    const entityId = slugRow.entityId;

    const [movie, canonicalSlugRow, translations, contentBlocks, relatedNews, cast, watch, externalIds] =
      await Promise.all([
      prisma.movie.findUnique({
        where: { id: entityId },
        select: {
          titleOriginal: true,
          releaseDate: true,
          runtimeMinutes: true,
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
      // TODAS as traducoes, nao so `pt-BR`. A escolha passou a ser codigo PURO
      // (`selectSynopsis`), e nao mais o WHERE: um titulo que entrou sob demanda
      // pode ter sinopse apenas no idioma de origem, e filtrar por `pt-BR` aqui
      // fazia esse texto desaparecer da pagina sem uma linha dizendo por que.
      // Titulo/metadados continuam vindo SO do locale publicado, abaixo.
      prisma.entityTranslation.findMany({
        where: { entityType: ENTITY_TYPE, entityId },
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
          // Defesa em profundidade: o filtro pelo `review_status` publicavel
          // tambem e reaplicado puramente em selectRenderableBlocks.
          reviewStatus: { in: [...RENDERABLE_REVIEW_STATUSES] },
        },
        select: { blockType: true, content: true, reviewStatus: true },
      }),
      getRelatedNewsForEntity(prisma, ENTITY_TYPE, entityId),
      getCastForEntity(prisma, ENTITY_TYPE, entityId),
      getWatchAvailabilityForEntity(prisma, ENTITY_TYPE, entityId),
      prisma.entityExternalId.findMany({
        where: { entityType: ENTITY_TYPE, entityId },
        select: { source: true, externalId: true },
      }),
    ]);

    if (movie === null) return null;

    const blocks: MovieContentBlockInput[] = contentBlocks.map((block) => ({
      blockType: String(block.blockType),
      content: block.content,
      reviewStatus: String(block.reviewStatus),
    }));

    // A linha do locale publicado: continua sendo a UNICA fonte de titulo,
    // `meta_title` e `meta_description`. A prioridade e explicita e nao herda a
    // ordem do `findMany` (que nao tem ordem garantida).
    const translation =
      translations
        .filter((row) => isPublishedLocale(row.languageCode))
        .sort(
          (a, b) =>
            publishedLocaleRank(a.languageCode) -
            publishedLocaleRank(b.languageCode),
        )[0] ?? null;

    const view = presentMovie({
      translations,
      record: {
        titleOriginal: movie.titleOriginal,
        year:
          movie.releaseDate === null ? null : movie.releaseDate.getUTCFullYear(),
        runtimeMinutes: movie.runtimeMinutes,
        posterPath: movie.posterPath,
        backdropPath: movie.backdropPath,
        status: movie.status,
        originalLanguage: movie.originalLanguage,
        certification: movie.certification,
      },
      translation,
      blocks,
    });

    const indexability = evaluateMovieIndexability({
      renderableBlockCount: view.renderableBlockCount,
    });

    const canonicalSlug = canonicalSlugRow?.slug ?? slug;
    const canonicalUrl = movieCanonicalUrl(canonicalSlug);

    // Ratings vem DEPOIS da Promise.all porque o `EntityRef` do payload precisa
    // do titulo e da URL canonica, que so existem aqui. Este e tambem o caminho
    // que alimenta o gate de licenca do SEO logo abaixo — antes, `displayedRatings`
    // era `[]` fixo e o gate da invariante 6 nunca podia disparar (gate cego).
    const ratingsPayload = await getRatingsForEntity(prisma, ENTITY_TYPE, entityId, {
      kind: "movie",
      id: String(entityId),
      title: view.title,
      canonicalUrl,
    });
    const ratings = buildRatingsView(ratingsPayload);

    // Fonte unica da Fase 3: funde os fatos vivos com a decisao VIGENTE
    // persistida em page_indexability_decisions (fail-closed em falha de banco).
    const seo = await resolveEntityPageSeo(
      { entityType: ENTITY_TYPE, entityId, languageCode: LANGUAGE_CODE },
      {
        language: LANGUAGE_CODE,
        hasReliableStructuredData: true,
        // Exatamente as notas RENDERIZADAS. Todas passaram pelo gate de licenca
        // de `entity-ratings` + atribuicao do presenter, entao chegam aqui com
        // `licenseDisplayAllowed: true`. Uma fonte desligada/expirada nao
        // aparece nesta lista (e some da tela) sem derrubar a pagina — que e o
        // comportamento correto: dado sem licenca fica INVISIVEL, e a pagina
        // segue indexavel pelo resto do conteudo.
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

    return {
      view,
      // C8: id INTERNO do catalogo, serializado. A pagina o repassa ao botao de
      // biblioteca (client component); a biblioteca referencia a entidade
      // canonica, nunca o slug (que muda com traducao/recanonizacao).
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
