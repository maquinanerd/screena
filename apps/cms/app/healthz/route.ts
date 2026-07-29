/**
 * GET /healthz — LIVENESS do CMS.
 *
 * Responde "o processo esta vivo" e nada mais. NAO toca banco, NAO le
 * configuracao, NAO consulta storage.
 *
 * A separacao de `/readyz` e deliberada: se a liveness dependesse do banco, uma
 * queda do PostgreSQL faria o orquestrador REINICIAR em loop um container
 * perfeitamente saudavel — e reiniciar nao devolve o banco.
 *
 * Fora da rota `(payload)` de proposito: e uma rota da aplicacao, nao da API do
 * CMS, e nao deve exigir autenticacao nem passar pelo handler do Payload.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET(): Response {
  return Response.json(
    { status: 'ok', service: 'cinerie-cms', timestamp: new Date().toISOString() },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}
