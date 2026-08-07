/**
 * POST /api/internal/entity-resolve — o tradutor "nome -> id interno do catalogo".
 *
 * ROTA INTERNA. Nao indexavel, fora do sitemap, sem CORS publico, autenticada
 * por credencial de escopo proprio (`catalog_resolve`). Delegador fino: a
 * decisao vive em `src/lib/entity-resolve.ts` e as consultas em
 * `src/server/entity-resolve.ts`.
 *
 * POR QUE ELA EXISTE. `entityCard.entityId` e id INTERNO do catalogo, o catalogo
 * vive no `screen-db` e o CMS nao alcanca aquele banco (ADR 0015) — por isso o
 * CMS aceita qualquer numero e devolve `201`. Quem confere e a renderizacao, e
 * quando nao acha, ela descarta em silencio. Um id existente e ERRADO e pior: a
 * pagina mostra a obra errada com cara de certo.
 *
 * A regra que organiza a rota inteira: **um `null` e inofensivo; um id errado e
 * uma mentira publicada.** Nada aqui devolve palpite.
 *
 * A rota le SOMENTE PostgreSQL (invariantes 3 e 4). Ela vive sob `/api/`, que o
 * `robots.ts` ja bloqueia — e ainda assim manda `X-Robots-Tag` proprio, porque
 * `Disallow` impede o rastreamento e nao a indexacao de uma URL descoberta por
 * outro caminho.
 */

import {
  MAX_RESOLVE_ITEMS,
  MAX_RESOLVE_REQUEST_BYTES,
  parseEntityResolveRequest,
  resolveAll,
} from "../../../../src/lib/entity-resolve";
import {
  extractPresentedKey,
  matchResolveCredential,
  readResolveCredentials,
} from "../../../../src/lib/entity-resolve-auth";
import {
  consumeRateLimit,
  pruneRateLimitBuckets,
  readRateLimitPerMinute,
  type RateLimitState,
} from "../../../../src/lib/entity-resolve-rate-limit";
import { loadResolveCandidates } from "../../../../src/server/entity-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baldes de rate limit, POR PROCESSO.
 *
 * Modulo de escopo, e nao um store: com N instancias atras de um balanceador o
 * teto efetivo e N vezes o configurado. E uma limitacao real e esta registrada
 * na documentacao de operacao — um teto compartilhado exigiria Redis ou tabela,
 * infra nova para uma rota que so um cliente conhecido chama.
 */
const rateLimitBuckets = new Map<string, RateLimitState>();

/**
 * Cabecalhos de TODA resposta, inclusive das recusas.
 *
 * `no-store` porque a resposta depende da credencial; `X-Robots-Tag` porque
 * `Disallow` no robots.txt impede rastrear e nao impede indexar uma URL
 * descoberta por outro caminho. Nao ha `Access-Control-Allow-Origin`: navegador
 * nenhum deve conseguir chamar esta rota, e a ausencia do cabecalho e o que
 * garante isso.
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

export async function POST(request: Request): Promise<Response> {
  const { credentials, rejected } = readResolveCredentials(process.env);
  const rawKeys = (process.env.CINERIE_CATALOG_RESOLVE_API_KEYS ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  // NASCE DESLIGADA. Sem chave configurada nao ha rota: `503` e nao `401`,
  // porque a diferenca importa para quem esta operando — `401` mandaria conferir
  // a chave do cliente quando o problema esta no ambiente do servidor.
  if (credentials.length === 0) {
    if (rejected > 0) {
      console.warn(
        JSON.stringify({
          event: "entity_resolve_credential_rejected",
          count: rejected,
          detail: "chave curta demais em CINERIE_CATALOG_RESOLVE_API_KEYS",
        }),
      );
    }
    return json({ error: "resolver_disabled" }, 503);
  }

  const presented = extractPresentedKey(request.headers.get("authorization"));
  const credential = matchResolveCredential(rawKeys, presented);
  if (credential === null) {
    // Uma unica recusa para "sem chave" e "chave errada": aqui, ao contrario do
    // CMS, nao ha conta reconhecida sem escopo — quem nao casa simplesmente nao
    // existe, e distinguir os dois casos so ajudaria quem esta adivinhando.
    return json({ error: "unauthenticated" }, 401);
  }

  const nowMs = Date.now();
  pruneRateLimitBuckets(rateLimitBuckets, nowMs);
  const limit = readRateLimitPerMinute(process.env);
  const verdict = consumeRateLimit(rateLimitBuckets, credential.id, limit, nowMs);
  if (!verdict.allowed) {
    return json(
      { error: "rate_limited", limitPerMinute: limit, retryAfterSeconds: verdict.retryAfterSeconds },
      429,
      { "retry-after": String(verdict.retryAfterSeconds) },
    );
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const rawBytes = Buffer.byteLength(raw, "utf8");

  let body: unknown = null;
  if (rawBytes > 0 && rawBytes <= MAX_RESOLVE_REQUEST_BYTES) {
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
  }

  const parsed = parseEntityResolveRequest(body, rawBytes);
  if (!parsed.ok) {
    const { code, status, issues } = parsed.rejection;
    return json({ error: code, issues, maxItems: MAX_RESOLVE_ITEMS }, status);
  }

  let results;
  try {
    const candidates = await loadResolveCandidates(parsed.queries);
    results = resolveAll(parsed.queries, candidates);
  } catch (error) {
    // Sem eco do erro do driver na RESPOSTA (ele carrega SQL e, em alguns modos,
    // a URL do banco) e sem silencio no SERVIDOR. Um `500` mudo aqui faria o
    // emissor tratar falha de leitura como "nao existe" — e "nao existe" e
    // exatamente a resposta que ele NAO pode receber por engano.
    console.error(
      JSON.stringify({
        event: "entity_resolve_failed",
        credentialId: credential.id,
        items: parsed.queries.length,
        errorKind: error instanceof Error ? error.constructor.name : typeof error,
      }),
    );
    return json({ error: "resolve_failed", retryable: true }, 503);
  }

  return json({ results }, 200, {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(verdict.remaining),
  });
}

/**
 * Qualquer outro metodo: `405`.
 *
 * Explicito porque o default do Next para metodo nao exportado tambem e `405` —
 * mas sem os cabecalhos de `noindex` e `no-store` desta rota. Um `GET` a esta URL
 * nao pode responder de um jeito que um crawler considere digno de indice.
 */
export function GET(): Response {
  return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
}
