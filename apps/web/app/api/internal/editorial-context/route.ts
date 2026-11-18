/**
 * POST /api/internal/editorial-context — o Cinerie Context Service (ADR 0015,
 * secao 3.2): "para estas obras, a ficha que a Cinerie pode entregar".
 *
 * ROTA INTERNA. Nao indexavel, fora do sitemap, sem CORS, autenticada por
 * credencial de escopo proprio (`catalog_context`, declarado pelo nome da
 * variavel `CINERIE_EDITORIAL_CONTEXT_API_KEYS`). Uma chave do resolve nao abre
 * esta rota, e o contrario tambem nao.
 *
 * QUEM CHAMA: o MN-Prime (redige a materia da Maquina Nerd com a ficha da obra)
 * e o portal da Maquina Nerd (mostra a ficha ao lado do texto). Delegador fino:
 * o pedido e lido por `src/lib/editorial-context-request.ts`, a identidade
 * reaproveita o tradutor do resolve, as leituras vivem em
 * `src/server/editorial-context.ts` e a forma da resposta em
 * `src/lib/editorial-context-presenter.ts` (`cinerie-editorial-context-v1`).
 *
 * Le SOMENTE PostgreSQL (invariantes 3 e 4). Nenhum caminho novo do render
 * publico para fora: nenhuma pagina chama esta rota.
 */

import { randomUUID } from "node:crypto";

import {
  buildEditorialContext,
  type ContextTitleInput,
} from "../../../../src/lib/editorial-context-presenter";
import {
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_REQUEST_BYTES,
  parseEditorialContextRequest,
} from "../../../../src/lib/editorial-context-request";
import { authenticateInternalRequest } from "../../../../src/lib/entity-resolve-auth";
import {
  consumeRateLimit,
  pruneRateLimitBuckets,
  readPositiveLimit,
  type RateLimitState,
} from "../../../../src/lib/entity-resolve-rate-limit";
import { SITE_URL } from "../../../../src/lib/site";
import {
  loadContextImageAuthorization,
  loadTitleContext,
  resolveContextItems,
} from "../../../../src/server/editorial-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Teto default por minuto, por credencial. Mais alto que o do resolve (60):
 * o portal pede a ficha quando uma materia sai do cache, e depois de um deploy
 * isso chega em rajada. Cada chamada e no maximo `MAX_CONTEXT_ITEMS` fichas.
 */
const DEFAULT_CONTEXT_RATE_LIMIT_PER_MINUTE = 300;

/** Credito de imagem: a fonte, curto, para caber na legenda da materia. */
const IMAGE_CREDIT = "TMDB";

/** Baldes de rate limit, POR PROCESSO (mesma limitacao registrada no resolve). */
const rateLimitBuckets = new Map<string, RateLimitState>();

/** Chave curta na variavel ja foi avisada neste processo? */
let warnedShortKey = false;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
};

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

/**
 * Uso editorial da midia FORA da Cinerie. Ligado por padrao (decisao do dono,
 * 18/11/2026, registrada em `docs/operations/editorial-context.md`); a chave de
 * EMERGENCIA `CINERIE_EDITORIAL_CONTEXT_MEDIA=off` tira imagens do contexto sem
 * deploy de codigo. Trailer e oferta continuam pelos proprios portoes.
 */
function mediaForEditorial(env: Record<string, string | undefined>): boolean {
  return (env.CINERIE_EDITORIAL_CONTEXT_MEDIA ?? "").trim().toLowerCase() !== "off";
}

export async function POST(request: Request): Promise<Response> {
  const auth = authenticateInternalRequest(
    process.env.CINERIE_EDITORIAL_CONTEXT_API_KEYS,
    request.headers.get("authorization"),
  );
  // Chave curta na variavel e aviso SEMPRE, mesmo ao lado de uma valida: ela
  // nao abre a rota, e o operador precisa saber que pos algo que nao vale.
  if (auth.rejected > 0 && !warnedShortKey) {
    // Uma vez por processo: a cada requisicao seriam ate centenas de linhas por minuto.
    warnedShortKey = true;
    console.warn(
      JSON.stringify({
        event: "editorial_context_credential_rejected",
        count: auth.rejected,
        detail: "chave curta demais em CINERIE_EDITORIAL_CONTEXT_API_KEYS",
      }),
    );
  }
  // NASCE DESLIGADA: sem chave valida nao ha rota (`503`, nao `401` — o
  // problema esta no ambiente do servidor, nao na chave de quem chama).
  if (auth.state === "disabled") return json({ error: "context_disabled" }, 503);
  if (auth.state === "unauthenticated") return json({ error: "unauthenticated" }, 401);
  const { credential } = auth;

  const nowMs = Date.now();
  pruneRateLimitBuckets(rateLimitBuckets, nowMs);
  const limit = readPositiveLimit(
    process.env.CINERIE_EDITORIAL_CONTEXT_RATE_LIMIT_PER_MINUTE,
    DEFAULT_CONTEXT_RATE_LIMIT_PER_MINUTE,
  );
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
  if (rawBytes > 0 && rawBytes <= MAX_CONTEXT_REQUEST_BYTES) {
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
  }

  const parsed = parseEditorialContextRequest(body, rawBytes);
  if (!parsed.ok) {
    const { code, status, issues } = parsed.rejection;
    return json({ error: code, issues, maxItems: MAX_CONTEXT_ITEMS }, status);
  }

  const startedMs = Date.now();
  try {
    const resolutions = await resolveContextItems(parsed.request.items);
    const imageAuthorization = await loadContextImageAuthorization();

    // Uma ficha por OBRA, nao por item: dois itens que resolvem para a mesma
    // obra (titulo e tmdbId do mesmo filme) nao duplicam o contexto.
    const wanted = new Map<string, { kind: "movie" | "tv"; entityId: string }>();
    for (const resolution of resolutions) {
      if (resolution.entityId === null) continue;
      wanted.set(`${resolution.kind}:${resolution.entityId}`, {
        kind: resolution.kind,
        entityId: resolution.entityId,
      });
    }
    const loaded = await Promise.all(
      [...wanted.values()].map((target) => loadTitleContext(target.kind, target.entityId, imageAuthorization)),
    );
    const titles = loaded.filter((title): title is ContextTitleInput => title !== null);

    const context = buildEditorialContext(titles, {
      requestId: parsed.request.requestId ?? `ctx-${randomUUID()}`,
      now: new Date(),
      siteUrl: SITE_URL,
      mediaForEditorial: mediaForEditorial(process.env),
      imageCredit: IMAGE_CREDIT,
    });

    console.info(
      JSON.stringify({
        event: "editorial_context_served",
        credentialId: credential.id,
        items: parsed.request.items.length,
        entities: context.entities.length,
        media: context.media.length,
        offers: context.availability.length,
        ms: Date.now() - startedMs,
      }),
    );

    return json({ context, resolutions }, 200, {
      "x-ratelimit-limit": String(limit),
      "x-ratelimit-remaining": String(verdict.remaining),
    });
  } catch (error) {
    // Sem eco do erro do driver (SQL, URL do banco) e sem silencio no servidor:
    // `503` retentavel, para o consumidor tratar como "tente depois", e nao como
    // "a obra nao existe".
    console.error(
      JSON.stringify({
        event: "editorial_context_failed",
        credentialId: credential.id,
        items: parsed.request.items.length,
        errorKind: error instanceof Error ? error.constructor.name : typeof error,
      }),
    );
    return json({ error: "context_failed", retryable: true }, 503);
  }
}

/** Qualquer outro metodo: `405`, com os mesmos cabecalhos de `noindex`/`no-store`. */
export function GET(): Response {
  return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
}
