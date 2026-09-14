/**
 * seo-audit.ts — auditoria de SEO POR FORA, reutilizável.
 *
 * Por que existe: a auditoria de 11/09/2026 foi feita à mão, com 109
 * requisições ao vivo. O que ela achou não pode voltar em silêncio, e teste de
 * unidade não pega regressão de SEO — porque o que quebra é o HTML SERVIDO, não
 * a função pura. Este script pede as páginas de verdade e lê o que saiu.
 *
 * Ele NÃO importa nada do repositório de propósito: se importasse os presenters,
 * provaria que o código concorda consigo mesmo. O valor está em ser um leitor
 * externo, igual ao Googlebot.
 *
 * Uso:
 *   pnpm --filter @screena/web seo:audit                    # produção
 *   SEO_AUDIT_BASE=http://127.0.0.1:3000 pnpm ... seo:audit # build local
 *   SEO_AUDIT_SAMPLE=3 ...                                  # amostra por tipo
 *
 * Saída: relatório legível + código de saída != 0 quando houver violação
 * CRÍTICA. Aviso (WARN) não derruba a execução; violação, sim.
 */

const BASE = (process.env["SEO_AUDIT_BASE"] ?? "https://cinerie.com").replace(/\/$/, "");
const SAMPLE_PER_TYPE = Number(process.env["SEO_AUDIT_SAMPLE"] ?? "2");
const TIMEOUT_MS = Number(process.env["SEO_AUDIT_TIMEOUT_MS"] ?? "30000");
const UA =
  process.env["SEO_AUDIT_UA"] ??
  "Mozilla/5.0 (compatible; CinerieSeoAudit/1.0; +https://cinerie.com)";

/** Severidade. `fail` derruba o processo; `warn` só aparece no relatório. */
type Severity = "fail" | "warn";

interface Finding {
  readonly severity: Severity;
  readonly url: string;
  readonly check: string;
  readonly detail: string;
}

const findings: Finding[] = [];
let checksRun = 0;

function record(severity: Severity, url: string, check: string, detail: string): void {
  findings.push({ severity, url, check, detail });
}

/** Afirma; registra a violação quando falsa. Devolve o próprio booleano. */
function expect(
  ok: boolean,
  severity: Severity,
  url: string,
  check: string,
  detail: string,
): boolean {
  checksRun += 1;
  if (!ok) record(severity, url, check, detail);
  return ok;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

interface Fetched {
  readonly url: string;
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly redirected: boolean;
  readonly finalUrl: string;
}

async function get(url: string, redirect: RequestRedirect = "follow"): Promise<Fetched | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect,
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
    });
    const body = await response.text();
    return {
      url,
      status: response.status,
      headers: response.headers,
      body,
      redirected: response.redirected,
      finalUrl: response.url,
    };
  } catch (error) {
    record("fail", url, "fetch", `requisição falhou: ${(error as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Extração de HTML
//
// Regex, e de propósito: acrescentar um parser de DOM aqui trocaria uma
// dependência nova por precisão que este script não precisa — ele procura tags
// de <head>, que são planas. Onde a regex é frágil (JSON-LD), o conteúdo é
// entregue ao JSON.parse, que é o juiz real.
// ---------------------------------------------------------------------------

function meta(html: string, name: string): string | null {
  const byName = new RegExp(
    `<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (byName) return byName[1] ?? null;
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*name=["']${name}["']`,
    "i",
  ).exec(html);
  return contentFirst?.[1] ?? null;
}

function property(html: string, prop: string): string | null {
  const direct = new RegExp(
    `<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (direct) return direct[1] ?? null;
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${prop}["']`,
    "i",
  ).exec(html);
  return contentFirst?.[1] ?? null;
}

function linkHref(html: string, rel: string): string | null {
  const direct = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*href=["']([^"']*)["']`, "i").exec(
    html,
  );
  if (direct) return direct[1] ?? null;
  const hrefFirst = new RegExp(`<link[^>]+href=["']([^"']*)["'][^>]*rel=["']${rel}["']`, "i").exec(
    html,
  );
  return hrefFirst?.[1] ?? null;
}

function title(html: string): string | null {
  return /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
}

function htmlLang(html: string): string | null {
  return /<html[^>]+lang=["']([^"']*)["']/i.exec(html)?.[1] ?? null;
}

function h1s(html: string): string[] {
  return [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map((m) => m[0]);
}

function imgsWithoutAlt(html: string): number {
  return [...html.matchAll(/<img\b[^>]*>/gi)].filter((m) => !/\balt=/i.test(m[0])).length;
}

function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const raw = match[1];
    if (raw === undefined) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch (error) {
      blocks.push({ __parseError: (error as Error).message, __raw: raw.slice(0, 200) });
    }
  }
  return blocks;
}

/** Achata `@graph` para que o tipo seja procurado num nível só. */
function flattenLd(blocks: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (value === null || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    out.push(node);
    if ("@graph" in node) push(node["@graph"]);
  };
  blocks.forEach(push);
  return out;
}

function ldTypes(nodes: Record<string, unknown>[]): string[] {
  return nodes.flatMap((node) => {
    const type = node["@type"];
    if (typeof type === "string") return [type];
    if (Array.isArray(type)) return type.filter((t): t is string => typeof t === "string");
    return [];
  });
}

function absolute(href: string): string {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return href;
  }
}

/** Compara URLs ignorando barra final — a diferença não é semântica aqui. */
function sameUrl(a: string, b: string): boolean {
  const norm = (value: string): string => value.replace(/\/$/, "").toLowerCase();
  return norm(absolute(a)) === norm(absolute(b));
}

// ---------------------------------------------------------------------------
// Contrato de uma página
// ---------------------------------------------------------------------------

interface PageExpectation {
  /** Rótulo do tipo, para o relatório. */
  readonly kind: string;
  /** `index` exige presença no sitemap; `noindex` exige ausência. */
  readonly indexability: "index" | "noindex";
  /** Schema.org obrigatório na página. */
  readonly schema?: string;
  /** Exige BreadcrumbList. */
  readonly breadcrumb?: boolean;
  /** Exige og:image (superfície compartilhável). */
  readonly ogImage?: boolean;
}

async function auditPage(path: string, contract: PageExpectation): Promise<void> {
  const url = `${BASE}${path}`;
  const page = await get(url);
  if (page === null) return;

  const { body, status } = page;

  if (!expect(status === 200, "fail", url, "http", `esperado 200, veio ${status}`)) return;

  // --- Cabeça ---------------------------------------------------------------
  const pageTitle = title(body);
  expect(pageTitle !== null && pageTitle.length > 0, "fail", url, "title", "sem <title>");
  if (pageTitle !== null) {
    expect(
      pageTitle.length <= 70,
      "warn",
      url,
      "title-comprimento",
      `${pageTitle.length} caracteres: "${pageTitle}"`,
    );
  }

  const description = meta(body, "description");
  expect(
    description !== null && description.trim().length > 0,
    contract.indexability === "index" ? "fail" : "warn",
    url,
    "meta-description",
    "ausente ou vazia",
  );

  const lang = htmlLang(body);
  expect(lang === "pt-BR", "fail", url, "html-lang", `lang="${lang ?? "ausente"}"`);

  const headings = h1s(body);
  expect(headings.length === 1, "fail", url, "h1", `${headings.length} elementos <h1>`);

  const semAlt = imgsWithoutAlt(body);
  expect(semAlt === 0, "fail", url, "img-alt", `${semAlt} <img> sem atributo alt`);

  // --- Robots ---------------------------------------------------------------
  const robots = (meta(body, "robots") ?? "").toLowerCase();
  const temNoindex = /\bnoindex\b/.test(robots);
  if (contract.indexability === "index") {
    expect(!temNoindex, "fail", url, "robots", `deveria indexar, veio "${robots}"`);
    expect(
      /\bmax-image-preview:large\b/.test(robots),
      "warn",
      url,
      "max-image-preview",
      `ausente em página indexável (robots="${robots}")`,
    );
  } else {
    expect(temNoindex, "fail", url, "robots", `deveria ser noindex, veio "${robots || "ausente"}"`);
    expect(
      /\bfollow\b/.test(robots) && !/\bnofollow\b/.test(robots),
      "warn",
      url,
      "robots-follow",
      `noindex deveria manter follow: "${robots}"`,
    );
  }

  // --- Canonical ------------------------------------------------------------
  const canonical = linkHref(body, "canonical");
  if (expect(canonical !== null, "fail", url, "canonical", "ausente")) {
    expect(
      sameUrl(canonical as string, url),
      "fail",
      url,
      "canonical-autorreferente",
      `aponta para ${canonical}`,
    );
    expect(
      (canonical as string).startsWith("http"),
      "fail",
      url,
      "canonical-absoluto",
      `relativo: ${canonical}`,
    );
  }

  // --- Open Graph -----------------------------------------------------------
  const ogUrl = property(body, "og:url");
  const ogTitle = property(body, "og:title");
  const ogImage = property(body, "og:image");
  const ogLocale = property(body, "og:locale");
  const twCard = meta(body, "twitter:card") ?? property(body, "twitter:card");
  const twImage = meta(body, "twitter:image") ?? property(body, "twitter:image");

  expect(ogTitle !== null, "fail", url, "og:title", "ausente");
  if (expect(ogUrl !== null, "fail", url, "og:url", "ausente") && canonical !== null) {
    expect(
      sameUrl(ogUrl as string, canonical),
      "fail",
      url,
      "og:url=canonical",
      `og:url ${ogUrl} != canonical ${canonical}`,
    );
  }
  if (ogLocale !== null) {
    expect(
      ogLocale === "pt_BR",
      "fail",
      url,
      "og:locale",
      `"${ogLocale}" — o formato do Open Graph usa sublinhado (pt_BR)`,
    );
  }
  if (contract.ogImage === true) {
    expect(ogImage !== null, "fail", url, "og:image", "superfície compartilhável sem imagem");
    expect(twImage !== null, "fail", url, "twitter:image", "ausente");
    expect(
      twCard === "summary_large_image",
      "fail",
      url,
      "twitter:card",
      `"${twCard ?? "ausente"}" com imagem disponível`,
    );
  }

  // --- JSON-LD --------------------------------------------------------------
  const blocks = jsonLdBlocks(body);
  const nodes = flattenLd(blocks);
  const comErroDeParse = nodes.filter((n) => "__parseError" in n);
  expect(
    comErroDeParse.length === 0,
    "fail",
    url,
    "jsonld-parse",
    comErroDeParse.map((n) => String(n["__parseError"])).join(" · "),
  );

  const types = ldTypes(nodes);
  if (contract.schema !== undefined) {
    expect(
      types.includes(contract.schema),
      "fail",
      url,
      "jsonld-tipo",
      `esperado ${contract.schema}; presentes: ${types.join(", ") || "nenhum"}`,
    );
  }
  if (contract.breadcrumb === true) {
    expect(types.includes("BreadcrumbList"), "fail", url, "breadcrumb", "BreadcrumbList ausente");
  }

  // INVARIANTE DO PROJETO: o Cinerie Score não vira nota de terceiro.
  const temAggregate = nodes.some((n) => "aggregateRating" in n) || types.includes("AggregateRating");
  expect(
    !temAggregate,
    "fail",
    url,
    "aggregate-rating",
    "AggregateRating emitido — proibido (invariante do projeto)",
  );

  // Entidade indexável precisa de imagem no schema (obrigatória para Movie).
  if (contract.schema === "Movie" || contract.schema === "TVSeries") {
    const entidade = nodes.find((n) => ldTypes([n]).includes(contract.schema as string));
    expect(
      entidade !== undefined && "image" in entidade,
      "fail",
      url,
      "jsonld-image",
      `${contract.schema} sem propriedade image`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => (m[1] ?? "").trim());
}

interface SitemapSnapshot {
  readonly shards: string[];
  readonly urls: Set<string>;
  readonly porShard: Map<string, number>;
}

async function readSitemap(): Promise<SitemapSnapshot | null> {
  const index = await get(`${BASE}/sitemap.xml`);
  if (index === null) return null;
  if (!expect(index.status === 200, "fail", `${BASE}/sitemap.xml`, "http", `veio ${index.status}`)) {
    return null;
  }

  const shards = locs(index.body);
  expect(shards.length > 0, "fail", `${BASE}/sitemap.xml`, "sitemap-vazio", "índice sem shards");

  const urls = new Set<string>();
  const porShard = new Map<string, number>();
  for (const shard of shards) {
    const doc = await get(shard);
    if (doc === null) continue;
    if (!expect(doc.status === 200, "fail", shard, "http", `shard veio ${doc.status}`)) continue;
    const found = locs(doc.body);
    porShard.set(shard, found.length);
    expect(found.length <= 50_000, "fail", shard, "limite-50k", `${found.length} URLs`);
    for (const u of found) urls.add(u.replace(/\/$/, ""));
  }
  return { shards, urls, porShard };
}

// ---------------------------------------------------------------------------
// Superfícies de infraestrutura
// ---------------------------------------------------------------------------

async function auditInfra(): Promise<void> {
  // Favicon: precisa responder 200 e NÃO pode ser HTML.
  const favicon = await get(`${BASE}/favicon.ico`);
  if (favicon !== null) {
    expect(favicon.status === 200, "fail", `${BASE}/favicon.ico`, "favicon", `veio ${favicon.status}`);
    const tipo = favicon.headers.get("content-type") ?? "";
    expect(
      !tipo.includes("text/html"),
      "fail",
      `${BASE}/favicon.ico`,
      "favicon-tipo",
      `content-type ${tipo} — 404 devolvendo HTML`,
    );
  }

  // Raiz: um salto, e 308 enquanto só pt publica.
  const raiz = await get(`${BASE}/`, "manual");
  if (raiz !== null) {
    expect(
      raiz.status === 308 || raiz.status === 200,
      "fail",
      `${BASE}/`,
      "raiz",
      `esperado 308 (ou 200 se a raiz servir conteúdo), veio ${raiz.status}`,
    );
    if (raiz.status === 307) {
      record("fail", `${BASE}/`, "raiz-307", "307 é temporário; a política publica só pt-BR");
    }
  }

  // robots.txt: um grupo `User-agent: *` do lado do app.
  const robots = await get(`${BASE}/robots.txt`);
  if (robots !== null && robots.status === 200) {
    const grupos = [...robots.body.matchAll(/^user-agent:\s*\*\s*$/gim)].length;
    expect(
      grupos <= 1,
      "warn",
      `${BASE}/robots.txt`,
      "robots-grupo-duplicado",
      `${grupos} grupos "User-agent: *" — o Google une, um parser ingênuo não`,
    );
    expect(
      /sitemap:/i.test(robots.body),
      "fail",
      `${BASE}/robots.txt`,
      "robots-sitemap",
      "sem diretiva Sitemap:",
    );
  }

  // 404 de verdade, em pt-BR, com H1.
  const inexistente = await get(`${BASE}/pt/filmes/esta-url-nao-existe-auditoria-seo/`);
  if (inexistente !== null) {
    expect(
      inexistente.status === 404,
      "fail",
      inexistente.url,
      "404-status",
      `veio ${inexistente.status}`,
    );
    expect(htmlLang(inexistente.body) === "pt-BR", "fail", inexistente.url, "404-lang", "sem lang pt-BR");
    expect(h1s(inexistente.body).length >= 1, "fail", inexistente.url, "404-h1", "sem H1");
    expect(
      linkHref(inexistente.body, "canonical") === null,
      "fail",
      inexistente.url,
      "404-canonical",
      "404 não pode emitir canonical",
    );
    expect(
      !/This page could not be found/i.test(inexistente.body),
      "fail",
      inexistente.url,
      "404-idioma",
      "texto padrão do Next, em inglês",
    );
  }
}

// ---------------------------------------------------------------------------
// Amostragem a partir do próprio sitemap
// ---------------------------------------------------------------------------

function sample(urls: Set<string>, pattern: RegExp, n: number): string[] {
  const out: string[] = [];
  for (const url of urls) {
    if (pattern.test(url)) out.push(url);
    if (out.length >= n) break;
  }
  return out;
}

async function main(): Promise<void> {
  const inicio = Date.now();
  process.stdout.write(`\nAUDITORIA DE SEO — ${BASE}\n${"=".repeat(60)}\n\n`);

  await auditInfra();

  const sitemap = await readSitemap();

  // Superfícies fixas.
  const fixas: Array<[string, PageExpectation]> = [
    ["/pt/", { kind: "home", indexability: "index", ogImage: true }],
    ["/pt/filmes/", { kind: "lista-filmes", indexability: "index", breadcrumb: true }],
    ["/pt/series/", { kind: "lista-series", indexability: "index", breadcrumb: true }],
    ["/pt/noticias/", { kind: "lista-noticias", indexability: "index", breadcrumb: true }],
  ];
  for (const [path, contract] of fixas) await auditPage(path, contract);

  // Amostras vindas do sitemap: o que está listado tem de responder 200 e indexar.
  if (sitemap !== null) {
    const grupos: Array<[RegExp, PageExpectation]> = [
      [
        /\/pt\/filmes\/[^/]+$/,
        { kind: "filme", indexability: "index", schema: "Movie", breadcrumb: true, ogImage: true },
      ],
      [
        /\/pt\/series\/[^/]+$/,
        {
          kind: "serie",
          indexability: "index",
          schema: "TVSeries",
          breadcrumb: true,
          ogImage: true,
        },
      ],
      [
        /\/pt\/pessoas\/[^/]+$/,
        { kind: "pessoa", indexability: "index", schema: "Person", breadcrumb: true },
      ],
      [
        /\/pt\/noticias\/[^/]+$/,
        {
          kind: "noticia",
          indexability: "index",
          schema: "NewsArticle",
          breadcrumb: true,
          ogImage: true,
        },
      ],
    ];
    for (const [pattern, contract] of grupos) {
      for (const url of sample(sitemap.urls, pattern, SAMPLE_PER_TYPE)) {
        await auditPage(url.replace(BASE, ""), contract);
      }
    }

    // O outro lado do contrato: o que é noindex NÃO pode estar no sitemap.
    const proibidos = [
      { rotulo: "galeria de imagens", pattern: /\/imagens\/?$/ },
      { rotulo: "galeria de vídeos", pattern: /\/videos\/?$/ },
      { rotulo: "temporada", pattern: /\/temporadas\/\d+\/?$/ },
      { rotulo: "episódio", pattern: /\/episodios\/\d+\/?$/ },
    ];
    for (const { rotulo, pattern } of proibidos) {
      const vazados = [...sitemap.urls].filter((u) => pattern.test(u));
      expect(
        vazados.length === 0,
        "fail",
        `${BASE}/sitemap.xml`,
        `sitemap-${rotulo.replace(/\s/g, "-")}`,
        `${vazados.length} URL(s) de ${rotulo} no sitemap; ex.: ${vazados[0] ?? "-"}`,
      );
    }
  }

  // --- Relatório ------------------------------------------------------------
  const falhas = findings.filter((f) => f.severity === "fail");
  const avisos = findings.filter((f) => f.severity === "warn");

  if (sitemap !== null) {
    process.stdout.write(`SITEMAP: ${sitemap.shards.length} shards, ${sitemap.urls.size} URLs\n`);
    for (const [shard, n] of sitemap.porShard) {
      process.stdout.write(`  ${n.toString().padStart(7)}  ${shard.replace(BASE, "")}\n`);
    }
    process.stdout.write("\n");
  }

  const imprimir = (rotulo: string, lista: Finding[]): void => {
    if (lista.length === 0) return;
    process.stdout.write(`${rotulo} (${lista.length})\n${"-".repeat(60)}\n`);
    for (const f of lista) {
      process.stdout.write(`  ${f.check}\n    ${f.url.replace(BASE, "") || "/"}\n    ${f.detail}\n`);
    }
    process.stdout.write("\n");
  };

  imprimir("VIOLAÇÕES", falhas);
  imprimir("AVISOS", avisos);

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  process.stdout.write(
    `${"=".repeat(60)}\n${checksRun} verificações em ${segundos}s — ` +
      `${falhas.length} violações, ${avisos.length} avisos\n`,
  );

  process.exit(falhas.length > 0 ? 1 : 0);
}

void main();
