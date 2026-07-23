/**
 * POST /api/auth/password-reset/request — Pedido de recuperacao de senha. Responde SEMPRE 202 com o mesmo corpo
 * generico, exista ou nao a conta (anti-enumeracao).
 *
 * Arquivo DELEGADOR de proposito: toda a regra vive em
 * `@screena/user-platform` (borda HTTP transport-agnostic), que roda sob a
 * suite de testes do monorepo. `apps/web` nao e coberto pelo vitest, entao
 * qualquer logica escrita aqui nasceria sem teste.
 *
 * Runtime Node (o fluxo usa node:crypto e PostgreSQL) e dinamico (mutacao
 * jamais pode ser cacheada). Somente POST: `GET` nao existe neste modulo, e o
 * proprio handler recusa qualquer outro metodo com 405.
 */

import { runAuthEndpoint } from "../../../../../src/server/auth/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return runAuthEndpoint((handlers) => handlers.requestPasswordReset, request);
}
