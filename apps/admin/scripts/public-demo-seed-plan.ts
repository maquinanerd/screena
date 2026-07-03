/**
 * public-demo-seed-plan.ts — Plano do SEED DEMO PUBLICO (Fase 9A) + resolucao de
 * modo. PURO (sem rede/DB/IO/env/Date/console).
 *
 * Objetivo: dar ao slice publico (filmes/series/pessoas) CONTEUDO CONTROLADO o
 * suficiente para o produto APARECER no site local/staging — cards com poster,
 * paginas de detalhe com sinopse editorial, elenco e "onde assistir" — sem
 * chamar TMDB nem qualquer API externa e sem publicar sozinho.
 *
 * Este modulo NAO escreve nada: define os MARCADORES inequivocos (prefixo de
 * slug, marcador textual, faixa de tmdb sentinela, marcador de watch/credito),
 * constroi um PLANO deterministico e resolve o MODO (dry-run | apply | cleanup |
 * abort) — dry-run por padrao, confirmacao dupla para escrever, producao aborta.
 *
 * A execucao real (escritas Prisma) vive SO no harness de linha de comando
 * `apps/admin/scripts/public-demo-seed.ts`.
 *
 * Determinismo: nenhum `Math.random`/`Date.now`/`new Date`. Datas sao strings
 * ISO fixas; o harness as converte para `Date` no momento da escrita.
 */

import { getAdminRuntimeKind, type AdminAccessEnv } from "../src/lib/access-protection";

/* ------------------------------------------------------------------ */
/* Marcadores inequivocos                                              */
/* ------------------------------------------------------------------ */

/** Prefixo de slug de todo registro do seed demo publico. */
export const PUBLIC_DEMO_SLUG_PREFIX = "demo-";

/** Marcador textual no inicio de todo `content` de content_block gerado. */
export const PUBLIC_DEMO_MARKER = "[PUBLIC DEMO SEED]";

/**
 * Faixa sentinela de `tmdb_id` (INT no schema). Distante da fixture dev do
 * apps/web (99990001) e do seed de staging (991000000) para nunca colidir. NAO
 * e id real do TMDB — nunca chamamos o TMDB.
 */
export const PUBLIC_DEMO_TMDB_ID_BASE = 992000000;

/** Idioma unico do seed (pt-BR publica primeiro; nunca gera en/es). */
export const PUBLIC_DEMO_LANGUAGE = "pt-BR";

/** Pais das ofertas legais de "onde assistir" (MVP pt-BR = Brasil). */
export const PUBLIC_DEMO_COUNTRY = "BR";

/**
 * Marcador no `provider_api` das linhas de `watch_availability` do demo. Como
 * `provider_api` e apenas o fornecedor TECNICO (nunca a fonte editorial), aqui
 * ele serve so como etiqueta de origem sintetica — reversivel no cleanup.
 */
export const PUBLIC_DEMO_WATCH_PROVIDER_API = "public-demo-seed";

/** Prefixo do `credit_id` (unico) das linhas de `cast_members` do demo. */
export const PUBLIC_DEMO_CREDIT_PREFIX = "demo-cast-";

/** Nome da env de confirmacao dupla e o valor exato exigido. */
export const PUBLIC_DEMO_CONFIRM_ENV = "SCREEN_PUBLIC_DEMO_SEED_CONFIRM";
export const PUBLIC_DEMO_CONFIRM_VALUE = "APPLY_PUBLIC_DEMO_SEED";

/* ------------------------------------------------------------------ */
/* Tipos do plano                                                      */
/* ------------------------------------------------------------------ */

export type PublicDemoBlockType = "editorial_intro" | "summary_without_spoilers";
export type PublicDemoReviewStatus = "published" | "human_reviewed";
export type PublicDemoOfferType =
  | "subscription"
  | "rent"
  | "buy"
  | "free"
  | "ads"
  | "cinema";
export type PublicDemoTargetKind = "movie" | "tv";

/** Bloco de conteudo do seed (marcado; nunca copia sinopse externa). */
export interface PublicDemoBlock {
  readonly blockType: PublicDemoBlockType;
  readonly reviewStatus: PublicDemoReviewStatus;
  readonly content: string;
}

/** Oferta legal de "onde assistir" (nunca pirataria; so modalidade do enum). */
export interface PublicDemoWatchOffer {
  readonly providerName: string;
  readonly offerType: PublicDemoOfferType;
}

/** Filme do seed demo (marcado por tmdb sentinela + slug prefixado). */
export interface PublicDemoMovie {
  readonly key: string;
  readonly tmdbId: number;
  readonly slug: string;
  readonly titleOriginal: string;
  readonly titlePt: string;
  readonly metaTitlePt: string;
  readonly metaDescriptionPt: string;
  readonly summaryPt: string;
  readonly releaseDateIso: string;
  readonly runtimeMinutes: number;
  readonly status: string;
  readonly posterPath: string;
  readonly backdropPath: string;
  readonly watchFetchedAtIso: string;
  readonly blocks: readonly PublicDemoBlock[];
  readonly watch: readonly PublicDemoWatchOffer[];
}

/** Serie do seed demo. */
export interface PublicDemoSeries {
  readonly key: string;
  readonly tmdbId: number;
  readonly slug: string;
  readonly nameOriginal: string;
  readonly namePt: string;
  readonly metaTitlePt: string;
  readonly metaDescriptionPt: string;
  readonly summaryPt: string;
  readonly firstAirDateIso: string;
  readonly lastAirDateIso: string | null;
  readonly status: string;
  readonly numberOfSeasons: number;
  readonly numberOfEpisodes: number;
  readonly posterPath: string;
  readonly backdropPath: string;
  readonly watchFetchedAtIso: string;
  readonly blocks: readonly PublicDemoBlock[];
  readonly watch: readonly PublicDemoWatchOffer[];
}

/** Pessoa do seed demo. */
export interface PublicDemoPerson {
  readonly key: string;
  readonly tmdbId: number;
  readonly slug: string;
  readonly name: string;
  readonly knownForDepartment: string;
  readonly profilePath: string;
  readonly blocks: readonly PublicDemoBlock[];
}

/** Vinculo de elenco (credit_id unico + prefixado; reversivel). */
export interface PublicDemoCast {
  readonly creditId: string;
  readonly personKey: string;
  readonly targetKind: PublicDemoTargetKind;
  readonly targetKey: string;
  readonly character: string;
  readonly billingOrder: number;
}

/** Contagem por tipo de registro que o apply tocaria. */
export interface PublicDemoRecordCount {
  readonly movies: number;
  readonly series: number;
  readonly people: number;
  readonly slugs: number;
  readonly translations: number;
  readonly contentBlocks: number;
  readonly castLinks: number;
  readonly watchOffers: number;
}

/** Plano deterministico completo do seed demo publico. */
export interface PublicDemoSeedPlan {
  readonly languageCode: string;
  readonly countryCode: string;
  readonly slugPrefix: string;
  readonly marker: string;
  readonly tmdbIdBase: number;
  readonly watchProviderApi: string;
  readonly creditPrefix: string;
  readonly movies: readonly PublicDemoMovie[];
  readonly series: readonly PublicDemoSeries[];
  readonly people: readonly PublicDemoPerson[];
  readonly cast: readonly PublicDemoCast[];
  readonly recordCount: PublicDemoRecordCount;
}

/* ------------------------------------------------------------------ */
/* Dados fixos (deterministicos)                                       */
/* ------------------------------------------------------------------ */

const WATCH_FETCHED_AT = "2026-06-15";

function movieBlocks(titlePt: string, editorial: string, spoilerFree: string): PublicDemoBlock[] {
  return [
    {
      blockType: "editorial_intro",
      reviewStatus: "published",
      content: `${PUBLIC_DEMO_MARKER} ${editorial} (Registro de DEMONSTRACAO do slice publico "${titlePt}": conteudo proprio de exemplo, sem notas, sem fontes de terceiros e sem sinopse copiada.)`,
    },
    {
      blockType: "summary_without_spoilers",
      reviewStatus: "human_reviewed",
      content: `${PUBLIC_DEMO_MARKER} ${spoilerFree}`,
    },
  ];
}

const DEMO_MOVIES: readonly Omit<PublicDemoMovie, "tmdbId">[] = [
  {
    key: "farol",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}o-farol-silencioso`,
    titleOriginal: "The Silent Lighthouse",
    titlePt: "O Farol Silencioso",
    metaTitlePt: "O Farol Silencioso (2019) — Filme",
    metaDescriptionPt:
      "Uma guardia de farol isolada numa costa varrida pelo vento reencontra um passado que julgava ter deixado para tras.",
    summaryPt:
      "Drama intimista sobre isolamento, memoria e reconciliacao numa costa remota.",
    releaseDateIso: "2019-09-12",
    runtimeMinutes: 118,
    status: "Released",
    posterPath: "/media/demo/movie-farol-poster.png",
    backdropPath: "/media/demo/movie-farol-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: movieBlocks(
      "O Farol Silencioso",
      "Um retrato contido sobre a solidao de quem vigia a luz para os outros e, no processo, precisa reacender a propria.",
      "Acompanhamos os primeiros dias da guardia no farol, o ritmo do mar e a chegada inesperada de uma carta — sem revelar o que ela desencadeia.",
    ),
    watch: [
      { providerName: "Netflix", offerType: "subscription" },
      { providerName: "Prime Video", offerType: "rent" },
      { providerName: "Apple TV", offerType: "buy" },
    ],
  },
  {
    key: "cidade-vidro",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}cidade-de-vidro`,
    titleOriginal: "City of Glass",
    titlePt: "Cidade de Vidro",
    metaTitlePt: "Cidade de Vidro (2021) — Filme",
    metaDescriptionPt:
      "Numa metropole de arranha-ceus espelhados, uma arquiteta descobre que cada reflexo esconde uma versao diferente da verdade.",
    summaryPt:
      "Thriller urbano sobre identidade, ambicao e o preco de construir a propria imagem.",
    releaseDateIso: "2021-03-05",
    runtimeMinutes: 132,
    status: "Released",
    posterPath: "/media/demo/movie-cidade-vidro-poster.png",
    backdropPath: "/media/demo/movie-cidade-vidro-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: movieBlocks(
      "Cidade de Vidro",
      "Um thriller de superficie polida e nucleo instavel, em que a cidade e tao personagem quanto quem a habita.",
      "A arquiteta assume o projeto de sua carreira e comeca a notar pequenas inconsistencias nos reflexos ao redor — apresentado sem entregar a virada central.",
    ),
    watch: [
      { providerName: "Max", offerType: "subscription" },
      { providerName: "Prime Video", offerType: "subscription" },
    ],
  },
  {
    key: "fronteira",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}a-ultima-fronteira`,
    titleOriginal: "The Last Frontier",
    titlePt: "A Ultima Fronteira",
    metaTitlePt: "A Ultima Fronteira (2023) — Filme",
    metaDescriptionPt:
      "Uma expedicao cientifica ao limite de um territorio inexplorado precisa decidir ate onde vale a pena avancar.",
    summaryPt:
      "Aventura de sobrevivencia sobre coragem, limites e o que se perde ao cruza-los.",
    releaseDateIso: "2023-11-24",
    runtimeMinutes: 141,
    status: "Released",
    posterPath: "/media/demo/movie-fronteira-poster.png",
    backdropPath: "/media/demo/movie-fronteira-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: movieBlocks(
      "A Ultima Fronteira",
      "Uma aventura de escala ampla que troca o espetaculo facil pela tensao de escolhas irreversiveis no fim do mapa.",
      "A equipe monta o acampamento-base e enfrenta os primeiros contratempos da travessia — descrito sem antecipar o destino da expedicao.",
    ),
    watch: [
      { providerName: "Disney+", offerType: "subscription" },
      { providerName: "Apple TV", offerType: "rent" },
    ],
  },
] as const;

function seriesBlocks(namePt: string, editorial: string, spoilerFree: string): PublicDemoBlock[] {
  return [
    {
      blockType: "editorial_intro",
      reviewStatus: "published",
      content: `${PUBLIC_DEMO_MARKER} ${editorial} (Registro de DEMONSTRACAO do slice publico "${namePt}": conteudo proprio de exemplo, sem notas, sem fontes de terceiros e sem sinopse copiada.)`,
    },
    {
      blockType: "summary_without_spoilers",
      reviewStatus: "human_reviewed",
      content: `${PUBLIC_DEMO_MARKER} ${spoilerFree}`,
    },
  ];
}

const DEMO_SERIES: readonly Omit<PublicDemoSeries, "tmdbId">[] = [
  {
    key: "correntes",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}correntes-profundas`,
    nameOriginal: "Deep Currents",
    namePt: "Correntes Profundas",
    metaTitlePt: "Correntes Profundas (2020) — Serie",
    metaDescriptionPt:
      "Numa vila pesqueira, tres familias veem seus segredos virem a tona quando o mar devolve o que tentaram esconder.",
    summaryPt:
      "Drama coral em tres temporadas sobre comunidade, culpa e mares.",
    firstAirDateIso: "2020-05-18",
    lastAirDateIso: "2023-07-30",
    status: "Ended",
    numberOfSeasons: 3,
    numberOfEpisodes: 24,
    posterPath: "/media/demo/tv-correntes-poster.png",
    backdropPath: "/media/demo/tv-correntes-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: seriesBlocks(
      "Correntes Profundas",
      "Um drama coral que trata o vilarejo como um organismo — cada episodio puxa um fio diferente da mesma teia.",
      "A primeira temporada apresenta as tres familias e o incidente no porto que reacende antigas tensoes — sem revelar quem estava envolvido.",
    ),
    watch: [{ providerName: "Netflix", offerType: "subscription" }],
  },
  {
    key: "herdeiros",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}herdeiros-da-noite`,
    nameOriginal: "Heirs of the Night",
    namePt: "Herdeiros da Noite",
    metaTitlePt: "Herdeiros da Noite (2022) — Serie",
    metaDescriptionPt:
      "Uma familia que guarda um segredo antigo precisa proteger sua heranca quando forasteiros chegam a cidade.",
    summaryPt:
      "Misterio sombrio sobre linhagem, lealdade e o peso de um legado.",
    firstAirDateIso: "2022-10-07",
    lastAirDateIso: null,
    status: "Returning Series",
    numberOfSeasons: 2,
    numberOfEpisodes: 16,
    posterPath: "/media/demo/tv-herdeiros-poster.png",
    backdropPath: "/media/demo/tv-herdeiros-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: seriesBlocks(
      "Herdeiros da Noite",
      "Um misterio de atmosfera densa que aposta na ambiguidade dos personagens mais do que em reviravoltas explicitas.",
      "O episodio de estreia situa a familia, a casa e a chegada dos forasteiros — apresentado sem entregar a natureza do segredo guardado.",
    ),
    watch: [
      { providerName: "Max", offerType: "subscription" },
      { providerName: "Netflix", offerType: "subscription" },
    ],
  },
  {
    key: "estacao",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}estacao-terminal`,
    nameOriginal: "Terminal Station",
    namePt: "Estacao Terminal",
    metaTitlePt: "Estacao Terminal (2024) — Serie",
    metaDescriptionPt:
      "A ultima estacao de uma linha ferroviaria prestes a fechar reune desconhecidos numa noite que ninguem esquecera.",
    summaryPt:
      "Antologia de personagens em torno de uma estacao que vive seus ultimos dias.",
    firstAirDateIso: "2024-02-14",
    lastAirDateIso: null,
    status: "Returning Series",
    numberOfSeasons: 1,
    numberOfEpisodes: 8,
    posterPath: "/media/demo/tv-estacao-poster.png",
    backdropPath: "/media/demo/tv-estacao-backdrop.png",
    watchFetchedAtIso: WATCH_FETCHED_AT,
    blocks: seriesBlocks(
      "Estacao Terminal",
      "Uma serie de estrutura antologica presa a um unico espaco, onde cada episodio segue um passageiro diferente.",
      "O piloto acompanha a chefe de estacao no anuncio do fechamento e nas primeiras chegadas da noite — sem adiantar os desfechos individuais.",
    ),
    watch: [
      { providerName: "Prime Video", offerType: "subscription" },
      { providerName: "Apple TV", offerType: "buy" },
    ],
  },
] as const;

function personBlocks(name: string, clause: string): PublicDemoBlock[] {
  return [
    {
      blockType: "editorial_intro",
      reviewStatus: "published",
      content: `${PUBLIC_DEMO_MARKER} ${name}, ${clause} (Registro de DEMONSTRACAO do slice publico: perfil proprio de exemplo, sem notas nem dados de terceiros.)`,
    },
  ];
}

const DEMO_PEOPLE: readonly Omit<PublicDemoPerson, "tmdbId">[] = [
  {
    key: "helena",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}helena-vasconcelos`,
    name: "Helena Vasconcelos",
    knownForDepartment: "Acting",
    profilePath: "/media/demo/person-helena-profile.png",
    blocks: personBlocks(
      "Helena Vasconcelos",
      "atriz de presenca contida, conhecida por papeis que equilibram forca e vulnerabilidade em dramas intimistas.",
    ),
  },
  {
    key: "rui",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}rui-andrade`,
    name: "Rui Andrade",
    knownForDepartment: "Directing",
    profilePath: "/media/demo/person-rui-profile.png",
    blocks: personBlocks(
      "Rui Andrade",
      "diretor e ator de formacao teatral, atraido por historias de escala ampla contadas a partir de gestos pequenos.",
    ),
  },
  {
    key: "marina",
    slug: `${PUBLIC_DEMO_SLUG_PREFIX}marina-duarte`,
    name: "Marina Duarte",
    knownForDepartment: "Acting",
    profilePath: "/media/demo/person-marina-profile.png",
    blocks: personBlocks(
      "Marina Duarte",
      "atriz versatil que transita entre o cinema autoral e as series de genero com a mesma naturalidade.",
    ),
  },
] as const;

/** Vinculos de elenco entre pessoas e titulos do demo (character + ordem). */
const DEMO_CAST_SOURCES: ReadonlyArray<{
  readonly personKey: string;
  readonly targetKind: PublicDemoTargetKind;
  readonly targetKey: string;
  readonly character: string;
  readonly billingOrder: number;
}> = [
  { personKey: "helena", targetKind: "movie", targetKey: "farol", character: "Ana", billingOrder: 0 },
  { personKey: "helena", targetKind: "movie", targetKey: "cidade-vidro", character: "Clara", billingOrder: 0 },
  { personKey: "helena", targetKind: "tv", targetKey: "correntes", character: "Dra. Sofia", billingOrder: 0 },
  { personKey: "rui", targetKind: "movie", targetKey: "fronteira", character: "Comandante Vidal", billingOrder: 0 },
  { personKey: "rui", targetKind: "tv", targetKey: "herdeiros", character: "O Guardiao", billingOrder: 1 },
  { personKey: "marina", targetKind: "movie", targetKey: "cidade-vidro", character: "Beatriz", billingOrder: 1 },
  { personKey: "marina", targetKind: "tv", targetKey: "estacao", character: "Julia", billingOrder: 0 },
  { personKey: "marina", targetKind: "tv", targetKey: "correntes", character: "Rita", billingOrder: 1 },
];

/* ------------------------------------------------------------------ */
/* Construcao do plano                                                 */
/* ------------------------------------------------------------------ */

/**
 * Monta o plano deterministico. Os `tmdbId` sao `BASE + offset` por tipo (0..
 * filmes, 100.. series, 200.. pessoas) para nao colidir entre si.
 */
export function buildPublicDemoSeedPlan(): PublicDemoSeedPlan {
  const movies: PublicDemoMovie[] = DEMO_MOVIES.map((movie, index) => ({
    ...movie,
    tmdbId: PUBLIC_DEMO_TMDB_ID_BASE + index,
  }));
  const series: PublicDemoSeries[] = DEMO_SERIES.map((show, index) => ({
    ...show,
    tmdbId: PUBLIC_DEMO_TMDB_ID_BASE + 100 + index,
  }));
  const people: PublicDemoPerson[] = DEMO_PEOPLE.map((person, index) => ({
    ...person,
    tmdbId: PUBLIC_DEMO_TMDB_ID_BASE + 200 + index,
  }));

  const cast: PublicDemoCast[] = DEMO_CAST_SOURCES.map((source) => ({
    creditId: `${PUBLIC_DEMO_CREDIT_PREFIX}${source.personKey}-${source.targetKind}-${source.targetKey}`,
    personKey: source.personKey,
    targetKind: source.targetKind,
    targetKey: source.targetKey,
    character: source.character,
    billingOrder: source.billingOrder,
  }));

  const contentBlocks =
    movies.reduce((sum, movie) => sum + movie.blocks.length, 0) +
    series.reduce((sum, show) => sum + show.blocks.length, 0) +
    people.reduce((sum, person) => sum + person.blocks.length, 0);
  const watchOffers =
    movies.reduce((sum, movie) => sum + movie.watch.length, 0) +
    series.reduce((sum, show) => sum + show.watch.length, 0);

  return {
    languageCode: PUBLIC_DEMO_LANGUAGE,
    countryCode: PUBLIC_DEMO_COUNTRY,
    slugPrefix: PUBLIC_DEMO_SLUG_PREFIX,
    marker: PUBLIC_DEMO_MARKER,
    tmdbIdBase: PUBLIC_DEMO_TMDB_ID_BASE,
    watchProviderApi: PUBLIC_DEMO_WATCH_PROVIDER_API,
    creditPrefix: PUBLIC_DEMO_CREDIT_PREFIX,
    movies,
    series,
    people,
    cast,
    recordCount: {
      movies: movies.length,
      series: series.length,
      people: people.length,
      slugs: movies.length + series.length + people.length,
      translations: movies.length + series.length + people.length,
      contentBlocks,
      castLinks: cast.length,
      watchOffers,
    },
  };
}

/** `true` se um `tmdbId` pertence a faixa sentinela do seed demo publico. */
export function isPublicDemoTmdbId(tmdbId: number): boolean {
  return (
    Number.isInteger(tmdbId) &&
    tmdbId >= PUBLIC_DEMO_TMDB_ID_BASE &&
    tmdbId < PUBLIC_DEMO_TMDB_ID_BASE + 1000
  );
}

/** `true` se um slug pertence ao seed demo publico (prefixo marcado). */
export function isPublicDemoSlug(slug: string): boolean {
  return slug.startsWith(PUBLIC_DEMO_SLUG_PREFIX);
}

/* ------------------------------------------------------------------ */
/* Resolucao de modo (dry-run | apply | cleanup | abort)               */
/* ------------------------------------------------------------------ */

/** Flags de linha de comando parseadas (sem IO). */
export interface PublicDemoFlags {
  readonly apply: boolean;
  readonly cleanup: boolean;
}

/** Env relevante para decidir o modo (sem segredo; so sinais). */
export interface PublicDemoEnvInput {
  readonly confirmValue: string | undefined;
  readonly vercelEnv: string | undefined;
  readonly nodeEnv: string | undefined;
  readonly hasDatabaseUrl: boolean;
}

/** Modo efetivo de execucao. */
export type PublicDemoMode = "dry-run" | "apply" | "cleanup" | "abort";

/** Decisao de modo: o modo + motivo estavel (pt-BR, sem segredo). */
export interface PublicDemoDecision {
  readonly mode: PublicDemoMode;
  readonly reason: string;
  /** `true` quando a decisao envolve escrita real (apply/cleanup). */
  readonly writes: boolean;
}

/**
 * Parseia argv em flags (`--apply`, `--cleanup`). Aceita variacoes com `=` mas
 * so reconhece as duas flags conhecidas; qualquer outro argumento e ignorado.
 */
export function parsePublicDemoFlags(argv: readonly string[]): PublicDemoFlags {
  const has = (name: string): boolean =>
    argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
  return { apply: has("--apply"), cleanup: has("--cleanup") };
}

/**
 * Resolve o modo do seed a partir de flags + env. Regras (fail closed): dry-run
 * e o padrao e NUNCA escreve; escrita (apply/cleanup) exige confirmacao dupla
 * (flag + env exata) e DATABASE_URL, e ABORTA em producao real.
 *
 * Ordem:
 *   1. Sem `--apply` e sem `--cleanup` -> dry-run (nunca escreve).
 *   2. `--apply` e `--cleanup` juntos    -> abort (escolha uma operacao).
 *   3. Producao real (runtime=production) -> abort (seguranca).
 *   4. Env de confirmacao != valor exato  -> abort (confirmacao dupla ausente).
 *   5. Sem DATABASE_URL                    -> abort (sem alvo).
 *   6. Caso contrario                      -> apply | cleanup.
 */
export function resolvePublicDemoMode(
  flags: PublicDemoFlags,
  env: PublicDemoEnvInput,
): PublicDemoDecision {
  if (!flags.apply && !flags.cleanup) {
    return {
      mode: "dry-run",
      reason: "Nenhuma flag de escrita: modo dry-run (nunca escreve). Imprime apenas o plano.",
      writes: false,
    };
  }

  if (flags.apply && flags.cleanup) {
    return {
      mode: "abort",
      reason: "Flags --apply e --cleanup juntas: escolha apenas uma operacao.",
      writes: false,
    };
  }

  const accessEnv: AdminAccessEnv = { VERCEL_ENV: env.vercelEnv, NODE_ENV: env.nodeEnv };
  if (getAdminRuntimeKind(accessEnv) === "production") {
    return {
      mode: "abort",
      reason: "Producao real detectada: seed apply/cleanup abortado por seguranca.",
      writes: false,
    };
  }

  if (env.confirmValue !== PUBLIC_DEMO_CONFIRM_VALUE) {
    return {
      mode: "abort",
      reason: `Confirmacao dupla ausente: defina ${PUBLIC_DEMO_CONFIRM_ENV}=${PUBLIC_DEMO_CONFIRM_VALUE} para escrever.`,
      writes: false,
    };
  }

  if (!env.hasDatabaseUrl) {
    return {
      mode: "abort",
      reason: "DATABASE_URL ausente: sem banco alvo para escrever.",
      writes: false,
    };
  }

  return flags.cleanup
    ? { mode: "cleanup", reason: "Cleanup confirmado: remove apenas registros marcados do seed.", writes: true }
    : { mode: "apply", reason: "Apply confirmado: aplica o plano de seed demo marcado (idempotente).", writes: true };
}

/* ------------------------------------------------------------------ */
/* Formatacao (seguro para imprimir; sem segredo)                      */
/* ------------------------------------------------------------------ */

/** Formata o plano em linhas legiveis e SEGURAS (sem segredo). */
export function formatPublicDemoPlan(plan: PublicDemoSeedPlan): string[] {
  const lines: string[] = [];
  lines.push("Plano de seed demo publico (deterministico, marcado):");
  lines.push(`  idioma:      ${plan.languageCode}`);
  lines.push(`  pais watch:  ${plan.countryCode}`);
  lines.push(`  marcador:    ${plan.marker}`);
  lines.push(`  prefixo slug:${plan.slugPrefix}`);
  lines.push(
    `  registros:   ${plan.recordCount.movies} filmes, ${plan.recordCount.series} series, ${plan.recordCount.people} pessoas, ${plan.recordCount.contentBlocks} blocos, ${plan.recordCount.castLinks} creditos, ${plan.recordCount.watchOffers} ofertas`,
  );
  for (const movie of plan.movies) {
    lines.push(`  - filme  ${movie.slug} (tmdb sentinela ${movie.tmdbId}) "${movie.titlePt}"`);
  }
  for (const show of plan.series) {
    lines.push(`  - serie  ${show.slug} (tmdb sentinela ${show.tmdbId}) "${show.namePt}"`);
  }
  for (const person of plan.people) {
    lines.push(`  - pessoa ${person.slug} (tmdb sentinela ${person.tmdbId}) "${person.name}"`);
  }
  return lines;
}
