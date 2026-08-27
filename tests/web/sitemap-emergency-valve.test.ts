/**
 * Governanca: a VALVULA DE EMERGENCIA do sitemap (2026-08-27) e o TETO.
 *
 * O QUE ACONTECEU. Em 2026-08-22 o sitemap tinha 53.054 URLs. Em 2026-08-27,
 * 4.069.444 — 77x em cinco dias, 96,36% em temporada e episodio. Nenhum alarme
 * disparou porque nada nunca comparou o total a coisa nenhuma, e porque as duas
 * rotas do sitemap sao `force-dynamic`: elas nao nascem no build, sao montadas a
 * cada requisicao direto do banco. Nao houve deploy nem linha de log.
 *
 * ESTE ARQUIVO TRAVA TRES COISAS:
 *  1. O PAR. Sair do sitemap nao desindexa; a meta tag desindexa. As duas
 *     listas (shard e pagina) tem de descrever os MESMOS tipos — se uma andar
 *     sem a outra, metade da valvula fica inerte e ninguem percebe.
 *  2. O SHARD ANTIGO MORRE. `sitemap-pt-BR-episodes-42.xml` precisa responder
 *     404, e nao continuar servindo 50.000 URLs para quem guardou o endereco.
 *  3. O TETO. Um total acima do declarado reprova aqui e sai fail-closed no
 *     runtime. E o detector de fumaca que faltava.
 */

import { describe, expect, it, vi } from "vitest";

import {
  SITEMAP_TOTAL_URL_CEILING,
  SUSPENDED_SITEMAP_TYPES,
  getSitemapIndexXml,
  parseShardId,
} from "../../apps/web/src/server/seo/sitemap-index";
import {
  SUSPENDED_PAGE_TYPES,
  SUSPENSION_REASON,
  applyPageSuspension,
} from "../../apps/web/src/server/seo/suspended-pages";
import { REPO_ROOT, readSourceWithoutComments } from "../support/source-text";
import path from "node:path";

/** Tipos publicados hoje, derivados do que `parseShardId` aceita. */
const PUBLISHED = ["movies", "series", "people", "news", "imagens", "videos", "static"] as const;

/** `PageSeoResolution` minima — so o que a valvula le e reescreve. */
function resolution(overrides: Record<string, unknown> = {}) {
  return {
    decision: "index",
    robots: { index: true, follow: true },
    includeInSitemap: true,
    canonical: "https://cinerie.com/pt/series/x/temporadas/1/",
    reason: "indexacao total",
    decisionSource: "live",
    policy: {},
    policyVersion: "v",
    hasUniqueValue: false,
    allRatingsLicensed: true,
    ...overrides,
  } as never;
}

/**
 * Prisma falso: toda contagem devolve `count`. Nao imita SQL — o teto soma
 * contagens, e e a soma que esta sob teste.
 */
function fakePrisma(count: number) {
  const rows = [{ n: count, maxmod: null }];
  return {
    $queryRaw: async () => rows,
    $queryRawUnsafe: async () => rows,
  } as never;
}

describe("valvula de emergencia do sitemap — o PAR", () => {
  it("(1) as duas listas descrevem os mesmos tipos (plural do shard / singular da decisao)", () => {
    // Se alguem tirar `episodes` do sitemap e esquecer `episode` na pagina, o
    // Google mantem indexado o que ja pegou — e a valvula vira decoracao.
    const doShard = [...SUSPENDED_SITEMAP_TYPES].map((t) => t.replace(/s$/, "")).sort();
    const daPagina = [...SUSPENDED_PAGE_TYPES].sort();
    expect(doShard).toEqual(daPagina);
  });

  it("(2) temporada e episodio estao suspensos — sao 96,36% do volume medido", () => {
    expect([...SUSPENDED_SITEMAP_TYPES].sort()).toEqual(["episodes", "seasons"]);
  });
});

describe("valvula — o shard suspenso responde 404", () => {
  it("(3) `parseShardId` recusa todo shard de tipo suspenso", () => {
    for (const type of SUSPENDED_SITEMAP_TYPES) {
      expect(parseShardId(`sitemap-pt-BR-${type}-1.xml`)).toBeNull();
      expect(parseShardId(`sitemap-pt-BR-${type}-42.xml`)).toBeNull();
    }
  });

  it("(4) e continua aceitando todo tipo publicado — a valvula nao derruba o resto", () => {
    for (const type of PUBLISHED) {
      expect(parseShardId(`sitemap-pt-BR-${type}-1.xml`)).not.toBeNull();
    }
  });
});

describe("valvula — a meta tag, que e o que de fato desindexa", () => {
  it("(5) tipo suspenso vira noindex, FORA do sitemap, e `follow` continua ligado", () => {
    for (const type of SUSPENDED_PAGE_TYPES) {
      const out = applyPageSuspension(type, resolution());
      expect(out.decision).toBe("noindex");
      expect(out.robots).toEqual({ index: false, follow: true });
      expect(out.includeInSitemap).toBe(false);
      expect(out.reason).toBe(SUSPENSION_REASON);
    }
  });

  it("(6) `follow` e deliberado: com nofollow o Google pararia de seguir os links que sustentam serie e temporada", () => {
    const out = applyPageSuspension("episode", resolution());
    expect(out.robots.follow).toBe(true);
  });

  it("(7) filme, serie e pessoa passam INTACTOS — a valvula nunca os toca", () => {
    for (const type of ["movie", "tv", "person"] as const) {
      const antes = resolution();
      expect(applyPageSuspension(type, antes)).toBe(antes);
    }
  });

  it("(8) nunca AFROUXA: `blocked` (licenca) e `draft` (idioma) continuam valendo", () => {
    for (const decision of ["blocked", "draft"] as const) {
      const out = applyPageSuspension("episode", resolution({ decision }));
      expect(out.decision).toBe(decision);
    }
  });
});

describe("teto declarado do sitemap", () => {
  it("(9) abaixo do teto o index publica normalmente", async () => {
    // 6 tipos publicados x 1.000 = 6.000, bem abaixo do teto.
    const { xml } = await getSitemapIndexXml(undefined, fakePrisma(1_000));
    expect(xml).toContain("<sitemap>");
    expect(xml).toContain("sitemap-pt-BR-movies-1.xml");
  });

  it("(10) ACIMA do teto o index sai VAZIO e o erro nomeia o total", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // 6 tipos x 100.000 = 600.000 > 300.000.
      const { xml } = await getSitemapIndexXml(undefined, fakePrisma(100_000));
      expect(xml).not.toContain("<sitemap>");
      const mensagem = erro.mock.calls.flat().map(String).join(" ");
      expect(mensagem).toContain("600000");
      expect(mensagem).toContain(String(SITEMAP_TOTAL_URL_CEILING));
    } finally {
      erro.mockRestore();
    }
  });

  it("(11) o teto e MENOR que o desastre medido — 4.069.444 URLs teriam reprovado", () => {
    expect(SITEMAP_TOTAL_URL_CEILING).toBeLessThan(4_069_444);
    // E maior que o volume publicado apos a valvula (~105.000), para nao
    // reprovar por crescimento normal.
    expect(SITEMAP_TOTAL_URL_CEILING).toBeGreaterThan(105_000);
  });
});

describe("gate de pessoa no SQL — biografia exibivel e foto", () => {
  const fonte = readSourceWithoutComments(
    path.join(REPO_ROOT, "apps", "web", "src", "server", "seo", "sitemap-index.ts"),
  );

  it("(12) as DUAS consultas de pessoa (contagem e pagina) exigem biografia e foto", () => {
    // Duas copias do WHERE: se so uma ganhar o gate, o index anuncia N shards
    // que a pagina nao consegue preencher.
    for (const predicado of [
      "AND BTRIM(COALESCE(p.biography, '')) <> ''",
      "AND p.biography_source_status::text IN ('official','licensed','third_party')",
      "AND BTRIM(COALESCE(p.profile_path, '')) <> ''",
    ]) {
      expect(fonte.split(predicado).length - 1).toBe(2);
    }
  });

  it("(13) a licenca da bio nao pode ser esquecida: texto sem status liberado nao conta (invariante 6)", () => {
    expect(fonte).not.toContain("biography_source_status::text IN ('unknown'");
  });
});
