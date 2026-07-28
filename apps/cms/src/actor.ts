/**
 * actor.ts — Ponte entre o `req.user` do Payload e o `Actor` das regras puras.
 *
 * Vive em modulo proprio porque tanto `collections.ts` quanto `hooks/articles.ts`
 * precisam dele, e os hooks sao registrados dentro das collections: manter a
 * funcao em `collections.ts` criaria um ciclo de import.
 */

import { EDITORIAL_ROLES, type EditorialRole } from './workflow.js'
import type { Actor } from './access.js'

interface PayloadUserLike {
  readonly id?: unknown
  readonly collection?: unknown
  readonly role?: unknown
  readonly active?: unknown
}

function isEditorialRole(value: unknown): value is EditorialRole {
  return typeof value === 'string' && (EDITORIAL_ROLES as readonly string[]).includes(value)
}

/**
 * Resolve quem esta agindo.
 *
 * FAIL-CLOSED: qualquer coisa que nao seja um usuario reconhecido vira
 * `anonymous`, e `anonymous` nao passa em nenhuma politica. Conta tecnica
 * INATIVA tambem cai para `anonymous` — desativar uma service account precisa
 * revogar o acesso de fato, e nao so escondê-la do painel.
 */
export function toActor(user: unknown): Actor {
  if (user === null || typeof user !== 'object') return { kind: 'anonymous' }
  const candidate = user as PayloadUserLike
  const id = typeof candidate.id === 'string' ? candidate.id : String(candidate.id ?? '')
  if (id === '' || id === 'undefined' || id === 'null') return { kind: 'anonymous' }

  if (candidate.collection === 'service-accounts') {
    if (candidate.active !== true) return { kind: 'anonymous' }
    return { kind: 'service', id }
  }

  if (candidate.collection === 'editorial-users') {
    if (candidate.active === false) return { kind: 'anonymous' }
    if (isEditorialRole(candidate.role)) return { kind: 'human', id, role: candidate.role }
  }

  return { kind: 'anonymous' }
}
