/**
 * tmdb-image-url.ts — PONTO GOVERNADO ÚNICO de construção da URL pública de
 * imagem do TMDB no app. É o ÚNICO arquivo de produção em `apps/web` autorizado a
 * conter o host do CDN de imagens do TMDB (o guard `scripts/audit/check-render-purity.mjs`
 * abre uma exceção explícita e nomeada só para este caminho).
 *
 * Decisão de arquitetura (final): o servidor NÃO salva imagem (sem JPG/WebP local,
 * sem volume). O banco guarda o `file_path` CRU do TMDB (ex.: `/abc123.jpg`) e o
 * frontend monta a URL pública `base_url + file_size + file_path`, renderizada por
 * `<img>` normal. Isto NÃO é chamada de API no render: só concatena string a partir
 * de dado já lido do PostgreSQL. Invariante 3 (zero API/fetch externo no render) e
 * invariante 4 (zero Gemini) seguem intactas; nenhum token TMDB vai para o cliente.
 *
 * Regra do TMDB: a URL é `${base}/${size}${file_path}`. NÃO se troca `.jpg` por
 * `.webp` no `file_path` — o tamanho é escolhido pelo segmento de `size`
 * (w300/w500/w780/w1280/original), nunca reescrevendo a extensão.
 */

/** Base pública do CDN de imagens do TMDB (sem token; só serve imagem). */
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** Prefixos de asset LOCAL antigo — rejeitados (não são `file_path` cru do TMDB). */
const LOCAL_ASSET_PREFIXES = ["/media/", "/uploads/", "/brand/"] as const;

/** Tamanhos suportados (segmento `file_size` da URL do TMDB). */
export type TmdbImageSize = "w300" | "w500" | "w780" | "w1280" | "original";

/**
 * Monta a URL pública remota de uma imagem do TMDB a partir do `file_path` CRU
 * (ex.: `/abc123.jpg`) e do tamanho. Retorna `null` — nunca URL quebrada — quando:
 *  - `path` ausente/vazio;
 *  - não começa com `/` (não é `file_path` do TMDB);
 *  - é protocolo-relativo (`//host`) ou URL absoluta embutida;
 *  - é um path de asset LOCAL antigo (`/media/`, `/uploads/`, `/brand/`);
 *  - contém `..`, query (`?`), hash (`#`), backslash ou espaço (defesa a entrada suja).
 *
 * Pura e determinística: sem rede, sem IO. A EXTENSÃO do `file_path` é preservada
 * (não converte para `.webp`); o tamanho vem só do segmento `size`.
 */
export function buildTmdbImageUrl(
  path: string | null | undefined,
  size: TmdbImageSize = "w780",
): string | null {
  if (path == null) return null;
  const value = path.trim();
  if (value === "") return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (LOCAL_ASSET_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  if (value.includes("..")) return null;
  if (/[?#\\\s]/.test(value)) return null;
  return `${TMDB_IMAGE_BASE}/${size}${value}`;
}
