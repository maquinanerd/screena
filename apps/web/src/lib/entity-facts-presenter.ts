/**
 * entity-facts-presenter.ts — A FICHA TÉCNICA do canônico, como dado. PURO.
 *
 * A ficha é lista de FATOS, não formulário: campo sem dado NÃO vira linha
 * vazia nem "N/A" — a linha não existe. Regras que este módulo trava:
 *
 *  - CLASSIFICAÇÃO é do recorte BRASILEIRO por construção (só a BR é
 *    persistida; ver normalizers/detail-facts.ts). Nunca a americana com
 *    rótulo de brasileira.
 *  - ORÇAMENTO tem moeda E ano, sempre juntos — valor sem os dois engana. A
 *    moeda é dólar (convenção documentada da API do TMDB; não há campo de
 *    moeda por título) e o ano é o da estreia. Sem ano, a linha não existe.
 *  - DIREÇÃO e ROTEIRO são pessoas com link quando a pessoa tem página —
 *    nunca texto solto quando há rota.
 *  - GÊNEROS aqui e os chips do hero saem da MESMA junção (uma fonte para o
 *    mesmo fato — a lição das duas tabelas de departamento).
 */

import type { CrewFactPerson } from "../server/entity-facts";

/** Uma linha da ficha: valor textual OU lista de pessoas (com link). */
export type FichaFact =
  | { readonly label: string; readonly value: string }
  | { readonly label: string; readonly people: readonly CrewFactPerson[] };

const MESES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
] as const;

/** `1999-05-21` -> `21 de maio de 1999`. Determinístico, sem `Intl`. */
export function formatDatePt(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (match === null) return null;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return `${Number(day)} de ${MESES_PT[monthIndex]} de ${year}`;
}

function formatCompactUsd(amount: bigint): string {
  const n = Number(amount);
  const fmt = (value: number, suffix: string): string => {
    const rounded = Math.round(value * 10) / 10;
    const text = Number.isInteger(rounded)
      ? String(rounded)
      : String(rounded).replace(".", ",");
    return `US$ ${text} ${suffix}`;
  };
  if (n >= 1_000_000_000) {
    return fmt(n / 1_000_000_000, n >= 2_000_000_000 ? "bilhões" : "bilhão");
  }
  if (n >= 1_000_000) {
    return fmt(n / 1_000_000, n >= 2_000_000 ? "milhões" : "milhão");
  }
  if (n >= 1_000) return fmt(n / 1_000, "mil");
  return `US$ ${n}`;
}

/**
 * "US$ 63 milhões (1999)". Moeda e ano SEMPRE juntos; sem ano de estreia não
 * há como contextualizar o valor e a linha não existe (`null`).
 */
export function formatBudget(amount: bigint | null, releaseYear: number | null): string | null {
  if (amount === null || amount <= 0n) return null;
  if (releaseYear === null) return null;
  return `${formatCompactUsd(amount)} (${releaseYear})`;
}

/** Dados crus da ficha de FILME (loaders + view). */
export interface MovieFichaInput {
  readonly titleOriginal: string | null;
  readonly displayTitle: string;
  readonly directors: readonly CrewFactPerson[];
  readonly writers: readonly CrewFactPerson[];
  readonly genres: readonly string[];
  readonly countries: readonly string[];
  /** ISO `YYYY-MM-DD`; a REGIONAL BR quando houver, senão a global. */
  readonly releaseDateBr: string | null;
  readonly releaseDate: string | null;
  readonly runtimeLabel: string | null;
  readonly statusLabel: string | null;
  readonly originalLanguageLabel: string | null;
  readonly certification: string | null;
  readonly companies: readonly string[];
  readonly budget: bigint | null;
  readonly releaseYear: number | null;
}

function pushValue(rows: FichaFact[], label: string, value: string | null): void {
  if (value === null || value.trim() === "") return;
  rows.push({ label, value });
}

function pushPeople(rows: FichaFact[], label: string, people: readonly CrewFactPerson[]): void {
  if (people.length === 0) return;
  rows.push({ label, people });
}

export function buildMovieFichaFacts(input: MovieFichaInput): FichaFact[] {
  const rows: FichaFact[] = [];
  // Título original só quando difere do exibido — repetir o H1 não é fato novo.
  if (input.titleOriginal !== null && input.titleOriginal !== input.displayTitle) {
    pushValue(rows, "Título original", input.titleOriginal);
  }
  pushPeople(rows, "Direção", input.directors);
  pushPeople(rows, "Roteiro", input.writers);
  pushValue(rows, "Gêneros", input.genres.length > 0 ? input.genres.join(", ") : null);
  pushValue(rows, "País de origem", input.countries.length > 0 ? input.countries.join(", ") : null);
  const estreia = input.releaseDateBr ?? input.releaseDate;
  pushValue(rows, "Estreia", estreia === null ? null : formatDatePt(estreia));
  pushValue(rows, "Duração", input.runtimeLabel);
  pushValue(rows, "Situação", input.statusLabel);
  pushValue(rows, "Idioma original", input.originalLanguageLabel);
  pushValue(rows, "Classificação", input.certification);
  pushValue(
    rows,
    "Distribuição",
    input.companies.length > 0 ? input.companies.join(", ") : null,
  );
  pushValue(rows, "Orçamento", formatBudget(input.budget, input.releaseYear));
  return rows;
}

/** Dados crus da ficha de SÉRIE. */
export interface SeriesFichaInput {
  readonly titleOriginal: string | null;
  readonly displayTitle: string;
  readonly genres: readonly string[];
  readonly countries: readonly string[];
  readonly periodLabel: string | null;
  readonly statusLabel: string | null;
  readonly seasonsCountLabel: string | null;
  readonly episodesCountLabel: string | null;
  readonly originalLanguageLabel: string | null;
  readonly certification: string | null;
  readonly networks: readonly string[];
  readonly companies: readonly string[];
}

export function buildSeriesFichaFacts(input: SeriesFichaInput): FichaFact[] {
  const rows: FichaFact[] = [];
  if (input.titleOriginal !== null && input.titleOriginal !== input.displayTitle) {
    pushValue(rows, "Título original", input.titleOriginal);
  }
  pushValue(rows, "Gêneros", input.genres.length > 0 ? input.genres.join(", ") : null);
  pushValue(rows, "País de origem", input.countries.length > 0 ? input.countries.join(", ") : null);
  pushValue(rows, "Período", input.periodLabel);
  pushValue(rows, "Situação", input.statusLabel);
  pushValue(rows, "Temporadas", input.seasonsCountLabel);
  pushValue(rows, "Episódios", input.episodesCountLabel);
  pushValue(rows, "Idioma original", input.originalLanguageLabel);
  pushValue(rows, "Classificação", input.certification);
  pushValue(rows, "Emissora", input.networks.length > 0 ? input.networks.join(", ") : null);
  pushValue(
    rows,
    "Produção",
    input.companies.length > 0 ? input.companies.join(", ") : null,
  );
  return rows;
}
