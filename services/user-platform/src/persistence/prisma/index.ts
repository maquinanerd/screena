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
export type {
  PrismaCatalogExecutor,
  PrismaExecutor,
  PrismaExportExecutor,
  PrismaLibraryExecutor,
} from "./executor.js";
export { UnmappableRowError } from "./mappers.js";
export { createPrismaSessionStore } from "./session-store.js";
export { createPrismaAuthTokenStore } from "./auth-token-store.js";
export { createPrismaAuthThrottleStore } from "./auth-throttle-store.js";

// C7D — perfil, consentimento, pedidos LGPD, auditoria, ciclo de vida da conta
// e leitura de exportacao.
export { createPrismaUserProfileStore } from "./profile-store.js";
export { createPrismaConsentStore } from "./consent-store.js";
export { createPrismaDataRequestStore } from "./data-request-store.js";
export { createPrismaAuthAuditStore } from "./auth-audit-store.js";
export { createPrismaAccountLifecycleStore } from "./account-lifecycle-store.js";
export { createPrismaExportReadStore } from "./export-read-store.js";

// C8 — biblioteca pessoal: watch state, progresso, diario, listas, itens,
// notas, importacao, leitura de catalogo e purga de encerramento.
export { createPrismaUserWatchStateStore } from "./watch-state-store.js";
export {
  createPrismaEpisodeProgressStore,
  EPISODE_BULK_CHUNK_SIZE,
} from "./episode-progress-store.js";
export { createPrismaViewingEventStore } from "./viewing-event-store.js";
export { createPrismaUserListStore } from "./user-list-store.js";
export { createPrismaUserListItemStore } from "./user-list-item-store.js";
export { createPrismaUserRatingStore } from "./user-rating-store.js";
export { createPrismaImportJobStore } from "./import-job-store.js";
export { createPrismaCatalogReadStore } from "./catalog-read-store.js";
export { createPrismaProductContentPurgeStore } from "./product-content-purge-store.js";
export { createEntityProbe, createEpisodeProbe } from "./catalog-probes.js";
