/**
 * redirect-lookup.ts — Leitura SERVER-ONLY dos REDIRECTS PERSISTIDOS (Fase 3, §10).
 *
 * Le a tabela `redirects` do PostgreSQL, classifica cada linha
 * (permanent/temporary/alias/framework) e resolve a CADEIA a partir de um path,
 * colapsando A -> ... -> destino final com deteccao de LOOP e teto de saltos —
 * reusando os cores puros de `@screena/seo` (classifyRedirect /
 * resolveRedirectChain / MAX_REDIRECT_HOPS).
 *
 * Status HTTP honra o valor persistido: 1 salto usa o `status_code` da linha
 * (301/302/307/308); cadeia colapsada usa 301 (permanente) ou 302 (se algum
 * salto e temporario). Destino DEVE ser interno (comeca com "/") — sem
 * open-redirect.
 *
 * Invariantes 3/4: so PostgreSQL local; nunca API externa. FAIL-CLOSED: qualquer
 * falha de banco, ciclo, cadeia longa ou destino invalido => SEM redirect (o
 * request segue o fluxo normal). Cache em memoria com TTL curto evita reler a
 * tabela a cada request.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  classifyRedirect,
  MAX_REDIRECT_HOPS,
  resolveRedirectChain,
  type ClassifiedRedirect,
} from "@screena/seo";

export type RedirectLookupStatus = "none" | "resolved" | "loop" | "too-long";

export interface RedirectLookupResult {
  status: RedirectLookupStatus;
  /** Destino final interno (path), ou null quando nao ha redirect valido. */
  location: string | null;
  /** Status HTTP a emitir (301/302/307/308), ou null. */
  statusCode: number | null;
}

/** TTL do cache em memoria do indice de redirects (ms). */
const CACHE_TTL_MS = 30_000;

interface CachedIndex {
  index: Map<string, ClassifiedRedirect>;
  expiresAt: number;
}

let cache: CachedIndex | null = null;

/** Limpa o cache do indice (usado por testes/validadores para determinismo). */
export function clearRedirectCache(): void {
  cache = null;
}

async function loadIndex(nowMs: number): Promise<Map<string, ClassifiedRedirect>> {
  if (cache !== null && cache.expiresAt > nowMs) return cache.index;
  const prisma = getPrismaClient();
  const rows = await prisma.redirect.findMany({
    select: { fromPath: true, toPath: true, statusCode: true, reason: true },
  });
  const index = new Map<string, ClassifiedRedirect>();
  for (const row of rows) {
    const classified = classifyRedirect({
      fromPath: row.fromPath,
      toPath: row.toPath,
      statusCode: row.statusCode,
      reason: row.reason,
    });
    index.set(classified.fromPath, classified);
  }
  cache = { index, expiresAt: nowMs + CACHE_TTL_MS };
  return index;
}

/**
 * Resolve o redirect persistido para `fromPath`. Retorna a resolucao final
 * (destino + status) ou `none`/`loop`/`too-long` (nenhum redirect emitido).
 * FAIL-CLOSED em falha de banco.
 */
export async function lookupRedirect(
  fromPath: string,
  nowMs: number = Date.now(),
): Promise<RedirectLookupResult> {
  let index: Map<string, ClassifiedRedirect>;
  try {
    index = await loadIndex(nowMs);
  } catch (error) {
    console.error(
      "[redirect] falha ao ler a tabela redirects; fail-closed (sem redirect):",
      error,
    );
    return { status: "none", location: null, statusCode: null };
  }

  const resolution = resolveRedirectChain(index, fromPath, MAX_REDIRECT_HOPS);
  if (resolution.status !== "resolved" || resolution.finalPath === null) {
    // none / loop / too-long: nao redireciona (fail-closed contra ciclo/cadeia).
    return { status: resolution.status, location: null, statusCode: null };
  }

  // Sem open-redirect: destino final deve ser interno.
  if (!resolution.finalPath.startsWith("/")) {
    return { status: "none", location: null, statusCode: null };
  }

  // Honra o status persistido: 1 salto usa o status da propria linha; cadeia
  // colapsada usa 301 (permanente) ou 302 (se algum salto e temporario).
  const first = index.get(fromPath);
  const singleHop = resolution.hops.length === 2;
  const statusCode =
    singleHop && first !== undefined
      ? first.statusCode
      : resolution.temporary
        ? 302
        : 301;

  return { status: "resolved", location: resolution.finalPath, statusCode };
}
