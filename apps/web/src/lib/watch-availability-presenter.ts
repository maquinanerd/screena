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
 *  - SEM pirataria: so as modalidades LEGAIS de streaming pago/gratis sao
 *    rotuladas, e o vocabulario e UNICO (`watch-offer-modality.ts`, comum aos
 *    quatro consumidores de `licensedWatchWhere`). Tipo fora do conjunto e
 *    descartado COM LOG do valor cru — nunca torrent/IPTV/player ilegal, e
 *    nunca rotulo inventado.
 *  - `ads` (catalogo gratuito com anuncio) ENTRA. Ele estava fora do conjunto e
 *    era descartado em silencio: as ofertas de Mercado Play, NetMovies, Pluto TV
 *    e "Amazon Prime Video Free with Ads" sumiam da tela sem uma linha de log.
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

import {
  PRICED_WATCH_MODALITIES,
  WATCH_MODALITY_ORDER,
  describeUnsupportedWatchModality,
  resolveWatchModality,
  watchModalityLabel,
  type WatchModality,
} from "./watch-offer-modality";

/**
 * Modalidades de streaming exibidas no painel.
 *
 * Alias do tipo canonico de `watch-offer-modality.ts` — o vocabulario (conjunto,
 * rotulos e ORDEM) mora la, num lugar so, compartilhado com os outros tres
 * consumidores de `licensedWatchWhere`.
 */
export type WatchAvailabilityOfferType = WatchModality;

/**
 * Ordem canonica dos grupos: **o que esta incluso vem antes do que custa**
 * (assinatura -> gratis -> gratis com anuncios -> aluguel -> compra).
 *
 * Nesta superficie a ordem e ESTRUTURAL, nao um sort key: o painel agrupa por
 * MODALIDADE e o leitor que varre de cima para baixo encontra primeiro o que
 * nao lhe custa nada. Ver a nota de agrupamento em `watch-offer-modality.ts`.
 */
const GROUP_ORDER: readonly WatchAvailabilityOfferType[] = WATCH_MODALITY_ORDER;

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

/**
 * Opcoes do presenter.
 *
 * `onUnsupportedOfferType` existe porque o descarte silencioso era o defeito:
 * um `offer_type` fora do conjunto sumia com um `continue` mudo. O modulo
 * continua PURO (nao escreve em lugar nenhum) — quem chama e que decide onde a
 * linha aparece. Omitir o callback e permitido, mas os quatro consumidores de
 * producao o passam.
 */
export interface WatchAvailabilityOptions {
  onUnsupportedOfferType?: (message: string, rawOfferType: string | null) => void;
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
  if (!PRICED_WATCH_MODALITIES.has(offerType)) return null;
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
  options: WatchAvailabilityOptions = {},
): WatchAvailabilityView | null {
  // ---- Passada 1: gates. Nada entra aqui sem licenca, credito e destino. ----
  const accepted: AcceptedOffer[] = [];

  for (const row of rows) {
    // Gate de licenca (invariante 6): sem display_allowed, a oferta nao existe.
    if (row.displayAllowed !== true) continue;

    const offerTypeRaw = trimToNull(row.offerType);
    const offerType = resolveWatchModality(offerTypeRaw);
    if (offerType === null) {
      // NUNCA um `continue` mudo: o valor cru vai para o chamador. Foi este
      // descarte silencioso que apagou as ofertas `ads` da tela.
      options.onUnsupportedOfferType?.(
        describeUnsupportedWatchModality(offerTypeRaw),
        offerTypeRaw,
      );
      continue;
    }

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

    // ATRIBUICAO: A TRAVA MUDOU DE ENDERECO, NAO FOI REMOVIDA.
    //
    // Ate 2026-08-12, uma oferta sem `attribution_text` (ou sem
    // `attribution_url`, quando a licenca exigia linkback) era DESCARTADA aqui:
    // o credito ficava sob o painel, e a proximidade era a prova.
    //
    // Decisao do proprietario (Pablo Eduardo, 2026-08-13): o credito saiu do
    // corpo e passou a viver no RODAPE GLOBAL. O que substituiu estes dois `if`:
    //  1. o rodape nomeia as DUAS origens de oferta — "Movie of the Night" e
    //     "JustWatch" — derivadas de `STREAMING_ORIGIN_CREDITS` em
    //     `services/legal`, entao nenhuma origem nova fica sem credito;
    //  2. `tests/web/footer-credits.test.tsx` prova, por rota, que o credito
    //     esta no texto visivel da pagina que exibe a oferta.
    //
    // NAO CONFUNDIR ESTE CREDITO COM O DESTINO DA OFERTA. `attributionUrl` e o
    // linkback para a FONTE; `deepLink`/`webUrl` sao para onde o usuario vai
    // assistir. Sao campos diferentes com destinos diferentes, e so o segundo
    // continua sendo gate: a checagem de `destinationUrl === null` acima
    // permanece intacta, porque oferta sem destino nao e falta de credito — e um
    // clique cego.
    //
    // O caminho de ESCRITA tambem continua exigindo credito: o trigger
    // `watch_availability_display_guard` recusa a linha sem a licenca e o
    // credito devidos. A proveniencia segue gravada; mudou onde ela aparece.
    const attributionText = trimToNull(row.attributionText);
    const attributionUrl = trimToNull(row.attributionUrl);

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
    groups.push({ offerType, label: watchModalityLabel(offerType), offers });
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
  options: WatchAvailabilityOptions = {},
): WatchAvailabilityOffer | null {
  const view = buildWatchAvailabilityView(rows, options);
  return view?.groups[0]?.offers[0] ?? null;
}

/**
 * Modalidades DISTINTAS de uma plataforma, ja na ordem canonica.
 *
 * E o insumo das superficies COMPACTAS ("Prime Video · Assinatura · Aluguel"):
 * uma linha por plataforma com as modalidades ao lado, nunca duas entradas da
 * mesma marca. Deriva das ofertas que passaram por TODOS os gates — uma
 * modalidade cuja oferta foi descartada por licenca, credito ou destino nao
 * pode aparecer como chip, senao o chip prometeria algo que nao esta na tela.
 */
export function distinctOfferTypesOf(
  offers: readonly WatchAvailabilityOffer[],
): WatchAvailabilityOfferType[] {
  const seen = new Set<WatchAvailabilityOfferType>();
  for (const offer of offers) seen.add(offer.offerType);
  return GROUP_ORDER.filter((offerType) => seen.has(offerType));
}
