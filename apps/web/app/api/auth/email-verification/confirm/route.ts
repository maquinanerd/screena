/**
 * POST /api/auth/email-verification/confirm — Confirmacao da verificacao de e-mail: consome o token de uso unico e
 * carimba a identidade, somente se a conta for elegivel.
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
  return runAuthEndpoint((handlers) => handlers.confirmEmailVerification, request);
}
