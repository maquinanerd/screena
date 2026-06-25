/**
 * seed-data.ts — Dados de semente canonicos da Screena (Fase 1).
 *
 * Modulo PURO (sem rede/DB/IO). Define os dados das tabelas-semente como
 * constantes tipadas, para que:
 *  - o runner de seed (prisma/seed.ts) os aplique no PostgreSQL;
 *  - os testes de governanca os validem (disjuncao provider/source, escalas,
 *    defaults pt-BR vs en/es) SEM precisar de banco.
 *
 * A fonte de verdade das fontes/escala de rating e @screena/config; aqui
 * apenas materializamos as linhas de seed que DEVEM espelha-la (travado por
 * teste). api_providers e rating_sources sao DISJUNTOS por construcao
 * (invariante 2): nenhuma chave de provider tecnico e uma fonte editorial.
 */

import { RATING_SCALES, RATING_SOURCES, type ProviderKind } from "@screena/config";

/** Linha de seed de `languages`. */
export interface LanguageSeed {
  readonly code: string;
  readonly namePt: string;
  readonly nameEn: string;
  readonly isPublished: boolean;
  readonly indexDefault: boolean;
}

/** Linha de seed de `countries`. */
export interface CountrySeed {
  readonly code: string;
  readonly namePt: string;
  readonly nameEn: string;
}

/** Linha de seed de `rating_sources`. */
export interface RatingSourceSeed {
  readonly key: string;
  readonly label: string;
  readonly scale: number;
  readonly homepageUrl: string;
}

/** Linha de seed de `api_providers`. */
export interface ApiProviderSeed {
  readonly key: string;
  readonly name: string;
  readonly kind: ProviderKind;
  readonly homepageUrl: string;
}

/** Linha de seed conservadora de `source_licenses` (default seguro). */
export interface SourceLicenseSeed {
  readonly sourceKey: string;
  readonly providerKey: string | null;
  readonly licenseStatus: "unknown";
  readonly displayAllowed: false;
  readonly logoAllowed: false;
  readonly scoreAllowed: false;
  readonly reviewQuoteAllowed: false;
  readonly requiresAttribution: true;
  readonly requiresLinkback: true;
  readonly notes: string;
}

/**
 * Idiomas. Invariantes 7/9: SO pt-BR publica e indexa por padrao no MVP;
 * en e es nascem nao-publicados e nao-indexaveis ate revisao humana.
 */
export const LANGUAGE_SEED: readonly LanguageSeed[] = [
  { code: "pt-BR", namePt: "Portugues (Brasil)", nameEn: "Portuguese (Brazil)", isPublished: true, indexDefault: true },
  { code: "en", namePt: "Ingles", nameEn: "English", isPublished: false, indexDefault: false },
  { code: "es", namePt: "Espanhol", nameEn: "Spanish", isPublished: false, indexDefault: false },
];

/** Conjunto inicial de paises (ISO 3166-1 alpha-2). */
export const COUNTRY_SEED: readonly CountrySeed[] = [
  { code: "BR", namePt: "Brasil", nameEn: "Brazil" },
  { code: "US", namePt: "Estados Unidos", nameEn: "United States" },
  { code: "GB", namePt: "Reino Unido", nameEn: "United Kingdom" },
  { code: "PT", namePt: "Portugal", nameEn: "Portugal" },
  { code: "ES", namePt: "Espanha", nameEn: "Spain" },
  { code: "FR", namePt: "Franca", nameEn: "France" },
  { code: "DE", namePt: "Alemanha", nameEn: "Germany" },
  { code: "IT", namePt: "Italia", nameEn: "Italy" },
  { code: "MX", namePt: "Mexico", nameEn: "Mexico" },
  { code: "AR", namePt: "Argentina", nameEn: "Argentina" },
  { code: "CA", namePt: "Canada", nameEn: "Canada" },
  { code: "AU", namePt: "Australia", nameEn: "Australia" },
  { code: "JP", namePt: "Japao", nameEn: "Japan" },
];

/**
 * Fontes editoriais de rating. A escala (`scale`) ESPELHA RATING_SCALES de
 * @screena/config (travado por tests/governance/rating-scales-mirror.test.ts).
 * Derivado de RATING_SOURCES para nunca divergir do conjunto canonico.
 */
const RATING_SOURCE_LABELS: Record<(typeof RATING_SOURCES)[number], { label: string; homepageUrl: string }> = {
  imdb: { label: "IMDb", homepageUrl: "https://www.imdb.com" },
  rotten_tomatoes: { label: "Rotten Tomatoes", homepageUrl: "https://www.rottentomatoes.com" },
  metacritic: { label: "Metacritic", homepageUrl: "https://www.metacritic.com" },
  letterboxd: { label: "Letterboxd", homepageUrl: "https://letterboxd.com" },
  filmaffinity: { label: "FilmAffinity", homepageUrl: "https://www.filmaffinity.com" },
};

export const RATING_SOURCE_SEED: readonly RatingSourceSeed[] = RATING_SOURCES.map((key) => ({
  key,
  label: RATING_SOURCE_LABELS[key].label,
  scale: RATING_SCALES[key],
  homepageUrl: RATING_SOURCE_LABELS[key].homepageUrl,
}));

/**
 * Fornecedores tecnicos (provider_api). DISJUNTO de RATING_SOURCES (invariante
 * 2): 'imdb' nunca e provider; o fornecedor das notas IMDb e 'imdb236'.
 * Travado por tests/governance/seed-disjoint.test.ts.
 */
export const API_PROVIDER_SEED: readonly ApiProviderSeed[] = [
  { key: "tmdb", name: "The Movie Database", kind: "data", homepageUrl: "https://www.themoviedb.org" },
  { key: "gemini", name: "Google Gemini", kind: "ai", homepageUrl: "https://ai.google.dev" },
  { key: "imdb236", name: "IMDb (RapidAPI imdb236)", kind: "ratings", homepageUrl: "https://rapidapi.com" },
  { key: "streaming_availability", name: "Streaming Availability (RapidAPI)", kind: "streaming", homepageUrl: "https://rapidapi.com" },
];

/**
 * Licencas iniciais: uma linha conservadora por fonte de rating. DEFAULT
 * SEGURO (invariante 6): nada exibivel ate revisao/licenca confirmada.
 */
export const SOURCE_LICENSE_SEED: readonly SourceLicenseSeed[] = RATING_SOURCES.map(
  (key): SourceLicenseSeed => ({
    sourceKey: key,
    providerKey: null,
    licenseStatus: "unknown",
    displayAllowed: false,
    logoAllowed: false,
    scoreAllowed: false,
    reviewQuoteAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    notes: "Licenca nao confirmada; nada exibivel ate revisao humana (Fase 1, default seguro).",
  }),
);
