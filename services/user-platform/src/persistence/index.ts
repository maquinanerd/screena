/**
 * Barrel da camada de PERSISTENCIA da user platform (Backend C, C7A).
 *
 * Nesta unidade existem SOMENTE contratos e portas: nenhum adapter concreto,
 * nenhum PrismaClient, nenhum SQL, nenhum IO. Os repositories reais e a
 * composicao de runtime sao C7B/C7C.
 *
 * O package.json ja expoe este caminho como `@screena/user-platform/runtime`.
 */

export * from "./types.js";
export * from "./ports.js";
