/**
 * editorial-actions-status.ts — Status da feature flag de acoes editoriais.
 * SERVER-ONLY, SOMENTE LEITURA.
 *
 * Le `process.env.ADMIN_EDITORIAL_ACTIONS_ENABLED` e devolve so um boolean
 * (`enabled`) e a presenca da env (`present`) — nunca um segredo (a flag nao e
 * secreta, mas mantemos a leitura de env FORA do JSX, no padrao do projeto).
 * Existe separado de `editorial-actions.ts` porque aquele arquivo e `"use server"`
 * e so pode exportar Server Actions async; este exporta um helper sincrono comum.
 *
 * NUNCA escreve, NUNCA publica, NUNCA chama API externa.
 */

import {
  EDITORIAL_ACTIONS_ENV_KEY,
  isEditorialActionsEnabled,
} from "../lib/editorial-action-policy";

export interface EditorialActionsStatus {
  /** `true` so quando a flag e exatamente `"true"`. */
  readonly enabled: boolean;
  /** `true` se a env esta definida (nao vazia), independente do valor. */
  readonly present: boolean;
  /** Nome da env (so o nome — nunca o valor). */
  readonly envKey: typeof EDITORIAL_ACTIONS_ENV_KEY;
}

/** Le a flag de acoes editoriais e devolve o status derivado (sem valor sensivel). */
export function getEditorialActionsStatus(): EditorialActionsStatus {
  const raw = process.env.ADMIN_EDITORIAL_ACTIONS_ENABLED;
  return {
    enabled: isEditorialActionsEnabled({ ADMIN_EDITORIAL_ACTIONS_ENABLED: raw }),
    present: typeof raw === "string" && raw.trim() !== "",
    envKey: EDITORIAL_ACTIONS_ENV_KEY,
  };
}
