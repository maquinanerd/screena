/**
 * Barrel do provedor Brevo (Backend C, C7C).
 *
 * Este e o UNICO ponto do repositorio autorizado a conhecer a Brevo. Nenhum
 * dominio puro, nenhuma camada de persistencia e nenhum handler HTTP importa
 * daqui — so a composicao de runtime (`auth-runtime/composition.ts`), que
 * entrega o resultado ja atras do port `TransactionalEmailProvider`.
 */

export {
  BREVO_DEFAULT_TIMEOUT_MS,
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  categorizeBrevoStatus,
  createBrevoTransactionalEmailProvider,
  readBrevoMessageId,
  type BrevoTransactionalEmailProviderConfig,
  type FetchLike,
} from "./transactional-email.js";
