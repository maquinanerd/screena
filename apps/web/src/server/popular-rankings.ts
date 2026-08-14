/**
 * popular-rankings.ts — Camada SERVER-ONLY da secao "Popular essa semana".
 *
 * Invariantes 3 e 4: le SOMENTE PostgreSQL local via @screena/db (Prisma). Zero
 * TMDB, zero RapidAPI, zero Gemini no caminho de render. A descoberta que
 * alimenta estas tabelas roda offline, em worker, com log em `api_sync_logs`.
 *
 * ============ UMA CONSULTA POR ABA, DE VERDADE ============
 *
 * O rotulo da aba nao e decorativo: cada `RankingTabSlug` mapeia para um recorte
 * DISTINTO do catalogo (`rankingCandidates`). Trocar de aba troca a lista porque
 * a lista veio de outra consulta — nao porque um `.slice()` mudou.
 *
 * ============ AUSENCIA NUNCA E MUDA ============
 *
 * Toda aba que devolve menos itens que o teto declara o PORQUE em
 * `RankingResult.absence`. A secao continua na tela com a mensagem de vazio
 * (esconde-la tornaria a aba invisivel), e o operador recebe uma linha de log
 * dizendo se falta ingestao, falta licenca ou o fato simplesmente nao existe no
 * modelo de dados.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { licensedWatchWhere } from "./entity-watch";
import {
  POPULAR_RANKING_LIMIT,
  RANKING_TABS,
  rankTitles,
  type RankedTitle,
  type RankedTitleInput,
  type RankingTabSlug,
  type RankingVertical,
} from "../lib/popular-rankings";
import { MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from "../lib/site";
import { buildTmdbImageUrl } from "../lib/tmdb-image-url";

const LANGUAGE_CODE = "pt-BR";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Poster 2:3 do card (152px no desktop). `w300` e o menor tamanho do catalogo
 * canonico de `TmdbImageSize` que ainda cobre o card em telas 2x sem pedir
 * `w500` para todo mundo.
 */
const RANKING_POSTER_SIZE = "w300" as const;

/** Janela de "No ar": episodio exibido nos ultimos 7 dias. */
const ON_THE_AIR_WINDOW_DAYS = 7;

/** Janela de "Novas temporadas": estreia de temporada -30d .. +30d. */
const NEW_SEASON_WINDOW_DAYS = 30;

/** Corte de "Classicos": estreia ATE 31/12/1999. */
const CLASSIC_RELEASE_CUTOFF = new Date(Date.UTC(1999, 11, 31));

/**
 * Volume minimo de votos para um titulo antigo ser "classico".
 *
 * `vote_count_tmdb` e sinal TECNICO do fornecedor, nunca nota editorial
 * (invariantes 1/2): entra aqui como CRITERIO DE ORDENACAO/CORTE e jamais
 * aparece na tela — o card e poster + numero, sem nota, sem badge, sem fonte.
 * Sem esse piso, "Classicos" viraria a lista dos filmes antigos mais obscuros
 * do catalogo, que e o oposto do recorte.
 */
const CLASSIC_MIN_VOTES = 500;

/** Teto de linhas lidas por recorte antes da resolucao de identidade. */
const CANDIDATE_FETCH_LIMIT = 60;

type PrismaClient = ReturnType<typeof getPrismaClient>;
type RankingEntityType = "movie" | "tv";

/**
 * Por que uma aba veio vazia (ou curta). Cada motivo nomeia uma CAUSA
 * acionavel, nunca "vazio".
 */
export type RankingAbsenceReason =
  /** Nao ha fato persistido de sessao em sala — o modelo de dados nao o tem. */
  | "no_theatrical_session_data"
  /** Nenhuma oferta sobreviveu ao gate de licenca (invariante 6). */
  | "no_licensed_streaming_offer"
  /** Nenhum episodio exibido na janela — depende de ingestao de episodios. */
  | "no_recent_episode"
  /** Nenhuma estreia de temporada na janela — depende de ingestao de temporadas. */
  | "no_season_premiere"
  /** Nenhum titulo antigo com volume minimo de votos. */
  | "no_qualified_classic"
  /** O catalogo nao tem titulo com slug canonico pt-BR deste tipo. */
  | "no_catalog_entity";

/** Causas que dependem de alguem AGIR (ingestao, licenca, decisao). */
const ACTIONABLE_RANKING_REASONS: ReadonlySet<RankingAbsenceReason> = new Set([
  "no_theatrical_session_data",
  "no_licensed_streaming_offer",
  "no_recent_episode",
  "no_season_premiere",
  "no_catalog_entity",
]);

export interface RankingAbsence {
  readonly event: "ranking_short";
  readonly vertical: RankingVertical;
  readonly tab: RankingTabSlug;
  readonly reason: RankingAbsenceReason;
  readonly returned: number;
  readonly expected: number;
  readonly actionable: boolean;
}

export interface RankingResult {
  readonly slug: RankingTabSlug;
  readonly items: readonly RankedTitle[];
  /** `null` quando a aba veio cheia; senao, o motivo (ja logado pelo loader). */
  readonly absence: RankingAbsence | null;
}

/** Chave estavel entre filmes e series (as sequencias de id sao independentes). */
function entityKey(entityType: RankingEntityType, entityId: bigint | string): string {
  return `${entityType}:${entityId.toString()}`;
}

/** Um candidato antes de resolver slug/titulo/poster. */
interface Candidate {
  readonly entityType: RankingEntityType;
  readonly entityId: bigint;
}

/**
 * Identidade publica (titulo pt-BR, rota canonica, poster) de todos os
 * candidatos — DUAS queries em lote por tipo, nunca uma por item.
 *
 * Entidade sem slug canonico pt-BR ou sem titulo fica de fora: o ranking nunca
 * produz link quebrado nem card sem nome acessivel.
 */
async function resolveIdentities(
  prisma: PrismaClient,
  candidates: readonly Candidate[],
): Promise<Map<string, RankedTitleInput>> {
  const out = new Map<string, RankedTitleInput>();
  const movieIds = candidates.filter((c) => c.entityType === "movie").map((c) => c.entityId);
  const tvIds = candidates.filter((c) => c.entityType === "tv").map((c) => c.entityId);
  if (movieIds.length === 0 && tvIds.length === 0) return out;

  const scope = [
    ...(movieIds.length > 0 ? [{ entityType: "movie" as const, entityId: { in: movieIds } }] : []),
    ...(tvIds.length > 0 ? [{ entityType: "tv" as const, entityId: { in: tvIds } }] : []),
  ];

  const [slugs, translations, movies, shows] = await Promise.all([
    prisma.slug.findMany({
      where: { OR: scope, languageCode: LANGUAGE_CODE, isCanonical: true },
      select: { entityType: true, entityId: true, slug: true },
    }),
    prisma.entityTranslation.findMany({
      where: { OR: scope, languageCode: LANGUAGE_CODE },
      select: { entityType: true, entityId: true, title: true },
    }),
    movieIds.length === 0
      ? Promise.resolve([])
      : prisma.movie.findMany({
          where: { id: { in: movieIds } },
          select: { id: true, titleOriginal: true, posterPath: true },
        }),
    tvIds.length === 0
      ? Promise.resolve([])
      : prisma.tvShow.findMany({
          where: { id: { in: tvIds } },
          select: { id: true, nameOriginal: true, posterPath: true },
        }),
  ]);

  const originals = new Map<string, { name: string; posterPath: string | null }>();
  for (const row of movies) {
    originals.set(entityKey("movie", row.id), {
      name: row.titleOriginal,
      posterPath: row.posterPath,
    });
  }
  for (const row of shows) {
    originals.set(entityKey("tv", row.id), {
      name: row.nameOriginal,
      posterPath: row.posterPath,
    });
  }

  const titleByKey = new Map<string, string>();
  for (const row of translations) {
    const title = row.title?.trim();
    if (title) titleByKey.set(entityKey(row.entityType as RankingEntityType, row.entityId), title);
  }

  for (const row of slugs) {
    const type = row.entityType as RankingEntityType;
    const key = entityKey(type, row.entityId);
    const original = originals.get(key);
    const title = titleByKey.get(key) ?? original?.name.trim() ?? null;
    if (title === null || title === "") continue;
    const base = type === "movie" ? MOVIES_INDEX_PATH : SERIES_INDEX_PATH;
    out.set(key, {
      id: key,
      title,
      href: `${base}${row.slug}/`,
      posterUrl: buildTmdbImageUrl(original?.posterPath ?? null, RANKING_POSTER_SIZE),
    });
  }
  return out;
}

/** Candidatos de streaming: entidades com oferta EXIBIVEL pelo gate compartilhado. */
async function streamingCandidates(
  prisma: PrismaClient,
  types: readonly RankingEntityType[],
  now: Date,
): Promise<Candidate[]> {
  if (types.length === 0) return [];
  const rows = await prisma.watchAvailability.findMany({
    where: {
      AND: [
        { OR: types.map((entityType) => ({ entityType })) },
        // O MESMO gate do painel de detalhe, da faixa amarela e do hub
        // /pt/onde-assistir. Nao existe segunda regra de autorizacao aqui.
        licensedWatchWhere(now),
      ],
    },
    take: CANDIDATE_FETCH_LIMIT,
    orderBy: [{ fetchedAt: "desc" }, { id: "asc" }],
    select: { entityType: true, entityId: true },
  });
  return rows.map((row) => ({
    entityType: row.entityType as RankingEntityType,
    entityId: row.entityId,
  }));
}

/** Candidatos por popularidade ja ingerida (nunca ordenacao arbitraria). */
async function popularCandidates(
  prisma: PrismaClient,
  entityType: RankingEntityType,
): Promise<Candidate[]> {
  if (entityType === "movie") {
    const rows = await prisma.movie.findMany({
      where: { popularity: { not: null } },
      orderBy: [{ popularity: "desc" }, { id: "asc" }],
      take: CANDIDATE_FETCH_LIMIT,
      select: { id: true },
    });
    return rows.map((row) => ({ entityType: "movie" as const, entityId: row.id }));
  }
  const rows = await prisma.tvShow.findMany({
    where: { popularity: { not: null } },
    orderBy: [{ popularity: "desc" }, { id: "asc" }],
    take: CANDIDATE_FETCH_LIMIT,
    select: { id: true },
  });
  return rows.map((row) => ({ entityType: "tv" as const, entityId: row.id }));
}

/** Motivo padrao quando um recorte por popularidade volta vazio. */
function popularityAbsence(): RankingAbsenceReason {
  return "no_catalog_entity";
}

/**
 * Candidatos de UM recorte, ja ordenados. Devolve tambem o motivo a registrar
 * quando o recorte vier curto.
 */
async function rankingCandidates(
  prisma: PrismaClient,
  slug: RankingTabSlug,
  now: Date,
): Promise<{ candidates: Candidate[]; reason: RankingAbsenceReason }> {
  switch (slug) {
    // ---------------------------------------------------------------- filmes
    case "filmes":
      return { candidates: await popularCandidates(prisma, "movie"), reason: popularityAbsence() };

    case "classicos": {
      const rows = await prisma.movie.findMany({
        where: {
          releaseDate: { not: null, lte: CLASSIC_RELEASE_CUTOFF },
          voteCountTmdb: { gte: CLASSIC_MIN_VOTES },
        },
        // Nota ponderada do recorte: media do fornecedor entre titulos que ja
        // passaram pelo piso de votos. Criterio de ORDEM, nunca exibido.
        orderBy: [{ voteAverageTmdb: "desc" }, { voteCountTmdb: "desc" }, { id: "asc" }],
        take: CANDIDATE_FETCH_LIMIT,
        select: { id: true },
      });
      return {
        candidates: rows.map((row) => ({ entityType: "movie" as const, entityId: row.id })),
        reason: "no_qualified_classic",
      };
    }

    // "Em cartaz" (e o "Cinema" da home) exigem um fato que o modelo de dados
    // NAO tem: sessao numa sala, com data e territorio. `movies.release_date` e
    // a data de estreia — a faixa amarela ja se recusa a chamar isso de "em
    // cartaz", e derivar a aba dela seria afirmar sessao onde nao ha nenhuma.
    // A aba existe, fica visivel e declara o vazio; acende quando houver
    // ingestao de exibicao em salas (ver a nota no relatorio da PR).
    case "em-cartaz":
    case "cinema":
      return { candidates: [], reason: "no_theatrical_session_data" };

    // ---------------------------------------------------------------- series
    case "series":
      return { candidates: await popularCandidates(prisma, "tv"), reason: popularityAbsence() };

    case "no-ar": {
      const since = new Date(now.getTime() - ON_THE_AIR_WINDOW_DAYS * MS_PER_DAY);
      const rows = await prisma.episode.findMany({
        where: { airDate: { gte: since, lte: now } },
        orderBy: [{ airDate: "desc" }, { tvShowId: "asc" }],
        take: CANDIDATE_FETCH_LIMIT,
        select: { tvShowId: true },
      });
      return {
        candidates: rows.map((row) => ({ entityType: "tv" as const, entityId: row.tvShowId })),
        reason: "no_recent_episode",
      };
    }

    case "novas-temporadas": {
      const from = new Date(now.getTime() - NEW_SEASON_WINDOW_DAYS * MS_PER_DAY);
      const to = new Date(now.getTime() + NEW_SEASON_WINDOW_DAYS * MS_PER_DAY);
      const rows = await prisma.season.findMany({
        // `season_number = 0` e "especiais" no TMDB: nao e estreia de temporada.
        where: { airDate: { gte: from, lte: to }, seasonNumber: { gt: 0 } },
        orderBy: [{ airDate: "desc" }, { tvShowId: "asc" }],
        take: CANDIDATE_FETCH_LIMIT,
        select: { tvShowId: true },
      });
      return {
        candidates: rows.map((row) => ({ entityType: "tv" as const, entityId: row.tvShowId })),
        reason: "no_season_premiere",
      };
    }

    // ------------------------------------------------------------- streaming
    case "streaming":
      // O TIPO vem da vertical do chamador; aqui o recorte e "tem oferta
      // exibivel". Quem escopa filme/serie e `getPopularRanking`.
      return { candidates: [], reason: "no_licensed_streaming_offer" };
  }
}

/**
 * Tipos de entidade que a vertical aceita. `home` aceita os dois — ela e a
 * uniao.
 */
function entityTypesFor(vertical: RankingVertical): RankingEntityType[] {
  if (vertical === "movies") return ["movie"];
  if (vertical === "series") return ["tv"];
  return ["movie", "tv"];
}

/**
 * DEFESA EM PROFUNDIDADE: descarta candidato da vertical errada.
 *
 * A consulta ja escopa por tipo — este filtro e a segunda barreira, e ele existe
 * porque a primeira e facil de afrouxar sem ninguem notar. Um `where` editado,
 * um recorte novo que esqueca o escopo, um `OR` mal montado: qualquer um desses
 * colocaria uma serie no ranking de `/pt/filmes` sem erro nenhum, e a pagina
 * responderia 200 mostrando a coisa errada. Aqui o tipo errado nao passa,
 * independentemente do que a consulta devolveu.
 */
function scopedToVertical(
  candidates: readonly Candidate[],
  vertical: RankingVertical,
): Candidate[] {
  const allowed = new Set(entityTypesFor(vertical));
  return candidates.filter((candidate) => allowed.has(candidate.entityType));
}

function logRankingAbsence(absence: RankingAbsence): void {
  // Uma linha JSON por aba curta: existe para ser filtrada
  // (`event=ranking_short tab=em-cartaz actionable=true`), nao lida uma a uma.
  console.warn(JSON.stringify(absence));
}

/**
 * O ranking de UMA aba, SEM a memoizacao de `cache()` e com o cliente injetado.
 *
 * Existe separado por duas razoes: `cache()` memoiza por argumentos e, fora de
 * um request React, essa memoizacao atravessa casos de teste (a segunda chamada
 * com o mesmo `slug` devolveria o resultado do primeiro banco); e o teste
 * precisa observar QUAL consulta cada aba dispara — o que so e possivel com um
 * cliente que ele mesmo forneceu.
 */
export async function loadPopularRanking(
  prisma: PrismaClient,
  vertical: RankingVertical,
  slug: RankingTabSlug,
  now: Date,
): Promise<RankingResult> {
  const discovered =
    slug === "streaming"
      ? {
          candidates: await streamingCandidates(prisma, entityTypesFor(vertical), now),
          reason: "no_licensed_streaming_offer" as const,
        }
      : await rankingCandidates(prisma, slug, now);

  const reason = discovered.reason;
  const candidates = scopedToVertical(discovered.candidates, vertical);
  const identities = await resolveIdentities(prisma, candidates);
  const inputs: RankedTitleInput[] = [];
  for (const candidate of candidates) {
    const identity = identities.get(entityKey(candidate.entityType, candidate.entityId));
    if (identity !== undefined) inputs.push(identity);
  }
  const items = rankTitles(inputs, POPULAR_RANKING_LIMIT);

  if (items.length >= POPULAR_RANKING_LIMIT) {
    return { slug, items, absence: null };
  }
  const absence: RankingAbsence = {
    event: "ranking_short",
    vertical,
    tab: slug,
    // Candidatos existiam mas nenhum tinha slug/titulo pt-BR: a causa nao e o
    // recorte, e a identidade publica que falta.
    reason: candidates.length > 0 && items.length === 0 ? "no_catalog_entity" : reason,
    returned: items.length,
    expected: POPULAR_RANKING_LIMIT,
    actionable: ACTIONABLE_RANKING_REASONS.has(reason),
  };
  logRankingAbsence(absence);
  return { slug, items, absence };
}

/**
 * O ranking de UMA aba. Sempre devolve a aba pedida (nunca troca de recorte em
 * silencio) e, quando ela vem curta, registra o motivo.
 */
export const getPopularRanking = cache(
  async (vertical: RankingVertical, slug: RankingTabSlug): Promise<RankingResult> =>
    loadPopularRanking(getPrismaClient(), vertical, slug, new Date()),
);

/**
 * Todas as abas da vertical, em paralelo.
 *
 * POR QUE AS TRES DE UMA VEZ, e nao so a ativa: com as listas ja no cliente a
 * troca de aba e INSTANTANEA — nao ha estado pendente, nao ha skeleton
 * piscando e nao ha como a altura da secao colapsar. E estritamente melhor que
 * o "cards a 50% ate a nova lista chegar" que a especificacao pede para o
 * caminho assincrono (divergencia declarada no relatorio da PR).
 */
export const getPopularRankings = cache(
  async (vertical: RankingVertical): Promise<RankingResult[]> => {
    const tabs = RANKING_TABS[vertical];
    return Promise.all(tabs.map((tab) => getPopularRanking(vertical, tab.slug)));
  },
);
