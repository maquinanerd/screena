/**
 * media-file-path.ts — Lógica PURA de resolução segura do caminho de um asset
 * local de mídia (imagens do catálogo TMDB ingeridas OFFLINE em
 * apps/web/public/media/tmdb/). Sem rede/DB/IO — só valida e classifica o path.
 *
 * Por que existe: em produção o app roda em `output: standalone`
 * (ver docs/CLOUDPANEL_DEPLOY.md), onde `public/` é copiado no BUILD. As imagens
 * geradas em RUNTIME pelo backfill (gitignored) não entram nessa cópia e por isso
 * o serving estático de `public/` devolve 404. O route handler
 * `app/media/tmdb/[...path]/route.ts` lê o arquivo do FS em runtime; esta função
 * é a fronteira pura que decide se o caminho pedido é seguro e servível.
 *
 * Governança: NÃO é API externa nem CDN — serve APENAS arquivo LOCAL. Zero CDN
 * remoto de imagens do TMDB no render (invariante 3 intacta); zero Gemini (4).
 */

/** Extensões de imagem aceitas (as que o backfill grava + fallbacks locais). */
const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "gif",
  "svg",
]);

/** Content-Type por extensão (o servidor precisa rotular o binário corretamente). */
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export interface ResolvedMediaFile {
  /** Caminho relativo POSIX seguro sob a raiz de mídia (ex.: "movie/x-poster.jpg"). */
  relativePath: string;
  /** Content-Type derivado da extensão. */
  contentType: string;
}

/**
 * Valida os segmentos de `[...path]` (já decodificados pelo Next) e devolve o
 * caminho relativo seguro + content-type, ou `null` se algo for inválido:
 *  - lista vazia;
 *  - segmento vazio, `.`/`..`, ou contendo separador/backslash/NUL (anti-traversal);
 *  - sem extensão ou extensão fora da allowlist de imagem.
 *
 * Pura e determinística — cobre a fronteira de segurança do route handler.
 */
export function resolveMediaFile(
  segments: readonly string[] | undefined | null,
): ResolvedMediaFile | null {
  if (segments == null || segments.length === 0) return null;

  for (const seg of segments) {
    if (typeof seg !== "string" || seg === "") return null;
    if (seg === "." || seg === "..") return null;
    if (seg.includes("/") || seg.includes("\\") || seg.includes("\0")) return null;
  }

  const relativePath = segments.join("/");
  const dot = relativePath.lastIndexOf(".");
  if (dot < 0 || dot === relativePath.length - 1) return null;

  const ext = relativePath.slice(dot + 1).toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXTENSION[ext];
  if (!ALLOWED_EXTENSIONS.has(ext) || contentType === undefined) return null;

  return { relativePath, contentType };
}
