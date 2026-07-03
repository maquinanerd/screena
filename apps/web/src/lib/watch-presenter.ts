/**
 * watch-presenter.ts — Monta a secao "Onde assistir" das paginas de detalhe
 * (filme e serie) a partir do payload controlado do PostgreSQL. PURO: sem
 * rede/DB/IO.
 *
 * Governanca (invariantes 6 e 8):
 *  - LICENCA antes de exibir: so entra oferta com `display_allowed = true`.
 *    Qualquer linha sem essa flag e descartada aqui (defesa em profundidade,
 *    alem do filtro na camada server). Sem oferta permitida -> secao omitida.
 *  - SEM pirataria: so as modalidades LEGAIS do enum `OfferType`
 *    (assinatura/aluguel/compra/gratis/anuncios/cinema) sao rotuladas. Tipos
 *    desconhecidos sao ignorados. Nunca torrent/IPTV/player ilegal.
 *  - NAO inventa disponibilidade: exibe so o que veio de `watch_availability`.
 *    Nenhum deep link e renderizado nesta fase (so nome + modalidade).
 *  - Carimbo "Atualizado em": derivado do `fetched_at` mais recente (frescor
 *    honesto). Sem `fetched_at`, nao alega atualizacao.
 */

/** Modalidades LEGAIS de oferta (espelham o enum `OfferType` do schema). */
export type WatchOfferType =
  | "subscription"
  | "rent"
  | "buy"
  | "free"
  | "ads"
  | "cinema";

/** Rotulo pt-BR de cada modalidade legal. */
const OFFER_LABELS: Readonly<Record<WatchOfferType, string>> = {
  subscription: "Assinatura",
  rent: "Aluguel",
  buy: "Compra",
  free: "Gratis",
  ads: "Com anuncios",
  cinema: "Cinema",
};

/** Ordem canonica de exibicao das modalidades dentro de um provedor. */
const OFFER_ORDER: readonly WatchOfferType[] = [
  "subscription",
  "free",
  "ads",
  "rent",
  "buy",
  "cinema",
];

/** Subconjunto de `watch_availability` necessario para a secao. */
export interface WatchOfferInput {
  /** `watch_availability.provider_name` (plataforma legal). */
  providerName: string;
  /** `watch_availability.offer_type` cru (string do enum). */
  offerType: string;
  /** `watch_availability.display_allowed` — gate-mestra (invariante 6). */
  displayAllowed: boolean;
  /** `watch_availability.fetched_at` em ISO (para o carimbo de frescor) ou null. */
  fetchedAtIso: string | null;
}

/** Um provedor legal agregado com suas modalidades permitidas. */
export interface WatchProviderView {
  providerName: string;
  /** Rotulos de modalidade distintos, em ordem canonica. */
  offerLabels: string[];
}

/** Modelo de exibicao da secao "Onde assistir". */
export interface WatchView {
  providers: WatchProviderView[];
  /** "Atualizado em DD/MM/AAAA" quando houver `fetched_at`; senao null. */
  updatedAtLabel: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isWatchOfferType(value: string): value is WatchOfferType {
  return Object.prototype.hasOwnProperty.call(OFFER_LABELS, value);
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
 * Monta a secao "Onde assistir": mantem so ofertas com `display_allowed = true`
 * e modalidade legal conhecida, agrupa por provedor (modalidades distintas em
 * ordem canonica), ordena provedores por nome e deriva o carimbo de frescor.
 *
 * Retorna `providers: []` quando nao ha oferta permitida — a pagina entao omite
 * a secao inteira (nunca exibe heading vazio nem plataforma inventada).
 */
export function buildWatchView(inputs: WatchOfferInput[]): WatchView {
  const byProvider = new Map<
    string,
    { providerName: string; offers: Set<WatchOfferType> }
  >();
  const fetchedAts: Array<string | null> = [];

  for (const input of inputs) {
    if (input.displayAllowed !== true) continue;
    const providerName = trimToNull(input.providerName);
    if (providerName === null) continue;
    const offerType = trimToNull(input.offerType);
    if (offerType === null || !isWatchOfferType(offerType)) continue;

    const key = providerName.toLowerCase();
    const existing = byProvider.get(key);
    if (existing === undefined) {
      byProvider.set(key, { providerName, offers: new Set([offerType]) });
    } else {
      existing.offers.add(offerType);
    }
    fetchedAts.push(input.fetchedAtIso);
  }

  const providers: WatchProviderView[] = [...byProvider.values()]
    .sort((a, b) => a.providerName.localeCompare(b.providerName))
    .map((entry) => ({
      providerName: entry.providerName,
      offerLabels: OFFER_ORDER.filter((offer) => entry.offers.has(offer)).map(
        (offer) => OFFER_LABELS[offer],
      ),
    }));

  return {
    providers,
    updatedAtLabel:
      providers.length === 0
        ? null
        : ((label) => (label === null ? null : `Atualizado em ${label}`))(
            formatWatchDate(mostRecentIso(fetchedAts)),
          ),
  };
}
