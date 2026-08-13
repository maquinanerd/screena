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
 *    um DESTINO http/https valido; sem qualquer um deles, a linha e descartada
 *    (nunca CTA falso, logo externo, imagem ou nota).
 *  - DESTINO tem duas naturezas, e elas nao podem ser confundidas na tela:
 *    `deep_link` leva a pagina do titulo NO PROVEDOR (Netflix, Max...);
 *    `web_url` leva a pagina do titulo NO AGREGADOR daquele pais (o `link` que o
 *    TMDB publica por pais, alimentado pelo JustWatch). O TMDB nao publica deep
 *    link por oferta, entao a oferta de origem TMDB so tem o segundo. Rotular os
 *    dois como "ir para a Netflix" seria afirmar um destino que o upstream nunca
 *    prometeu — por isso a oferta carrega `destinationKind`, e o painel usa isso.
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
  /**
   * `watch_providers.slug` do provedor CANONICO (via `watch_provider_id`).
   *
   * E a unica identidade estavel ENTRE fornecedores tecnicos: a Netflix e
   * `"netflix"` para a RapidAPI e `"8"` para o TMDB, mas o mesmo slug nos dois.
   * Sem ele, a mesma plataforma apareceria duas vezes no painel quando os dois
   * caminhos tivessem oferta. `null` quando o alias ainda nao esta mapeado —
   * nesse caso a oferta nem chega aqui exibivel (o trigger a barra).
   */
  providerSlug: string | null;
  /** `watch_availability.offer_type` cru (string do enum). */
  offerType: string | null;
  /** `watch_availability.deep_link` — destino NO PROVEDOR; so http/https. */
  deepLink: string | null;
  /**
   * `watch_availability.web_url` — destino NO AGREGADOR do pais (a pagina que o
   * TMDB publica por pais, alimentada pelo JustWatch). Usado como destino quando
   * nao ha `deep_link`, que e sempre o caso da origem TMDB.
   */
  webUrl: string | null;
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
  /** `watch_availability.requires_attribution` — licenca exige credito. */
  requiresAttribution: boolean;
  /** `watch_availability.requires_linkback` — licenca exige link para a fonte. */
  requiresLinkback: boolean;
  /** `watch_availability.attribution_text` (ex.: "Disponibilidade fornecida por ..."). */
  attributionText: string | null;
  /** `watch_availability.attribution_url` — destino do linkback. */
  attributionUrl: string | null;
}

/**
 * Credito da fonte agregadora exibido junto ao painel.
 *
 * A licenca do agregador (ex.: Movie of the Night) exige `requires_attribution`
 * e `requires_linkback`; a matriz em docs/legal/source-authorization-matrix.md
 * registra "atribuicao junto ao painel". Exibir a oferta sem o credito viola a
 * propria licenca que autoriza exibi-la.
 */
export interface WatchAvailabilityAttribution {
  /** Texto do credito, exatamente como licenciado. */
  text: string;
  /** Linkback quando exigido/registrado; null quando a licenca nao exige. */
  url: string | null;
}

/**
 * Natureza do destino de uma oferta. NUNCA colapsar os dois: o rotulo que a UI
 * pode prometer depende disto.
 */
export type WatchDestinationKind =
  /** `deep_link`: a pagina do titulo NO PROVEDOR. */
  | "provider"
  /** `web_url`: a pagina do titulo no AGREGADOR daquele pais. */
  | "aggregator";

/** Uma oferta legal ja validada e pronta para render. */
export interface WatchAvailabilityOffer {
  providerName: string;
  providerKey: string;
  offerType: WatchAvailabilityOfferType;
  /** URL http/https de destino legal (renderizada com rel nofollow sponsored). */
  destinationUrl: string;
  /** O que `destinationUrl` REALMENTE e — provedor ou agregador. */
  destinationKind: WatchDestinationKind;
  /** Qualidade quando informada; senao null. */
  quality: string | null;
  /** Rotulo de preco (ex.: "R$ 14,90") so para aluguel/compra; senao null. */
  priceLabel: string | null;
  /**
   * Credito DESTA oferta (a licenca que autoriza exibir e a mesma que obriga
   * creditar). `null` so quando a licenca nao exige atribuicao — uma oferta que
   * exigia e nao tinha ja foi descartada. Superficies que mostram UMA oferta
   * isolada (ex.: faixa da home) precisam do credito da oferta, nao do agregado
   * do painel.
   */
  attribution: WatchAvailabilityAttribution | null;
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
  /**
   * Creditos das fontes das ofertas EXIBIDAS (dedupe por texto+url, ordem
   * estavel). Nunca vazio quando ha grupo: uma oferta que exige credito e nao o
   * tem foi descartada antes de chegar aqui.
   */
  attributions: WatchAvailabilityAttribution[];
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

/** Uma oferta que passou por TODOS os gates, ainda com o contexto de escolha. */
interface AcceptedOffer {
  readonly offer: WatchAvailabilityOffer;
  /** Identidade da plataforma ENTRE fornecedores (slug canonico ou fallback). */
  readonly canonicalId: string;
  readonly fetchedAtIso: string | null;
}

/**
 * PRECEDENCIA ENTRE FORNECEDORES TECNICOS — declarada, nao emergente.
 *
 * A mesma plataforma pode chegar por dois caminhos: `streaming_availability`
 * (RapidAPI), que publica deep link POR OFERTA, e `tmdb`, que so publica um link
 * por PAIS (a pagina do agregador). Quando os dois trazem oferta para a mesma
 * plataforma e a mesma modalidade, o painel mostraria "Netflix — Assinatura"
 * duas vezes, com destinos diferentes.
 *
 * A REGRA: para um mesmo (plataforma canonica, modalidade), a oferta com destino
 * NO PROVEDOR vence a oferta com destino no AGREGADOR. O motivo e o usuario, nao
 * o fornecedor — o deep link leva ao titulo no servico; a pagina do agregador
 * leva a mais uma escolha. Nunca o inverso, e nunca "a mais recente".
 *
 * O QUE ESTA REGRA **NAO** FAZ: ela nao colapsa variantes legitimas. Aluguel em
 * HD e aluguel em 4K, do mesmo provedor, continuam sendo duas linhas — a
 * deduplicacao fina (link/qualidade/preco) segue depois e inalterada. So a
 * duplicata de PROVENIENCIA e removida.
 */
function keyOfProvenanceRivalry(accepted: AcceptedOffer): string {
  return `${accepted.canonicalId}|${accepted.offer.offerType}`;
}

/**
 * Monta o painel "Disponibilidade no Brasil": mantem so ofertas com
 * `display_allowed = true`, modalidade legal conhecida (assinatura/gratis/
 * aluguel/compra), `provider_name`/`provider_key` presentes e um DESTINO
 * http/https (deep link do provedor ou, na falta dele, a pagina do agregador
 * daquele pais); resolve a precedencia entre fornecedores tecnicos; deduplica
 * ofertas identicas; agrupa por modalidade na ordem canonica; ordena por
 * provedor (asc) e qualidade (desc); e deriva o carimbo de frescor.
 *
 * Retorna `null` quando nao ha nenhuma oferta permitida — a pagina entao NAO
 * renderiza o painel (nunca heading vazio, plataforma inventada ou pirataria).
 */
export function buildWatchAvailabilityView(
  rows: WatchAvailabilityRow[],
): WatchAvailabilityView | null {
  // ---- Passada 1: gates. Nada entra aqui sem licenca, credito e destino. ----
  const accepted: AcceptedOffer[] = [];

  for (const row of rows) {
    // Gate de licenca (invariante 6): sem display_allowed, a oferta nao existe.
    if (row.displayAllowed !== true) continue;

    const offerTypeRaw = trimToNull(row.offerType);
    if (offerTypeRaw === null || !isOfferType(offerTypeRaw)) continue; // descarta addon/desconhecido
    const offerType = offerTypeRaw;

    const providerName = trimToNull(row.providerName);
    const providerKey = trimToNull(row.providerKey);
    if (providerName === null || providerKey === null) continue;

    // DESTINO: o deep link do provedor quando existe; senao a pagina do pais no
    // agregador. A ordem e a precedencia, e a natureza viaja junto para que a UI
    // nao possa prometer "ir para a Netflix" apontando para o agregador.
    // A oferta de origem TMDB SEMPRE cai no segundo caso: o upstream nao publica
    // deep link por oferta, e fabricar um seria afirmar destino inexistente.
    const providerLink = safeDeepLink(row.deepLink);
    const aggregatorLink = safeDeepLink(row.webUrl);
    const destinationUrl = providerLink ?? aggregatorLink;
    if (destinationUrl === null) continue;
    const destinationKind: WatchDestinationKind =
      providerLink !== null ? "provider" : "aggregator";

    // ATRIBUICAO EXIGIDA E AUSENTE = NAO EXIBE (invariante 6). Mesma regra que
    // `toPublicRating` ja aplica as notas: a licenca que autoriza exibir e a
    // mesma que obriga a creditar; exibir sem credito nao e "quase certo", e
    // uso nao licenciado. Fail-closed por OFERTA, nao pelo painel inteiro.
    // `!== false` (nao `=== true`) e deliberado: a coluna nasce `default(true)`,
    // entao QUALQUER coisa que nao seja um "false" explicito conta como
    // exigencia. Com `&&` simples, um campo ausente seria falsy e desligaria o
    // gate em silencio — exatamente o modo de falha que este gate existe para
    // impedir. Mesmo espirito do `displayAllowed !== true` acima.
    const attributionText = trimToNull(row.attributionText);
    const attributionUrl = trimToNull(row.attributionUrl);
    if (row.requiresAttribution !== false && attributionText === null) continue;
    if (row.requiresLinkback !== false && attributionUrl === null) continue;

    const quality = trimToNull(row.quality);
    const priceLabel = buildPriceLabel(offerType, row.priceAmount, row.currency);

    accepted.push({
      // Slug canonico e a identidade ENTRE fornecedores; sem ele (alias nao
      // mapeado) a oferta so pode rivalizar consigo mesma, e o fallback pela
      // chave tecnica preserva o comportamento historico de um fornecedor so.
      canonicalId: (trimToNull(row.providerSlug) ?? providerKey).toLowerCase(),
      fetchedAtIso: row.fetchedAtIso,
      offer: {
        providerName,
        providerKey,
        offerType,
        destinationUrl,
        destinationKind,
        quality,
        priceLabel,
        attribution:
          attributionText === null ? null : { text: attributionText, url: attributionUrl },
      },
    });
  }

  // ---- Passada 2: precedencia de proveniencia (ver keyOfProvenanceRivalry). --
  const providerBacked = new Set<string>();
  for (const candidate of accepted) {
    if (candidate.offer.destinationKind === "provider") {
      providerBacked.add(keyOfProvenanceRivalry(candidate));
    }
  }

  const byType = new Map<WatchAvailabilityOfferType, WatchAvailabilityOffer[]>();
  const fetchedAts: Array<string | null> = [];
  const attributions: WatchAvailabilityAttribution[] = [];
  const seenAttributions = new Set<string>();
  const seen = new Set<string>();

  for (const candidate of accepted) {
    if (
      candidate.offer.destinationKind === "aggregator" &&
      providerBacked.has(keyOfProvenanceRivalry(candidate))
    ) {
      continue; // a mesma plataforma/modalidade ja tem destino no provedor
    }

    const { offer } = candidate;
    // Dedupe fino por provedor/modalidade/destino/qualidade/preco. Preservado
    // como estava: variantes reais (HD vs 4K) continuam sendo linhas distintas.
    const dedupeKey = [
      offer.providerKey.toLowerCase(),
      offer.offerType,
      offer.destinationUrl,
      offer.quality ?? "",
      offer.priceLabel ?? "",
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const bucket = byType.get(offer.offerType);
    if (bucket === undefined) byType.set(offer.offerType, [offer]);
    else bucket.push(offer);

    fetchedAts.push(candidate.fetchedAtIso);

    // Credito so da oferta que REALMENTE entrou. Uma oferta descartada acima
    // nao arrasta seu credito para a tela (credito orfao = credito mentiroso).
    // Vale tambem para a perdedora da precedencia: se a oferta TMDB saiu, o
    // credito do JustWatch sai com ela.
    const { attribution } = offer;
    if (attribution !== null) {
      const key = `${attribution.text}|${attribution.url ?? ""}`;
      if (!seenAttributions.has(key)) {
        seenAttributions.add(key);
        attributions.push(attribution);
      }
    }
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
      return a.destinationUrl.localeCompare(b.destinationUrl); // desempate estavel
    });
    groups.push({ offerType, label: GROUP_LABELS[offerType], offers });
  }

  if (groups.length === 0) return null;

  const updatedDate = formatWatchDate(mostRecentIso(fetchedAts));
  return {
    groups,
    updatedAtLabel: updatedDate === null ? null : `Atualizado em ${updatedDate}`,
    attributions,
  };
}

/**
 * Escolhe UMA oferta para superficies compactas (faixa amarela da home), de
 * forma DETERMINISTICA e sem duplicar regra: delega a
 * `buildWatchAvailabilityView` — mesmos gates de licenca, mesma exclusao de
 * modalidade ilegal/desconhecida, mesma exigencia de atribuicao/linkback,
 * mesma ordenacao canonica — e devolve a primeira oferta do primeiro grupo.
 *
 * A politica de prioridade e, portanto, a ja publicada pelo painel:
 * assinatura -> gratis -> aluguel -> compra; dentro do grupo, provedor (asc),
 * qualidade (desc) e destino (desempate estavel). Nao ha "provedor principal"
 * por popularidade comercial: isso seria uma afirmacao sem dado persistido.
 * A precedencia entre fornecedores tecnicos tambem vem de la — a faixa da home
 * nunca mostra o destino do agregador quando existe deep link do provedor.
 *
 * `null` quando nao ha nenhuma oferta exibivel — a superficie entao cai no CTA
 * generico, nunca em plataforma inventada.
 */
export function selectTickerWatchOffer(
  rows: WatchAvailabilityRow[],
): WatchAvailabilityOffer | null {
  const view = buildWatchAvailabilityView(rows);
  return view?.groups[0]?.offers[0] ?? null;
}
