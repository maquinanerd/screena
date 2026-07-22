/**
 * Barrel dos ADAPTERS Prisma da user platform (Backend C, C7B1).
 *
 * Este e o UNICO diretorio da user platform autorizado a conhecer o Prisma. O
 * barrel de `persistence/` (um nivel acima) permanece deliberadamente livre de
 * driver: quem precisa apenas dos CONTRATOS (dominio, testes, futuras
 * implementacoes alternativas) importa de la sem arrastar o client junto.
 *
 * Nao ha composicao de runtime aqui: nenhum `PrismaClient` e criado, nenhuma
 * conexao e aberta e nenhuma transacao e iniciada. Montar identidade +
 * credencial na mesma transacao de cadastro e C7C.
 *
 * REGRA DA CAMADA (C7B1.1): CONFLITO ESPERADO NAO PODE ENVENENAR UMA TRANSACAO
 * INTERATIVA. Nenhum adapter daqui usa excecao como fluxo normal — resultados
 * previstos pelo contrato saem de operacoes nao-abortivas
 * (`ON CONFLICT DO NOTHING`, `updateMany` com pre-imagem, sondas de existencia).
 * Excecao que chega aqui e falha de verdade e sobe intacta.
 */

export { createPrismaIdentityStore } from "./identity-store.js";
export { createPrismaPasswordCredentialStore } from "./password-credential-store.js";
export type { PrismaExecutor } from "./executor.js";
export { UnmappableRowError } from "./mappers.js";
export { createPrismaSessionStore } from "./session-store.js";
export { createPrismaAuthTokenStore } from "./auth-token-store.js";
export { createPrismaAuthThrottleStore } from "./auth-throttle-store.js";
