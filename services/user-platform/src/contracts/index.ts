/**
 * Barrel raiz de contratos (Backend C).
 *
 * Reexporta SOMENTE o barrel PUBLICO-SEGURO. Importar de `@screena/user-platform`
 * contracts pela raiz nunca entrega tipo sensivel: a entrega de segredos vive
 * apenas em `contracts/internal.js`, importada explicitamente pela futura
 * camada de transporte. Essa fronteira e travada por contract-boundary.test.ts.
 */

export * from "./public.js";
