/**
 * BORDA HTTP da biblioteca pessoal (C8).
 *
 * Reusa integralmente as garantias do C7D — nao ha segundo mecanismo de nada:
 *  - autenticacao por `resolveAuthenticatedContext` (unico caminho);
 *  - CSRF double submit pelo MESMO `requireCsrf` em toda mutacao;
 *  - ownership estrutural: nenhum handler le `userId` do corpo ou da URL;
 *  - fail-closed: excecao inesperada vira 500 de corpo fixo.
 *
 * O id de recurso (lista, item, job) vem do CAMINHO, e a autorizacao acontece
 * no servico comparando o dono com o titular da sessao. Conhecer um id nunca
 * basta.
 */

import {
  parseAddListItemCommand,
  parseBulkMarkCommand,
  parseEntityRefCommand,
  parseListWriteCommand,
  parseReorderCommand,
  parseSetEpisodeWatchedCommand,
  parseSetRatingCommand,
  parseSetWatchStateCommand,
} from "../contracts/library-commands.js";
import { parseEntityId, serializeEntityId } from "../contracts/payloads.js";
import { requireCsrf } from "../core/request-guards.js";
import type { DomainResult } from "../core/result.js";
import {
  addListItem,
  clearRating,
  clearWatchState,
  createList,
  deleteList,
  ensureSystemLists,
  listUserLists,
  listWatchStates,
  readHistory,
  readList,
  removeListItem,
  reorderList,
  setRating,
  setWatchState,
  updateList,
} from "../auth-runtime/library-services.js";
import {
  markSeriesEpisodes,
  readSeriesProgress,
  setEpisodeWatched,
} from "../auth-runtime/tracker-services.js";
import {
  applyImport,
  cancelImport,
  createImportPreview,
  listImports,
  readImport,
} from "../auth-runtime/import-services.js";
import { resolveAuthenticatedContext } from "../auth-runtime/account.js";
import type { AuthenticatedContext, AuthRequestContext, AuthRuntimeDeps } from "../auth-runtime/deps.js";
import { SUPPORTED_IMPORT_SOURCES, type ImportTargetState, type SupportedImportSource } from "../imports/index.js";
import { readPresentedCsrfToken, readSessionToken } from "./cookies.js";
import { readClientIp, readJsonBody, readUserAgent, resolveCorrelationId } from "./request.js";
import {
  AUTH_SECURITY_HEADERS,
  malformedRequestResponse,
  methodNotAllowedResponse,
  unexpectedFailureResponse,
  validationFailedResponse,
} from "./responses.js";

export interface LibraryHttpDeps {
  readonly runtime: AuthRuntimeDeps;
  readonly hashClientIp: (ip: string) => string;
  readonly newCorrelationId: () => string;
  readonly onUnexpectedError?: (correlationId: string) => void;
}

/** Teto do corpo de importacao: o arquivo chega aqui (5 MB + folga do JSON). */
const IMPORT_MAX_BODY_BYTES = 8 * 1024 * 1024;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...AUTH_SECURITY_HEADERS },
  });
}

function unauthenticatedResponse(): Response {
  return jsonResponse(401, {
    ok: false,
    code: "unauthorized",
    message: "sessao invalida ou expirada.",
  });
}

function csrfRejectedResponse(): Response {
  return jsonResponse(403, {
    ok: false,
    code: "csrf_mismatch",
    message: "requisicao nao autorizada.",
  });
}

/** Traduz o codigo de dominio em status HTTP. Mesma tabela do C7D. */
function failureResponse(result: DomainResult<unknown> & { ok: false }): Response {
  const status =
    result.error.code === "unauthorized"
      ? 401
      : result.error.code === "forbidden"
        ? 403
        : result.error.code === "not_found"
          ? 404
          : result.error.code === "conflict"
            ? 409
            : result.error.code === "version_conflict"
              ? 409
              : result.error.code === "rate_limited" || result.error.code === "locked_out"
                ? 429
                : result.error.code === "precondition_failed"
                  ? 412
                  : 400;
  return jsonResponse(status, {
    ok: false,
    code: result.error.code,
    message: result.error.message,
    ...(result.error.details !== undefined ? { details: result.error.details } : {}),
  });
}

function buildContext(deps: LibraryHttpDeps, request: Request): AuthRequestContext {
  const clientIp = readClientIp(request);
  return {
    correlationId: resolveCorrelationId(request, deps.newCorrelationId()),
    clientIpHash: clientIp === null ? null : deps.hashClientIp(clientIp),
    userAgent: readUserAgent(request),
  };
}

/** Casca das MUTACOES: metodo -> corpo -> sessao -> CSRF -> parse -> servico. */
async function mutation<TCommand>(
  deps: LibraryHttpDeps,
  request: Request,
  parse: (input: unknown) => DomainResult<TCommand>,
  run: (
    authenticated: AuthenticatedContext,
    command: TCommand,
    context: AuthRequestContext,
  ) => Promise<Response>,
): Promise<Response> {
  const context = buildContext(deps, request);
  try {
    const body = await readJsonBody(request);
    if (body.kind === "method_not_allowed") return methodNotAllowedResponse();
    if (body.kind === "malformed") return malformedRequestResponse();

    const authenticated = await resolveAuthenticatedContext(
      deps.runtime,
      readSessionToken(request),
    );
    if (authenticated === null) return unauthenticatedResponse();

    // CSRF ANTES do parse: um pedido forjado nao chega a tocar dominio.
    const csrf = requireCsrf(
      readPresentedCsrfToken(request) ?? undefined,
      authenticated.csrfTokenHash,
    );
    if (!csrf.ok) return csrfRejectedResponse();

    const command = parse(body.value);
    if (!command.ok) return validationFailedResponse(command.error.details ?? []);

    return await run(authenticated, command.value, context);
  } catch {
    deps.onUnexpectedError?.(context.correlationId);
    return unexpectedFailureResponse();
  }
}

/** Casca das LEITURAS: sem corpo, sem CSRF (nao muda estado). */
async function read(
  deps: LibraryHttpDeps,
  request: Request,
  run: (authenticated: AuthenticatedContext, url: URL) => Promise<Response>,
): Promise<Response> {
  const context = buildContext(deps, request);
  try {
    if (request.method.toUpperCase() !== "GET") return methodNotAllowedResponse();
    const authenticated = await resolveAuthenticatedContext(
      deps.runtime,
      readSessionToken(request),
    );
    if (authenticated === null) return unauthenticatedResponse();
    return await run(authenticated, new URL(request.url));
  } catch {
    deps.onUnexpectedError?.(context.correlationId);
    return unexpectedFailureResponse();
  }
}

/** Le paginacao da query com tetos seguros. */
function paging(url: URL): { limit: number; offset: number } {
  const limit = Number(url.searchParams.get("limit") ?? "20");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  return {
    limit: Number.isFinite(limit) ? limit : 20,
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  };
}

/** Extrai um id de recurso do CAMINHO (ultimo ou penultimo segmento). */
function idFromPath(url: URL, fromEnd: number): DomainResult<bigint> {
  const segmentos = url.pathname.split("/").filter((s) => s.length > 0);
  const bruto = segmentos[segmentos.length - 1 - fromEnd] ?? "";
  return parseEntityId(bruto);
}

/** Serializa BigInt para JSON (o payload usa id em texto). */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? serializeEntityId(v) : v)),
  );
}

export interface LibraryHttpHandlers {
  readonly setWatchState: (request: Request) => Promise<Response>;
  readonly clearWatchState: (request: Request) => Promise<Response>;
  readonly listLibrary: (request: Request) => Promise<Response>;
  readonly history: (request: Request) => Promise<Response>;
  readonly setEpisodeWatched: (request: Request) => Promise<Response>;
  readonly bulkMarkEpisodes: (request: Request) => Promise<Response>;
  readonly seriesProgress: (request: Request) => Promise<Response>;
  readonly listLists: (request: Request) => Promise<Response>;
  readonly createList: (request: Request) => Promise<Response>;
  readonly readList: (request: Request) => Promise<Response>;
  readonly updateList: (request: Request) => Promise<Response>;
  readonly deleteList: (request: Request) => Promise<Response>;
  readonly addListItem: (request: Request) => Promise<Response>;
  readonly removeListItem: (request: Request) => Promise<Response>;
  readonly reorderList: (request: Request) => Promise<Response>;
  readonly setRating: (request: Request) => Promise<Response>;
  readonly clearRating: (request: Request) => Promise<Response>;
  readonly createImport: (request: Request) => Promise<Response>;
  readonly listImports: (request: Request) => Promise<Response>;
  readonly readImport: (request: Request) => Promise<Response>;
  readonly applyImport: (request: Request) => Promise<Response>;
  readonly cancelImport: (request: Request) => Promise<Response>;
}

export function createLibraryHttpHandlers(deps: LibraryHttpDeps): LibraryHttpHandlers {
  const rt = deps.runtime;

  /** Chave de idempotencia da operacao: do cabecalho, ou gerada. */
  const idempotency = (request: Request): string =>
    request.headers.get("idempotency-key") ?? deps.newCorrelationId();

  return {
    async setWatchState(request) {
      return mutation(deps, request, parseSetWatchStateCommand, async (auth, cmd) => {
        const r = await setWatchState(rt, auth, {
          ...cmd,
          idempotencyKey: idempotency(request),
          expectedVersion: null,
        });
        return r.ok ? jsonResponse(200, { ok: true, state: jsonSafe(r.value) }) : failureResponse(r);
      });
    },

    async clearWatchState(request) {
      return mutation(deps, request, parseEntityRefCommand, async (auth, cmd) => {
        const r = await clearWatchState(rt, auth, cmd);
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async listLibrary(request) {
      return read(deps, request, async (auth, url) => {
        const status = url.searchParams.getAll("status");
        const page = paging(url);
        const r = await listWatchStates(rt, auth, {
          statuses: status as never[],
          entityTypes: [],
          limit: page.limit,
          offset: page.offset,
        });
        return jsonResponse(200, { ok: true, ...jsonSafe(r) as object });
      });
    },

    async history(request) {
      return read(deps, request, async (auth, url) => {
        const page = paging(url);
        const r = await readHistory(rt, auth, page);
        return jsonResponse(200, { ok: true, ...jsonSafe(r) as object });
      });
    },

    async setEpisodeWatched(request) {
      return mutation(deps, request, parseSetEpisodeWatchedCommand, async (auth, cmd) => {
        const r = await setEpisodeWatched(rt, auth, {
          ...cmd,
          watchedAt: null,
          idempotencyKey: idempotency(request),
          expectedVersion: null,
        });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async bulkMarkEpisodes(request) {
      return mutation(deps, request, parseBulkMarkCommand, async (auth, cmd) => {
        const r = await markSeriesEpisodes(rt, auth, {
          ...cmd,
          watchedAt: null,
          idempotencyKey: idempotency(request),
        });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async seriesProgress(request) {
      return read(deps, request, async (auth, url) => {
        const id = idFromPath(url, 0);
        if (!id.ok) return failureResponse(id);
        const r = await readSeriesProgress(rt, auth, { tvShowId: id.value });
        return jsonResponse(200, { ok: true, progress: jsonSafe(r) });
      });
    },

    async listLists(request) {
      return read(deps, request, async (auth, url) => {
        // Garante as listas de sistema na primeira visita (idempotente).
        await ensureSystemLists(rt, auth);
        const r = await listUserLists(rt, auth, paging(url));
        return jsonResponse(200, { ok: true, ...jsonSafe(r) as object });
      });
    },

    async createList(request) {
      return mutation(deps, request, parseListWriteCommand, async (auth, cmd) => {
        const r = await createList(rt, auth, cmd);
        return r.ok ? jsonResponse(201, { ok: true, list: jsonSafe(r.value) }) : failureResponse(r);
      });
    },

    async readList(request) {
      return read(deps, request, async (auth, url) => {
        const id = idFromPath(url, 0);
        if (!id.ok) return failureResponse(id);
        const r = await readList(rt, auth, { listId: id.value, ...paging(url) });
        return r.ok ? jsonResponse(200, { ok: true, ...jsonSafe(r.value) as object }) : failureResponse(r);
      });
    },

    async updateList(request) {
      return mutation(deps, request, parseListWriteCommand, async (auth, cmd) => {
        const id = idFromPath(new URL(request.url), 0);
        if (!id.ok) return failureResponse(id);
        const r = await updateList(rt, auth, { listId: id.value, ...cmd });
        return r.ok ? jsonResponse(200, { ok: true, list: jsonSafe(r.value) }) : failureResponse(r);
      });
    },

    async deleteList(request) {
      return mutation(deps, request, () => ({ ok: true as const, value: {} }), async (auth) => {
        // Rota montada: .../lists/<id>/delete — o id e o PENULTIMO segmento.
        // (fromEnd 0 lia o sufixo "delete" e a exclusao respondia 400 sempre.)
        const id = idFromPath(new URL(request.url), 1);
        if (!id.ok) return failureResponse(id);
        const r = await deleteList(rt, auth, { listId: id.value });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async addListItem(request) {
      return mutation(deps, request, parseAddListItemCommand, async (auth, cmd) => {
        // .../lists/<id>/items -> o id da lista e o penultimo segmento.
        const id = idFromPath(new URL(request.url), 1);
        if (!id.ok) return failureResponse(id);
        const r = await addListItem(rt, auth, { listId: id.value, ...cmd });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async removeListItem(request) {
      return mutation(deps, request, () => ({ ok: true as const, value: {} }), async (auth) => {
        const url = new URL(request.url);
        // Rota montada: .../lists/<listId>/items/<itemId>/remove — o sufixo
        // "remove" ocupa o ultimo segmento (fromEnd 0/2 liam "remove"/"items").
        const itemId = idFromPath(url, 1);
        const listId = idFromPath(url, 3);
        if (!itemId.ok) return failureResponse(itemId);
        if (!listId.ok) return failureResponse(listId);
        const r = await removeListItem(rt, auth, {
          listId: listId.value,
          itemId: itemId.value,
        });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async reorderList(request) {
      return mutation(deps, request, parseReorderCommand, async (auth, cmd) => {
        // .../lists/<id>/reorder
        const id = idFromPath(new URL(request.url), 1);
        if (!id.ok) return failureResponse(id);
        const r = await reorderList(rt, auth, { listId: id.value, ...cmd });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async setRating(request) {
      return mutation(deps, request, parseSetRatingCommand, async (auth, cmd) => {
        const r = await setRating(rt, auth, cmd);
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async clearRating(request) {
      return mutation(deps, request, parseEntityRefCommand, async (auth, cmd) => {
        const r = await clearRating(rt, auth, cmd);
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    /**
     * PREVIEW da importacao. O arquivo chega em base64 dentro do JSON — nao ha
     * `multipart` aqui de proposito: a borda ja e JSON-only, e exigir
     * `content-type: application/json` e o que barra o envio por formulario
     * HTML entre origens (o vetor classico de CSRF).
     */
    async createImport(request) {
      const context = buildContext(deps, request);
      try {
        const declarado = request.headers.get("content-length");
        if (declarado !== null && Number(declarado) > IMPORT_MAX_BODY_BYTES) {
          return jsonResponse(413, {
            ok: false,
            code: "validation_failed",
            message: "arquivo grande demais.",
          });
        }

        const body = await readImportBody(request);
        if (body === null) return malformedRequestResponse();

        const authenticated = await resolveAuthenticatedContext(
          rt,
          readSessionToken(request),
        );
        if (authenticated === null) return unauthenticatedResponse();

        const csrf = requireCsrf(
          readPresentedCsrfToken(request) ?? undefined,
          authenticated.csrfTokenHash,
        );
        if (!csrf.ok) return csrfRejectedResponse();

        if (!(SUPPORTED_IMPORT_SOURCES as readonly string[]).includes(body.source)) {
          return jsonResponse(400, {
            ok: false,
            code: "validation_failed",
            message: "fonte de importacao nao suportada.",
            details: [`fontes suportadas: ${SUPPORTED_IMPORT_SOURCES.join(", ")}`],
          });
        }

        const r = await createImportPreview(rt, authenticated, {
          source: body.source as SupportedImportSource,
          targetState: body.targetState,
          fileName: body.fileName,
          bytes: body.bytes,
        });
        return r.ok
          ? jsonResponse(201, {
              ok: true,
              job: jsonSafe(r.value.job),
              preview: jsonSafe(r.value.plan.summary),
              conflicts: jsonSafe(r.value.plan.conflicts),
              unmatched: jsonSafe(r.value.plan.unmatched.slice(0, 100)),
            })
          : failureResponse(r);
      } catch {
        deps.onUnexpectedError?.(context.correlationId);
        return unexpectedFailureResponse();
      }
    },

    async listImports(request) {
      return read(deps, request, async (auth, url) => {
        const r = await listImports(rt, auth, paging(url));
        return jsonResponse(200, { ok: true, ...jsonSafe(r) as object });
      });
    },

    async readImport(request) {
      return read(deps, request, async (auth, url) => {
        const id = idFromPath(url, 0);
        if (!id.ok) return failureResponse(id);
        const r = await readImport(rt, auth, { jobId: id.value });
        return r.ok
          ? jsonResponse(200, { ok: true, job: jsonSafe(r.value.job), preview: r.value.preview })
          : failureResponse(r);
      });
    },

    async applyImport(request) {
      return mutation(deps, request, () => ({ ok: true as const, value: {} }), async (auth) => {
        // .../imports/<id>/apply
        const id = idFromPath(new URL(request.url), 1);
        if (!id.ok) return failureResponse(id);
        const r = await applyImport(rt, auth, { jobId: id.value });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },

    async cancelImport(request) {
      return mutation(deps, request, () => ({ ok: true as const, value: {} }), async (auth) => {
        const id = idFromPath(new URL(request.url), 1);
        if (!id.ok) return failureResponse(id);
        const r = await cancelImport(rt, auth, { jobId: id.value });
        return r.ok ? jsonResponse(200, { ok: true, ...r.value }) : failureResponse(r);
      });
    },
  };
}

/** Corpo da importacao: fonte, estado alvo, nome e conteudo em base64. */
async function readImportBody(request: Request): Promise<
  | {
      readonly source: string;
      readonly targetState: ImportTargetState;
      readonly fileName: string | null;
      readonly bytes: Uint8Array;
    }
  | null
> {
  if (request.method.toUpperCase() !== "POST") return null;
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const obj = payload as Record<string, unknown>;
  const source = obj["source"];
  const targetState = obj["targetState"];
  const conteudo = obj["contentBase64"];
  const fileName = obj["fileName"];

  if (typeof source !== "string" || typeof conteudo !== "string") return null;
  if (
    targetState !== "watchlist" &&
    targetState !== "watched" &&
    targetState !== "list_item"
  ) {
    return null;
  }

  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(conteudo, "base64"));
  } catch {
    return null;
  }

  return {
    source,
    targetState,
    fileName: typeof fileName === "string" ? fileName : null,
    bytes,
  };
}
