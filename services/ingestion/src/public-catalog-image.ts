/**
 * public-catalog-image.ts — Resolucao PURA do valor a gravar em
 * posterPath/backdropPath durante o backfill de catalogo publico (TMDB).
 *
 * Decisao de arquitetura (final): o servidor NAO salva imagem. Por PADRAO o
 * backfill grava o `file_path` CRU do TMDB (ex.: `/abc.jpg`); o frontend monta a
 * URL publica remota (`image.tmdb.org/...`). A flag `--download-images` (legado,
 * opt-in) baixa o arquivo e grava o path LOCAL (`/media/tmdb/...`) — usada so quando
 * explicitamente pedida. Sem download por padrao => sem disco, sem volume.
 *
 * Puro/testavel: sem rede, sem IO. O download em si (quando ligado) acontece no
 * bin; aqui so decidimos QUAL string persistir.
 */

export interface CatalogImagePathInput {
  /** `file_path` cru do TMDB (poster/backdrop) exatamente como veio do detalhe. */
  readonly rawPath: string | null | undefined;
  /** Path local gerado pelo download (so com `--download-images`); null se falhou. */
  readonly downloadedLocalPath?: string | null;
  /** true quando `--download-images` (legado); false = default (grava path cru). */
  readonly downloadImages: boolean;
}

/**
 * Normaliza o `file_path` cru do TMDB: string nao-vazia comecando com `/`
 * (ex.: `/abc.jpg`), senao `null`. Nao transforma a extensao nem monta URL.
 */
export function normalizeRawTmdbPath(path: string | null | undefined): string | null {
  if (path == null) return null;
  const value = path.trim();
  if (value === "" || !value.startsWith("/")) return null;
  return value;
}

/**
 * Decide o valor a persistir em posterPath/backdropPath:
 *  - `--download-images` (legado): usa o path LOCAL baixado (ou null se falhou);
 *  - padrao: grava o `file_path` CRU do TMDB (nunca `/media/...`).
 */
export function resolveCatalogImagePath(input: CatalogImagePathInput): string | null {
  if (input.downloadImages) {
    return input.downloadedLocalPath ?? null;
  }
  return normalizeRawTmdbPath(input.rawPath);
}
