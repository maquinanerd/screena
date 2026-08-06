/**
 * projection-failure.ts — Falha de projecao CLASSIFICADA.
 *
 * O worker ja distingue falha retentavel de permanente (`SafeError`, em
 * `bin/project-editorial.ts`), mas a persistencia — que vive em `src/` — nao
 * tinha como emitir essa distincao: qualquer coisa que ela lancasse chegava ao
 * worker como "falha nao classificada", perdia o motivo e ia para a outbox com
 * uma mensagem generica.
 *
 * Esta classe fecha esse buraco sem `src/` depender de `bin/`. Ela e
 * estruturalmente compativel com `SafeError`: `code`, `message` e `retryable`.
 */
export class ProjectionFailure extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, retryable: boolean) {
    super(message)
    this.name = 'ProjectionFailure'
    this.code = code
    this.retryable = retryable
  }
}

/**
 * Reconhecimento ESTRUTURAL, nao por `instanceof`.
 *
 * O worker e a persistencia podem ser carregados por caminhos de modulo
 * diferentes (tsx, bundle, `deps.inline` do vitest), e nesse caso existem duas
 * classes com o mesmo nome e `instanceof` devolve `false` — a falha voltaria a
 * ser "nao classificada" exatamente nos ambientes em que isso e mais dificil de
 * perceber.
 */
export function isClassifiedFailure(
  error: unknown,
): error is { code: string; message: string; retryable: boolean } {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown }
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  )
}
