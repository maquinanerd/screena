/**
 * editorial-context-presenter.ts — Monta o `cinerie-editorial-context-v1` a
 * partir do que o catalogo ja leu. PURO: sem banco, sem rede, sem relogio
 * proprio (o instante chega por parametro).
 *
 * QUEM CONSOME. O Cinerie Context Service (ADR 0015, secao 3.2) nasceu para o
 * MNScr; o primeiro consumidor real e a Maquina Nerd — o MN-Prime, que redige a
 * materia, e o portal, que mostra a ficha da obra ao lado do texto. Os dois
 * recebem o MESMO contrato.
 *
 * AS DUAS REGRAS DO CONTRATO, aplicadas aqui e nao no consumidor:
 *
 *  1. MIDIA: existir no catalogo nao autoriza uso. So entra midia que passou
 *     pelo MESMO portao que a pagina publica da Cinerie usa (licenca de imagem
 *     `tmdb/image`; linha de video `display_allowed`), e o uso editorial fora da
 *     Cinerie e uma chave PROPRIA (`mediaForEditorial`), decidida pelo dono —
 *     ver `docs/operations/editorial-context.md`. Sem a chave, a midia nem e
 *     listada, e a lacuna vai em `omissions`.
 *  2. PROVENIENCIA: todo fato carrega `origin`. Aqui e sempre `cinerie_catalog`
 *     (dado do catalogo) ou `licensed_media` (midia autorizada).
 *
 * Os tipos abaixo ESPELHAM o contrato de `@screena/editorial-contracts` sem
 * importa-lo — o app web nao depende daquele pacote em runtime. O espelho e
 * travado por teste: a saida deste modulo passa por
 * `parseCinerieEditorialContextV1` em `__tests__/editorial-context-presenter.test.ts`.
 */

import type { ContextKind } from "./editorial-context-request";
import type { WatchAvailabilityView } from "./watch-availability-presenter";

export const EDITORIAL_CONTEXT_CONTRACT_VERSION = "cinerie-editorial-context-v1" as const;

/* ------------------------------------------------------------------ */
/* Entrada: o que o servidor leu                                       */
/* ------------------------------------------------------------------ */

export interface ContextImageInput {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface ContextPersonInput {
  readonly personId: string;
  readonly name: string;
  readonly slug: string | null;
  readonly character: string | null;
}

export interface ContextTrailerInput {
  readonly embedUrl: string;
  readonly watchUrl: string;
  readonly name: string | null;
}

/** A ficha de UM titulo, como o servidor a leu (ja passada pelos portoes de leitura). */
export interface ContextTitleInput {
  readonly kind: ContextKind;
  readonly entityId: string;
  readonly title: string;
  readonly originalTitle: string | null;
  readonly slug: string;
  readonly canonicalUrl: string;
  readonly synopsis: { readonly text: string; readonly languageCode: string } | null;
  /** `YYYY-MM-DD` da estreia (filme) ou do primeiro episodio (serie). */
  readonly releaseDateIso: string | null;
  readonly runtimeMinutes: number | null;
  readonly genres: readonly string[];
  readonly externalIds: readonly { readonly source: string; readonly externalId: string }[];
  readonly tmdbId: number;
  readonly cast: readonly ContextPersonInput[];
  readonly directors: readonly ContextPersonInput[];
  readonly writers: readonly ContextPersonInput[];
  /**
   * Imagens. Ja vem `null`/vazias quando a licenca de imagem nega — o servidor
   * monta a URL por `tmdbImageUrlIfAllowed`, a mesma porta da pagina publica.
   */
  readonly poster: ContextImageInput | null;
  readonly backdrop: ContextImageInput | null;
  readonly scenes: readonly ContextImageInput[];
  /** O motivo, quando a licenca de imagem negou. `null` quando autorizou. */
  readonly imageDeniedReason: string | null;
  readonly trailer: ContextTrailerInput | null;
  readonly watch: WatchAvailabilityView | null;
  readonly series: {
    readonly seasons: number | null;
    readonly episodes: number | null;
    readonly lastAirDateIso: string | null;
    readonly ended: boolean;
  } | null;
}

export interface ContextBuildOptions {
  readonly requestId: string;
  readonly now: Date;
  readonly siteUrl: string;
  /**
   * Uso editorial FORA da Cinerie (materia de outro site do grupo). Chave do
   * dono, nao da licenca: a licenca diz que a Cinerie pode exibir; esta chave
   * diz que a redacao da Maquina Nerd pode usar a mesma arte na materia.
   */
  readonly mediaForEditorial: boolean;
  /** Credito de imagem exigido pela licenca vigente (`attribution_text`). */
  readonly imageCredit: string;
}

/* ------------------------------------------------------------------ */
/* Saida: espelho do contrato                                          */
/* ------------------------------------------------------------------ */

export type MediaRole = "poster" | "backdrop" | "scene" | "trailer";

export interface ContextPerson {
  entityId: string;
  name: string;
  slug?: string;
  canonicalUrl?: string;
  role?: string;
  character?: string;
  externalIds: { provider: "tmdb" | "imdb" | "wikidata"; value: string; url?: string }[];
}

export interface ContextEntity {
  entityKind: ContextKind;
  entityId: string;
  title: string;
  originalTitle?: string;
  slug?: string;
  canonicalUrl?: string;
  language: string;
  overview?: string;
  releaseDate?: string;
  runtimeMinutes?: number;
  genres: string[];
  seasonCount?: number;
  episodeCount?: number;
  lastAirDate?: string;
  ended?: boolean;
  externalIds: { provider: "tmdb" | "imdb" | "wikidata"; value: string; url?: string }[];
  cast: ContextPerson[];
  crew: ContextPerson[];
  origin: "cinerie_catalog";
}

export interface ContextMedia {
  mediaId: string;
  kind: "image" | "video" | "trailer";
  role: MediaRole;
  /** Filme e serie tem sequencias de id independentes: o tipo vai junto do id. */
  entityKind: ContextKind;
  entityId: string;
  url: string;
  embedUrl?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  alt?: string;
  caption?: string;
  credit?: string;
  sourceName?: string;
  licenseStatus: "approved";
  requiresAttribution: boolean;
  allowedForEditorial: boolean;
  allowedForHero: boolean;
  allowedForSocial: boolean;
  restrictions: string[];
  origin: "licensed_media";
}

export interface ContextAvailability {
  entityKind: ContextKind;
  entityId: string;
  country: "BR";
  providerName: string;
  offerType: "flatrate" | "rent" | "buy" | "free" | "ads";
  url?: string;
  displayAllowed: true;
  attributionText?: string;
}

export interface ContextOmission {
  scope: "entity" | "media" | "availability" | "article";
  ref?: string;
  reason: "license_unknown" | "license_blocked" | "not_translated" | "not_published" | "private_data";
}

export interface EditorialContextV1 {
  contractVersion: typeof EDITORIAL_CONTEXT_CONTRACT_VERSION;
  requestId: string;
  language: "pt-BR";
  generatedAt: string;
  entities: ContextEntity[];
  relations: never[];
  media: ContextMedia[];
  publishedArticles: never[];
  coverageTimeline: never[];
  availability: ContextAvailability[];
  omissions: ContextOmission[];
}

/* ------------------------------------------------------------------ */
/* Limites (os do contrato)                                            */
/* ------------------------------------------------------------------ */

const SHORT_TEXT = 500;
const TITLE_TEXT = 300;
const SUMMARY_TEXT = 2_000;

/** Elenco que vai no contexto: o topo da ordem de creditos, como na ficha. */
export const CONTEXT_CAST_LIMIT = 12;

/** Mesmo `stableId` do contrato. */
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
/** Mesmo `slugProposal` do contrato. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Texto que o contrato aceita: o contrato RECUSA marcacao, e uma sinopse com
 * `<i>` (o TMDB tem algumas) derrubaria a resposta inteira. Aqui a marcacao e
 * removida e o texto e cortado no limite — nunca recusado por isso.
 */
export function contractText(value: string | null | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  const cleaned = value
    .replace(/<\s*\/?\s*(?:br|p|div|li)(?![a-z])[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\bon[a-z]+\s*=\s*["']/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned === "") return undefined;
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function slugOrUndefined(slug: string | null | undefined): string | undefined {
  if (slug == null) return undefined;
  return SLUG.test(slug) && slug.length <= 200 ? slug : undefined;
}

function externalIdsFor(
  tmdbId: number,
  kind: ContextKind,
  rows: ContextTitleInput["externalIds"],
): ContextEntity["externalIds"] {
  const out: ContextEntity["externalIds"] = [
    { provider: "tmdb", value: String(tmdbId), url: `https://www.themoviedb.org/${kind}/${String(tmdbId)}` },
  ];
  for (const row of rows) {
    const source = row.source.toLowerCase();
    const value = row.externalId.trim();
    if (!STABLE_ID.test(value)) continue;
    if (source === "imdb" && /^tt\d+$/.test(value)) {
      if (!out.some((id) => id.provider === "imdb")) {
        out.push({ provider: "imdb", value, url: `https://www.imdb.com/title/${value}/` });
      }
    } else if (source === "wikidata" && /^Q\d+$/.test(value)) {
      if (!out.some((id) => id.provider === "wikidata")) {
        out.push({ provider: "wikidata", value, url: `https://www.wikidata.org/wiki/${value}` });
      }
    }
  }
  return out;
}

function personFor(person: ContextPersonInput, siteUrl: string, role: string | null): ContextPerson | null {
  const name = contractText(person.name, SHORT_TEXT);
  if (name === undefined || !STABLE_ID.test(person.personId)) return null;
  const slug = slugOrUndefined(person.slug);
  const character = contractText(person.character, SHORT_TEXT);
  return {
    entityId: person.personId,
    name,
    ...(slug === undefined ? {} : { slug, canonicalUrl: `${siteUrl}/pt/pessoas/${slug}/` }),
    ...(role === null ? {} : { role }),
    ...(character === undefined ? {} : { character }),
    externalIds: [],
  };
}

const OFFER_TYPE: Readonly<Record<string, ContextAvailability["offerType"]>> = {
  subscription: "flatrate",
  free: "free",
  ads: "ads",
  rent: "rent",
  buy: "buy",
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function availabilityFor(input: ContextTitleInput): ContextAvailability[] {
  if (input.watch === null) return [];
  const out: ContextAvailability[] = [];
  const seen = new Set<string>();
  for (const group of input.watch.groups) {
    for (const offer of group.offers) {
      const offerType = OFFER_TYPE[offer.offerType];
      if (offerType === undefined) continue;
      const providerName = contractText(offer.providerName, SHORT_TEXT);
      if (providerName === undefined) continue;
      const key = `${providerName}|${offerType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const attributionText = contractText(offer.attribution?.text, SHORT_TEXT);
      out.push({
        entityKind: input.kind,
        entityId: input.entityId,
        country: "BR",
        providerName,
        offerType,
        ...(isHttpUrl(offer.destinationUrl) ? { url: offer.destinationUrl } : {}),
        displayAllowed: true,
        ...(attributionText === undefined ? {} : { attributionText }),
      });
    }
  }
  return out;
}

function aspectOf(width: number, height: number): string | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const ratio = width / height;
  if (Math.abs(ratio - 2 / 3) < 0.02) return "2:3";
  if (Math.abs(ratio - 16 / 9) < 0.03) return "16:9";
  return undefined;
}

function imageMedia(
  input: ContextTitleInput,
  image: ContextImageInput,
  role: Exclude<MediaRole, "trailer">,
  index: number,
  options: ContextBuildOptions,
): ContextMedia {
  const aspectRatio = aspectOf(image.width, image.height);
  const label = role === "poster" ? "Pôster" : role === "backdrop" ? "Imagem de divulgação" : "Cena";
  // Pôster e arte de catalogo, vertical e com titulo estampado: serve para a
  // ficha e para o corpo, nunca para capa (corte 16:9 decapita a arte). Cena e
  // backdrop sao a capa natural.
  const hero = options.mediaForEditorial && role !== "poster";
  return {
    mediaId: `cinerie:${input.kind}:${input.entityId}:${role}:${String(index)}`,
    kind: "image",
    role,
    entityKind: input.kind,
    entityId: input.entityId,
    url: image.url,
    width: image.width,
    height: image.height,
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    alt: contractText(`${label} de ${input.title}`, SHORT_TEXT) ?? label,
    credit: options.imageCredit,
    sourceName: "TMDB",
    licenseStatus: "approved",
    requiresAttribution: true,
    allowedForEditorial: options.mediaForEditorial,
    allowedForHero: hero,
    allowedForSocial: hero,
    restrictions: ["creditar a fonte na legenda", "sem recorte que esconda o titulo da arte"],
    origin: "licensed_media",
  };
}

function trailerMedia(input: ContextTitleInput, trailer: ContextTrailerInput): ContextMedia {
  const caption = contractText(trailer.name, SHORT_TEXT);
  return {
    mediaId: `cinerie:${input.kind}:${input.entityId}:trailer:0`,
    kind: "trailer",
    role: "trailer",
    entityKind: input.kind,
    entityId: input.entityId,
    url: trailer.watchUrl,
    embedUrl: trailer.embedUrl,
    aspectRatio: "16:9",
    alt: contractText(`Trailer de ${input.title}`, SHORT_TEXT) ?? "Trailer",
    ...(caption === undefined ? {} : { caption }),
    sourceName: "YouTube",
    licenseStatus: "approved",
    // Incorporacao pelo player oficial: o credito e o proprio player.
    requiresAttribution: false,
    allowedForEditorial: true,
    allowedForHero: false,
    allowedForSocial: false,
    restrictions: ["somente incorporado pelo player oficial do YouTube"],
    origin: "licensed_media",
  };
}

/** Uma entidade do contexto. Pura; exportada para teste. */
export function entityFor(input: ContextTitleInput, siteUrl: string): ContextEntity {
  const title = contractText(input.title, TITLE_TEXT) ?? input.entityId;
  const originalTitle = contractText(input.originalTitle, TITLE_TEXT);
  const overview = contractText(input.synopsis?.text, SUMMARY_TEXT);
  const slug = slugOrUndefined(input.slug);
  const cast = input.cast
    .slice(0, CONTEXT_CAST_LIMIT)
    .map((person) => personFor(person, siteUrl, "ator"))
    .filter((person): person is ContextPerson => person !== null);
  const crew = [
    ...input.directors.map((person) => personFor(person, siteUrl, "direção")),
    ...input.writers.map((person) => personFor(person, siteUrl, "roteiro")),
  ].filter((person): person is ContextPerson => person !== null);
  const genres = input.genres
    .map((genre) => contractText(genre, SHORT_TEXT))
    .filter((genre): genre is string => genre !== undefined)
    .slice(0, 20);

  return {
    entityKind: input.kind,
    entityId: input.entityId,
    title,
    ...(originalTitle === undefined || originalTitle === title ? {} : { originalTitle }),
    ...(slug === undefined ? {} : { slug }),
    ...(isHttpUrl(input.canonicalUrl) ? { canonicalUrl: input.canonicalUrl } : {}),
    language: "pt-BR",
    ...(overview === undefined ? {} : { overview }),
    ...(input.releaseDateIso === null ? {} : { releaseDate: input.releaseDateIso }),
    ...(input.runtimeMinutes !== null && input.runtimeMinutes > 0 ? { runtimeMinutes: input.runtimeMinutes } : {}),
    genres,
    ...(input.series === null
      ? {}
      : {
          ...(input.series.seasons !== null && input.series.seasons >= 0 ? { seasonCount: input.series.seasons } : {}),
          ...(input.series.episodes !== null && input.series.episodes >= 0
            ? { episodeCount: input.series.episodes }
            : {}),
          ...(input.series.lastAirDateIso === null ? {} : { lastAirDate: input.series.lastAirDateIso }),
          ended: input.series.ended,
        }),
    externalIds: externalIdsFor(input.tmdbId, input.kind, input.externalIds),
    cast,
    crew,
    origin: "cinerie_catalog",
  };
}

/**
 * O contexto inteiro.
 *
 * As omissoes sao EXPLICITAS: uma obra sem sinopse em portugues, sem imagem
 * autorizada ou sem oferta no Brasil vai com a lacuna nomeada, para que o
 * redator nao trate ausencia como inexistencia (invariante do contrato).
 */
export function buildEditorialContext(
  titles: readonly ContextTitleInput[],
  options: ContextBuildOptions,
): EditorialContextV1 {
  const entities: ContextEntity[] = [];
  const media: ContextMedia[] = [];
  const availability: ContextAvailability[] = [];
  const omissions: ContextOmission[] = [];

  for (const input of titles) {
    entities.push(entityFor(input, options.siteUrl));

    if (input.synopsis === null || input.synopsis.languageCode !== "pt-BR") {
      omissions.push({ scope: "entity", ref: input.entityId, reason: "not_translated" });
    }

    const images: { image: ContextImageInput; role: Exclude<MediaRole, "trailer"> }[] = [
      ...(input.backdrop === null ? [] : [{ image: input.backdrop, role: "backdrop" as const }]),
      ...input.scenes.map((image) => ({ image, role: "scene" as const })),
      ...(input.poster === null ? [] : [{ image: input.poster, role: "poster" as const }]),
    ];
    const seenUrls = new Set<string>();
    const uniqueImages = images.filter(({ image }) => {
      if (!isHttpUrl(image.url) || seenUrls.has(image.url)) return false;
      seenUrls.add(image.url);
      return true;
    });

    if (input.imageDeniedReason !== null) {
      omissions.push({ scope: "media", ref: input.entityId, reason: "license_blocked" });
    } else if (!options.mediaForEditorial && uniqueImages.length > 0) {
      // A licenca deixa a Cinerie exibir, mas o uso fora dela esta desligado: a
      // arte nem e oferecida. "Bloqueado" e o que o consumidor precisa saber.
      omissions.push({ scope: "media", ref: input.entityId, reason: "license_blocked" });
    } else {
      uniqueImages.forEach(({ image, role }, index) => {
        media.push(imageMedia(input, image, role, index, options));
      });
    }

    if (input.trailer !== null && isHttpUrl(input.trailer.watchUrl) && isHttpUrl(input.trailer.embedUrl)) {
      media.push(trailerMedia(input, input.trailer));
    }

    const offers = availabilityFor(input);
    if (offers.length === 0) {
      omissions.push({ scope: "availability", ref: input.entityId, reason: "license_unknown" });
    }
    availability.push(...offers);
  }

  return {
    contractVersion: EDITORIAL_CONTEXT_CONTRACT_VERSION,
    requestId: options.requestId,
    language: "pt-BR",
    generatedAt: options.now.toISOString(),
    entities,
    relations: [],
    media,
    publishedArticles: [],
    coverageTimeline: [],
    availability,
    omissions,
  };
}
