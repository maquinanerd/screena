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
 *  3. O TETO, POR TIPO. Um tipo acima do SEU teto sai sozinho do index e os
 *     demais continuam. Ate 2026-09-11 era um teto global que esvaziava o
 *     sitemap inteiro por causa de um tipo so — o defeito que a auditoria de SEO
 *     mediu com data de estouro.
 */

import { describe, expect, it, vi } from "vitest";

import {
  OWNER_EXCLUDED_SITEMAP_TYPES,
  SITEMAP_TYPE_URL_CEILING,
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

/**
 * Tipos publicados hoje, derivados do que `parseShardId` aceita. Galerias sairam
 * em 2026-09-11 por decisao do dono (D1) — ver o caso (4b). Temporada e episodio
 * VOLTARAM em 2026-09-22, pelo portao de conteudo: a valvula esvaziou.
 */
const PUBLISHED = ["movies", "series", "people", "news", "static", "seasons", "episodes"] as const;

/** A valvula como ela era — para exercitar o MECANISMO, que continua ligado. */
const VALVULA_DE_2026_08_27 = ["season", "episode"] as const;

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

  it("(2) a valvula esta VAZIA desde 22/09/2026: temporada e episodio saem por dado", () => {
    // Era ["episodes","seasons"] — 96,36% do volume medido em 27/08. A saida
    // registrada pela propria valvula ("quando a Fase 3 estiver aplicada, esta
    // lista volta a ser vazia") foi pedida pelo dono em 22/09/2026. O portao de
    // conteudo e `evaluateSeasonQualityGate`/`evaluateEpisodeQualityGate`.
    expect([...SUSPENDED_SITEMAP_TYPES]).toEqual([]);
    expect([...SUSPENDED_PAGE_TYPES]).toEqual([]);
  });
});

describe("valvula — o shard suspenso responde 404", () => {
  it("(3) os shards de temporada e episodio voltam a ser aceitos", () => {
    // Nomes LITERAIS: iterar a lista vazia passaria sem provar nada.
    for (const type of ["seasons", "episodes"]) {
      expect(parseShardId(`sitemap-pt-BR-${type}-1.xml`)).not.toBeNull();
    }
  });

  it("(4) e continua aceitando todo tipo publicado — a valvula nao derruba o resto", () => {
    for (const type of PUBLISHED) {
      expect(parseShardId(`sitemap-pt-BR-${type}-1.xml`)).not.toBeNull();
    }
  });

  it("(4b) galeria saiu por DECISAO DO DONO (D1): o shard antigo de imagens e videos responde 404", () => {
    // Os nomes sao LITERAIS de proposito (a mesma licao do caso 7 da suite de
    // governanca): derivar da propria lista faria o teste passar vazio se alguem
    // a esvaziasse.
    expect([...OWNER_EXCLUDED_SITEMAP_TYPES].sort()).toEqual(["imagens", "videos"]);
    for (const type of ["imagens", "videos"]) {
      expect(parseShardId(`sitemap-pt-BR-${type}-1.xml`)).toBeNull();
    }
  });
});

describe("valvula — a meta tag, que e o que de fato desindexa", () => {
  it("(5) tipo suspenso vira noindex, FORA do sitemap, e `follow` continua ligado", () => {
    // O MECANISMO continua ligado as paginas: religar a valvula e acrescentar o
    // tipo as duas listas. Aqui ele e exercitado com a lista de 27/08.
    for (const type of VALVULA_DE_2026_08_27) {
      const out = applyPageSuspension(type, resolution(), VALVULA_DE_2026_08_27);
      expect(out.decision).toBe("noindex");
      expect(out.robots).toEqual({ index: false, follow: true });
      expect(out.includeInSitemap).toBe(false);
      expect(out.reason).toBe(SUSPENSION_REASON);
    }
  });

  it("(6) `follow` e deliberado: com nofollow o Google pararia de seguir os links que sustentam serie e temporada", () => {
    const out = applyPageSuspension("episode", resolution(), VALVULA_DE_2026_08_27);
    expect(out.robots.follow).toBe(true);
  });

  it("(6b) com a valvula VAZIA, a pagina de temporada e episodio passa intacta", () => {
    // E o estado de producao desde 22/09/2026: quem decide e o portao de
    // conteudo, na resolucao que chega aqui.
    for (const type of ["season", "episode"] as const) {
      const antes = resolution();
      expect(applyPageSuspension(type, antes)).toBe(antes);
    }
  });

  it("(7) filme, serie e pessoa passam INTACTOS — a valvula nunca os toca", () => {
    for (const type of ["movie", "tv", "person"] as const) {
      const antes = resolution();
      expect(applyPageSuspension(type, antes, VALVULA_DE_2026_08_27)).toBe(antes);
    }
  });

  it("(8) so DEMOVE de `index`: blocked, draft e noindex voltam intactos, com o MOTIVO preservado", () => {
    // O caso que quase passou foi `noindex`: a valvula reescrevia o motivo de
    // uma decisao persistida, apagando a auditoria de por que a pagina saiu do
    // indice — e fazendo `noindex` deixar de discriminar quem decidiu.
    for (const decision of ["blocked", "draft", "noindex"] as const) {
      const antes = resolution({ decision, reason: "motivo de quem decidiu antes" });
      const out = applyPageSuspension("episode", antes, VALVULA_DE_2026_08_27);
      expect(out.decision).toBe(decision);
      expect(out.reason).toBe("motivo de quem decidiu antes");
      expect(out).toBe(antes);
    }
  });
});

describe("teto declarado do sitemap", () => {
  it("(9) abaixo do teto o index publica normalmente", async () => {
    // Cada tipo publicado com 1.000 URLs: bem abaixo de todo teto por tipo.
    const { xml } = await getSitemapIndexXml(undefined, fakePrisma(1_000));
    expect(xml).toContain("<sitemap>");
    expect(xml).toContain("sitemap-pt-BR-movies-1.xml");
  });

  it("(10) um tipo ACIMA do SEU teto sai sozinho; os outros continuam no index", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Toda contagem = 100.000. Filme tem teto de 500.000, serie e pessoa de
      // 150.000 — todos acima; noticia tem 50.000 — so noticia estoura.
      //
      // O MESMO conjunto, com o teto global antigo (6 tipos x 100.000 = 600.000
      // contra 300.000), produzia um index VAZIO. E essa a diferenca sob teste.
      const { xml } = await getSitemapIndexXml(undefined, fakePrisma(100_000));
      expect(xml).toContain("sitemap-pt-BR-movies-1.xml");
      expect(xml).toContain("sitemap-pt-BR-series-1.xml");
      expect(xml).toContain("sitemap-pt-BR-people-1.xml");
      expect(xml).not.toContain("-news-");
      const mensagem = erro.mock.calls.flat().map(String).join(" ");
      expect(mensagem).toContain("news");
      expect(mensagem).toContain("100000");
      expect(mensagem).toContain(String(SITEMAP_TYPE_URL_CEILING.news));
    } finally {
      erro.mockRestore();
      aviso.mockRestore();
    }
  });

  it("(11) cada teto e MENOR que o desastre medido do seu tipo e MAIOR que o volume legitimo", () => {
    // 2026-08-27: 3.793.672 episodios num dia. O teto de episodio reprovaria.
    expect(SITEMAP_TYPE_URL_CEILING.episodes).toBeLessThan(3_793_672);
    // E acima do volume publicado apos a valvula, para nao reprovar por
    // crescimento normal (medido shard a shard em 2026-08-27).
    expect(SITEMAP_TYPE_URL_CEILING.movies).toBeGreaterThan(34_799);
    expect(SITEMAP_TYPE_URL_CEILING.series).toBeGreaterThan(32_392);
    expect(SITEMAP_TYPE_URL_CEILING.imagens).toBeGreaterThan(43_155);
    // Medido em 22/09/2026, com os arquivos de 10.000 URLs: 59.612 filmes e 32.328
    // series. O teto de filme precisa de folga de MESES sobre o ritmo de ~1.800 por
    // dia: o alerta de 80% nao pode estar a semanas do volume de hoje.
    expect(SITEMAP_TYPE_URL_CEILING.movies * 0.8).toBeGreaterThan(59_612 + 1_800 * 120);
    expect(SITEMAP_TYPE_URL_CEILING.series).toBeGreaterThan(32_328);
    // Temporada e episodio voltaram em 2026-09-22 pelo portao de conteudo. O
    // teto fica acima do DOBRO da estimativa ponderada daquele dia (amostra de
    // 219 series: ~109 mil episodios, ~6,6 mil temporadas) — a cauda pesada de
    // series longas nao cabe numa amostra.
    expect(SITEMAP_TYPE_URL_CEILING.episodes).toBeGreaterThan(109_089 * 2);
    expect(SITEMAP_TYPE_URL_CEILING.seasons).toBeGreaterThan(6_643 * 2);
  });
});

describe("gate de pessoa no SQL — biografia exibivel e foto", () => {
  const fonte = readSourceWithoutComments(
    path.join(REPO_ROOT, "apps", "web", "src", "server", "seo", "sitemap-index.ts"),
  );

  it("(12) as DUAS consultas de pessoa (contagem e pagina) exigem foto e escolhem o piso pela biografia", () => {
    // Duas copias do WHERE: se so uma ganhar o gate, o index anuncia N shards
    // que a pagina nao consegue preencher. Desde 22/09/2026 (D2) a biografia nao
    // e mais um AND: ela so baixa o piso de obras no indice para 1 — sem ela, a
    // filmografia sustenta a pagina a partir de MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY.
    for (const predicado of [
      "AND BTRIM(COALESCE(p.profile_path, '')) <> ''",
      "WHEN BTRIM(COALESCE(p.biography, '')) <> ''",
      "AND p.biography_source_status::text IN ('official','licensed','third_party')",
      "ELSE ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}",
    ]) {
      expect(fonte.split(predicado).length - 1, predicado).toBe(2);
    }
    // A biografia como AND solto seria a regra antiga — que barrava todo mundo.
    expect(fonte).not.toContain("\n        AND BTRIM(COALESCE(p.biography, '')) <> ''");
  });

  it("(13) a licenca da bio nao pode ser esquecida: texto sem status liberado nao conta (invariante 6)", () => {
    expect(fonte).not.toContain("biography_source_status::text IN ('unknown'");
  });
});
