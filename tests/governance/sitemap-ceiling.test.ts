/**
 * Governanca: O TETO DO SITEMAP E O GATE POR DECISAO.
 *
 * O QUE ESTE ARQUIVO PROVA. Que o construtor REAL do sitemap, executado contra
 * um conjunto de dados, produz uma SAIDA com: zero episodio, zero temporada,
 * cada tipo abaixo do SEU teto declarado (por tipo desde 2026-09-11), e— a mudanca desta leva — **nenhuma entidade
 * sem linha em `page_indexability_decisions`**.
 *
 * POR QUE NAO E UM TESTE DE TEXTO. O modo de falha assinatura deste projeto e
 * sucesso medido em proxy: guarda textual que casa com o proprio comentario,
 * validador que morre e reporta PASS, painel verde com a fila parada. Um teste
 * que fizesse `grep` por "COALESCE" na fonte passaria com o gate desligado. Aqui
 * nada e lido da fonte: `getSitemapIndexXml`/`getSitemapShardXml` sao chamados de
 * verdade, os shards anunciados sao buscados um a um, e as afirmacoes sao sobre
 * as URLs que sairam.
 *
 * COMO O BANCO FALSO NAO FALSIFICA O RESULTADO. `FakeDb` nao "sabe" a resposta:
 * ele guarda LINHAS e avalia o predicado de decisao pelo PARAMETRO que a
 * consulta manda. A regra nova passa `'index'`/`'noindex'` como o valor de uma
 * decisao AUSENTE; o fake le esse parametro e aplica `decisao ?? default ===
 * 'index'`. Se alguem devolver a clausula antiga (`NOT EXISTS ... <> 'index'`),
 * o parametro simplesmente nao existe — e o fake cai na semantica LEGADA
 * (ausente = entra), que e literalmente o que aquele SQL significa. O teste
 * entao reprova pela SAIDA, dizendo que entidade sem decisao entrou. Nao ha
 * caminho em que o fake conserte o defeito por conta propria: qualquer forma que
 * ele nao reconheca cai no legado permissivo, que reprova.
 *
 * ESCOPO. Este arquivo isola tres coisas: teto, valvula (tipo suspenso) e gate
 * por decisao — inclusive o ARMAR do gate. Os gates ESTRUTURAIS (titulo vazio,
 * biografia, foto, piso de galeria) sao de `sitemap-person-eligibility.test.ts` e
 * do validador real de Postgres; o conjunto aqui os satisfaz de proposito, para
 * que a unica variavel sob teste seja a decisao.
 */

import { describe, expect, it, vi } from "vitest";

import {
  SITEMAP_DECISION_GATE_MIN_ROWS,
  SITEMAP_TYPE_URL_CEILING,
  SUSPENDED_SITEMAP_TYPES,
  getSitemapIndexXml,
  getSitemapShardXml,
  isDecisionGateArmed,
} from "../../apps/web/src/server/seo/sitemap-index";

// ---------------------------------------------------------------------------
// Conjunto de dados falso
// ---------------------------------------------------------------------------

type Decision = "index" | "noindex" | null;

interface Entity {
  readonly id: number;
  readonly slug: string;
  /** `null` = SEM linha em page_indexability_decisions (o caso que importa). */
  readonly decision: Decision;
  /** Para pessoa: a decisao do FILME em que ela e creditada. */
  readonly creditDecision?: Decision;
  /** Tem galeria acima do piso? (so filme/serie) */
  readonly gallery?: boolean;
}

/** Monta N entidades com a distribuicao de decisoes pedida. */
function build(
  prefix: string,
  firstId: number,
  spec: { index: number; noindex: number; missing: number },
  extra: (i: number) => Partial<Entity> = () => ({}),
): Entity[] {
  const out: Entity[] = [];
  let id = firstId;
  const push = (decision: Decision) => {
    out.push({ id, slug: `${prefix}-${id}`, decision, ...extra(out.length) });
    id += 1;
  };
  for (let i = 0; i < spec.index; i += 1) push("index");
  for (let i = 0; i < spec.noindex; i += 1) push("noindex");
  for (let i = 0; i < spec.missing; i += 1) push(null);
  return out;
}

interface DataSet {
  readonly movies: readonly Entity[];
  readonly series: readonly Entity[];
  readonly people: readonly Entity[];
  readonly seasons: readonly Entity[];
  readonly episodes: readonly Entity[];
  readonly news: number;
}

/**
 * O conjunto padrao. Volume DE PROPOSITO alto em episodio e temporada: sao
 * 96,36% do sitemap medido em producao, e um teste que os representasse com tres
 * linhas nao provaria nada sobre o volume que causou o incidente.
 *
 * As contagens de decisao ficam acima de {@link SITEMAP_DECISION_GATE_MIN_ROWS}
 * porque o gate so ARMA com prova suficiente — um conjunto de dez linhas cairia
 * no modo desarmado e o teste mediria o comportamento antigo sem perceber.
 */
function dataset(): DataSet {
  return {
    // 1.200 index + 800 noindex + 1.000 SEM linha
    movies: build("filme", 1_000, { index: 1_200, noindex: 800, missing: 1_000 }, (i) => ({
      gallery: i % 2 === 0,
    })),
    // 1.100 index + 500 noindex + 400 SEM linha
    series: build("serie", 20_000, { index: 1_100, noindex: 500, missing: 400 }, (i) => ({
      gallery: i % 2 === 0,
    })),
    // 1.050 index + 200 noindex + 250 SEM linha; todas creditadas em obra `index`
    people: build("pessoa", 40_000, { index: 1_050, noindex: 200, missing: 250 }, () => ({
      creditDecision: "index" as Decision,
    })),
    seasons: build("temporada", 60_000, { index: 4_000, noindex: 500, missing: 500 }),
    episodes: build("episodio", 100_000, { index: 40_000, noindex: 10_000, missing: 10_000 }),
    news: 7,
  };
}

// ---------------------------------------------------------------------------
// Banco falso — guarda LINHAS, avalia o predicado pelo PARAMETRO da consulta
// ---------------------------------------------------------------------------

/** Os defaults de decisao ausente que a consulta mandou, na ordem. */
function absentParams(values: readonly unknown[]): ("index" | "noindex")[] {
  return values.filter((v) => v === "index" || v === "noindex") as ("index" | "noindex")[];
}

/**
 * A entidade entra?
 *
 * `absent === null` significa que a consulta NAO mandou default nenhum — ou seja,
 * voltou para a clausula legada `NOT EXISTS (... decision <> 'index')`, cujo
 * significado exato e "ausente entra". Nao ha atalho: o fake evita a resposta
 * certa por conta propria e reprova pela saida.
 */
function passes(decision: Decision, absent: "index" | "noindex" | null): boolean {
  const efetiva = decision ?? (absent ?? "index");
  return efetiva === "index";
}

interface Query {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class FakeDb {
  constructor(private readonly data: DataSet) {}

  /** Registro das formas de gate vistas — o teste inspeciona para diagnostico. */
  readonly seen: string[] = [];

  private coverage(): { entity_type: string; n: number }[] {
    const count = (rows: readonly Entity[]) => rows.filter((r) => r.decision !== null).length;
    return [
      { entity_type: "movie", n: count(this.data.movies) },
      { entity_type: "tv", n: count(this.data.series) },
      { entity_type: "person", n: count(this.data.people) },
      { entity_type: "season", n: count(this.data.seasons) },
      { entity_type: "episode", n: count(this.data.episodes) },
    ];
  }

  /** As entidades ELEGIVEIS daquele tipo, ja com o gate de decisao aplicado. */
  private eligible(kind: string, values: readonly unknown[]): Entity[] {
    const defaults = absentParams(values);
    if (kind === "people") {
      // [movie, tv, person] desde 22/09/2026: a obra (filme OU serie) entra numa
      // unica subconsulta, com um CASE para o default do tipo dela; o ultimo e o
      // da propria pessoa. Vazio no legado.
      if (defaults.length !== 3 && defaults.length !== 0) {
        throw new Error(
          `consulta de pessoa com ${defaults.length} defaults de decisao — forma nao reconhecida`,
        );
      }
      const daObra = defaults.length === 3 ? (defaults[0] ?? null) : null;
      const propria = defaults.length === 3 ? (defaults[2] ?? null) : null;
      this.seen.push(`people:${propria ?? "legado"}`);
      return this.data.people.filter(
        (p) => passes(p.creditDecision ?? null, daObra) && passes(p.decision, propria),
      );
    }
    const absent = defaults.length > 0 ? (defaults[defaults.length - 1] ?? null) : null;
    this.seen.push(`${kind}:${absent ?? "legado"}`);
    const rows =
      kind === "movies"
        ? this.data.movies
        : kind === "series"
          ? this.data.series
          : kind === "seasons"
            ? this.data.seasons
            : this.data.episodes;
    return rows.filter((r) => passes(r.decision, absent));
  }

  /** Galerias elegiveis: dono com galeria acima do piso E dono indexavel. */
  private galleries(values: readonly unknown[]): Entity[] {
    const defaults = absentParams(values);
    if (defaults.length !== 2 && defaults.length !== 0) {
      throw new Error(
        `consulta de galeria com ${defaults.length} defaults de decisao — forma nao reconhecida`,
      );
    }
    const daFilme = defaults.length === 2 ? (defaults[0] ?? null) : null;
    const daSerie = defaults.length === 2 ? (defaults[1] ?? null) : null;
    this.seen.push(`galeria:${daFilme ?? "legado"}`);
    return [
      ...this.data.movies.filter((m) => m.gallery === true && passes(m.decision, daFilme)),
      ...this.data.series.filter((s) => s.gallery === true && passes(s.decision, daSerie)),
    ];
  }

  private answer(q: Query): unknown[] {
    const sql = q.sql;
    // A consulta de cobertura: lista fixa de tipos via VALUES, com a contagem
    // SATURADA no piso (ver `readDecisionCoverage`). O fake devolve a contagem
    // real do conjunto — saturar ou nao nao muda o veredito do `>=`.
    if (sql.includes("AS t(entity_type)")) return this.coverage();

    const isCount = sql.includes("COUNT(*)::int AS n");
    const slice = (rows: Entity[]) => {
      const nums = q.values.filter((v) => typeof v === "number") as number[];
      // [.., limit, offset] — a paginacao e sempre os DOIS ultimos numericos.
      const offset = nums.length >= 2 ? (nums[nums.length - 1] ?? 0) : 0;
      const limit = nums.length >= 2 ? (nums[nums.length - 2] ?? rows.length) : rows.length;
      return rows.slice(offset, offset + limit);
    };

    if (sql.includes("AS galerias")) {
      const rows = this.galleries(q.values);
      if (isCount) return [{ n: rows.length, maxmod: null }];
      return slice(rows).map((r) => ({
        vertical: r.slug.startsWith("filme") ? "filmes" : "series",
        slug: r.slug,
        lastmod: null,
      }));
    }
    if (sql.includes("FROM article_translations")) {
      const rows = Array.from({ length: this.data.news }, (_, i) => ({
        slug: `noticia-${i}`,
        lastmod: null,
      }));
      return isCount ? [{ n: rows.length, maxmod: null }] : slice(rows as never);
    }

    const kind = sql.includes("JOIN movies m ON m.id = s.entity_id")
      ? "movies"
      : sql.includes("JOIN tv_shows t ON t.id = s.entity_id")
        ? "series"
        : sql.includes("JOIN people p ON p.id = s.entity_id")
          ? "people"
          : sql.includes("FROM seasons se")
            ? "seasons"
            : sql.includes("FROM episodes e")
              ? "episodes"
              : null;
    if (kind === null) throw new Error(`consulta nao reconhecida pelo fake: ${sql.slice(0, 120)}`);

    const rows = this.eligible(kind, q.values);
    if (isCount) return [{ n: rows.length, maxmod: null }];
    if (kind === "seasons") {
      return slice(rows).map((r) => ({ series_slug: r.slug, season_number: 1, lastmod: null }));
    }
    if (kind === "episodes") {
      return slice(rows).map((r) => ({
        series_slug: r.slug,
        season_number: 1,
        episode_number: 1,
        lastmod: null,
      }));
    }
    return slice(rows).map((r) => ({ slug: r.slug, lastmod: null }));
  }

  asPrisma(): never {
    const responder = (q: Query): unknown[] => this.answer(q);
    return {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) =>
        responder({ sql: strings.join(" ? "), values }),
      $queryRawUnsafe: async (sql: string, ...values: unknown[]) => responder({ sql, values }),
    } as never;
  }
}

// ---------------------------------------------------------------------------
// Execucao do construtor REAL: index -> shards -> URLs por tipo
// ---------------------------------------------------------------------------

const LIMIT = 500;

function locsOf(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
}

/** Classifica uma URL publica pelo SEGMENTO da rota (nao pelo nome do shard). */
function typeOfUrl(url: string): string {
  if (/\/episodios\//.test(url)) return "episodios";
  if (/\/temporadas\//.test(url)) return "temporadas";
  if (/\/imagens\/$/.test(url)) return "imagens";
  if (/\/videos\/$/.test(url)) return "videos";
  if (/\/pt\/filmes\/[^/]+\/$/.test(url)) return "filmes";
  if (/\/pt\/series\/[^/]+\/$/.test(url)) return "series";
  if (/\/pt\/pessoas\/[^/]+\/$/.test(url)) return "pessoas";
  if (/\/pt\/noticias\/[^/]+\/$/.test(url)) return "noticias";
  return "estatica";
}

interface Saida {
  readonly shards: number;
  readonly total: number;
  readonly byType: Record<string, number>;
  readonly urls: readonly string[];
}

/** Roda o sitemap INTEIRO (index + cada shard anunciado) e devolve a SAIDA. */
async function buildSitemap(db: FakeDb): Promise<Saida> {
  const prisma = db.asPrisma();
  const index = await getSitemapIndexXml({ limit: LIMIT }, prisma);
  const shardUrls = locsOf(index.xml);
  const urls: string[] = [];
  for (const shardUrl of shardUrls) {
    const id = shardUrl.slice(shardUrl.lastIndexOf("/") + 1);
    const shard = await getSitemapShardXml(id, { limit: LIMIT }, prisma);
    if (shard === null) continue;
    urls.push(...locsOf(shard.xml));
  }
  const byType: Record<string, number> = {};
  for (const u of urls) byType[typeOfUrl(u)] = (byType[typeOfUrl(u)] ?? 0) + 1;
  return { shards: shardUrls.length, total: urls.length, byType, urls };
}

// ---------------------------------------------------------------------------

describe("sitemap: o gate por decisao — sem linha, fora do sitemap", () => {
  it("(1) entidade SEM decisao vigente NAO aparece na saida", async () => {
    // Este e o coracao da mudanca. Antes, `NOT EXISTS (... <> 'index')` fazia a
    // linha ausente ENTRAR — e como a tabela nunca foi escrita, o site indexava
    // por omissao. Voltar aquela clausula faz este caso reprovar.
    const saida = await buildSitemap(new FakeDb(dataset()));
    expect(saida.byType["filmes"]).toBe(1_200); // 1.200 index; os 1.000 sem linha ficam fora
    expect(saida.byType["series"]).toBe(1_100);
    expect(saida.byType["pessoas"]).toBe(1_050);
  });

  it("(2) entidade com decisao vigente `noindex` tambem fica fora", async () => {
    const saida = await buildSitemap(new FakeDb(dataset()));
    // 1.200 index + 800 noindex + 1.000 ausentes = 3.000 filmes no conjunto.
    expect(saida.byType["filmes"]).toBeLessThan(3_000);
    expect(saida.urls.some((u) => u.includes("/filmes/filme-2200/"))).toBe(false);
  });

  it("(3) NENHUMA galeria sai no sitemap — nem a de dono indexavel (decisao do dono D1)", async () => {
    // Ate 2026-09-11 a galeria herdava a decisao do dono. Desde a decisao D1 ela
    // nao entra de jeito nenhum: 69.016 URLs sem conteudo proprio, 42,7% do
    // sitemap. O conjunto tem galeria em METADE dos filmes e series INDEXAVEIS —
    // se o tipo voltasse a publicar, este caso reprovaria pela saida, e nao por
    // leitura de fonte.
    const saida = await buildSitemap(new FakeDb(dataset()));
    expect(saida.byType["imagens"] ?? 0).toBe(0);
    expect(saida.byType["videos"] ?? 0).toBe(0);
    expect(saida.urls.some((u) => /\/(imagens|videos)\/$/.test(u))).toBe(false);
  });

  it("(4) DESARMADO (poucas decisoes) o sitemap NAO despenca — a entidade sem linha continua entrando", async () => {
    // A rede de seguranca. Se o codigo invertido subir antes de o produtor rodar
    // contra producao, a tabela esta vazia e a inversao levaria o sitemap a zero.
    // Abaixo do piso o gate fica inerte e o comportamento antigo vale.
    const base = dataset();
    const poucos: DataSet = {
      ...base,
      movies: build("filme", 1_000, { index: 5, noindex: 3, missing: 1_000 }),
      series: build("serie", 20_000, { index: 4, noindex: 2, missing: 400 }),
      people: build("pessoa", 40_000, { index: 3, noindex: 1, missing: 250 }, () => ({
        creditDecision: "index" as Decision,
      })),
      seasons: build("temporada", 60_000, { index: 2, noindex: 0, missing: 500 }),
      episodes: build("episodio", 100_000, { index: 2, noindex: 0, missing: 10_000 }),
    };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const saida = await buildSitemap(new FakeDb(poucos));
      // 5 index + 1.000 ausentes entram; so os 3 `noindex` explicitos saem.
      expect(saida.byType["filmes"]).toBe(1_005);
      const log = erro.mock.calls.flat().map(String).join(" ");
      expect(log).toContain("gate de decisao DESARMADO");
    } finally {
      erro.mockRestore();
    }
  });

  it("(5) o piso que arma o gate e uma constante declarada, nao um numero solto", () => {
    expect(SITEMAP_DECISION_GATE_MIN_ROWS).toBeGreaterThanOrEqual(1_000);
    expect(isDecisionGateArmed({ movie: 999, tv: 0, person: 0, season: 0, episode: 0 }, "movie")).toBe(false);
    expect(isDecisionGateArmed({ movie: 1_000, tv: 0, person: 0, season: 0, episode: 0 }, "movie")).toBe(true);
  });
});

describe("sitemap: temporada e episodio voltam pela DECISAO (valvula vazia desde 22/09/2026)", () => {
  it("(6) so as de decisao `index` saem: 4.000 temporadas e 40.000 episodios, nenhuma sem linha", async () => {
    // Ate 22/09/2026 este caso provava a valvula: zero temporada e zero
    // episodio. O dono pediu a saida por dado; o portao de CONTEUDO vive no SQL
    // (e e provado no validador real), e aqui se prova a outra metade — o gate
    // por decisao, que continua tirando quem nao tem linha com o tipo armado.
    const dados = dataset();
    const saida = await buildSitemap(new FakeDb(dados));
    expect(saida.byType["temporadas"] ?? 0).toBe(4_000);
    expect(saida.byType["episodios"] ?? 0).toBe(40_000);
  });

  it("(7) os shards dos dois tipos voltam ao index, e a valvula esta VAZIA", async () => {
    // Os nomes sao LITERAIS de proposito (a mesma licao de antes): derivar da
    // propria lista faria o teste passar vazio.
    const prisma = new FakeDb(dataset()).asPrisma();
    const index = await getSitemapIndexXml({ limit: LIMIT }, prisma);
    expect(index.xml).toContain("-episodes-");
    expect(index.xml).toContain("-seasons-");
    expect([...SUSPENDED_SITEMAP_TYPES]).toEqual([]);
  });
});

describe("sitemap: o teto declarado", () => {
  it("(8) cada tipo da saida real fica abaixo do SEU teto", async () => {
    const saida = await buildSitemap(new FakeDb(dataset()));
    // Segmento da rota -> nome do tipo do shard.
    const tipoDoSegmento: Record<string, keyof typeof SITEMAP_TYPE_URL_CEILING> = {
      filmes: "movies",
      series: "series",
      pessoas: "people",
      noticias: "news",
      imagens: "imagens",
      videos: "videos",
      temporadas: "seasons",
      episodios: "episodes",
    };
    for (const [segmento, n] of Object.entries(saida.byType)) {
      const tipo = tipoDoSegmento[segmento];
      if (tipo === undefined) continue; // estatica: fora do teto por tipo
      expect(n, `${segmento}`).toBeLessThanOrEqual(SITEMAP_TYPE_URL_CEILING[tipo]);
    }
    expect(saida.total).toBeGreaterThan(1_000); // e nao despencou a zero
  });

  it("(9) estourar o teto de FILMES tira so filmes — series e pessoas continuam na saida", async () => {
    // O defeito que a auditoria de 11/09/2026 mediu, com filmes no papel de "o
    // tipo que cresceu sozinho". Com o teto GLOBAL antigo um conjunto assim
    // produzia um index VAZIO: os filmes arrastavam series, pessoas e noticias
    // para fora junto. O volume sai da CONSTANTE (teto + 1): quando o teto de
    // filme subiu (22/09/2026), um numero literal teria deixado de estourar e o
    // teste passaria a provar o contrario do que diz.
    const grande: DataSet = {
      ...dataset(),
      movies: build("filme", 1_000, {
        index: SITEMAP_TYPE_URL_CEILING.movies + 1,
        noindex: 0,
        missing: 0,
      }),
    };
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const saida = await buildSitemap(new FakeDb(grande));
      expect(saida.byType["filmes"] ?? 0).toBe(0);
      expect(saida.byType["series"]).toBe(1_100);
      expect(saida.byType["pessoas"]).toBe(1_050);
      const log = erro.mock.calls.flat().map(String).join(" ");
      expect(log).toContain("movies");
      expect(log).toContain(String(SITEMAP_TYPE_URL_CEILING.movies));
    } finally {
      erro.mockRestore();
    }
  });
});
