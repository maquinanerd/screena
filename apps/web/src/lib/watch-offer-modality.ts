/**
 * watch-offer-modality.ts — Vocabulario UNICO da modalidade de uma oferta.
 * PURO (sem rede/DB/IO, sem `Date`).
 *
 * ============ POR QUE ISTO EXISTE ============
 *
 * A colheita de producao mediu o corpus: **18.077 `buy` + 18.330 `rent` contra
 * 10.970 `subscription`**. Compra e aluguel sao a MAIORIA do dado. Uma fileira
 * que mostra so a marca ("Amazon", "Apple TV") num titulo que custa R$ 14,90 de
 * aluguel afirma ao leitor que esta incluso na assinatura que ele ja paga. E a
 * mesma familia de defeito do "Original Screen" e do RT exibido como `80/100` —
 * e esta custa dinheiro do leitor.
 *
 * O vocabulario estava ESPALHADO e DIVERGENTE em tres lugares:
 *  - `watch-availability-presenter.ts` conhecia 4 modalidades e DESCARTAVA `ads`
 *    em silencio (Mercado Play, NetMovies, Pluto TV, Prime Video Free with Ads —
 *    todas as ofertas gratuitas com anuncio sumiam da tela sem uma linha de log);
 *  - `watch-popular.tsx` tinha um mapa proprio com `addon` (valor que NAO existe
 *    no enum `OfferType`) e caia para `?? offer`, imprimindo o valor cru do enum
 *    na cara do leitor;
 *  - `discover.ts` e a faixa da home nao mostravam modalidade nenhuma.
 *
 * Regra critica repetida em quatro lugares diverge; num lugar so, nao — a mesma
 * licao que criou `watch-platform-identity.ts`.
 *
 * ============ O QUE ESTE MODULO NAO FAZ ============
 *
 * Nao inventa rotulo. Um `offer_type` fora do conjunto conhecido devolve `null`
 * e o chamador e OBRIGADO a decidir o que fazer com ele — nunca imprimir o valor
 * cru, nunca aproximar para a modalidade mais parecida (isso afirmaria um
 * contrato comercial que o upstream nao declarou).
 */

/** Modalidades que a tela sabe nomear. Subconjunto do enum `OfferType`. */
export const WATCH_MODALITIES = ["subscription", "free", "ads", "rent", "buy"] as const;

export type WatchModality = (typeof WATCH_MODALITIES)[number];

/**
 * ORDEM CANONICA: **o que esta incluso vem antes do que custa.**
 *
 * `subscription` primeiro (o leitor provavelmente ja paga), depois o gratuito
 * (`free`, e entao `ads`, que e gratuito porem com contrapartida), e so entao o
 * transacional (`rent` antes de `buy`, porque alugar custa menos que comprar).
 *
 * A ordem e declarada AQUI e nao emerge de ordenacao alfabetica nem da ordem em
 * que o banco devolveu as linhas — uma ordem emergente muda entre deploys.
 */
export const WATCH_MODALITY_ORDER: readonly WatchModality[] = [
  "subscription",
  "free",
  "ads",
  "rent",
  "buy",
];

/**
 * Rotulos pt-BR. Curtos, sem jargao de API, e cada um responde "vou pagar?".
 *
 * `ads` e "Grátis com anúncios" e nao "Com anúncios": o leitor precisa saber
 * que nao custa nada. "Com anúncios" sozinho descreve a contrapartida e omite o
 * preco, que e justamente a informacao que esta fileira existe para dar.
 */
export const WATCH_MODALITY_LABELS: Readonly<Record<WatchModality, string>> = {
  subscription: "Assinatura",
  free: "Grátis",
  ads: "Grátis com anúncios",
  rent: "Aluguel",
  buy: "Compra",
};

/** Modalidades cujo preco (quando o upstream publica) e exibido. */
export const PRICED_WATCH_MODALITIES: ReadonlySet<WatchModality> = new Set<WatchModality>([
  "rent",
  "buy",
]);

const MODALITY_RANK: ReadonlyMap<WatchModality, number> = new Map(
  WATCH_MODALITY_ORDER.map((modality, index) => [modality, index]),
);

/**
 * Reconhece um `offer_type` cru.
 *
 * `null` para qualquer valor fora do conjunto — inclusive `cinema`, que existe
 * no enum `OfferType` do banco mas NAO e uma modalidade de streaming: o
 * `watch/providers` do TMDB nunca o emite, e rotula-lo na fileira "Onde
 * assistir" afirmaria disponibilidade domestica de uma sessao de cinema.
 */
export function resolveWatchModality(raw: string | null | undefined): WatchModality | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return (WATCH_MODALITIES as readonly string[]).includes(trimmed)
    ? (trimmed as WatchModality)
    : null;
}

/** Rotulo de uma modalidade ja reconhecida. */
export function watchModalityLabel(modality: WatchModality): string {
  return WATCH_MODALITY_LABELS[modality];
}

/**
 * Mensagem de descarte de um `offer_type` desconhecido, com o VALOR CRU.
 *
 * Existe para que nenhum chamador possa descartar em silencio: o gate anterior
 * fazia `continue` sem uma linha sequer, e foi assim que 87 ofertas `ads` de
 * producao sumiram sem deixar rastro. A string carrega o valor bruto porque e
 * ele que identifica um contrato de upstream que mudou.
 */
export function describeUnsupportedWatchModality(raw: string | null | undefined): string {
  const shown = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "(vazio)";
  return (
    `[watch] offer_type sem rotulo conhecido: ${JSON.stringify(shown)} — oferta descartada. ` +
    "Nenhum rotulo e inventado; se o upstream passou a emitir esta modalidade, " +
    "acrescente-a a WATCH_MODALITIES antes de exibi-la."
  );
}

/** Ordena modalidades pela ordem canonica (incluso antes do que custa). */
export function sortWatchModalities(
  modalities: readonly WatchModality[],
): WatchModality[] {
  return [...modalities].sort(
    (a, b) => (MODALITY_RANK.get(a) ?? 0) - (MODALITY_RANK.get(b) ?? 0),
  );
}

/**
 * Rotulos de uma plataforma, deduplicados e na ordem canonica.
 *
 * E o formato "Prime Video · Assinatura · Aluguel" das superficies COMPACTAS
 * (faixa da home, destaque do explorar, hub): uma linha por PLATAFORMA, com as
 * modalidades ao lado — nunca duas entradas da mesma marca, que e o defeito do
 * hub duplicado com outra roupa.
 */
export function watchModalityLabels(
  modalities: readonly WatchModality[],
): string[] {
  const seen = new Set<WatchModality>();
  const ordered: WatchModality[] = [];
  for (const modality of sortWatchModalities(modalities)) {
    if (seen.has(modality)) continue;
    seen.add(modality);
    ordered.push(modality);
  }
  return ordered.map(watchModalityLabel);
}
