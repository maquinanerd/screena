/**
 * sitemap-xml.ts — Renderizacao PURA de XML de sitemap (urlset) e sitemap-index.
 *
 * Prompt 3 (Fase 3, §5/§11): o sitemap index e os shards precisam servir XML
 * VALIDO, com URLs absolutas escapadas e Content-Type correto. Este modulo NAO
 * le banco nem decide o que entra (isso e do resolver/planner); apenas serializa
 * uma lista ja filtrada de URLs/shards em XML seguro.
 *
 * Escapa `&`, `<`, `>`, `"` e `'` para evitar XML quebrado/injecao a partir de
 * slugs ou titulos vindos do banco.
 *
 * PURO: sem rede, banco, IO, `Date` ou `Math.random`.
 */

/** Content-Type canonico das respostas de sitemap (index e shards). */
export const SITEMAP_CONTENT_TYPE = "application/xml; charset=utf-8";

/** Um `<url>` no urlset (ja com loc absoluta e filtrada). */
export interface SitemapXmlUrl {
  /** URL absoluta canonica (com barra final). */
  loc: string;
  /** ISO-8601 confiavel, ou null/omitido. */
  lastmod?: string | null;
  /** changefreq do protocolo (daily/weekly/...), ou null/omitido. */
  changefreq?: string | null;
  /** prioridade 0..1, ou null/omitido. */
  priority?: number | null;
}

/** Uma entrada `<sitemap>` do sitemap-index (aponta para um shard). */
export interface SitemapIndexXmlEntry {
  /** URL absoluta do arquivo de shard. */
  loc: string;
  /** ISO-8601 confiavel do shard, ou null/omitido. */
  lastmod?: string | null;
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Escapa texto para conteudo/atributo XML seguro. */
export function escapeXml(value: string): string {
  let out = "";
  for (const ch of value) {
    out += XML_ESCAPES[ch] ?? ch;
  }
  return out;
}

/** Normaliza priority para o formato do protocolo (0.0..1.0), ou null. */
function priorityString(priority: number | null | undefined): string | null {
  if (priority === null || priority === undefined || Number.isNaN(priority)) {
    return null;
  }
  const clamped = priority < 0 ? 0 : priority > 1 ? 1 : priority;
  return clamped.toFixed(1);
}

function trimmedOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Renderiza um `<urlset>` a partir das URLs ja filtradas (`includeInSitemap`).
 * Sempre XML valido, mesmo com lista vazia.
 */
export function renderUrlset(urls: readonly SitemapXmlUrl[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const url of urls) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(url.loc)}</loc>`);
    const lastmod = trimmedOrNull(url.lastmod);
    if (lastmod !== null) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
    const changefreq = trimmedOrNull(url.changefreq);
    if (changefreq !== null) {
      lines.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`);
    }
    const priority = priorityString(url.priority);
    if (priority !== null) lines.push(`    <priority>${priority}</priority>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

/**
 * Renderiza um `<sitemapindex>` a partir das entradas de shard. Sempre XML
 * valido, mesmo com lista vazia.
 */
export function renderSitemapIndex(
  entries: readonly SitemapIndexXmlEntry[],
): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <sitemap>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    const lastmod = trimmedOrNull(entry.lastmod);
    if (lastmod !== null) lines.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
    lines.push("  </sitemap>");
  }
  lines.push("</sitemapindex>");
  return `${lines.join("\n")}\n`;
}
