/**
 * editorial-media-path.ts — Higiene do caminho publico de midia editorial. PURO.
 *
 * O site e LEITOR de midia editorial; o worker e o ESCRITOR. Este modulo cobre
 * apenas a primeira metade da leitura: transformar os segmentos da URL num
 * caminho de lookup, recusando lixo antes de gastar uma consulta ao banco.
 *
 * O QUE ESTE MODULO DELIBERADAMENTE NAO FAZ: derivar chave de storage. A forma
 * canonica da chave (`editorial/<2 hex>/<sha256>.<ext>`) e contrato do worker
 * (`services/news-ingestion/src/media/storage-port.ts`) e NAO e reimplementada
 * aqui. Reimplementa-la criaria duas definicoes do mesmo formato, que divergem
 * na primeira mudanca — e a divergencia apareceria como imagem 404 em producao,
 * o mesmo sintoma que este codigo existe para corrigir.
 *
 * Quem decide se o caminho e legitimo e o BANCO: `editorial_media_assets` tem
 * indice UNICO em `public_path`, e a chave usada contra o bucket sai da COLUNA
 * `storage_key` daquela linha — nunca da URL. Por isso a validacao abaixo e
 * higiene generica (charset, tamanho, travessia, extensao de imagem), nao uma
 * copia do formato: um caminho bem-formado porem inexistente simplesmente nao
 * casa nenhuma linha e vira 404.
 */

/**
 * Prefixo publico servido por esta rota.
 *
 * Casa com o default de `EDITORIAL_MEDIA_PUBLIC_BASE_PATH` no worker
 * (`storage-config.ts`, DEFAULT_PUBLIC_BASE_PATH = '/media'). O prefixo e o
 * caminho do arquivo de rota (`app/media/editorial/[...key]`), entao mudar a
 * variavel no worker sem mover a rota quebraria a leitura — ver o README desta
 * fatia e o runbook de EasyPanel.
 */
export const EDITORIAL_MEDIA_ROUTE_PREFIX = "/media/editorial";

/**
 * Extensoes aceitas na URL.
 *
 * Espelha a tabela de MIME aceitos na projecao (jpeg/png/webp/avif). Serve como
 * filtro barato: o `Content-Type` realmente devolvido vem de
 * `editorial_media_assets.mime_type`, validado por ASSINATURA DE BYTES na
 * projecao — nunca da extensao da URL.
 */
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif"] as const;

/**
 * Teto de segmentos apos `/media/editorial/`.
 *
 * A chave real tem 2 (`<xx>/<arquivo>`). O teto e 4 para nao acoplar esta rota
 * ao numero de niveis de balde escolhido pelo worker: se ele passar a usar tres
 * niveis, a rota continua servindo e o banco segue sendo a autoridade.
 */
const MAX_SEGMENTS = 4;

/** Teto de tamanho do caminho, alinhado ao teto de chave do worker (200). */
const MAX_LOOKUP_LENGTH = 200;

/** Um segmento seguro: comeca alfanumerico, sem travessia, sem maiuscula. */
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

function hasAllowedExtension(segment: string): boolean {
  const dot = segment.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = segment.slice(dot + 1);
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Monta o caminho de lookup a partir dos segmentos capturados pela rota.
 *
 * Retorna `null` — nunca lanca — quando o caminho nao merece uma consulta ao
 * banco. O chamador traduz `null` em 404, sem distinguir "malformado" de
 * "inexistente": a diferenca so serviria para enumerar o bucket.
 */
export function editorialMediaLookupPath(
  segments: readonly string[] | undefined,
): string | null {
  if (segments === undefined || segments.length === 0) return null;
  if (segments.length > MAX_SEGMENTS) return null;

  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") return null;
    if (!SAFE_SEGMENT.test(segment)) return null;
  }

  const last = segments[segments.length - 1];
  if (last === undefined || !hasAllowedExtension(last)) return null;

  const lookup = `${EDITORIAL_MEDIA_ROUTE_PREFIX}/${segments.join("/")}`;
  if (lookup.length > MAX_LOOKUP_LENGTH) return null;
  return lookup;
}

/**
 * A chave vinda do BANCO e segura para virar caminho de arquivo/objeto?
 *
 * Ultima barreira antes de `path.join` no driver local. A coluna `storage_key`
 * ja tem CHECK contra `..` na migration `20260729010000_editorial_media_assets`,
 * mas uma linha gravada por outro caminho (restore, correcao manual) nao passa
 * por aquele CHECK duas vezes — e escrever fora da raiz do storage e um estrago
 * que nao se desfaz.
 */
export function isSafeStoredObjectKey(key: string): boolean {
  if (key === "" || key.length > MAX_LOOKUP_LENGTH) return false;
  if (key.startsWith("/") || key.includes("\\") || key.includes("\0")) return false;
  const segments = key.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  return /^[a-z0-9/._-]+$/.test(key);
}
