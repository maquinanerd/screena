/**
 * route.ts — Serve os assets LOCAIS de mídia do catálogo TMDB (`/media/tmdb/...`)
 * lendo o arquivo do filesystem em RUNTIME.
 *
 * Por que um route handler em vez de só `public/`:
 *  - Em produção o app roda em `output: standalone` (docs/CLOUDPANEL_DEPLOY.md):
 *    o `public/` é copiado no BUILD. As imagens que o backfill TMDB gera em
 *    RUNTIME (apps/web/public/media/tmdb/, gitignored) NÃO entram nessa cópia, e
 *    por isso o serving estático devolve 404 mesmo com o arquivo no disco.
 *  - Este handler lê o arquivo do FS a cada request, então funciona igual em
 *    `next start` e em standalone. Arquivos COMMITADOS (ex.: /media/demo/*) seguem
 *    sendo servidos estaticamente pelo Next (static tem precedência sobre a rota);
 *    só os gerados em runtime caem aqui.
 *
 * Governança: serve APENAS arquivo LOCAL sob a raiz de mídia. Zero API externa,
 * zero CDN remoto de imagens do TMDB, zero Gemini no render (invariantes 3 e 4).
 * A validação de path (anti-traversal + allowlist de extensão) vive no helper
 * PURO `resolveMediaFile` (testável). O download/ingestão do TMDB continua OFFLINE.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveMediaFile } from "../../../../src/lib/media-file-path";

// Node runtime (usa node:fs). A rota é dinâmica por natureza (catch-all `[...path]`
// + leitura de `params` e do FS por request), então NÃO é prerenderizada nem
// cacheada no build — lê sempre o arquivo atual. O Next força `Cache-Control:
// public, max-age=0` em route handler dinâmico (nosso header serve de intenção); o
// cache longo de asset deve ser feito no proxy/CDN (o Nginx do deploy já faz isso
// para `/_next/static/`; replicar um bloco para `/media/`).
export const runtime = "nodejs";

/** Segmento fixo da raiz servida por esta rota. */
const MEDIA_SUBDIR = ["media", "tmdb"] as const;

/**
 * Raízes candidatas do diretório `media/tmdb`, robustas a cwd/standalone. A
 * primeira em que o arquivo existir é usada. `SCREEN_MEDIA_ROOT` (env de
 * servidor, opcional) é um escape hatch para layouts de deploy não usuais:
 * aponta para o diretório `media` (o `tmdb` é anexado aqui).
 */
function mediaTmdbRoots(): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.SCREEN_MEDIA_ROOT?.trim();
  if (fromEnv) roots.push(path.join(fromEnv, "tmdb"));
  const cwd = process.cwd();
  roots.push(path.join(cwd, "apps", "web", "public", ...MEDIA_SUBDIR));
  roots.push(path.join(cwd, "public", ...MEDIA_SUBDIR));
  return roots;
}

/**
 * Lê o binário local pedido, tentando cada raiz candidata. Defesa em profundidade
 * contra traversal: o caminho resolvido precisa ficar SOB a raiz (o helper puro
 * já rejeita `..`/separadores, isto é a segunda barreira). `null` = não achou.
 */
async function readMediaBinary(relativePath: string): Promise<ArrayBuffer | null> {
  for (const root of mediaTmdbRoots()) {
    const abs = path.resolve(root, relativePath);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) continue;
    try {
      const info = await stat(abs);
      if (!info.isFile()) continue;
      const buf = await readFile(abs);
      // ArrayBuffer explícito (BodyInit válido): o generic de Buffer/Uint8Array
      // (ArrayBufferLike) não casa direto com o tipo de `Response`.
      const out = new ArrayBuffer(buf.byteLength);
      new Uint8Array(out).set(buf);
      return out;
    } catch {
      // arquivo ausente nesta raiz — tenta a próxima
    }
  }
  return null;
}

/** Headers comuns de resposta 200 (cache local; nunca depende de terceiros). */
function okHeaders(contentType: string, length: number): HeadersInit {
  return {
    "Content-Type": contentType,
    "Content-Length": String(length),
    // Cache moderado no browser + mais longo no proxy/CDN; o arquivo é imutável
    // por slug/tipo, mas o backfill pode reescrever (refresh), então não `immutable`.
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await context.params;
  const resolved = resolveMediaFile(segments);
  if (resolved === null) return new Response("Not Found", { status: 404 });

  const data = await readMediaBinary(resolved.relativePath);
  if (data === null) return new Response("Not Found", { status: 404 });

  return new Response(data, {
    status: 200,
    headers: okHeaders(resolved.contentType, data.byteLength),
  });
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path: segments } = await context.params;
  const resolved = resolveMediaFile(segments);
  if (resolved === null) return new Response(null, { status: 404 });

  const data = await readMediaBinary(resolved.relativePath);
  if (data === null) return new Response(null, { status: 404 });

  return new Response(null, {
    status: 200,
    headers: okHeaders(resolved.contentType, data.byteLength),
  });
}
