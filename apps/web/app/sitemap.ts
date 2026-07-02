import type { MetadataRoute } from "next";

import { getSitemapEntries } from "../src/server/seo/sitemap-entries";

/**
 * sitemap.xml do app publico Screen (https://thescreen.media/sitemap.xml).
 *
 * Toda a decisao de inclusao vive no presenter puro `sitemap-presenter`
 * (mesmos gates de indexabilidade das paginas — sitemap e meta robots nunca
 * discordam) e a leitura do PostgreSQL na camada server-only
 * `src/server/seo/sitemap-entries` (invariantes 3/4: zero API externa, zero
 * Gemini; so banco local).
 *
 * Dinamico (server-rendered on demand): o build roda sem DATABASE_URL e nada
 * e pre-renderizado; a cada request o sitemap reflete o estado atual do banco.
 * Com o banco indisponivel, a camada server devolve apenas as rotas estaticas
 * publicas (fallback explicito e logado).
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = await getSitemapEntries();
  return entries.map((entry) => ({
    url: entry.url,
    ...(entry.lastModifiedIso !== null
      ? { lastModified: new Date(entry.lastModifiedIso) }
      : {}),
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));
}
