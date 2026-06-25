/**
 * @screena/seo — Ponto de entrada do gate anti-thin e da decisao de indexabilidade.
 *
 * Reexporta a lista canonica de blocos de valor e a logica de indexabilidade.
 * Importe sempre a partir de "@screena/seo", nunca dos modulos internos.
 *
 * Tudo aqui e puro e determinista: sem rede, banco, IO, Date ou Math.random.
 */

export * from "./value-blocks.js";
export * from "./indexability.js";
