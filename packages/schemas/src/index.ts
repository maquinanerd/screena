/**
 * @screena/schemas — Ponto de entrada do pacote de validacao.
 *
 * Reexporta a validacao de ratings (integridade fonte/escala/provider/label)
 * e a validacao da saida do Entity Writer (forma, tipos e anti-alucinacao
 * contra payload controlado). Importe sempre a partir de "@screena/schemas",
 * nunca dos modulos internos diretamente.
 */

export * from "./ratings.js";
export * from "./entity-writer-output.js";
