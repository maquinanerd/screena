'use client'

/**
 * Leitura CLIENT-ONLY do token CSRF para o double submit (C7D).
 *
 * O cookie de CSRF NAO e `HttpOnly` de proposito: o cliente precisa le-lo para
 * reapresenta-lo no cabecalho `X-CSRF-Token`. Este helper faz so isso — le o
 * cookie e monta o cabecalho. O cookie de SESSAO continua `HttpOnly` e nunca e
 * alcancado por este codigo.
 *
 * Tenta os dois nomes (com e sem prefixo `__Host-`) porque o prefixo depende do
 * ambiente, e o cliente nao sabe em qual esta rodando.
 */

const CSRF_COOKIE_NAMES = ['__Host-cinerie_csrf', 'cinerie_csrf'] as const

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const cookies = document.cookie.split(';')
  for (const name of CSRF_COOKIE_NAMES) {
    for (const part of cookies) {
      const trimmed = part.trim()
      const eq = trimmed.indexOf('=')
      if (eq > 0 && trimmed.slice(0, eq) === name) {
        const value = trimmed.slice(eq + 1)
        if (value.length > 0) return value
      }
    }
  }
  return null
}

/**
 * `fetch` autenticado com CSRF. Anexa o cabecalho em TODA mutacao; sem o token
 * o servidor responde 403 (fail-closed), entao um cliente sem cookie de CSRF
 * simplesmente nao consegue mutar — que e o comportamento correto.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const csrf = readCsrfToken()
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (csrf !== null) {
    headers.set('x-csrf-token', csrf)
  }
  return fetch(input, { ...init, headers, credentials: 'same-origin' })
}
