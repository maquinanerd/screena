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
import { resolveEditorialScoreSources, type ScoredEntityType } from "./editorial-score";
import { orderByTrending, readTrendingSnapshot } from "./trending-snapshot";
import {
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
 * Converte um `Decimal` do Prisma (ou number) em `number` seguro. Qualquer valor
 * nao finito vira null (fallback seguro — nunca NaN cruza para o presenter).
 */
function decimalToNumber(value: { toString(): string } | number | null): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(num) ? num : null;
}

/** Slugs canonicos pt-BR de um tipo, indexados por entityId (string). */
async function canonicalSlugsByEntity(
  prisma: PrismaClient,
  entityType: HeroEntityType,
): Promise<{ ids: bigint[]; slugByEntity: Map<string, string> }> {
  const rows = await prisma.slug.findMany({
    where: { entityType, languageCode: LANGUAGE_CODE, isCanonical: true },
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
  // `ids` e o catalogo INTEIRO daquele tipo. Sem o fatiamento, um catalogo
  // acima de ~32.7 mil titulos derruba a home com P2035 — ver
  // `../lib/prisma-in-chunks`.
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
async function movieCandidates(prisma: PrismaClient): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "movie");
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
          screenScore: true,
          screenScoreScale: true,
          screenScoreDisplay: true,
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
        screenScore: decimalToNumber(movie.screenScore),
        screenScoreScale: movie.screenScoreScale,
        screenScoreDisplay: movie.screenScoreDisplay,
        summary: translation.summary,
        backdropPath: movie.backdropPath,
        posterPath: movie.posterPath,
      },
    };
  });
}

/** Monta os candidatos de SERIE (sem crew/cast ainda). */
async function seriesCandidates(prisma: PrismaClient): Promise<HeroCandidate[]> {
  const { ids, slugByEntity } = await canonicalSlugsByEntity(prisma, "tv");
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
          screenScore: true,
          screenScoreScale: true,
          screenScoreDisplay: true,
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
        screenScore: decimalToNumber(show.screenScore),
        screenScoreScale: show.screenScoreScale,
        screenScoreDisplay: show.screenScoreDisplay,
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
  // A vertical oposta nao e consultada: em `/pt/series` o catalogo de filmes
  // (129 titulos em producao) nao paga nem uma query.
  const [movies, series] = await Promise.all([
    scope === "series" ? Promise.resolve<HeroCandidate[]>([]) : movieCandidates(prisma),
    scope === "movies" ? Promise.resolve<HeroCandidate[]>([]) : seriesCandidates(prisma),
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
  const curated = await curatedEntityKeys(prisma, now);
  const byKey = new Map<string, HeroCandidate>();
  for (const candidate of [...movies, ...series]) {
    byKey.set(`${candidate.entityType}:${candidate.entityId.toString()}`, candidate);
  }
  const permitidos = new Set<HeroEntityType>(
    scope === "movies" ? ["movie"] : scope === "series" ? ["tv"] : ["movie", "tv"],
  );
  const selected = composeHero(
    curated.filter((pick) => permitidos.has(pick.entityType)),
    automatic,
    byKey,
  );

  // AUSENCIA NUNCA E MUDA. Nenhum elegivel significa uma faixa a menos na home,
  // e o motivo mais frequente das recusas diz o que falta (arte? traducao?
  // votos?). Sem esta linha, "o hero sumiu" seria indistinguivel de "o hero
  // quebrou".
  if (selected.length === 0 && recusados.length > 0) {
    const porMotivo: Record<string, number> = {};
    for (const recusa of recusados) {
      porMotivo[recusa.reason] = (porMotivo[recusa.reason] ?? 0) + 1;
    }
    console.warn(
      JSON.stringify({
        event: "hero_empty",
        scope,
        candidates: recusados.length,
        byReason: porMotivo,
      }),
    );
  }

  // PROCEDENCIA do Cinerie Score em LOTE (uma query por tipo, nunca N+1). Sem
  // calculo `calculated` coerente em `cinerie_score_calculations`, a nota fica
  // sem origem editorial e o presenter oculta a estrela — fail-closed.
  // A chave inclui o TIPO: `movies.id` e `tv_shows.id` sao sequencias
  // independentes, entao um id 5 de filme e um id 5 de serie coexistem.
  const scoreSources = await Promise.all(
    (["movie", "tv"] as const).map(async (entityType: ScoredEntityType) => {
      const resolved = await resolveEditorialScoreSources(
        prisma,
        entityType,
        selected
          .filter((candidate) => candidate.entityType === entityType)
          .map((candidate) => ({
            entityId: candidate.entityId,
            screenScore: candidate.input.screenScore,
            screenScoreScale: candidate.input.screenScoreScale,
          })),
      );
      return [...resolved].map(
        ([id, source]) => [`${entityType}:${id}`, source] as const,
      );
    }),
  );
  const sourceByKey = new Map(scoreSources.flat());

  const inputs: HeroSlideInput[] = await Promise.all(
    selected.map(async (candidate): Promise<HeroSlideInput> => {
      const [director, cast] = await Promise.all([
        directorNameForEntity(prisma, candidate.entityType, candidate.entityId),
        getCastForEntity(prisma, candidate.entityType, candidate.entityId),
      ]);
      return {
        ...candidate.input,
        screenScoreSource:
          sourceByKey.get(`${candidate.entityType}:${candidate.entityId.toString()}`) ?? null,
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
