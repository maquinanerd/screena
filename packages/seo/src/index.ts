/**
 * @screena/seo — Ponto de entrada da decisao de indexabilidade/SEO.
 *
 * FONTE UNICA (Prompt 3): `resolvePageSeo` em `resolver.js` centraliza a decisao
 * consumida por metadata, sitemap, canonical e validadores. Os demais modulos
 * sao adaptadores/utilitarios ao redor dela (indexability, json-ld, redirects,
 * sitemap-plan, value-blocks, entity-schema, language-index-guard).
 *
 * Importe sempre a partir de "@screena/seo", nunca dos modulos internos.
 * Tudo aqui e puro e determinista: sem rede, banco, IO, Date ou Math.random.
 */

export * from "./resolver.js";
export * from "./value-blocks.js";
export * from "./indexability.js";
export * from "./language-index-guard.js";
export * from "./entity-schema.js";
export * from "./json-ld.js";
export * from "./redirects.js";
export * from "./sitemap-plan.js";
export * from "./sitemap-xml.js";
