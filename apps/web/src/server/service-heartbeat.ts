/**
 * service-heartbeat.ts — O SINAL DE VIDA do `screen-app`. SERVER-ONLY.
 *
 * ============================================================================
 * POR QUE O SITE PUBLICO GRAVA UMA LINHA POR MINUTO
 * ============================================================================
 * "O deploy subiu?" e a pergunta que o dono mais faz, e o `screen-app` e o
 * servico em que ela mais importa. Ate aqui a resposta era `CINERIE_BUILD_SHA`,
 * variavel estatica do EasyPanel que ficou 38 commits atrasada, e `/api/health/`
 * a repete. Este modulo grava em `service_heartbeats` a impressao digital do
 * codigo que ESTE container carregou (`@screena/db/service-heartbeat`), mais o
 * `.next/BUILD_ID` do build que ele serve.
 *
 * ============================================================================
 * FORA DO CAMINHO DE RENDER
 * ============================================================================
 * Nao e importado por pagina nenhuma. Quem o liga e `instrumentation.ts`, uma vez
 * por processo, na subida do servidor Node — nunca durante o render, nunca no
 * build (sem `DATABASE_URL` o build nao liga nada) e nunca no runtime edge. Uma
 * falha de escrita vira log `warn` e o site segue: o sinal de vida nao pode
 * derrubar o que ele observa.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  startServiceHeartbeat,
  type ServiceHeartbeatHandle,
} from "@screena/db/service-heartbeat";

/**
 * As credenciais cuja PRESENCA o painel mostra para o `screen-app`. So o nome,
 * se esta preenchida e o formato saem daqui — nunca o valor.
 *
 * A chave do provedor de e-mail fica DE FORA de proposito: o app publico nao pode
 * citar variavel do Brevo em lugar nenhum (fronteira travada pelo caso 9 do
 * `boundary.test.ts` do runtime de auth da plataforma de usuarios). Quem conhece
 * essa chave e o runtime de auth, nao o site.
 *
 * O caminho daquele teste NAO e escrito por extenso aqui de proposito: a guarda de
 * privacidade (`tests/governance/user-platform-privacy.test.ts`, caso 8) varre o
 * TEXTO de `apps/web` atras do nome do pacote, e um comentario que o citasse
 * poria este modulo — que nao importa a plataforma — na lista de importadores.
 */
export const WEB_CREDENTIAL_ENV_NAMES = [
  "DATABASE_URL",
  "CINERIE_IP_HASH_SALT",
  "CINERIE_CATALOG_RESOLVE_API_KEYS",
] as const;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Ligar o sinal de vida neste processo?
 *
 * Nao liga no BUILD (`NEXT_PHASE`), nao liga sem banco, e o dono pode desligar
 * com `CINERIE_HEARTBEAT_DISABLED=true` — os validadores que medem linha lida por
 * requisicao desligam para que um sinal de minuto nao entre na conta.
 */
export function shouldStartWebHeartbeat(env: Env): boolean {
  if ((env.DATABASE_URL ?? "").trim() === "") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return (env.CINERIE_HEARTBEAT_DISABLED ?? "").trim().toLowerCase() !== "true";
}

const globalScope = globalThis as { __cinerieWebHeartbeat?: ServiceHeartbeatHandle };

/** Liga o sinal de vida (uma vez por processo). `null` quando nao se aplica. */
export function startWebServiceHeartbeat(env: Env = process.env): ServiceHeartbeatHandle | null {
  if (!shouldStartWebHeartbeat(env)) return null;
  if (globalScope.__cinerieWebHeartbeat !== undefined) return globalScope.__cinerieWebHeartbeat;
  const handle = startServiceHeartbeat({
    db: getPrismaClient(),
    serviceKey: env.CINERIE_SERVICE_KEY?.trim() || "screen-app",
    buildIdFile: "apps/web/.next/BUILD_ID",
    credentialEnvNames: WEB_CREDENTIAL_ENV_NAMES,
    env,
    log: (level, event, fields) => {
      const line = JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() });
      if (level === "warn") console.warn(line);
      else console.log(line);
    },
  });
  globalScope.__cinerieWebHeartbeat = handle;
  return handle;
}
