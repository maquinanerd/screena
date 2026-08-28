/**
 * home-hero.ts — Camada de dados SERVER-ONLY do hero-carousel da home publica.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma). Zero API externa,
 *    zero Gemini, zero TMDB no caminho de render.
 *  - Nao escreve no banco; apenas monta um snapshot serializavel para o client.
 *
 * Fronteira de serializacao: converte `Decimal`/`BigInt`/Date do Prisma em
 * primitivos e delega a montagem/validacao ao presenter PURO
 * `home-hero-presenter`. O client component so recebe `HeroSlide[]` plano.
 *
 * ============================================================================
 * O HERO ORDENAVA POR DATA DE LANCAMENTO, E ISSO O ENTREGAVA AO LIXO DO TMDB
 * ============================================================================
 * Ate 25/08/2026 a escolha era `sort(byYearDesc)` + `slice(0, 5)`, e o unico
 * requisito para entrar no pool era ter slug canonico pt-BR. Nenhum filtro de
 * arte, de votos, de status ou de sanidade de data.
 *
 * O TMDB e comunitario: ele tem lixo, e o lixo se concentra exatamente nas datas
 * futuras (placeholders de filmes nao anunciados, datas digitadas errado). Uma
 * ordenacao por data decrescente nao e "quase certa" — ela premia, por
 * construcao, o registro mais implausivel do catalogo. Resultado medido em
 * producao: o destaque da home era "Der Liebesbrief", curta alemao de 1938
 * cadastrado com `release_date` em 2057, sem poster.
 *
 * A ORDEM AGORA (decisao do dono, 25/08/2026):
 *  1. CURADORIA MANUAL vigente (`hero_curation_decisions`) — vence sempre;
 *  2. TRENDING da semana (`discovery_snapshots`), na ordem da lista;
 *  3. VOTE_COUNT desc entre os que passam no portao;
 *  4. nada passa => `[]`, e a superficie omite a faixa (com log `hero_empty`).
 *
 * A data de lancamento deixou de ser criterio de ordem. Ela permanece como
 * CORTE no portao (`estreia_futura`, `ano_implausivel`), que e o papel que ela
 * sabe cumprir. O portao vive em `../lib/home-hero-eligibility.ts` (puro).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { getCastForEntity } from "./entity-cast";
import { resolveEditorialScores, scoreFields, type ScoredEntityType } from "./editorial-score";
import { orderByTrending, readTrendingSnapshot } from "./trending-snapshot";
import {
  HERO_MAX_YEARS_AHEAD,
  HERO_MIN_VOTE_COUNT,
  HERO_MIN_YEAR,
  HERO_MOVIE_RELEASED_STATUS,
  heroRejectionReason,
  type HeroRejectionReason,
} from "../lib/home-hero-eligibility";
import {
  buildHeroSlides,
  type HeroSlide,
  type HeroSlideInput,
} from "../lib/home-hero-presenter";
import { findManyInChunks } from "../lib/prisma-in-chunks";

const LANGUAGE_CODE = "pt-BR";

/** Quantos slides o carousel exibe no maximo. */
export const HOME_HERO_SLIDE_LIMIT = 5;

/**
 * Escopo do hero. A home e a UNIAO das duas verticais; `/pt/filmes` e
 * `/pt/series` pedem SO a sua.
 *
 * POR QUE ISTO E UM PARAMETRO E NAO UM `.filter()` NA PAGINA. Era um filtro na
 * pagina — e por isso `/pt/series` ficou SEM hero. O corte
 * `[...movies, ...series].slice(0, 5)` acontecia ANTES do filtro: com cinco ou
 * mais filmes com slug canonico (producao tem 129), nenhuma serie sobrevivia ao
 * `slice`, e a pagina de series filtrava uma lista onde ja nao havia serie
 * alguma. O limite so pode ser aplicado depois de o escopo ser conhecido.
 */
export type HeroScope = "home" | "movies" | "series";

type PrismaClient = ReturnType<typeof getPrismaClient>;
type HeroEntityType = "movie" | "tv";

/** Ano UTC de uma data (ou null). */
function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

/**
 * ============================================================================
 * O HERO CARREGAVA O CATALOGO INTEIRO PARA ESCOLHER 5 SLIDES (corrigido 2026-08-28)
 * ============================================================================
 * `canonicalSlugsByEntity` nao tinha escopo: toda requisicao trazia TODOS os
 * slugs canonicos da vertical, depois TODAS as entidades e TODAS as traducoes
 * daqueles ids, e so entao o portao de qualidade rodava em memoria. Com ~21 mil
 * filmes com slug isso e ~63 mil linhas por render — na home, em `/pt/filmes` e
 * em `/pt/series`, porque as tres chamam este loader.
 *
 * O portao agora roda NO BANCO, e o que volta e uma lista curta de ids. O
 * portao em memoria (`applyHeroGate`) continua existindo e continua sendo a
 * autoridade: o SQL e um PRE-FILTRO que reproduz as mesmas clausulas de
 * `lib/home-hero-eligibility.ts`. Se as duas discordarem, quem manda e a
 * funcao pura — o SQL so pode ser MAIS restritivo, nunca menos, e
 * `home-hero-selection.test.ts` continua medindo o portao de verdade.
 *
 * TRES FONTES DE ID, e as duas ultimas nao sao opcionais:
 *  1. o topo por `vote_count_tmdb` que passa no portao (o automatico);
 *  2. os ids do TRENDING da semana — eles vem antes do vote_count na ordem
 *     final, e um titulo em alta com poucos votos ficaria fora do topo;
 *  3. os ids da CURADORIA MANUAL — que NAO passa pelo portao de proposito.
 *     Sem esta terceira fonte, fixar um titulo sem sinopse pt-BR deixaria de
 *     funcionar em silencio, que e o pior desfecho possivel para um recurso
 *     cujo ponto e o dono mandar.
 */
const HERO_CANDIDATE_LIMIT = 60;

/**
 * `$1` language_code, `$2` vote minimo, `$3` agora, `$4` ano minimo,
 * `$5` ano maximo, `$6` limite. Filme acrescenta `$7` = status exigido.
 */
function heroCandidateSql(entityType: HeroEntityType): string {
  const table = entityType === "movie" ? "movies" : "tv_shows";
  const dateColumn = entityType === "movie" ? "release_date" : "first_air_date";
  // `status` so decide para FILME — em serie "Returning Series"/"Ended" sao
  // ambos legitimos, e exigir "Released" reprovaria o catalogo inteiro de
  // series. Mesma regra, e mesma justificativa, de `heroRejectionReason`.
  const statusClause = entityType === "movie" ? "AND e.status = $7" : "";
  return `
    SELECT e.id
    FROM slugs s
    JOIN ${table} e ON e.id = s.entity_id
    JOIN entity_translations t
      ON t.entity_type = '${entityType}'::"EntityType"
     AND t.entity_id = e.id
     AND t.language_code = $1
    WHERE s.entity_type = '${entityType}'::"EntityType"
      AND s.language_code = $1
      AND s.is_canonical
      AND NULLIF(btrim(e.backdrop_path), '') IS NOT NULL
      AND NULLIF(btrim(e.poster_path), '') IS NOT NULL
      AND e.vote_count_tmdb >= $2
      AND NULLIF(btrim(t.summary), '') IS NOT NULL
      AND e.${dateColumn} IS NOT NULL
      AND e.${dateColumn} <= $3
      AND EXTRACT(YEAR FROM e.${dateColumn}) >= $4
      AND EXTRACT(YEAR FROM e.${dateColumn}) <= $5
      ${statusClause}
    ORDER BY e.vote_count_tmdb DESC, e.id ASC
    LIMIT $6
  `;
}

const HERO_CANDIDATE_SQL: Readonly<Record<HeroEntityType, string>> = {
  movie: heroCandidateSql("movie"),
  tv: heroCandidateSql("tv"),
};

/** Ids que o portao aprova, do mais votado para o menos, ate o teto. */
async function gatedTopIds(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  now: Date,
): Promise<bigint[]> {
  const params: unknown[] = [
    LANGUAGE_CODE,
    HERO_MIN_VOTE_COUNT,
    now,
    HERO_MIN_YEAR,
    now.getUTCFullYear() + HERO_MAX_YEARS_AHEAD,
    HERO_CANDIDATE_LIMIT,
  ];
  if (entityType === "movie") params.push(HERO_MOVIE_RELEASED_STATUS);
  const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    HERO_CANDIDATE_SQL[entityType],
    ...params,
  );
  return rows.map((row) => row.id);
}

/** Slugs canonicos pt-BR de um tipo, DENTRO do escopo de ids pedido. */
async function canonicalSlugsByEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  scope: readonly bigint[],
): Promise<{ ids: bigint[]; slugByEntity: Map<string, string> }> {
  if (scope.length === 0) return { ids: [], slugByEntity: new Map() };
  const rows = await prisma.slug.findMany({
    where: {
      entityType,
      languageCode: LANGUAGE_CODE,
      isCanonical: true,
      entityId: { in: [...scope] },
    },
    select: { entityId: true, slug: true },
  });
  const slugByEntity = new Map<string, string>();
  const ids: bigint[] = [];
  for (const row of rows) {
    slugByEntity.set(row.entityId.toString(), row.slug);
    ids.push(row.entityId);
  }
  return { ids, slugByEntity };
}

/** Titulo + resumo editorial pt-BR por entityId (string). */
async function translationsByEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  ids: bigint[],
): Promise<Map<string, { title: string | null; summary: string | null }>> {
  const out = new Map<string, { title: string | null; summary: string | null }>();
  if (ids.length === 0) return out;
  // `ids` agora e o ESCOPO curto (topo + trending + curadoria). O fatiamento
  // continua: ele e a rede de seguranca do teto de 32.767 bind variables e nao
  // sai porque a lista encolheu — ver `../lib/prisma-in-chunks`.
  const rows = await findManyInChunks(ids, (chunk) =>
    prisma.entityTranslation.findMany({
      where: { entityType, entityId: { in: chunk }, languageCode: LANGUAGE_CODE },
      select: { entityId: true, title: true, summary: true },
    }),
  );
  for (const row of rows) {
    out.set(row.entityId.toString(), { title: row.title, summary: row.summary });
  }
  return out;
}

/** Nome do DIRETOR (crew) de um titulo, ou null quando nao ha crew de direcao. */
async function directorNameForEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  entityId: bigint,
): Promise<string | null> {
  const row = await prisma.crewMember.findFirst({
    where: {
      entityType,
      entityId,
      OR: [{ job: "Director" }, { department: "Directing" }],
    },
    orderBy: { id: "asc" },
    select: { person: { select: { name: true } } },
  });
  return row?.person.name ?? null;
}

/** Candidato leve antes de resolver creditos (crew/cast). */
interface HeroCandidate {
  kind: "movie" | "series";
  entityType: HeroEntityType;
  entityId: bigint;
  input: Omit<HeroSlideInput, "director" | "cast">;
  /** `vote_count_tmdb`: criterio de CORTE e de ORDEM, jamais exibido (inv. 1/2). */
  voteCount: number | null;
  /** `status` do TMDB (so decide para filme). */
  status: string | null;
  /** Data de estreia crua, para o portao decidir "ja estreou". */
  releaseDate: Date | null;
}

/** Monta os candidatos de FILME (sem crew/cast ainda). */
async function movieCandidates(
  prisma: PrismaClient,
  scope: readonly bigint[],
): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "movie", scope);
  if (ids.length === 0) return [];
  const [movies, translations] = await Promise.all([
    findManyInChunks(ids, (chunk) =>
      prisma.movie.findMany({
        where: { id: { in: chunk } },
        select: {
          id: true,
          titleOriginal: true,
          releaseDate: true,
          voteCountTmdb: true,
          status: true,
          certification: true,
          backdropPath: true,
          posterPath: true,
        },
      }),
    ),
    translationsByEntity(prisma, "movie", ids),
  ]);
  return movies.map((movie) => {
    const key = movie.id.toString();
    const translation = translations.get(key) ?? { title: null, summary: null };
    const year = yearFromDate(movie.releaseDate);
    return {
      kind: "movie" as const,
      entityType: "movie" as const,
      entityId: movie.id,
      voteCount: movie.voteCountTmdb,
      status: movie.status,
      releaseDate: movie.releaseDate,
      input: {
        kind: "movie",
        title: translation.title ?? movie.titleOriginal,
        slug: slugByEntity.get(key) ?? null,
        year,
        seasonsCount: null,
        episodesCount: null,
        certification: movie.certification,
        // Placeholders: `scoreFields` sobrescreve os quatro campos com a nota
        // resolvida de `cinerie_score_calculations`. Nascer vazio aqui e o
        // fail-closed — se a resolucao falhasse, o slide sairia SEM nota, nunca
        // com uma nota nao governada.
        screenScore: null,
        screenScoreScale: null,
        screenScoreDisplay: false,
        summary: translation.summary,
        backdropPath: movie.backdropPath,
        posterPath: movie.posterPath,
      },
    };
  });
}

/** Monta os candidatos de SERIE (sem crew/cast ainda). */
async function seriesCandidates(
  prisma: PrismaClient,
  scope: readonly bigint[],
): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "tv", scope);
  if (ids.length === 0) return [];
  const [shows, translations] = await Promise.all([
    findManyInChunks(ids, (chunk) =>
      prisma.tvShow.findMany({
        where: { id: { in: chunk } },
        select: {
          id: true,
          nameOriginal: true,
          firstAirDate: true,
          voteCountTmdb: true,
          status: true,
          numberOfSeasons: true,
          numberOfEpisodes: true,
          certification: true,
          backdropPath: true,
          posterPath: true,
        },
      }),
    ),
    translationsByEntity(prisma, "tv", ids),
  ]);
  return shows.map((show) => {
    const key = show.id.toString();
    const translation = translations.get(key) ?? { title: null, summary: null };
    const year = yearFromDate(show.firstAirDate);
    return {
      kind: "series" as const,
      entityType: "tv" as const,
      entityId: show.id,
      voteCount: show.voteCountTmdb,
      status: show.status,
      releaseDate: show.firstAirDate,
      input: {
        kind: "series",
        title: translation.title ?? show.nameOriginal,
        slug: slugByEntity.get(key) ?? null,
        year,
        seasonsCount: show.numberOfSeasons,
        episodesCount: show.numberOfEpisodes,
        certification: show.certification,
        screenScore: null,
        screenScoreScale: null,
        screenScoreDisplay: false,
        summary: translation.summary,
        backdropPath: show.backdropPath,
        posterPath: show.posterPath,
      },
    };
  });
}

/**
 * Ordem de DESEMPATE do hero automatico: mais votados primeiro.
 *
 * `vote_count_tmdb` NAO e nota — e volume de avaliacoes, o sinal mais barato de
 * "muita gente conhece este titulo". Entra como criterio de ORDEM e nunca chega
 * a tela (invariantes 1 e 2). Desempate estavel por titulo para a lista nao
 * dancar entre dois renders com o mesmo numero de votos.
 */
function byVoteCountDesc(a: HeroCandidate, b: HeroCandidate): number {
  const av = a.voteCount ?? 0;
  const bv = b.voteCount ?? 0;
  if (av !== bv) return bv - av;
  return (a.input.title ?? "").localeCompare(b.input.title ?? "");
}

/** Uma recusa do portao, para o log da superficie. */
export interface HeroRejection {
  readonly entityType: HeroEntityType;
  readonly entityId: string;
  readonly title: string | null;
  readonly reason: HeroRejectionReason;
}

/**
 * Aplica o PORTAO DE QUALIDADE e devolve quem passou + por que cada um caiu.
 *
 * A lista de recusados nao e decoracao: sem ela, "o hero sumiu" e indistinguivel
 * de "o hero nunca foi construido", e a operacao nao teria como saber se falta
 * ingestao de arte, de traducao ou de votos.
 */
function applyHeroGate(
  candidates: readonly HeroCandidate[],
  now: Date,
): { eligible: HeroCandidate[]; rejected: HeroRejection[] } {
  const eligible: HeroCandidate[] = [];
  const rejected: HeroRejection[] = [];
  for (const candidate of candidates) {
    const reason = heroRejectionReason(
      {
        kind: candidate.kind,
        backdropPath: candidate.input.backdropPath,
        posterPath: candidate.input.posterPath,
        voteCount: candidate.voteCount,
        summary: candidate.input.summary,
        releaseDate: candidate.releaseDate,
        status: candidate.status,
      },
      now,
    );
    if (reason === null) eligible.push(candidate);
    else {
      rejected.push({
        entityType: candidate.entityType,
        entityId: candidate.entityId.toString(),
        title: candidate.input.title,
        reason,
      });
    }
  }
  return { eligible, rejected };
}

/**
 * Ordena os ELEGIVEIS de um tipo: trending da semana primeiro, na ordem da
 * lista; quem nao esta no trending vem depois, por volume de votos.
 *
 * POR QUE NAO E "TRENDING OU NADA", como em "Popular essa semana". Aquela faixa
 * AFIRMA um recorte ("em alta"), entao titulo fora do trending sob aquele rotulo
 * seria mentira, e `orderByTrending` descarta com razao. O hero nao afirma
 * recorte nenhum — ele afirma "vale a pena ver isto" — entao o trending e a
 * melhor evidencia disponivel, e a ausencia dele degrada para a segunda melhor
 * em vez de apagar a faixa. E o que a decisao do dono pede em letra: (a)
 * snapshot quando houver, (b) senao vote_count, (c) so entao vazio.
 */
async function orderEligible(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  eligible: readonly HeroCandidate[],
  now: Date,
): Promise<HeroCandidate[]> {
  if (eligible.length === 0) return [];
  const snapshot = await readTrendingSnapshot(prisma, entityType, "week", now);
  const emAlta = orderByTrending(eligible, (c) => c.entityId, snapshot.entityIds);
  const naLista = new Set(emAlta.map((c) => c.entityId.toString()));
  const resto = eligible
    .filter((c) => !naLista.has(c.entityId.toString()))
    .sort(byVoteCountDesc);
  return [...emAlta, ...resto];
}

/**
 * A curadoria MANUAL vigente, na ordem declarada (`position`).
 *
 * Vigente = `valid_from <= agora` e (`valid_until` nulo ou futuro). Quando duas
 * linhas disputam a mesma posicao, ganha a decidida mais recentemente — trocar
 * o destaque e escrever uma linha nova, nunca editar a antiga, e assim o
 * historico de quem decidiu o que fica intacto.
 */
async function curatedEntityKeys(
  prisma: PrismaClient,
  now: Date,
): Promise<{ entityType: HeroEntityType; entityId: bigint }[]> {
  const rows = await prisma.heroCurationDecision.findMany({
    where: {
      languageCode: LANGUAGE_CODE,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      // O hero so tem estas duas verticais; `season`/`episode`/`person` numa
      // linha de curadoria seria dado invalido, e ignora-lo aqui evita que ele
      // vire um slide sem rota.
      entityType: { in: ["movie", "tv"] },
    },
    orderBy: [{ position: "asc" }, { decidedAt: "desc" }],
    select: { entityType: true, entityId: true },
  });
  return rows.map((row) => ({
    entityType: row.entityType as HeroEntityType,
    entityId: row.entityId,
  }));
}

/**
 * Monta a lista final: curadoria humana primeiro, automatico preenchendo o resto.
 *
 * "A curadoria VENCE" significa que o titulo fixado ocupa a frente do carousel
 * mesmo que o automatico o ordenasse depois — nao que ela apague os outros
 * slides. Fixar um titulo e deixar o hero com um card so seria punir o dono por
 * usar o recurso.
 *
 * A curadoria NAO passa pelo portao de qualidade, de proposito: o portao existe
 * para conter a escolha AUTOMATICA, e um humano que fixa um titulo ja decidiu.
 * O presenter continua descartando quem nao tem slug/titulo — ali o que se
 * protege nao e gosto, e link quebrado.
 */
function composeHero(
  curated: readonly { entityType: HeroEntityType; entityId: bigint }[],
  automatic: readonly HeroCandidate[],
  byKey: ReadonlyMap<string, HeroCandidate>,
): HeroCandidate[] {
  const escolhidos: HeroCandidate[] = [];
  const jaEscolhido = new Set<string>();
  const push = (candidate: HeroCandidate | undefined): void => {
    if (candidate === undefined) return;
    const key = `${candidate.entityType}:${candidate.entityId.toString()}`;
    if (jaEscolhido.has(key)) return;
    jaEscolhido.add(key);
    escolhidos.push(candidate);
  };
  for (const pick of curated) {
    if (escolhidos.length >= HOME_HERO_SLIDE_LIMIT) break;
    push(byKey.get(`${pick.entityType}:${pick.entityId.toString()}`));
  }
  for (const candidate of automatic) {
    if (escolhidos.length >= HOME_HERO_SLIDE_LIMIT) break;
    push(candidate);
  }
  return escolhidos;
}

/**
 * DIAGNOSTICO DE HERO VAZIO, CONTADO NO BANCO.
 *
 * Antes, o motivo das recusas saia do portao em memoria — o que so funcionava
 * porque o catalogo INTEIRO era carregado. Com o pre-filtro em SQL, um catalogo
 * onde nada passa devolve ZERO linhas, `rejected` fica vazio, e o log
 * `hero_empty` deixaria de sair exatamente na hora em que ele importa. Ausencia
 * silenciosa e defeito, nao economia.
 *
 * Esta consulta roda SO quando nada foi selecionado, e conta sobre o catalogo
 * inteiro daquela vertical (entidades COM slug canonico pt-BR). Os contadores
 * NAO sao mutuamente exclusivos — um titulo sem arte e sem sinopse conta nos
 * dois. Isso e deliberado: a pergunta operacional e "o que falta ingerir?", e
 * para essa pergunta o primeiro motivo que o portao encontrou esconde os
 * outros.
 */
async function heroGateCensus(
  prisma: PrismaClient,
  entityType: HeroEntityType,
  now: Date,
): Promise<Record<string, number>> {
  const table = entityType === "movie" ? "movies" : "tv_shows";
  const dateColumn = entityType === "movie" ? "release_date" : "first_air_date";
  const statusSelect =
    entityType === "movie"
      ? `, count(*) FILTER (WHERE e.status IS DISTINCT FROM $6) AS nao_lancado`
      : "";
  const sql = `
    SELECT count(*) AS com_slug,
           count(*) FILTER (WHERE NULLIF(btrim(e.backdrop_path), '') IS NULL) AS sem_backdrop,
           count(*) FILTER (WHERE NULLIF(btrim(e.poster_path), '') IS NULL) AS sem_poster,
           count(*) FILTER (WHERE e.vote_count_tmdb IS NULL OR e.vote_count_tmdb < $2) AS votos_insuficientes,
           count(*) FILTER (WHERE NULLIF(btrim(t.summary), '') IS NULL) AS sem_sinopse_pt_br,
           count(*) FILTER (WHERE e.${dateColumn} IS NULL OR e.${dateColumn} > $3) AS estreia_futura,
           count(*) FILTER (
             WHERE e.${dateColumn} IS NOT NULL
               AND (EXTRACT(YEAR FROM e.${dateColumn}) < $4
                 OR EXTRACT(YEAR FROM e.${dateColumn}) > $5)
           ) AS ano_implausivel${statusSelect}
    FROM slugs s
    JOIN ${table} e ON e.id = s.entity_id
    LEFT JOIN entity_translations t
      ON t.entity_type = '${entityType}'::"EntityType"
     AND t.entity_id = e.id
     AND t.language_code = $1
    WHERE s.entity_type = '${entityType}'::"EntityType"
      AND s.language_code = $1
      AND s.is_canonical
  `;
  const params: unknown[] = [
    LANGUAGE_CODE,
    HERO_MIN_VOTE_COUNT,
    now,
    HERO_MIN_YEAR,
    now.getUTCFullYear() + HERO_MAX_YEARS_AHEAD,
  ];
  if (entityType === "movie") params.push(HERO_MOVIE_RELEASED_STATUS);
  const rows = await prisma.$queryRawUnsafe<Record<string, bigint>[]>(sql, ...params);
  const row = rows[0];
  if (row === undefined) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) out[key] = Number(value);
  return out;
}

/**
 * Monta os slides do hero-carousel do escopo pedido, ate
 * `HOME_HERO_SLIDE_LIMIT`. Resolve crew/cast so dos candidatos que entram no
 * carousel (evita N+1 no catalogo inteiro). Sem dado real -> [] e a pagina
 * omite o hero (nunca cai para a outra vertical).
 */
export async function loadHeroSlides(
  prisma: PrismaClient,
  scope: HeroScope,
  now: Date = new Date(),
): Promise<HeroSlide[]> {
  const permitidos = new Set<HeroEntityType>(
    scope === "movies" ? ["movie"] : scope === "series" ? ["tv"] : ["movie", "tv"],
  );

  // A CURADORIA e lida ANTES dos candidatos, e nao depois: os ids dela entram
  // no escopo da consulta. Ela nao passa pelo portao (decisao do dono), entao
  // um titulo fixado precisa ser carregado por id — se dependesse do topo por
  // vote_count, fixar um titulo pouco votado deixaria de funcionar em silencio.
  const curated = (await curatedEntityKeys(prisma, now)).filter((pick) =>
    permitidos.has(pick.entityType),
  );
  const curatedIds = (entityType: HeroEntityType): bigint[] =>
    curated.filter((pick) => pick.entityType === entityType).map((pick) => pick.entityId);

  // O TRENDING tambem entra no escopo: ele vem ANTES do vote_count na ordem
  // final (`orderEligible`), e um titulo em alta com poucos votos ficaria fora
  // do topo por construcao.
  const escopo = async (entityType: HeroEntityType): Promise<bigint[]> => {
    if (!permitidos.has(entityType)) return [];
    const [top, trending] = await Promise.all([
      gatedTopIds(prisma, entityType, now),
      readTrendingSnapshot(prisma, entityType, "week", now),
    ]);
    const unicos = new Map<string, bigint>();
    for (const id of [...top, ...trending.entityIds, ...curatedIds(entityType)]) {
      unicos.set(id.toString(), id);
    }
    return [...unicos.values()];
  };

  const [escopoFilmes, escopoSeries] = await Promise.all([escopo("movie"), escopo("tv")]);

  // A vertical oposta nao e consultada: em `/pt/series` o catalogo de filmes
  // nao paga nem uma query.
  const [movies, series] = await Promise.all([
    movieCandidates(prisma, escopoFilmes),
    seriesCandidates(prisma, escopoSeries),
  ]);

  // PORTAO DE QUALIDADE, por vertical. Ate 25/08/2026 nao havia portao nenhum:
  // a lista era ordenada por ano desc e cortada em 5, e foi assim que um curta
  // de 1938 cadastrado com `release_date` em 2057 e sem poster virou o destaque
  // da home.
  const filmes = applyHeroGate(movies, now);
  const seriados = applyHeroGate(series, now);
  const recusados = [...filmes.rejected, ...seriados.rejected];

  const [filmesOrdenados, seriesOrdenadas] = await Promise.all([
    orderEligible(prisma, "movie", filmes.eligible, now),
    orderEligible(prisma, "tv", seriados.eligible, now),
  ]);
  const automatic =
    scope === "movies"
      ? filmesOrdenados
      : scope === "series"
        ? seriesOrdenadas
        : [...filmesOrdenados, ...seriesOrdenadas];

  // A curadoria manual VENCE: entra na frente, e o automatico preenche o resto.
  const byKey = new Map<string, HeroCandidate>();
  for (const candidate of [...movies, ...series]) {
    byKey.set(`${candidate.entityType}:${candidate.entityId.toString()}`, candidate);
  }
  const selected = composeHero(curated, automatic, byKey);

  // AUSENCIA NUNCA E MUDA. Nenhum elegivel significa uma faixa a menos na home,
  // e o motivo mais frequente das recusas diz o que falta (arte? traducao?
  // votos?). Sem esta linha, "o hero sumiu" seria indistinguivel de "o hero
  // quebrou".
  if (selected.length === 0) {
    // O censo vem do BANCO e cobre o catalogo inteiro; `rejected` cobre so o
    // escopo carregado (trending + curadoria que nao passaram). Os dois saem,
    // porque respondem a perguntas diferentes: "o que falta ingerir?" e "o que
    // foi pedido e nao pode entrar?".
    const porMotivo: Record<string, number> = {};
    for (const recusa of recusados) {
      porMotivo[recusa.reason] = (porMotivo[recusa.reason] ?? 0) + 1;
    }
    const censo = await Promise.all(
      [...permitidos].map(
        async (entityType) => [entityType, await heroGateCensus(prisma, entityType, now)] as const,
      ),
    );
    console.warn(
      JSON.stringify({
        event: "hero_empty",
        scope,
        scopedCandidates: movies.length + series.length,
        scopedRejections: porMotivo,
        catalogCensus: Object.fromEntries(censo),
      }),
    );
  }

  // O Cinerie Score em LOTE (uma query por tipo, nunca N+1). A NOTA vem de
  // `cinerie_score_calculations` — as colunas `screen_score*` das entidades nao
  // sao mais lidas por tela nenhuma (ver `./editorial-score`). Sem calculo
  // exibivel, os quatro campos saem vazios e o presenter oculta a estrela —
  // fail-closed.
  // A chave inclui o TIPO: `movies.id` e `tv_shows.id` sao sequencias
  // independentes, entao um id 5 de filme e um id 5 de serie coexistem.
  const scoresPorTipo = await Promise.all(
    (["movie", "tv"] as const).map(async (entityType: ScoredEntityType) => {
      const resolved = await resolveEditorialScores(
        prisma,
        entityType,
        selected
          .filter((candidate) => candidate.entityType === entityType)
          .map((candidate) => candidate.entityId),
      );
      return [...resolved].map(([id, view]) => [`${entityType}:${id}`, view] as const);
    }),
  );
  const scoreByKey = new Map(scoresPorTipo.flat());

  const inputs: HeroSlideInput[] = await Promise.all(
    selected.map(async (candidate): Promise<HeroSlideInput> => {
      const [director, cast] = await Promise.all([
        directorNameForEntity(prisma, candidate.entityType, candidate.entityId),
        getCastForEntity(prisma, candidate.entityType, candidate.entityId),
      ]);
      return {
        ...candidate.input,
        ...scoreFields(
          scoreByKey.get(`${candidate.entityType}:${candidate.entityId.toString()}`),
        ),
        director,
        cast: cast.map((member) => member.name),
      };
    }),
  );

  return buildHeroSlides(inputs);
}

/**
 * Idem, com o cliente do processo e a memoizacao por request. `cache()` guarda
 * por ESCOPO, entao home/filmes/series nao se sobrescrevem.
 */
export const getHomeHeroSlides = cache(
  async (scope: HeroScope = "home"): Promise<HeroSlide[]> =>
    loadHeroSlides(getPrismaClient(), scope),
);
