/**
 * security.ts — Diagnostico de SEGURANCA de acesso do admin. SERVER-ONLY,
 * SOMENTE LEITURA.
 *
 * Le apenas `process.env` (as env de acesso/ambiente) e devolve um STATUS
 * REDIGIDO, seguro para exibir na pagina interna de seguranca. NUNCA retorna
 * usuario, senha, `Authorization`, `DATABASE_URL`, token ou qualquer segredo:
 * so booleans/rotulos derivados e a presenca (nao o valor) de cada env.
 *
 * Motivo de existir (Fase 6C): manter a leitura das env sensiveis FORA do JSX/
 * das paginas em `apps/admin/app`. A pagina consome so a projecao redigida; a
 * unica superficie que toca `process.env.ADMIN_BASIC_AUTH_*` e este helper
 * server-only, que jamais devolve o valor. Nao chama nenhuma API externa, nao
 * toca o banco, nao escreve, nao publica.
 */

import {
  ADMIN_ACCESS_ENV_KEYS,
  getAdminAccessConfig,
  redactAdminAccessConfigForDisplay,
  type AdminAccessEnvKey,
  type RedactedAdminAccessConfig,
} from "../lib/access-protection";
import {
  getEditorialActionsStatus,
  type EditorialActionsStatus,
} from "./editorial-actions-status";

export interface AdminSecurityDiagnostics {
  /** Status redigido (sem segredo) para a pagina interna. */
  readonly config: RedactedAdminAccessConfig;
  /** Nomes das env vars necessarias (so nomes — nunca valores). */
  readonly requiredEnvKeys: readonly AdminAccessEnvKey[];
  /**
   * Status da feature flag de ESCRITA editorial (Fase 7A). So boolean/nome — a
   * flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` nao e secreta, mas seu valor nunca e
   * exibido; a pagina mostra apenas se as acoes estao habilitadas.
   */
  readonly editorialActions: EditorialActionsStatus;
}

/**
 * Monta o diagnostico redigido a partir de `process.env`. A leitura das env
 * sensiveis acontece SO aqui (server-only); o resultado nunca contem valor de
 * usuario/senha, apenas presenca (`true`/`false`) e status derivado.
 */
export function getAdminSecurityDiagnostics(): AdminSecurityDiagnostics {
  const config = getAdminAccessConfig({
    ADMIN_PROTECTION_ENABLED: process.env.ADMIN_PROTECTION_ENABLED,
    ADMIN_BASIC_AUTH_USER: process.env.ADMIN_BASIC_AUTH_USER,
    ADMIN_BASIC_AUTH_PASSWORD: process.env.ADMIN_BASIC_AUTH_PASSWORD,
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });

  return {
    config: redactAdminAccessConfigForDisplay(config),
    requiredEnvKeys: [...ADMIN_ACCESS_ENV_KEYS],
    editorialActions: getEditorialActionsStatus(),
  };
}
