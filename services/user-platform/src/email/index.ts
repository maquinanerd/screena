/**
 * Barrel do modulo de E-MAIL TRANSACIONAL (Backend C, C7C).
 *
 * Tudo aqui e PURO e agnostico de fornecedor: o port, os templates versionados
 * em codigo e a montagem dos links. Nenhum arquivo deste diretorio conhece
 * Brevo, endpoint, header de autenticacao ou formato de resposta de terceiro —
 * isso vive so em `providers/brevo/`.
 */

export * from "./types.js";
export * from "./links.js";
export * from "./templates.js";
