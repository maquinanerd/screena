/**
 * @screena/ui — Ponto de entrada da camada de apresentacao canonica.
 *
 * Reexporta os tokens de cor e a resolucao de vertical. Importe sempre a
 * partir de "@screena/ui", nunca dos modulos internos diretamente.
 *
 * Garantia central (invariante 11): resolveVertical sempre devolve label e
 * badge, para que a diferenciacao filme/serie/neutro nunca dependa so da cor.
 */

export * from "./tokens.js";
export * from "./vertical.js";
