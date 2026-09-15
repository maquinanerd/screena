/**
 * service-heartbeat.ts — O SINAL DE VIDA do `cinerie-admin`. SERVER-ONLY.
 *
 * Grava em `service_heartbeats` a impressao digital do codigo que ESTE processo
 * carregou e o `.next/BUILD_ID` do build servido — o mesmo metodo dos outros
 * servicos (`@screena/db/service-heartbeat`). E a unica escrita que o painel faz
 * por conta propria, e ela e sobre o proprio painel: nao toca catalogo, fila,
 * licenca nem usuario.
 *
 * Nao liga no build (`NEXT_PHASE`), nao liga sem banco e desliga com
 * `CINERIE_HEARTBEAT_DISABLED=true`. Falha de escrita vira log `warn` e o painel
 * segue: o sinal de vida nao pode derrubar o que ele observa.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  startServiceHeartbeat,
  type ServiceHeartbeatHandle,
} from "@screena/db/service-heartbeat";

/**
 * As variaveis cuja PRESENCA e formato o painel mostra para o proprio painel. So
 * o nome, se esta preenchida e o formato saem daqui — nunca o valor.
 */
export const ADMIN_CREDENTIAL_ENV_NAMES = [
  "DATABASE_URL",
  "ADMIN_BASIC_AUTH_USER",
  "ADMIN_BASIC_AUTH_PASSWORD",
  "ADMIN_OPERATOR_LABEL",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Ligar o sinal de vida neste processo? */
export function shouldStartAdminHeartbeat(env: Env): boolean {
  if ((env.DATABASE_URL ?? "").trim() === "") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return (env.CINERIE_HEARTBEAT_DISABLED ?? "").trim().toLowerCase() !== "true";
}

const globalScope = globalThis as { __cinerieAdminHeartbeat?: ServiceHeartbeatHandle };

/** Liga o sinal de vida (uma vez por processo). `null` quando nao se aplica. */
export function startAdminServiceHeartbeat(env: Env = process.env): ServiceHeartbeatHandle | null {
  if (!shouldStartAdminHeartbeat(env)) return null;
  if (globalScope.__cinerieAdminHeartbeat !== undefined) return globalScope.__cinerieAdminHeartbeat;
  const handle = startServiceHeartbeat({
    db: getPrismaClient(),
    serviceKey: env.CINERIE_SERVICE_KEY?.trim() || "cinerie-admin",
    buildIdFile: "apps/admin/.next/BUILD_ID",
    credentialEnvNames: ADMIN_CREDENTIAL_ENV_NAMES,
    env,
    log: (level, event, fields) => {
      const line = JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() });
      if (level === "warn") console.warn(line);
      else console.log(line);
    },
  });
  globalScope.__cinerieAdminHeartbeat = handle;
  return handle;
}
