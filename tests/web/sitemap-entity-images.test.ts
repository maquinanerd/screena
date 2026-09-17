/**
 * sitemap-entity-images.test.ts — o shard de filmes e de series anuncia a arte
 * que a ficha exibe, sob a licenca que a ficha le, sem mudar contagem nem
 * consulta.
 *
 * Banco FALSO de proposito: o que se prova aqui e a FIACAO do shard — a licenca
 * lida uma vez por shard, as colunas de arte na mesma consulta paginada, a
 * licenca negada ou ilegivel tirando so a imagem. A paridade com a PAGINA, contra
 * PostgreSQL real, e provada em `validate:seo-runtime` (checks 49 a 54).
 */

import { describe, expect, it } from "vitest";

import { getSitemapShardXml } from "../../apps/web/src/server/seo/sitemap-index";

interface Ficha {
  readonly slug: string;
  readonly poster: string | null;
  readonly backdrop: string | null;
}

type LerLicencas = () => Promise<readonly object[]>;

const LICENCA_VIGENTE = {
  sourceKey: "tmdb",
  contentType: "image",
  licenseStatus: "official",
  displayAllowed: true,
  isCurrent: true,
};

const FILMES: readonly Ficha[] = [
  { slug: "com-arte", poster: "/poster1.jpg", backdrop: "/fundo1.jpg" },
  { slug: "sem-arte", poster: null, backdrop: null },
  { slug: "arte-malformada", poster: "https://outro.test/x.jpg", backdrop: "/com espaco.jpg" },
];
const SERIES: readonly Ficha[] = [
  { slug: "serie-com-arte", poster: "/poster2.jpg", backdrop: "/fundo2.jpg" },
];
// A coluna de arte vem preenchida de proposito: pessoa fica sem imagem pelo TIPO.
const PESSOAS: readonly Ficha[] = [{ slug: "pessoa", poster: "/retrato.jpg", backdrop: null }];

async function lerShard(id: string, lerLicencas: LerLicencas) {
  const consultas: string[] = [];
  let leiturasDeLicenca = 0;
  const client = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ? ");
      consultas.push(sql);
      if (sql.includes("AS t(entity_type)")) return [];
      const fichas = sql.includes("JOIN movies m ON m.id = s.entity_id")
        ? FILMES
        : sql.includes("JOIN tv_shows t ON t.id = s.entity_id")
          ? SERIES
          : sql.includes("JOIN people p ON p.id = s.entity_id")
            ? PESSOAS
            : null;
      if (fichas === null) throw new Error(`consulta nao reconhecida: ${sql.slice(0, 80)}`);
      if (sql.includes("COUNT(*)::int AS n")) return [{ n: fichas.length, maxmod: null }];
      return fichas.map((ficha) => ({
        slug: ficha.slug,
        lastmod: null,
        poster_path: ficha.poster,
        backdrop_path: ficha.backdrop,
      }));
    },
    sourceLicense: {
      findMany: async () => {
        leiturasDeLicenca += 1;
        return lerLicencas();
      },
    },
  };
  const resposta = await getSitemapShardXml(id, { limit: 500 }, client as never);
  return {
    servido: resposta !== null,
    xml: resposta?.xml ?? "",
    consultas,
    leiturasDeLicenca,
  };
}

/** O conteudo do `<url>` cuja `<loc>` termina no caminho, ou "". */
function urlDe(xml: string, caminho: string): string {
  return (
    xml
      .split("<url>")
      .slice(1)
      .map((parte) => parte.slice(0, parte.indexOf("</url>")))
      .find((bloco) => bloco.includes(`${caminho}</loc>`)) ?? ""
  );
}

const imagensDe = (bloco: string): string[] =>
  Array.from(bloco.matchAll(/<image:loc>([^<]*)<\/image:loc>/g), (m) => m[1] ?? "");
const locsDe = (xml: string): string[] =>
  Array.from(xml.matchAll(/<loc>([^<]*)<\/loc>/g), (m) => m[1] ?? "");

const licenciado: LerLicencas = async () => [LICENCA_VIGENTE];

describe("imagem no shard de filmes e de series", () => {
  it("(1) com licenca: poster w500 e backdrop w1280 na ficha com arte; nada na sem arte nem na malformada", async () => {
    const shard = await lerShard("sitemap-pt-BR-movies-1.xml", licenciado);
    expect(shard.servido).toBe(true);
    expect(imagensDe(urlDe(shard.xml, "/pt/filmes/com-arte/"))).toEqual([
      "https://image.tmdb.org/t/p/w500/poster1.jpg",
      "https://image.tmdb.org/t/p/w1280/fundo1.jpg",
    ]);
    expect(urlDe(shard.xml, "/pt/filmes/sem-arte/")).not.toBe("");
    expect(imagensDe(urlDe(shard.xml, "/pt/filmes/sem-arte/"))).toEqual([]);
    expect(urlDe(shard.xml, "/pt/filmes/arte-malformada/")).not.toBe("");
    expect(imagensDe(urlDe(shard.xml, "/pt/filmes/arte-malformada/"))).toEqual([]);
    expect(shard.leiturasDeLicenca).toBe(1);
  });

  it("(2) sem licenca: nenhuma imagem nem namespace, e as MESMAS URLs", async () => {
    const com = await lerShard("sitemap-pt-BR-movies-1.xml", licenciado);
    const sem = await lerShard("sitemap-pt-BR-movies-1.xml", async () => []);
    expect(sem.servido).toBe(true);
    expect(sem.xml).not.toContain("<image:");
    expect(sem.xml).not.toContain("xmlns:image");
    expect(locsDe(sem.xml)).toHaveLength(FILMES.length);
    expect(locsDe(sem.xml)).toEqual(locsDe(com.xml));
  });

  it("(3) licenca vigente com display_allowed=false: nenhuma imagem", async () => {
    const shard = await lerShard("sitemap-pt-BR-movies-1.xml", async () => [
      { ...LICENCA_VIGENTE, displayAllowed: false },
    ]);
    expect(shard.servido).toBe(true);
    expect(shard.xml).not.toContain("<image:");
  });

  it("(4) licenca ilegivel: a imagem sai e a URL fica — a arte nao derruba o shard", async () => {
    const com = await lerShard("sitemap-pt-BR-movies-1.xml", licenciado);
    const quebrada = await lerShard("sitemap-pt-BR-movies-1.xml", async () => {
      throw new Error("conexao perdida");
    });
    expect(quebrada.servido).toBe(true);
    expect(quebrada.xml).not.toContain("<image:");
    expect(locsDe(quebrada.xml)).toEqual(locsDe(com.xml));
  });

  it("(5) serie: a mesma regra, com a arte da serie", async () => {
    const shard = await lerShard("sitemap-pt-BR-series-1.xml", licenciado);
    expect(imagensDe(urlDe(shard.xml, "/pt/series/serie-com-arte/"))).toEqual([
      "https://image.tmdb.org/t/p/w500/poster2.jpg",
      "https://image.tmdb.org/t/p/w1280/fundo2.jpg",
    ]);
    expect(shard.leiturasDeLicenca).toBe(1);
  });

  it("(6) pessoa: nao le licenca e nao ganha imagem", async () => {
    const shard = await lerShard("sitemap-pt-BR-people-1.xml", licenciado);
    expect(shard.servido).toBe(true);
    expect(shard.xml).not.toContain("<image:");
    expect(shard.leiturasDeLicenca).toBe(0);
  });

  it("(7) a arte vem na MESMA consulta paginada, e nenhuma consulta por linha", async () => {
    const shard = await lerShard("sitemap-pt-BR-movies-1.xml", licenciado);
    const paginas = shard.consultas.filter(
      (sql) => sql.includes("JOIN movies m ON m.id = s.entity_id") && !sql.includes("COUNT(*)"),
    );
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toContain("m.poster_path AS poster_path, m.backdrop_path AS backdrop_path");
    expect(paginas[0]).toMatch(/LIMIT\s+\?\s+OFFSET\s+\?/);
    // Cobertura + contagem + pagina: tres consultas, com 3 fichas ou com 50.000.
    expect(shard.consultas).toHaveLength(3);
  });
});
