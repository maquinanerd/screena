/**
 * staging-seed-plan.ts — Plano de SEED CONTROLADO de staging + resolucao de modo.
 * PURO (sem rede/DB/IO/env/Date/console).
 *
 * Este modulo NAO escreve nada. Ele apenas:
 *   - define os MARCADORES inequivocos do seed de staging (prefixo de slug,
 *     marcador textual, faixa de tmdb_id sentinela) para que todo registro
 *     criado seja identificavel e reversivel;
 *   - constroi um PLANO deterministico (mesma saida sempre) do que um comando
 *     manual escreveria em staging;
 *   - resolve o MODO de execucao (dry-run | apply | cleanup | abort) a partir de
 *     flags/env, com dry-run por padrao, confirmacao dupla para escrita e
 *     bloqueio de producao real.
 *
 * A execucao real (as escritas Prisma) vive SOMENTE no harness de linha de
 * comando `apps/admin/scripts/staging-seed.ts`, fora do runtime do admin. Este
 * modulo e a parte pura/testavel; por isso NAO contem nenhuma chamada de metodo
 * de escrita (a guarda `readonly-guard` varre `src/` e deve permanecer verde).
 *
 * Determinismo: nenhum `Math.random`, nenhum `Date.now`/`new Date`. Datas, quando
 * necessarias, sao valores fixos definidos aqui.
 */

import { getAdminRuntimeKind, type AdminAccessEnv } from "./access-protection";

/* ------------------------------------------------------------------ */
/* Marcadores inequivocos                                              */
/* ------------------------------------------------------------------ */

/** Prefixo de slug de todo registro de seed de staging. */
export const STAGING_SEED_SLUG_PREFIX = "screen-staging-seed-";

/** Marcador textual no inicio de todo `content` gerado pelo seed. */
export const STAGING_SEED_MARKER = "[STAGING SEED]";

/**
 * Faixa sentinela de `tmdb_id` (INT no schema; < 2.147.483.647) usada so pelo
 * seed de staging. Distante da fixture dev do apps/web (99990001) para nunca
 * colidir. NAO e um id real do TMDB — nunca chamamos o TMDB.
 */
export const STAGING_SEED_TMDB_ID_BASE = 991000000;

/** Idioma unico do seed (pt-BR publica primeiro; nunca gera en/es). */
export const STAGING_SEED_LANGUAGE = "pt-BR";

/** Data fixa de referencia do seed (determinismo; nunca `new Date()`). */
export const STAGING_SEED_REFERENCE_DATE = "2020-01-01";

/** Nome da env de confirmacao dupla e o valor exato exigido. */
export const STAGING_SEED_CONFIRM_ENV = "SCREEN_STAGING_SEED_CONFIRM";
export const STAGING_SEED_CONFIRM_VALUE = "APPLY_STAGING_SEED";

/* ------------------------------------------------------------------ */
/* Tipos do plano                                                      */
/* ------------------------------------------------------------------ */

/** Tipo de bloco do seed (apenas os dois blocos de valor do slice ativo). */
export type SeedBlockType = "editorial_intro" | "cast_intro";

/** ReviewStatus publicaveis usados pelos blocos do seed. */
export type SeedReviewStatus = "published" | "human_reviewed";

/** Um bloco de conteudo do seed (marcado, sem copiar sinopse externa). */
export interface SeedContentBlock {
  readonly blockType: SeedBlockType;
  readonly reviewStatus: SeedReviewStatus;
  readonly content: string;
}

/** Um filme de seed (marcado por tmdb sentinela + slug prefixado). */
export interface SeedMovieRecord {
  readonly tmdbId: number;
  readonly slug: string;
  readonly titleOriginal: string;
  readonly titlePt: string;
  readonly languageCode: string;
  readonly blocks: readonly SeedContentBlock[];
}

/** Contagem por tipo de registro que o apply tocaria. */
export interface SeedRecordCount {
  readonly movies: number;
  readonly slugs: number;
  readonly translations: number;
  readonly contentBlocks: number;
}

/** Plano deterministico completo do seed de staging. */
export interface StagingSeedPlan {
  readonly languageCode: string;
  readonly slugPrefix: string;
  readonly marker: string;
  readonly tmdbIdBase: number;
  readonly referenceDate: string;
  readonly movies: readonly SeedMovieRecord[];
  readonly recordCount: SeedRecordCount;
}

/* ------------------------------------------------------------------ */
/* Construcao do plano (fixo/deterministico)                           */
/* ------------------------------------------------------------------ */

/**
 * Sementes editoriais fixas. Conteudo claramente de FIXTURE de staging: nao
 * finge resenha real, nao usa notas, nao cita plataformas nem fontes de rating.
 * Cada filme tem 2 blocos (passa o gate anti-thin quando revisado).
 */
const SEED_SOURCES: ReadonlyArray<{
  readonly key: string;
  readonly titleOriginal: string;
  readonly titlePt: string;
}> = [
  { key: "alfa", titleOriginal: "Staging Sample Alpha", titlePt: "Amostra de Staging Alfa" },
  { key: "beta", titleOriginal: "Staging Sample Beta", titlePt: "Amostra de Staging Beta" },
];

function buildBlocks(titlePt: string): SeedContentBlock[] {
  return [
    {
      blockType: "editorial_intro",
      reviewStatus: "published",
      content: `${STAGING_SEED_MARKER} Introducao editorial de EXEMPLO para "${titlePt}", registro sintetico de staging. Nao e resenha real, nao contem notas nem dados de terceiros; serve apenas para validar o fluxo editorial.`,
    },
    {
      blockType: "cast_intro",
      reviewStatus: "human_reviewed",
      content: `${STAGING_SEED_MARKER} Bloco de elenco de EXEMPLO para "${titlePt}", registro sintetico de staging. Texto generico, sem nomes reais de elenco, sem notas e sem disponibilidade.`,
    },
  ];
}

/**
 * Monta o plano deterministico. Sem argumentos = mesma saida sempre. Os
 * `tmdbId` sao `BASE + indice`; os slugs recebem o prefixo de staging.
 */
export function buildStagingSeedPlan(): StagingSeedPlan {
  const movies: SeedMovieRecord[] = SEED_SOURCES.map((source, index) => ({
    tmdbId: STAGING_SEED_TMDB_ID_BASE + index,
    slug: `${STAGING_SEED_SLUG_PREFIX}${source.key}`,
    titleOriginal: source.titleOriginal,
    titlePt: source.titlePt,
    languageCode: STAGING_SEED_LANGUAGE,
    blocks: buildBlocks(source.titlePt),
  }));

  const contentBlocks = movies.reduce((sum, movie) => sum + movie.blocks.length, 0);

  return {
    languageCode: STAGING_SEED_LANGUAGE,
    slugPrefix: STAGING_SEED_SLUG_PREFIX,
    marker: STAGING_SEED_MARKER,
    tmdbIdBase: STAGING_SEED_TMDB_ID_BASE,
    referenceDate: STAGING_SEED_REFERENCE_DATE,
    movies,
    recordCount: {
      movies: movies.length,
      slugs: movies.length,
      translations: movies.length,
      contentBlocks,
    },
  };
}

/** `true` se um `tmdbId` pertence a faixa sentinela do seed de staging. */
export function isStagingSeedTmdbId(tmdbId: number): boolean {
  return (
    Number.isInteger(tmdbId) &&
    tmdbId >= STAGING_SEED_TMDB_ID_BASE &&
    tmdbId < STAGING_SEED_TMDB_ID_BASE + 1000
  );
}

/** `true` se um slug pertence ao seed de staging (prefixo marcado). */
export function isStagingSeedSlug(slug: string): boolean {
  return slug.startsWith(STAGING_SEED_SLUG_PREFIX);
}

/* ------------------------------------------------------------------ */
/* Resolucao de modo (dry-run | apply | cleanup | abort)               */
/* ------------------------------------------------------------------ */

/** Flags de linha de comando parseadas (sem IO). */
export interface SeedFlags {
  readonly apply: boolean;
  readonly cleanup: boolean;
}

/** Env relevante para decidir o modo (sem segredo; so sinais). */
export interface SeedEnvInput {
  readonly confirmValue: string | undefined;
  readonly vercelEnv: string | undefined;
  readonly nodeEnv: string | undefined;
  readonly hasDatabaseUrl: boolean;
}

/** Modo efetivo de execucao. */
export type SeedMode = "dry-run" | "apply" | "cleanup" | "abort";

/** Decisao de modo: o modo + motivo estavel (pt-BR, sem segredo). */
export interface SeedDecision {
  readonly mode: SeedMode;
  readonly reason: string;
  /** `true` quando a decisao envolve escrita real (apply/cleanup). */
  readonly writes: boolean;
}

/**
 * Parseia argv em flags (`--apply`, `--cleanup`). Aceita variacoes com `=` mas
 * so reconhece as duas flags conhecidas; qualquer outro argumento e ignorado.
 */
export function parseSeedFlags(argv: readonly string[]): SeedFlags {
  const has = (name: string): boolean =>
    argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
  return { apply: has("--apply"), cleanup: has("--cleanup") };
}

/**
 * Resolve o modo de execucao do seed a partir de flags + env. Regras (fail
 * closed): dry-run e o padrao e NUNCA escreve; escrita (apply/cleanup) exige
 * confirmacao dupla (flag + env exata) e DATABASE_URL, e ABORTA em producao real.
 *
 * Ordem:
 *   1. Sem `--apply` e sem `--cleanup` -> dry-run (nunca escreve).
 *   2. `--apply` e `--cleanup` juntos    -> abort (escolha uma operacao).
 *   3. Producao real (runtime=production) -> abort (seguranca).
 *   4. Env de confirmacao != valor exato  -> abort (confirmacao dupla ausente).
 *   5. Sem DATABASE_URL                    -> abort (sem alvo).
 *   6. Caso contrario                      -> apply | cleanup.
 */
export function resolveSeedMode(flags: SeedFlags, env: SeedEnvInput): SeedDecision {
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

  if (env.confirmValue !== STAGING_SEED_CONFIRM_VALUE) {
    return {
      mode: "abort",
      reason: `Confirmacao dupla ausente: defina ${STAGING_SEED_CONFIRM_ENV}=${STAGING_SEED_CONFIRM_VALUE} para escrever.`,
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
    : { mode: "apply", reason: "Apply confirmado: aplica o plano de seed marcado (idempotente).", writes: true };
}

/* ------------------------------------------------------------------ */
/* Formatacao (seguro para imprimir; sem segredo)                      */
/* ------------------------------------------------------------------ */

/**
 * Formata o plano em linhas legiveis e SEGURAS (sem segredo). Usado pelo harness
 * para o dry-run e como preview do apply.
 */
export function formatSeedPlan(plan: StagingSeedPlan): string[] {
  const lines: string[] = [];
  lines.push("Plano de seed de staging (deterministico, marcado):");
  lines.push(`  idioma:      ${plan.languageCode}`);
  lines.push(`  marcador:    ${plan.marker}`);
  lines.push(`  prefixo slug:${plan.slugPrefix}`);
  lines.push(
    `  registros:   ${plan.recordCount.movies} filmes, ${plan.recordCount.slugs} slugs, ${plan.recordCount.translations} traducoes, ${plan.recordCount.contentBlocks} content blocks`,
  );
  for (const movie of plan.movies) {
    lines.push(
      `  - ${movie.slug} (tmdb sentinela ${movie.tmdbId}) "${movie.titlePt}" · ${movie.blocks.length} blocos`,
    );
  }
  return lines;
}
