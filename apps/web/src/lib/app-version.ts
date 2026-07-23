/**
 * app-version.ts — versão rastreável da imagem/servidor em execução. PURO:
 * apenas leitura de `process.env`, sem rede/DB/IO.
 *
 * Os valores são injetados no build (Dockerfile `ARG` -> `ENV`) e ficam
 * disponiveis em runtime para o endpoint de health. Sem eles (dev local, build
 * sem args), resolvem para `"unknown"` — nunca lançam nem inventam um SHA.
 */

export interface AppVersion {
  /** SHA do commit buildado (curto ou longo), ou "unknown". */
  readonly commit: string;
  /** Rótulo de versão/tag da imagem, ou "unknown". */
  readonly version: string;
  /** Timestamp ISO de build, ou "unknown". */
  readonly builtAt: string;
}

function readOr(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key];
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim();
  return value.length === 0 ? "unknown" : value;
}

export function getAppVersion(env: NodeJS.ProcessEnv = process.env): AppVersion {
  return {
    commit: readOr(env, "CINERIE_BUILD_SHA"),
    version: readOr(env, "CINERIE_BUILD_VERSION"),
    builtAt: readOr(env, "CINERIE_BUILD_TIME"),
  };
}
