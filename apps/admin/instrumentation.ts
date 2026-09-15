/**
 * instrumentation.ts — liga o SINAL DE VIDA do painel na subida do servidor Node.
 *
 * O painel mostra qual codigo cada servico roda; ele tambem e um servico, e o
 * dono precisa saber se o painel que esta olhando e o do ultimo deploy. Roda uma
 * vez por processo, so no runtime Node (nunca no edge do middleware) e nunca no
 * build. Detalhes em `src/server/ops/service-heartbeat.ts`.
 *
 * O import fica DENTRO do `if` positivo de proposito: o Next troca `NEXT_RUNTIME`
 * por constante no build e o webpack so abandona o `import()` de um ramo
 * constante-falso. Com `return` antecipado, o pacote edge do middleware tentava
 * embutir `node:fs`/`node:crypto` e o `next build` morria em
 * `UnhandledSchemeError` (medido em 2026-09-15).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAdminServiceHeartbeat } = await import("./src/server/ops/service-heartbeat");
    startAdminServiceHeartbeat();
  }
}
