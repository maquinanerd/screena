/**
 * O teto do sitemap e POR TIPO: um tipo que estoura nunca apaga os outros.
 *
 * O defeito que isto trava foi medido na auditoria de 11/09/2026: com um teto
 * GLOBAL, o index inteiro saia vazio assim que a SOMA passava do limite — e a
 * soma era puxada por um tipo so.
 */

import { describe, expect, it } from "vitest";

import {
  SITEMAP_CEILING_ALERT_RATIOS,
  describeSitemapCeilingVerdict,
  evaluateSitemapCeilings,
  evaluateSitemapTypeCeiling,
} from "./sitemap-ceiling.js";

const TETOS = { movies: 1_000, series: 1_000, images: 1_000, news: 1_000 } as const;

describe("teto por tipo — isolamento", () => {
  it("(1) imagens ACIMA do teto saem; filmes, series e noticias continuam", () => {
    // O cenario exato pedido pela remediacao.
    const relatorio = evaluateSitemapCeilings(
      { movies: 900, series: 400, images: 5_000, news: 12 },
      TETOS,
    );
    expect(relatorio.excluded).toEqual(["images"]);
    expect(relatorio.published).toEqual(["movies", "series", "news"]);
  });

  it("(2) nenhum veredito depende da contagem de OUTRO tipo", () => {
    // Com o teto global, a mesma contagem de filmes era aprovada ou reprovada
    // conforme o tamanho das galerias. Aqui ela nao pode mudar.
    const com = evaluateSitemapCeilings({ movies: 900, images: 50 }, TETOS);
    const semLimite = evaluateSitemapCeilings({ movies: 900, images: 999_999 }, TETOS);
    const filmes = (r: typeof com) => r.verdicts.find((v) => v.type === "movies");
    expect(filmes(com)).toEqual(filmes(semLimite));
  });

  it("(3) CONTROLE NEGATIVO: todos acima do teto => nenhum publicado", () => {
    // Sem este caso, uma implementacao que simplesmente nunca excluisse nada
    // passaria nos dois anteriores.
    const relatorio = evaluateSitemapCeilings(
      { movies: 1_001, series: 1_001, images: 1_001, news: 1_001 },
      TETOS,
    );
    expect(relatorio.published).toEqual([]);
    expect(relatorio.excluded).toEqual(["movies", "series", "images", "news"]);
  });

  it("(4) a ordem dos tipos e preservada — o index anuncia na mesma ordem de sempre", () => {
    const relatorio = evaluateSitemapCeilings({ news: 1, movies: 1, series: 1 }, TETOS);
    expect(relatorio.verdicts.map((v) => v.type)).toEqual(["news", "movies", "series"]);
  });
});

describe("teto por tipo — alertas antes do corte", () => {
  it("(5) os limiares declarados sao 80%, 90% e 95%", () => {
    expect([...SITEMAP_CEILING_ALERT_RATIOS]).toEqual([0.8, 0.9, 0.95]);
  });

  it.each([
    [799, "ok", false],
    [800, "alert-80", false],
    [899, "alert-80", false],
    [900, "alert-90", false],
    [949, "alert-90", false],
    [950, "alert-95", false],
    [999, "alert-95", false],
    [1_000, "at-ceiling", false],
    [1_001, "over-ceiling", true],
  ] as const)("(6) %i de 1.000 => %s (excluido=%s)", (count, nivel, excluido) => {
    const v = evaluateSitemapTypeCeiling("movies", count, 1_000);
    expect(v.level).toBe(nivel);
    expect(v.excluded).toBe(excluido);
  });

  it("(7) tipo em alerta continua PUBLICADO e aparece em `alerts`", () => {
    const relatorio = evaluateSitemapCeilings({ movies: 960, series: 10 }, TETOS);
    expect(relatorio.published).toContain("movies");
    expect(relatorio.alerts.map((v) => v.type)).toEqual(["movies"]);
  });
});

describe("teto por tipo — fail-closed POR TIPO quando o dado nao serve", () => {
  it("(8) tipo sem teto declarado sai — e so ele", () => {
    const relatorio = evaluateSitemapCeilings({ movies: 10, desconhecido: 10 }, TETOS);
    expect(relatorio.excluded).toEqual(["desconhecido"]);
    expect(relatorio.published).toEqual(["movies"]);
    expect(relatorio.verdicts[1]?.level).toBe("invalid-ceiling");
  });

  it.each([[0], [-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "(9) teto invalido (%s) exclui o tipo",
    (teto) => {
      expect(evaluateSitemapTypeCeiling("movies", 10, teto).level).toBe("invalid-ceiling");
    },
  );

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    "(10) contagem invalida (%s) exclui o tipo",
    (contagem) => {
      const v = evaluateSitemapTypeCeiling("movies", contagem, 1_000);
      expect(v.level).toBe("invalid-count");
      expect(v.excluded).toBe(true);
    },
  );

  it("(11) zero URLs e um estado valido, nao um erro", () => {
    const v = evaluateSitemapTypeCeiling("news", 0, 1_000);
    expect(v.level).toBe("ok");
    expect(v.excluded).toBe(false);
  });
});

describe("teto por tipo — a linha de log nomeia a causa", () => {
  it("(12) o log do corte nomeia o tipo, a contagem e o teto, e diz que os outros ficam", () => {
    const linha = describeSitemapCeilingVerdict(evaluateSitemapTypeCeiling("images", 5_000, 1_000));
    expect(linha).toContain("images");
    expect(linha).toContain("5000");
    expect(linha).toContain("1000");
    expect(linha).toContain("SO este tipo sai");
  });

  it("(13) o log de alerta diz que o tipo segue publicado", () => {
    const linha = describeSitemapCeilingVerdict(evaluateSitemapTypeCeiling("movies", 900, 1_000));
    expect(linha).toContain("90.0%");
    expect(linha).toContain("publicado");
  });
});
