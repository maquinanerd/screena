/**
 * ratings-presenter.ts — Monta o painel "Notas da crítica e do público" das
 * paginas de detalhe (filme e serie) a partir do `RatingsPayload` ja governado
 * por `entity-ratings.ts`. PURO: sem rede/DB/IO e sem `Date`.
 *
 * Governanca (invariantes 1, 2, 6):
 *  - IMDb != Rotten Tomatoes. Cada nota fica na ESCALA DA PROPRIA FONTE
 *    (`value`/`best`) e nunca e reescalada, convertida ou somada a outra. Um
 *    8,4/10 do IMDb e um 92/100 do Rotten Tomatoes aparecem lado a lado como
 *    medidas DIFERENTES, jamais como percentuais equivalentes.
 *  - Critica != publico. `scoreType` vira rotulo visivel ("Crítica"/"Público"),
 *    entao Tomatometer e Popcornmeter nunca se confundem na tela.
 *  - `provider_api` != `rating_source`: o credito exibido vem de `attribution`
 *    (a FONTE editorial). O fornecedor tecnico (RapidAPI / Film & Show Ratings)
 *    NUNCA aparece como autor da nota.
 *  - ATRIBUICAO obrigatoria: nota sem credito nao e exibida (a licenca das 5
 *    fontes exige `requires_attribution`; ver
 *    docs/legal/source-authorization-matrix.md). "Todo dado publico tem
 *    origem/licenca/atribuicao" — sem credito, nao ha dado publico.
 *  - SEM logo: `logo_allowed = false` para todas as fontes. O painel exibe o
 *    NOME da fonte em texto, nunca a marca grafica.
 *  - SEM nota propria: este painel nunca agrega, calcula media ou inventa um
 *    "Cinerie Score". Ele so reexibe nota de terceiro, creditada.
 */

import type { PublicExternalRating, RatingsPayload } from "@screena/public-contracts";

/** Rotulo pt-BR da natureza da nota. Critica e publico NUNCA se fundem. */
const SCORE_TYPE_LABELS: Readonly<Record<string, string>> = {
  critics: "Crítica",
  audience: "Público",
  editorial: "Editorial",
};

/** Uma nota pronta para render, ja creditada e na escala da propria fonte. */
export interface RatingsPanelItem {
  /** `rating_source` (imdb, rotten_tomatoes, ...) — usado como chave/data-attr. */
  sourceKey: string;
  /** Nome da FONTE editorial, em texto (nunca logo). */
  sourceLabel: string;
  /** Natureza da nota, crua (para data-attr e teste). */
  scoreType: string;
  /** Natureza da nota, legivel ("Crítica"/"Público"/"Editorial"). */
  scoreTypeLabel: string;
  /** Rotulo da metrica como a fonte a chama (ex.: "Tomatometer"). */
  metricLabel: string;
  /** Valor na escala da fonte, em pt-BR (ex.: "8,4"). NUNCA normalizado. */
  valueLabel: string;
  /** Denominador da escala da fonte (ex.: 10, 100, 5). */
  best: number;
  /** "8,4/10" — valor e escala juntos, para nao existir numero sem escala. */
  scoreLabel: string;
  /** Volume de votos/criticas quando o upstream informa; senao null. */
  countLabel: string | null;
  /** Credito da FONTE (nunca do fornecedor tecnico). Obrigatorio. */
  attribution: { text: string; url: string | null };
}

/** Modelo de exibicao do painel de notas. */
export interface RatingsPanelView {
  items: RatingsPanelItem[];
  /** "Atualizado em DD/MM/AAAA" derivado do `updatedAt` mais recente. */
  updatedAtLabel: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Numero em pt-BR sem `Intl` (deterministico entre runtimes/versoes de ICU).
 * Mantem a precisao que veio da fonte: nao arredonda para "ficar bonito".
 */
export function formatRatingNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value).replace(".", ",");
}

/** Milhar com ponto (pt-BR): 1234 -> "1.234". Puro. */
export function formatRatingCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return "";
  const digits = String(Math.trunc(count));
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ".";
  }
  return out;
}

/**
 * Formata "AAAA-MM-DD..." (ISO) em "DD/MM/AAAA". Puro e deterministico (sem
 * `Date`): usa so o prefixo de data. Retorna null para entrada invalida.
 */
export function formatRatingDate(iso: string | null): string | null {
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

/** Projeta uma nota do contrato publico para item de painel, ou `null`. */
function toPanelItem(rating: PublicExternalRating): RatingsPanelItem | null {
  const sourceLabel = trimToNull(rating.sourceLabel);
  const metricLabel = trimToNull(rating.label);
  if (sourceLabel === null || metricLabel === null) return null;

  // Escala invalida tornaria o numero ambiguo ("8,4" de quanto?). Sem escala
  // confiavel, a nota nao e exibida — nunca um numero solto na tela.
  if (!Number.isFinite(rating.value) || !Number.isFinite(rating.best) || rating.best <= 0) {
    return null;
  }

  // ATRIBUICAO OBRIGATORIA (invariante 6). Sem credito, a nota nao e publicavel:
  // e a mesma licenca que autoriza exibir e que obriga a creditar a fonte.
  const attributionText = trimToNull(rating.attribution?.text ?? null);
  if (attributionText === null) return null;
  const attributionUrl = trimToNull(rating.attribution?.url ?? null);

  const scoreTypeLabel = SCORE_TYPE_LABELS[rating.scoreType];
  // Um `scoreType` desconhecido nao pode virar rotulo inventado: sem saber se e
  // critica ou publico, exibir arriscaria trocar um pelo outro (invariante 1).
  if (scoreTypeLabel === undefined) return null;

  const valueLabel = formatRatingNumber(rating.value);
  const countLabel =
    rating.count === null || !Number.isFinite(rating.count) || rating.count < 0
      ? null
      : formatRatingCount(rating.count);

  return {
    sourceKey: rating.sourceKey,
    sourceLabel,
    scoreType: rating.scoreType,
    scoreTypeLabel,
    metricLabel,
    valueLabel,
    best: rating.best,
    // Valor e escala SEMPRE juntos: "92/100" nunca vira "92%" nem "9,2".
    scoreLabel: `${valueLabel}/${formatRatingNumber(rating.best)}`,
    countLabel,
    attribution: { text: attributionText, url: attributionUrl },
  };
}

/**
 * Monta o painel de notas externas.
 *
 * Retorna `null` quando nenhuma nota sobrevive aos gates — a pagina entao NAO
 * renderiza o painel (nunca heading vazio, "sem notas" ou placeholder). Fonte
 * desligada simplesmente deixa de aparecer: a pagina continua inteira.
 */
export function buildRatingsView(payload: RatingsPayload): RatingsPanelView | null {
  const items: RatingsPanelItem[] = [];
  const seen = new Set<string>();
  const updatedAts: Array<string | null> = [];

  for (const rating of payload.ratings) {
    const item = toPanelItem(rating);
    if (item === null) continue;

    // Uma fonte pode legitimamente ter duas metricas (Tomatometer + Popcornmeter):
    // a chave inclui o scoreType para nao colapsar critica com publico.
    const key = `${item.sourceKey}|${item.scoreType}|${item.metricLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);

    items.push(item);
    updatedAts.push(rating.updatedAt);
  }

  if (items.length === 0) return null;

  // Ordem TOTAL e estavel: fonte, depois natureza, depois metrica. Duas replicas
  // do site nunca mostram a mesma pagina em ordem diferente.
  items.sort((a, b) => {
    const bySource = a.sourceKey.localeCompare(b.sourceKey);
    if (bySource !== 0) return bySource;
    const byType = a.scoreType.localeCompare(b.scoreType);
    if (byType !== 0) return byType;
    return a.metricLabel.localeCompare(b.metricLabel);
  });

  const updatedDate = formatRatingDate(mostRecentIso(updatedAts));
  return {
    items,
    updatedAtLabel: updatedDate === null ? null : `Atualizado em ${updatedDate}`,
  };
}
