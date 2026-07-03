/**
 * Testes PUROS do plano de seed e da resolucao de modo (Fase 8A).
 *
 * Cobrem: default dry-run; escrita so com confirmacao dupla; producao aborta;
 * DATABASE_URL ausente aborta; determinismo do plano; marcadores inequivocos;
 * ausencia de segredo na saida formatada.
 */

import { describe, expect, it } from "vitest";

import {
  buildStagingSeedPlan,
  formatSeedPlan,
  isStagingSeedSlug,
  isStagingSeedTmdbId,
  parseSeedFlags,
  resolveSeedMode,
  STAGING_SEED_CONFIRM_ENV,
  STAGING_SEED_CONFIRM_VALUE,
  STAGING_SEED_MARKER,
  STAGING_SEED_SLUG_PREFIX,
  STAGING_SEED_TMDB_ID_BASE,
  type SeedEnvInput,
  type SeedFlags,
} from "../../apps/admin/src/lib/staging-seed-plan";

const CONFIRMED: SeedEnvInput = {
  confirmValue: STAGING_SEED_CONFIRM_VALUE,
  vercelEnv: "preview",
  nodeEnv: "production",
  hasDatabaseUrl: true,
};

const NO_FLAGS: SeedFlags = { apply: false, cleanup: false };

describe("parseSeedFlags", () => {
  it("reconhece --apply e --cleanup (e ignora o resto)", () => {
    expect(parseSeedFlags([])).toEqual({ apply: false, cleanup: false });
    expect(parseSeedFlags(["--apply"])).toEqual({ apply: true, cleanup: false });
    expect(parseSeedFlags(["--cleanup"])).toEqual({ apply: false, cleanup: true });
    expect(parseSeedFlags(["--apply", "--verbose"])).toEqual({ apply: true, cleanup: false });
    expect(parseSeedFlags(["--apply=1"])).toEqual({ apply: true, cleanup: false });
  });
});

describe("resolveSeedMode — default e dry-run", () => {
  it("sem flags -> dry-run, nunca escreve (independente de env)", () => {
    const d = resolveSeedMode(NO_FLAGS, {
      confirmValue: STAGING_SEED_CONFIRM_VALUE,
      vercelEnv: "production",
      nodeEnv: "production",
      hasDatabaseUrl: true,
    });
    expect(d.mode).toBe("dry-run");
    expect(d.writes).toBe(false);
  });
});

describe("resolveSeedMode — escrita exige confirmacao dupla", () => {
  it("--apply sem env de confirmacao -> abort", () => {
    const d = resolveSeedMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, confirmValue: undefined },
    );
    expect(d.mode).toBe("abort");
    expect(d.writes).toBe(false);
    expect(d.reason).toContain(STAGING_SEED_CONFIRM_ENV);
  });

  it("--apply com env errada -> abort", () => {
    const d = resolveSeedMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, confirmValue: "sim" },
    );
    expect(d.mode).toBe("abort");
  });

  it("--apply confirmado, fora de producao, com DATABASE_URL -> apply", () => {
    const d = resolveSeedMode({ apply: true, cleanup: false }, CONFIRMED);
    expect(d.mode).toBe("apply");
    expect(d.writes).toBe(true);
  });

  it("--cleanup confirmado -> cleanup", () => {
    const d = resolveSeedMode({ apply: false, cleanup: true }, CONFIRMED);
    expect(d.mode).toBe("cleanup");
    expect(d.writes).toBe(true);
  });

  it("--apply e --cleanup juntos -> abort", () => {
    const d = resolveSeedMode({ apply: true, cleanup: true }, CONFIRMED);
    expect(d.mode).toBe("abort");
  });
});

describe("resolveSeedMode — producao e DATABASE_URL", () => {
  it("producao real (VERCEL_ENV=production) -> abort mesmo confirmado", () => {
    const d = resolveSeedMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, vercelEnv: "production" },
    );
    expect(d.mode).toBe("abort");
    expect(d.reason.toLowerCase()).toContain("producao");
  });

  it("producao real (NODE_ENV=production, sem VERCEL_ENV) -> abort", () => {
    const d = resolveSeedMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, vercelEnv: undefined, nodeEnv: "production" },
    );
    expect(d.mode).toBe("abort");
  });

  it("sem DATABASE_URL -> abort", () => {
    const d = resolveSeedMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, hasDatabaseUrl: false },
    );
    expect(d.mode).toBe("abort");
    expect(d.reason).toContain("DATABASE_URL");
  });
});

describe("buildStagingSeedPlan — deterministico e marcado", () => {
  it("mesma saida sempre (determinista)", () => {
    expect(buildStagingSeedPlan()).toEqual(buildStagingSeedPlan());
  });

  it("todo slug tem prefixo, todo tmdb esta na faixa sentinela, todo bloco tem marcador", () => {
    const plan = buildStagingSeedPlan();
    expect(plan.movies.length).toBeGreaterThan(0);
    for (const movie of plan.movies) {
      expect(movie.slug.startsWith(STAGING_SEED_SLUG_PREFIX)).toBe(true);
      expect(isStagingSeedSlug(movie.slug)).toBe(true);
      expect(movie.tmdbId).toBeGreaterThanOrEqual(STAGING_SEED_TMDB_ID_BASE);
      expect(isStagingSeedTmdbId(movie.tmdbId)).toBe(true);
      expect(movie.tmdbId).toBeLessThan(2_147_483_647); // cabe no INT do schema
      expect(movie.blocks.length).toBeGreaterThanOrEqual(2); // passa o gate anti-thin
      for (const block of movie.blocks) {
        expect(block.content.startsWith(STAGING_SEED_MARKER)).toBe(true);
      }
    }
    expect(plan.recordCount.movies).toBe(plan.movies.length);
    expect(plan.recordCount.contentBlocks).toBe(
      plan.movies.reduce((sum, m) => sum + m.blocks.length, 0),
    );
  });

  it("tmdb sentinela nao colide com a fixture dev do apps/web (99990001)", () => {
    for (const movie of buildStagingSeedPlan().movies) {
      expect(movie.tmdbId).not.toBe(99990001);
    }
    expect(isStagingSeedTmdbId(99990001)).toBe(false);
  });
});

describe("formatSeedPlan — seguro para imprimir", () => {
  it("nao contem termo de segredo", () => {
    const dump = formatSeedPlan(buildStagingSeedPlan()).join("\n").toLowerCase();
    for (const secret of ["password", "senha", "authorization", "database_url", "bearer"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("descreve marcador, prefixo e contagem", () => {
    const dump = formatSeedPlan(buildStagingSeedPlan()).join("\n");
    expect(dump).toContain(STAGING_SEED_MARKER);
    expect(dump).toContain(STAGING_SEED_SLUG_PREFIX);
  });
});
