/**
 * entity-status.ts — Traducao pt-BR de campos factuais de catalogo (situacao de
 * producao e idioma original) para a ficha tecnica das paginas de detalhe.
 *
 * PURO: sem rede/DB/IO. NAO inventa fatos — apenas mapeia valores de enumeracao
 * ja persistidos (vindos do TMDB via ingestao offline) para um rotulo pt-BR. Um
 * valor ausente ou desconhecido vira `null` e a ficha simplesmente omite a
 * linha; nunca vaza o rotulo cru em ingles nem adivinha uma situacao/idioma.
 *
 * Mesma politica dos mapas ja existentes (`known_for_department`): so rotula o
 * que reconhecemos; o resto e omitido, nao "inventado".
 */

/** Vertical da entidade — a situacao tem genero gramatical (filme m / serie f). */
export type EntityStatusKind = "movie" | "tv";

/**
 * Situacao de producao de FILME (`movies.status`, valores canonicos do TMDB) em
 * pt-BR (genero masculino). `Rumored` e omitido de proposito: e especulativo
 * demais para ser exibido como fato numa pagina indexavel.
 */
const MOVIE_STATUS_LABELS: Readonly<Record<string, string>> = {
  Released: "Lançado",
  "Post Production": "Pós-produção",
  "In Production": "Em produção",
  Planned: "Anunciado",
  Canceled: "Cancelado",
};

/**
 * Situacao de producao de SERIE (`tv_shows.status`, valores canonicos do TMDB)
 * em pt-BR (genero feminino).
 */
const TV_STATUS_LABELS: Readonly<Record<string, string>> = {
  "Returning Series": "Em exibição",
  Ended: "Finalizada",
  Canceled: "Cancelada",
  "In Production": "Em produção",
  Planned: "Anunciada",
  Pilot: "Piloto",
};

/**
 * Idioma original (`original_language`, ISO 639-1 do TMDB) em pt-BR. Cobre os
 * idiomas mais comuns de catalogo; codigo desconhecido -> `null` (omite a linha,
 * nunca mostra o codigo cru). TMDB usa alguns codigos nao-padrao (`cn` para
 * cantones), incluidos aqui.
 */
const ORIGINAL_LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  en: "Inglês",
  pt: "Português",
  es: "Espanhol",
  fr: "Francês",
  de: "Alemão",
  it: "Italiano",
  ja: "Japonês",
  ko: "Coreano",
  zh: "Chinês (mandarim)",
  cn: "Chinês (cantonês)",
  ru: "Russo",
  hi: "Híndi",
  ar: "Árabe",
  nl: "Holandês",
  sv: "Sueco",
  no: "Norueguês",
  da: "Dinamarquês",
  fi: "Finlandês",
  pl: "Polonês",
  tr: "Turco",
  th: "Tailandês",
  id: "Indonésio",
  he: "Hebraico",
  cs: "Tcheco",
  hu: "Húngaro",
  el: "Grego",
  ro: "Romeno",
  uk: "Ucraniano",
  vi: "Vietnamita",
  fa: "Persa",
  ta: "Tâmil",
  te: "Télugo",
  ml: "Malaiala",
  is: "Islandês",
  nb: "Norueguês",
};

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Rotula a situacao de producao em pt-BR, escolhendo o genero pela vertical.
 * Ausente/desconhecido -> `null`.
 */
export function mapEntityStatus(
  status: string | null | undefined,
  kind: EntityStatusKind,
): string | null {
  const value = trimToNull(status);
  if (value === null) return null;
  const table = kind === "tv" ? TV_STATUS_LABELS : MOVIE_STATUS_LABELS;
  return table[value] ?? null;
}

/**
 * Rotula o idioma original em pt-BR a partir do codigo ISO 639-1. A busca e
 * case-insensitive (o TMDB usa minusculas, mas normalizamos por seguranca).
 * Ausente/desconhecido -> `null`.
 */
export function mapOriginalLanguage(
  code: string | null | undefined,
): string | null {
  const value = trimToNull(code);
  if (value === null) return null;
  return ORIGINAL_LANGUAGE_LABELS[value.toLowerCase()] ?? null;
}
