/**
 * Testes PUROS do plano do seed demo publico e da resolucao de modo (Fase 9A).
 *
 * Cobrem: default dry-run; escrita so com confirmacao dupla; producao aborta;
 * DATABASE_URL ausente aborta; determinismo; marcadores inequivocos; ausencia de
 * segredo na saida formatada.
 */

import { describe, expect, it } from "vitest";

import {
  buildPublicDemoSeedPlan,
  formatPublicDemoPlan,
  isPublicDemoSlug,
  isPublicDemoTmdbId,
  parsePublicDemoFlags,
  resolvePublicDemoMode,
  PUBLIC_DEMO_CONFIRM_ENV,
  PUBLIC_DEMO_CONFIRM_VALUE,
  PUBLIC_DEMO_MARKER,
  PUBLIC_DEMO_SLUG_PREFIX,
  PUBLIC_DEMO_TMDB_ID_BASE,
  type PublicDemoEnvInput,
  type PublicDemoFlags,
} from "../../apps/admin/scripts/public-demo-seed-plan";

const CONFIRMED: PublicDemoEnvInput = {
  confirmValue: PUBLIC_DEMO_CONFIRM_VALUE,
  vercelEnv: "preview",
  nodeEnv: "production",
  hasDatabaseUrl: true,
};

const NO_FLAGS: PublicDemoFlags = { apply: false, cleanup: false };

describe("parsePublicDemoFlags", () => {
  it("reconhece --apply e --cleanup (e ignora o resto)", () => {
    expect(parsePublicDemoFlags([])).toEqual({ apply: false, cleanup: false });
    expect(parsePublicDemoFlags(["--apply"])).toEqual({ apply: true, cleanup: false });
    expect(parsePublicDemoFlags(["--cleanup"])).toEqual({ apply: false, cleanup: true });
    expect(parsePublicDemoFlags(["--apply", "--x"])).toEqual({ apply: true, cleanup: false });
    expect(parsePublicDemoFlags(["--apply=1"])).toEqual({ apply: true, cleanup: false });
  });
});

describe("resolvePublicDemoMode", () => {
  it("sem flags -> dry-run, nunca escreve (mesmo em producao)", () => {
    const d = resolvePublicDemoMode(NO_FLAGS, {
      confirmValue: PUBLIC_DEMO_CONFIRM_VALUE,
      vercelEnv: "production",
      nodeEnv: "production",
      hasDatabaseUrl: true,
    });
    expect(d.mode).toBe("dry-run");
    expect(d.writes).toBe(false);
  });

  it("--apply sem env de confirmacao -> abort", () => {
    const d = resolvePublicDemoMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, confirmValue: undefined },
    );
    expect(d.mode).toBe("abort");
    expect(d.reason).toContain(PUBLIC_DEMO_CONFIRM_ENV);
  });

  it("--apply com env errada -> abort", () => {
    const d = resolvePublicDemoMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, confirmValue: "sim" },
    );
    expect(d.mode).toBe("abort");
  });

  it("--apply confirmado, fora de producao, com DATABASE_URL -> apply", () => {
    const d = resolvePublicDemoMode({ apply: true, cleanup: false }, CONFIRMED);
    expect(d.mode).toBe("apply");
    expect(d.writes).toBe(true);
  });

  it("--cleanup confirmado -> cleanup", () => {
    const d = resolvePublicDemoMode({ apply: false, cleanup: true }, CONFIRMED);
    expect(d.mode).toBe("cleanup");
    expect(d.writes).toBe(true);
  });

  it("--apply e --cleanup juntos -> abort", () => {
    expect(resolvePublicDemoMode({ apply: true, cleanup: true }, CONFIRMED).mode).toBe("abort");
  });

  it("producao real (VERCEL_ENV=production) -> abort mesmo confirmado", () => {
    const d = resolvePublicDemoMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, vercelEnv: "production" },
    );
    expect(d.mode).toBe("abort");
    expect(d.reason.toLowerCase()).toContain("producao");
  });

  it("producao real (NODE_ENV=production, sem VERCEL_ENV) -> abort", () => {
    const d = resolvePublicDemoMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, vercelEnv: undefined, nodeEnv: "production" },
    );
    expect(d.mode).toBe("abort");
  });

  it("sem DATABASE_URL -> abort", () => {
    const d = resolvePublicDemoMode(
      { apply: true, cleanup: false },
      { ...CONFIRMED, hasDatabaseUrl: false },
    );
    expect(d.mode).toBe("abort");
    expect(d.reason).toContain("DATABASE_URL");
  });
});

describe("buildPublicDemoSeedPlan — deterministico e marcado", () => {
  it("mesma saida sempre (determinista)", () => {
    expect(buildPublicDemoSeedPlan()).toEqual(buildPublicDemoSeedPlan());
  });

  it("entrega 3 filmes, 3 series, 3 pessoas e vinculos de elenco", () => {
    const plan = buildPublicDemoSeedPlan();
    expect(plan.movies).toHaveLength(3);
    expect(plan.series).toHaveLength(3);
    expect(plan.people).toHaveLength(3);
    expect(plan.cast.length).toBeGreaterThanOrEqual(3);
    expect(plan.recordCount.watchOffers).toBeGreaterThan(0);
  });

  it("todo slug tem prefixo, todo tmdb esta na faixa sentinela, todo bloco tem marcador", () => {
    const plan = buildPublicDemoSeedPlan();
    const entities = [
      ...plan.movies.map((m) => ({ slug: m.slug, tmdbId: m.tmdbId, blocks: m.blocks })),
      ...plan.series.map((s) => ({ slug: s.slug, tmdbId: s.tmdbId, blocks: s.blocks })),
      ...plan.people.map((p) => ({ slug: p.slug, tmdbId: p.tmdbId, blocks: p.blocks })),
    ];
    for (const entity of entities) {
      expect(isPublicDemoSlug(entity.slug)).toBe(true);
      expect(entity.slug.startsWith(PUBLIC_DEMO_SLUG_PREFIX)).toBe(true);
      expect(isPublicDemoTmdbId(entity.tmdbId)).toBe(true);
      expect(entity.tmdbId).toBeGreaterThanOrEqual(PUBLIC_DEMO_TMDB_ID_BASE);
      expect(entity.tmdbId).toBeLessThan(2_147_483_647); // cabe no INT do schema
      for (const block of entity.blocks) {
        expect(block.content.startsWith(PUBLIC_DEMO_MARKER)).toBe(true);
      }
    }
  });

  it("filmes e series tem >= 2 blocos publicaveis (passa o gate anti-thin)", () => {
    const plan = buildPublicDemoSeedPlan();
    for (const title of [...plan.movies, ...plan.series]) {
      expect(title.blocks.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("tmdb sentinela nao colide com a fixture dev (99990001) nem o staging (991000000)", () => {
    const plan = buildPublicDemoSeedPlan();
    const all = [...plan.movies, ...plan.series, ...plan.people].map((e) => e.tmdbId);
    expect(all).not.toContain(99990001);
    expect(isPublicDemoTmdbId(99990001)).toBe(false);
    expect(isPublicDemoTmdbId(991000000)).toBe(false);
  });

  it("ofertas de watch usam so modalidades legais do enum", () => {
    const legal = new Set(["subscription", "rent", "buy", "free", "ads", "cinema"]);
    for (const title of [...buildPublicDemoSeedPlan().movies, ...buildPublicDemoSeedPlan().series]) {
      for (const w of title.watch) expect(legal.has(w.offerType)).toBe(true);
    }
  });
});

describe("formatPublicDemoPlan — seguro para imprimir", () => {
  it("nao contem termo de segredo", () => {
    const dump = formatPublicDemoPlan(buildPublicDemoSeedPlan()).join("\n").toLowerCase();
    for (const secret of ["password", "senha", "authorization", "database_url", "bearer"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("descreve marcador, prefixo e contagem", () => {
    const dump = formatPublicDemoPlan(buildPublicDemoSeedPlan()).join("\n");
    expect(dump).toContain(PUBLIC_DEMO_MARKER);
    expect(dump).toContain(PUBLIC_DEMO_SLUG_PREFIX);
  });
});
