/**
 * Governanca: o portao de CONTEUDO de temporada e episodio no SQL do sitemap.
 *
 * Temporada e episodio sairam da valvula de 2026-08-27 em 22/09/2026, pelo
 * portao de conteudo (`evaluateSeasonQualityGate` / `evaluateEpisodeQualityGate`).
 * A pagina aplica a funcao pura; o sitemap, este SQL. Este teste le o SQL como
 * TEXTO e trava tres erros que o typecheck nao pega:
 *
 *  1. o portao sumir de uma das quatro consultas (contagem e pagina, de
 *     temporada e de episodio) — o sitemap voltaria a publicar casca;
 *  2. contagem e pagina divergirem — o index anunciaria shards vazios;
 *  3. a "serie no indice" das quatro consultas deixar de ser o MESMO predicado
 *     da consulta de series — uma temporada entraria no sitemap com a serie
 *     fora dele.
 *
 * Quem prova que o SQL DISCRIMINA e o validador real
 * (`validate:season-episode-routes`).
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, readSourceWithoutComments } from "../support/source-text";

// Sem os comentarios de TypeScript; os de SQL (`--`) vivem dentro do template e
// ficam — sao ancoras deste teste.
const source = readSourceWithoutComments(
  path.join(REPO_ROOT, "apps", "web", "src", "server", "seo", "sitemap-index.ts"),
).replace(/\r\n/g, "\n");

/** Os blocos de consulta que comecam num `FROM`, ate o fim do template. */
function blocks(fromClause: string): string[] {
  return source
    .split(fromClause)
    .slice(1)
    .map((block) => block.slice(0, block.indexOf("`")));
}

const SEASON_BLOCKS = blocks("FROM seasons se\n");
const EPISODE_BLOCKS = blocks("FROM episodes e\n");

/** Trecho entre duas ancoras. Ancora que nao casa REPROVA — nunca compara vazio. */
function between(block: string, start: string, end: string): string {
  const a = block.indexOf(start);
  const b = block.indexOf(end, a);
  if (a === -1 || b === -1) throw new Error(`ancora nao encontrada: ${a === -1 ? start : end}`);
  return block.slice(a, b + end.length);
}

const SERIE_NO_INDICE_INICIO = "-- SERIE NO INDICE";
const SERIE_NO_INDICE_FIM = "LIMIT 1), ${absentTv}) = 'index'";

describe("sitemap — portao de conteudo de temporada e episodio", () => {
  it("(1) duas consultas de temporada e duas de episodio (contagem + pagina)", () => {
    expect(SEASON_BLOCKS).toHaveLength(2);
    expect(EPISODE_BLOCKS).toHaveLength(2);
  });

  it("(2) as QUATRO exigem a serie dona no indice, com o MESMO texto", () => {
    const trechos = [...SEASON_BLOCKS, ...EPISODE_BLOCKS].map((block) =>
      between(block, SERIE_NO_INDICE_INICIO, SERIE_NO_INDICE_FIM),
    );
    expect(new Set(trechos).size).toBe(1);
  });

  it("(3) a D3 da serie dona e a MESMA da consulta de series", () => {
    // A consulta de series e a que comeca com a serie como entidade principal.
    const seriesBlock = source.split("FROM slugs s JOIN tv_shows t ON t.id = s.entity_id")[1] ?? "";
    const d3 = (block: string): string =>
      between(block, "AND NOT (\n          s.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}", "\n        )\n");
    const daSerie = d3(seriesBlock);
    for (const block of [...SEASON_BLOCKS, ...EPISODE_BLOCKS]) {
      expect(d3(block)).toBe(daSerie);
    }
  });

  it("(4) temporada: sinopse propria OU guia de episodios, na medida da pagina", () => {
    for (const block of SEASON_BLOCKS) {
      expect(block).toContain("AND se.season_number >= 1");
      expect(block).toContain(
        "char_length(BTRIM(COALESCE(se.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}",
      );
      expect(block).toContain(
        "char_length(BTRIM(COALESCE(ep.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}",
      );
      expect(block).toContain(") >= ${MIN_SEASON_EPISODES_WITH_SYNOPSIS}");
    }
  });

  it("(5) episodio: sinopse de verdade E imagem propria", () => {
    for (const block of EPISODE_BLOCKS) {
      expect(block).toContain("AND se.season_number >= 1 AND e.episode_number >= 1");
      expect(block).toContain(
        "AND char_length(BTRIM(COALESCE(e.overview, ''), ${SYNOPSIS_TRIM_CHARS})) >= ${MIN_SYNOPSIS_CHARS}",
      );
      expect(block).toContain("AND BTRIM(COALESCE(e.still_path, '')) <> ''");
    }
  });

  it("(6) contagem e pagina usam o MESMO portao, caractere a caractere", () => {
    const portao = (block: string, tipo: "season" | "episode"): string =>
      between(
        block,
        "WHERE BTRIM(t.name_original) <> ''",
        tipo === "season" ? "LIMIT 1), ${absentSeason}) = 'index'" : "LIMIT 1), ${absentEpisode}) = 'index'",
      );
    expect(portao(SEASON_BLOCKS[0] ?? "", "season")).toBe(portao(SEASON_BLOCKS[1] ?? "", "season"));
    expect(portao(EPISODE_BLOCKS[0] ?? "", "episode")).toBe(portao(EPISODE_BLOCKS[1] ?? "", "episode"));
  });

  it("(7) CONTROLE: sem o portao, o extrator reprova em vez de comparar vazio", () => {
    expect(() => between("SELECT 1 FROM seasons se", SERIE_NO_INDICE_INICIO, SERIE_NO_INDICE_FIM)).toThrow();
  });
});
