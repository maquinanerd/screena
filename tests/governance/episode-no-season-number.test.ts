/**
 * Teste de governanca (Fase 1, correcao do PR #1) — episodes nao armazena
 * season_number.
 *
 * Bloqueador encontrado pelo Codex: episodes.season_number poderia divergir de
 * seasons.season_number. Correcao aprovada: remover o dado redundante. O numero
 * da temporada e DERIVADO de seasons via episodes.season_id.
 *
 * Este teste trava a regressao: o model Episode (schema) e a tabela episodes
 * (migration) NAO podem ter o campo/coluna season_number; e seasons DEVE
 * manter season_number (verdade da temporada).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const schema = readFileSync(path.join(ROOT, "packages", "db", "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  path.join(ROOT, "packages", "db", "prisma", "migrations", "20260625120000_init", "migration.sql"),
  "utf8",
);

/** Corpo de um model Prisma (da declaracao ate seu @@map("<table>")). */
function prismaModel(table: string): string {
  const idx = schema.indexOf(`@@map("${table}")`);
  expect(idx, `model com @@map("${table}") deve existir`).toBeGreaterThanOrEqual(0);
  return schema.slice(schema.lastIndexOf("\nmodel ", idx), idx);
}

/** Bloco de colunas de um CREATE TABLE na migration (ate o <table>_pkey). */
function createTable(table: string): string {
  const start = migration.indexOf(`CREATE TABLE "${table}" (`);
  expect(start, `CREATE TABLE "${table}" deve existir`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf(`"${table}_pkey"`, start);
  return migration.slice(start, end);
}

describe("normalizacao: episodes nao armazena season_number (PR #1)", () => {
  const episodeModel = prismaModel("episodes");
  const episodesTable = createTable("episodes");

  it("o model Episode nao tem o campo seasonNumber", () => {
    expect(/\bseasonNumber\b/.test(episodeModel)).toBe(false);
  });

  it("o model Episode nao mapeia a coluna season_number", () => {
    expect(/@map\("season_number"\)/.test(episodeModel)).toBe(false);
  });

  it("o model Episode mantem episode_number e season_id", () => {
    expect(/@map\("episode_number"\)/.test(episodeModel)).toBe(true);
    expect(/@map\("season_id"\)/.test(episodeModel)).toBe(true);
  });

  it("unicidade de episodio e por (season_id, episode_number)", () => {
    expect(/@@unique\(\[seasonId, episodeNumber\]\)/.test(episodeModel)).toBe(true);
  });

  it("a tabela episodes (migration) nao tem a coluna season_number", () => {
    expect(/"season_number"/.test(episodesTable)).toBe(false);
  });

  it("a tabela episodes mantem episode_number", () => {
    expect(/"episode_number"/.test(episodesTable)).toBe(true);
  });
});

describe("seasons continua sendo a verdade do season_number", () => {
  it("o model Season mantem season_number", () => {
    expect(/@map\("season_number"\)/.test(prismaModel("seasons"))).toBe(true);
  });

  it("a tabela seasons (migration) mantem a coluna season_number", () => {
    expect(/"season_number"/.test(createTable("seasons"))).toBe(true);
  });
});
