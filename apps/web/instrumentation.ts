/**
 * instrumentation.ts — Gancho de SUBIDA do servidor Next do `screen-app`.
 *
 * O Next chama `register()` uma vez por instancia de servidor, antes da primeira
 * requisicao. Aqui ele liga UMA coisa: o sinal de vida com a impressao digital do
 * codigo (`src/server/service-heartbeat.ts`), que o painel operacional usa para
 * dizer qual commit este container roda.
 *
 * O `import()` dinamico DENTRO do `if` de `NEXT_RUNTIME` e o padrao documentado
 * do Next: no build do runtime edge o ramo inteiro some, e os modulos de Node
 * (`fs`, `crypto`, Prisma) nunca entram naquele pacote. Nada aqui roda no render.
 *
 * A condicao POSITIVA com o import dentro do bloco e obrigatoria, nao estilo. O
 * Next troca `process.env.NEXT_RUNTIME` por uma constante no build, e o webpack
 * so deixa de seguir o `import()` que esta num ramo de `if` constante-falso. Um
 * `return` antecipado seguido do import mantem o import vivo para o parser, e o
 * pacote edge (o do middleware) passa a exigir `node:fs`/`node:crypto` —
 * `UnhandledSchemeError` no `next build`, medido no admin em 2026-09-15.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWebServiceHeartbeat } = await import("./src/server/service-heartbeat");
    startWebServiceHeartbeat();
  }
}
