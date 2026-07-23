/**
 * runtime-env.ts — sinais de ambiente de execução do app publico. PURO: sem
 * rede, DB ou IO; apenas leitura de `process.env`.
 */

/**
 * `true` quando o app roda em runtime de PRODUCAO.
 *
 * Base: `NODE_ENV === "production"`, que o `next build`/`next start` definem no
 * bundle de producao. Usado para esconder superficies tecnicas (ex.: a rota
 * `/dev/*`) do usuario final, sem depender de nenhuma env extra de deploy.
 */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}
