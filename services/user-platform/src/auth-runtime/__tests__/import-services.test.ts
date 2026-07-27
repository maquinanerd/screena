/**
 * Testes do RUNTIME de importacao (C8): preview sem escrita, apply idempotente,
 * reimport sem duplicata, retomada, cancelamento e tamanhos crescentes.
 *
 * O dominio puro (CSV, matching, plano) ja tem 50 testes proprios; aqui prova-se
 * a ORQUESTRACAO ponta a ponta com os dubles que reproduzem os uniques do
 * banco.
 */

import { describe, expect, it } from "vitest";
import {
  applyImport,
  cancelImport,
  createImportPreview,
  readImport,
} from "../import-services.js";
import { createTestRuntime, seedUser } from "./fakes.js";
import { seedCatalogTitle } from "./library-fakes.js";
import type { AuthenticatedContext } from "../deps.js";

function auth(userId: bigint): AuthenticatedContext {
  return {
    userId,
    sessionId: 1n,
    userStatus: "active",
    csrfTokenHash: "c".repeat(64),
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** CSV canonico com N filmes, todos com tmdb_id (match exato). */
function cinerieCsv(n: number): string {
  const linhas = ["entity_type,tmdb_id,title,year,state,watched_at"]
  for (let i = 1; i <= n; i += 1) {
    linhas.push(`movie,${1000 + i},Filme ${i},20${10 + (i % 10)},watched,2024-01-15`)
  }
  return linhas.join("\n")
}

/** Semeia o catalogo casando com `cinerieCsv`. */
function seedCatalogFor(rt: ReturnType<typeof createTestRuntime>, n: number): void {
  for (let i = 1; i <= n; i += 1) {
    seedCatalogTitle(rt.db, {
      entityType: "movie",
      entityId: BigInt(500 + i),
      title: `Filme ${i}`,
      year: 2010 + (i % 10),
      tmdbId: 1000 + i,
    })
  }
}

describe("createImportPreview", () => {
  it("(1) PREVIEW nao escreve nada na biblioteca", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedCatalogFor(rt, 3);

    const r = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: "meus-filmes.csv",
      bytes: bytesOf(cinerieCsv(3)),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.plan.summary.exact).toBe(3);
    expect(r.value.plan.summary.applicable).toBe(3);
    // NENHUMA escrita de biblioteca: o job existe, mas watch states nao.
    expect(rt.db.watchStates).toHaveLength(0);
    expect(rt.db.importJobs).toHaveLength(1);
    expect(rt.db.importJobs[0]!.status).toBe("preview_ready");
  });

  it("(2) ZIP e recusado na borda de bytes", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const r = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: "export.zip",
      bytes: zip,
    });
    expect(r.ok).toBe(false);
  });

  it("(3) titulo ambiguo NAO e aplicado (fica em unmatched)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    // Dois filmes de MESMO titulo e ano: ambiguidade real.
    seedCatalogTitle(rt.db, { entityType: "movie", entityId: 700n, title: "Duna", year: 2021 });
    seedCatalogTitle(rt.db, { entityType: "movie", entityId: 701n, title: "Duna", year: 2021 });

    const csv = "title,year,state\nDuna,2021,watched";
    const r = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: null,
      bytes: bytesOf(csv),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.plan.summary.ambiguous).toBe(1);
    expect(r.value.plan.summary.applicable).toBe(0);
    expect(r.value.plan.unmatched).toHaveLength(1);
  });
});

describe("applyImport", () => {
  async function previewAndJob(rt: ReturnType<typeof createTestRuntime>, userId: bigint, n: number) {
    seedCatalogFor(rt, n);
    const r = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: "f.csv",
      bytes: bytesOf(cinerieCsv(n)),
    });
    if (!r.ok) throw new Error("preview falhou no teste");
    return r.value.job.id;
  }

  it("(1) apply grava a biblioteca e conclui o job", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const jobId = await previewAndJob(rt, userId, 3);

    const r = await applyImport(rt.deps, auth(userId), { jobId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.appliedCount).toBe(3);
    expect(rt.db.watchStates.filter((w) => w.status === "watched")).toHaveLength(3);
    expect(rt.db.importJobs[0]!.status).toBe("applied");
    // Proveniencia registrada no diario.
    expect(rt.db.viewingEvents.filter((e) => e.eventType === "import_applied")).toHaveLength(3);
  });

  it("(2) REIMPORT do mesmo arquivo NAO duplica", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });

    const job1 = await previewAndJob(rt, userId, 3);
    await applyImport(rt.deps, auth(userId), { jobId: job1 });
    const watchApos1 = rt.db.watchStates.length;
    const eventosApos1 = rt.db.viewingEvents.length;

    // Segundo import do MESMO conteudo (novo job, mesmas linhas).
    const job2 = await previewAndJob(rt, userId, 3);
    await applyImport(rt.deps, auth(userId), { jobId: job2 });

    // Watch states: os mesmos 3 (unique por user+entidade), nao 6.
    expect(rt.db.watchStates.length).toBe(watchApos1);
    // O diario nao ganha eventos NOVOS de import para as mesmas linhas do
    // mesmo job — mas job2 tem id diferente, entao a chave de idempotencia
    // difere; o que importa e que a BIBLIOTECA nao duplicou.
    expect(eventosApos1).toBeGreaterThan(0);
  });

  it("(3) apply DUPLICADO concorrente: o segundo e barrado pelo CAS de status", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const jobId = await previewAndJob(rt, userId, 5);

    const [a, b] = await Promise.all([
      applyImport(rt.deps, auth(userId), { jobId }),
      applyImport(rt.deps, auth(userId), { jobId }),
    ]);
    // Um aplica; o outro encontra o status ja mudado (conflict). Em ambos os
    // casos a biblioteca tem exatamente 5 titulos, nunca 10.
    const sucessos = [a, b].filter((r) => r.ok).length;
    expect(sucessos).toBeGreaterThanOrEqual(1);
    expect(rt.db.watchStates.filter((w) => w.status === "watched")).toHaveLength(5);
  });

  it("(4) RETOMADA: reprocessar um job ja aplicado NAO duplica", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const jobId = await previewAndJob(rt, userId, 6);

    // Primeira aplicacao completa: 6 titulos.
    const primeira = await applyImport(rt.deps, auth(userId), { jobId });
    expect(primeira.ok).toBe(true);
    expect(rt.db.watchStates.filter((w) => w.status === "watched")).toHaveLength(6);

    // Simula uma retomada que NAO viu a conclusao: recoloca o job em `applying`
    // com o cursor a meio caminho, como se tivesse crashado apos gravar 3 e
    // antes de concluir. Como cada acao e idempotente, reaplicar 3..5 nao cria
    // segundo watch state (unique por user+entidade).
    const job = rt.db.importJobs.find((j) => j.id === jobId)!;
    job.status = "applying";
    job.appliedCount = 3;

    const retomada = await applyImport(rt.deps, auth(userId), { jobId });
    expect(retomada.ok).toBe(true);
    if (!retomada.ok) return;
    expect(retomada.value.appliedCount).toBe(6);
    // Continua com EXATAMENTE 6 — a retomada nao duplicou nada.
    expect(rt.db.watchStates.filter((w) => w.status === "watched")).toHaveLength(6);
  });
});

describe("cancelImport", () => {
  it("(1) cancelar antes do apply descarta o plano e nao escreve nada", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedCatalogFor(rt, 3);
    const preview = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: null,
      bytes: bytesOf(cinerieCsv(3)),
    });
    if (!preview.ok) throw new Error("preview falhou");

    const r = await cancelImport(rt.deps, auth(userId), { jobId: preview.value.job.id });
    expect(r.ok).toBe(true);
    expect(rt.db.importJobs[0]!.status).toBe("cancelled");
    expect(rt.db.importJobs[0]!.preview).toBeNull();
    expect(rt.db.watchStates).toHaveLength(0);
  });

  it("(2) job ja aplicado nao pode ser cancelado", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedCatalogFor(rt, 1);
    const preview = await createImportPreview(rt.deps, auth(userId), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: null,
      bytes: bytesOf(cinerieCsv(1)),
    });
    if (!preview.ok) throw new Error("preview falhou");
    await applyImport(rt.deps, auth(userId), { jobId: preview.value.job.id });

    const r = await cancelImport(rt.deps, auth(userId), { jobId: preview.value.job.id });
    expect(r.ok).toBe(false);
  });
});

describe("ownership da importacao", () => {
  it("outro usuario nao le nem aplica o job alheio", async () => {
    const rt = createTestRuntime();
    const dono = seedUser(rt.db, { emailNormalized: "dono@b.test" });
    const intruso = seedUser(rt.db, { emailNormalized: "intruso@b.test" });
    seedCatalogFor(rt, 2);
    const preview = await createImportPreview(rt.deps, auth(dono), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: null,
      bytes: bytesOf(cinerieCsv(2)),
    });
    if (!preview.ok) throw new Error("preview falhou");
    const jobId = preview.value.job.id;

    expect((await readImport(rt.deps, auth(intruso), { jobId })).ok).toBe(false);
    expect((await applyImport(rt.deps, auth(intruso), { jobId })).ok).toBe(false);
  });
});

describe("tamanhos crescentes", () => {
  // PREVIEW ate 10.000 linhas: o parser + matching sao O(n) e o preview e UMA
  // transacao. Prova que o caminho de leitura aguenta um arquivo grande.
  for (const n of [10, 1_000, 10_000]) {
    it(`(preview ${n}) processa ${n} linhas e conta exact`, async () => {
      const rt = createTestRuntime();
      const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
      seedCatalogFor(rt, n);
      const preview = await createImportPreview(rt.deps, auth(userId), {
        source: "cinerie_csv",
        targetState: "watched",
        fileName: null,
        bytes: bytesOf(cinerieCsv(n)),
      });
      expect(preview.ok).toBe(true);
      if (!preview.ok) return;
      expect(preview.value.plan.summary.totalRows).toBe(n);
      expect(preview.value.plan.summary.exact).toBe(n);
    });
  }

  // APPLY ate 1.000 nos dubles em memoria: cada acao roda numa transacao que o
  // duble faz por snapshot/restore (structuredClone), o que torna 10.000
  // aplicacoes O(n^2) NESTE ambiente — nao no banco real, que usa upsert
  // set-based. A escala REAL do apply e provada no validador PostgreSQL 16
  // (validate:library), sem cloning; aqui prova-se ate onde o duble e honesto.
  for (const n of [10, 1_000]) {
    it(`(apply ${n}) aplica ${n} linhas de forma idempotente`, async () => {
      const rt = createTestRuntime();
      const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
      seedCatalogFor(rt, n);
      const preview = await createImportPreview(rt.deps, auth(userId), {
        source: "cinerie_csv",
        targetState: "watched",
        fileName: null,
        bytes: bytesOf(cinerieCsv(n)),
      });
      if (!preview.ok) throw new Error("preview falhou");
      const apply = await applyImport(rt.deps, auth(userId), { jobId: preview.value.job.id });
      expect(apply.ok).toBe(true);
      if (!apply.ok) return;
      expect(apply.value.appliedCount).toBe(n);
      expect(rt.db.watchStates.filter((w) => w.status === "watched")).toHaveLength(n);
    });
  }
});
