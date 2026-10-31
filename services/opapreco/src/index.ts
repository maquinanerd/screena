/**
 * @screena/opapreco — transporte HTTP do ad server da OpaPreco. SERVER-ONLY.
 *
 * Tres funcoes, uma por rota de `apps/web/app/api/opapreco/**`. Nenhuma decide
 * o que aparece na pagina: validar o contrato, esconder desconto sem prova e
 * recusar oferta vencida e trabalho de `apps/web/src/lib/opapreco/normalize.ts`.
 * Aqui so se garante que a conversa com o terceiro tem teto de tempo, de tamanho
 * e de destino.
 */

/** Teto de espera da SPEC (§14.4): passou disso, o slot colapsa. */
export const OPAPRECO_TIMEOUT_MS = 1500;

/** Teto da imagem de produto servida pelo proxy (WebP 2x do quadro cabe folgado). */
export const OPAPRECO_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AdRequestInput {
  /** `OPAPRECO_AD_SERVER_URL` — origem (com ou sem caminho base) do ad server. */
  readonly adServerUrl: string;
  /** `OPAPRECO_PUBLISHER_ID`. */
  readonly publisher: string;
  /** Parametros ja validados pela rota (slot, url, viewport, containerWidth, tags). */
  readonly query: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

export type AdRequestOutcome =
  | { readonly kind: "ad"; readonly body: unknown }
  | { readonly kind: "empty" }
  | { readonly kind: "error"; readonly reason: string };

/** Monta `{base}/v1/ad?publisher=...&...` sem perder um caminho base configurado. */
export function buildAdRequestUrl(
  adServerUrl: string,
  publisher: string,
  query: Readonly<Record<string, string>>,
): string {
  const base = new URL(adServerUrl);
  const prefix = base.pathname.replace(/\/+$/, "");
  const target = new URL(`${prefix}/v1/ad`, base.origin);
  target.searchParams.set("publisher", publisher);
  for (const [key, value] of Object.entries(query)) {
    if (value !== "") target.searchParams.set(key, value);
  }
  return target.toString();
}

/**
 * Pede uma decisao de anuncio. 204 = sem oferta elegivel (`empty`); qualquer
 * outro status, corpo que nao e JSON, rede caida ou estouro de 1,5 s = `error`.
 * O chamador trata os dois do mesmo jeito para o leitor (o slot colapsa); a
 * diferenca existe so para o log.
 */
export async function requestAdDecision(input: AdRequestInput): Promise<AdRequestOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let url: string;
  try {
    url = buildAdRequestUrl(input.adServerUrl, input.publisher, input.query);
  } catch {
    return { kind: "error", reason: "ad_server_url_invalida" };
  }
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs ?? OPAPRECO_TIMEOUT_MS),
    });
    if (response.status === 204) return { kind: "empty" };
    if (!response.ok) return { kind: "error", reason: `status_${response.status}` };
    const body: unknown = await response.json();
    return { kind: "ad", body };
  } catch (error) {
    const name = error instanceof Error ? error.name : "erro";
    return { kind: "error", reason: name === "TimeoutError" ? "timeout" : `falha_${name}` };
  }
}

export interface ImageFetchInput {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: FetchLike;
}

export interface FetchedImage {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
}

/**
 * Tipos aceitos. SVG fica FORA de proposito: servido pela origem da Cinerie, um
 * SVG de terceiro carrega script com o cookie do site. Foto de produto e raster.
 */
const RASTER_IMAGE = /^image\/(?:webp|jpeg|png|gif|avif)$/i;

/**
 * Baixa a imagem de produto. A LISTA DE HOSTS e conferida pelo chamador antes;
 * aqui o redirect e recusado (`redirect: "error"`), para que um host da lista
 * nao vire trampolim para qualquer outro endereco.
 */
export async function fetchAllowedImage(input: ImageFetchInput): Promise<FetchedImage | null> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxBytes = input.maxBytes ?? OPAPRECO_IMAGE_MAX_BYTES;
  try {
    const response = await fetchImpl(input.url, {
      method: "GET",
      headers: { accept: "image/webp,image/avif,image/png,image/jpeg,image/gif" },
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? OPAPRECO_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const contentType = ((response.headers.get("content-type") ?? "").split(";")[0] ?? "").trim();
    if (!RASTER_IMAGE.test(contentType)) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > maxBytes) return null;
    return { bytes: buffer, contentType: contentType.toLowerCase() };
  } catch {
    return null;
  }
}

export interface ImpressionInput {
  /** `tracking.impressionUrl` devolvida pelo ad server. */
  readonly url: string;
  /** Origem do ad server configurado: a URL de impressao precisa ser dela. */
  readonly adServerUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchLike;
}

/** A URL de impressao pertence ao ad server configurado (mesma origem, https)? */
export function isAdServerUrl(candidate: string, adServerUrl: string): boolean {
  try {
    const target = new URL(candidate);
    const server = new URL(adServerUrl);
    return target.protocol === "https:" && target.origin === server.origin;
  } catch {
    return false;
  }
}

/**
 * Dispara a impressao. Fora da origem do ad server nao sai requisicao nenhuma:
 * a rota publica de tracking nao pode virar um disparador de GET para qualquer
 * endereco. Devolve se disparou (para teste); o leitor nunca ve o resultado.
 */
export async function fireImpression(input: ImpressionInput): Promise<boolean> {
  if (!isAdServerUrl(input.url, input.adServerUrl)) return false;
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    await fetchImpl(input.url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs ?? OPAPRECO_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}
