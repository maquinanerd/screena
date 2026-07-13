/**
 * watch-availability-presenter.ts — Monta o painel "Disponibilidade no Brasil"
 * (streaming legal por pais) das paginas de detalhe (filme e serie) a partir do
 * payload controlado do PostgreSQL. PURO: sem rede/DB/IO e sem `Date` (frescor
 * derivado so do prefixo ISO do `fetched_at`).
 *
 * Governanca (invariantes 6 e 8):
 *  - LICENCA antes de exibir: so entra oferta com `display_allowed = true`.
 *    Qualquer linha sem essa flag e descartada aqui — defesa em profundidade,
 *    alem do gate `displayAllowed: true` da query na camada server. Este PR NAO
 *    promove nenhuma linha para `display_allowed = true`.
 *  - SEM pirataria: so as 4 modalidades LEGAIS de streaming pago/gratis
 *    (assinatura/gratis/aluguel/compra) sao rotuladas. `addon` e qualquer tipo
 *    fora do conjunto sao descartados. Nunca torrent/IPTV/player ilegal.
 *  - NAO inventa disponibilidade: exibe so o que veio de `watch_availability`.
 *    Cada oferta so aparece com `provider_name`, `provider_key`, `offer_type` e
 *    um `deep_link` http/https validos; sem qualquer um deles, a linha e
 *    descartada (nunca CTA falso, logo externo, imagem ou nota).
 *  - Carimbo "Atualizado em": derivado do `fetched_at` mais recente das ofertas
 *    incluidas (frescor honesto). Sem `fetched_at`, nao alega atualizacao.
 */

/** Modalidades de streaming exibidas no painel (subconjunto legal do enum). */
export type WatchAvailabilityOfferType = "subscription" | "free" | "rent" | "buy";

/** Rotulo pt-BR de cada modalidade. */
const GROUP_LABELS: Readonly<Record<WatchAvailabilityOfferType, string>> = {
  subscription: "Assinatura",
  free: "Grátis",
  rent: "Aluguel",
  buy: "Compra",
};

/** Ordem canonica e estavel dos grupos (assinatura -> gratis -> aluguel -> compra). */
const GROUP_ORDER: readonly WatchAvailabilityOfferType[] = [
  "subscription",
  "free",
  "rent",
  "buy",
];

/** Modalidades transacionais em que o preco (quando existir) e exibido. */
const PRICED_OFFER_TYPES: ReadonlySet<WatchAvailabilityOfferType> = new Set([
  "rent",
  "buy",
]);

/** Simbolo por moeda (ISO 4217). Fora do mapa, usa o proprio codigo. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  BRL: "R$",
  USD: "US$",
  EUR: "€",
};

/** Ranking de qualidade para ordenacao desc dentro do grupo. */
const QUALITY_RANK: Readonly<Record<string, number>> = {
  uhd: 4,
  "4k": 4,
  fhd: 3,
  hd: 2,
  sd: 1,
};

/** Subconjunto de `watch_availability` necessario para o painel (ja mapeado). */
export interface WatchAvailabilityRow {
  /** `watch_availability.provider_name`. */
  providerName: string | null;
  /** `watch_availability.provider_key`. */
  providerKey: string | null;
  /** `watch_availability.offer_type` cru (string do enum). */
  offerType: string | null;
  /** `watch_availability.deep_link` (destino legal; so http/https e aceito). */
  deepLink: string | null;
  /** `watch_availability.quality` (ex.: "hd", "uhd") ou null. */
  quality: string | null;
  /** `watch_availability.price` serializado (string decimal) ou null. */
  priceAmount: string | null;
  /** `watch_availability.currency` (ISO 4217) ou null. */
  currency: string | null;
  /** `watch_availability.display_allowed` — gate-mestra (invariante 6). */
  displayAllowed: boolean;
  /** `watch_availability.fetched_at` em ISO (carimbo de frescor) ou null. */
  fetchedAtIso: string | null;
}

/** Uma oferta legal ja validada e pronta para render. */
export interface WatchAvailabilityOffer {
  providerName: string;
  providerKey: string;
  offerType: WatchAvailabilityOfferType;
  /** URL http/https de destino legal (renderizada com rel nofollow sponsored). */
  deepLink: string;
  /** Qualidade quando informada; senao null. */
  quality: string | null;
  /** Rotulo de preco (ex.: "R$ 14,90") so para aluguel/compra; senao null. */
  priceLabel: string | null;
}

/** Um grupo de modalidade com suas ofertas ordenadas. */
export interface WatchAvailabilityGroup {
  offerType: WatchAvailabilityOfferType;
  label: string;
  offers: WatchAvailabilityOffer[];
}

/** Modelo de exibicao do painel "Disponibilidade no Brasil". */
export interface WatchAvailabilityView {
  groups: WatchAvailabilityGroup[];
  /** "Atualizado em DD/MM/AAAA" quando houver `fetched_at`; senao null. */
  updatedAtLabel: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isOfferType(value: string): value is WatchAvailabilityOfferType {
  return Object.prototype.hasOwnProperty.call(GROUP_LABELS, value);
}

/** Aceita apenas deep links http/https; qualquer outro esquema vira null. */
function safeDeepLink(value: string | null): string | null {
  const trimmed = trimToNull(value);
  if (trimmed === null) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function qualityRankOf(quality: string | null): number {
  if (quality === null) return 0;
  return QUALITY_RANK[quality.toLowerCase()] ?? 0;
}

/**
 * Rotulo de preco a partir de valor + moeda. So para aluguel/compra e so quando
 * houver valor. Puro: nunca inventa moeda nem converte escala.
 */
function buildPriceLabel(
  offerType: WatchAvailabilityOfferType,
  amount: string | null,
  currency: string | null,
): string | null {
  if (!PRICED_OFFER_TYPES.has(offerType)) return null;
  const value = trimToNull(amount);
  if (value === null) return null;
  const code = trimToNull(currency);
  if (code === null) return value;
  const symbol = CURRENCY_SYMBOLS[code.toUpperCase()] ?? null;
  return symbol !== null ? `${symbol} ${value}` : `${value} ${code.toUpperCase()}`;
}

/**
 * Formata "AAAA-MM-DD..." (ISO) em "DD/MM/AAAA". Puro e deterministico (sem
 * `Date`): usa so o prefixo de data. Retorna null para entrada invalida.
 */
export function formatWatchDate(iso: string | null): string | null {
  const value = trimToNull(iso);
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** ISO mais recente (comparacao lexicografica valida em ISO-8601) ou null. */
function mostRecentIso(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    const normalized = trimToNull(value);
    if (normalized === null) continue;
    if (latest === null || normalized > latest) latest = normalized;
  }
  return latest;
}

/**
 * Monta o painel "Disponibilidade no Brasil": mantem so ofertas com
 * `display_allowed = true`, modalidade legal conhecida (assinatura/gratis/
 * aluguel/compra), `provider_name`/`provider_key` presentes e `deep_link`
 * http/https; deduplica ofertas identicas; agrupa por modalidade na ordem
 * canonica; ordena por provedor (asc) e qualidade (desc); e deriva o carimbo de
 * frescor.
 *
 * Retorna `null` quando nao ha nenhuma oferta permitida — a pagina entao NAO
 * renderiza o painel (nunca heading vazio, plataforma inventada ou pirataria).
 */
export function buildWatchAvailabilityView(
  rows: WatchAvailabilityRow[],
): WatchAvailabilityView | null {
  const seen = new Set<string>();
  const byType = new Map<WatchAvailabilityOfferType, WatchAvailabilityOffer[]>();
  const fetchedAts: Array<string | null> = [];

  for (const row of rows) {
    // Gate de licenca (invariante 6): sem display_allowed, a oferta nao existe.
    if (row.displayAllowed !== true) continue;

    const offerTypeRaw = trimToNull(row.offerType);
    if (offerTypeRaw === null || !isOfferType(offerTypeRaw)) continue; // descarta addon/desconhecido
    const offerType = offerTypeRaw;

    const providerName = trimToNull(row.providerName);
    const providerKey = trimToNull(row.providerKey);
    const deepLink = safeDeepLink(row.deepLink);
    if (providerName === null || providerKey === null || deepLink === null) continue;

    const quality = trimToNull(row.quality);
    const priceLabel = buildPriceLabel(offerType, row.priceAmount, row.currency);

    // Dedupe por provedor/modalidade/link/qualidade/preco.
    const dedupeKey = [
      providerKey.toLowerCase(),
      offerType,
      deepLink,
      quality ?? "",
      priceLabel ?? "",
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const offer: WatchAvailabilityOffer = {
      providerName,
      providerKey,
      offerType,
      deepLink,
      quality,
      priceLabel,
    };
    const bucket = byType.get(offerType);
    if (bucket === undefined) byType.set(offerType, [offer]);
    else bucket.push(offer);

    fetchedAts.push(row.fetchedAtIso);
  }

  const groups: WatchAvailabilityGroup[] = [];
  for (const offerType of GROUP_ORDER) {
    const offers = byType.get(offerType);
    if (offers === undefined || offers.length === 0) continue;
    offers.sort((a, b) => {
      const byName = a.providerName.localeCompare(b.providerName);
      if (byName !== 0) return byName;
      const byQuality = qualityRankOf(b.quality) - qualityRankOf(a.quality); // desc
      if (byQuality !== 0) return byQuality;
      return a.deepLink.localeCompare(b.deepLink); // desempate estavel
    });
    groups.push({ offerType, label: GROUP_LABELS[offerType], offers });
  }

  if (groups.length === 0) return null;

  const updatedDate = formatWatchDate(mostRecentIso(fetchedAts));
  return {
    groups,
    updatedAtLabel: updatedDate === null ? null : `Atualizado em ${updatedDate}`,
  };
}
