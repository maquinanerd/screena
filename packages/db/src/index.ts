/**
 * @screena/db — Camada de dados da Screena.
 *
 * Exporta os dados de semente tipados (puros, sem IO) usados pelo runner de
 * seed e pelos testes de governanca. O Prisma Client e gerado em
 * node_modules/@prisma/client a partir de prisma/schema.prisma e e usado
 * apenas server-side/admin/worker — NUNCA no render publico (invariantes 3/4).
 *
 * Regra: workers escrevem, web le. Nenhum client de DB ou API externa no
 * caminho de render de pagina indexavel.
 */

export * from "./seed-data.js";
export * from "./language-vocabulary.js";
