/**
 * home-upcoming-presenter.ts — Lógica PURA da seção "Em breve" da Home v4:
 * monta os cards de filmes com estreia FUTURA a partir do payload controlado do
 * PostgreSQL. Sem rede/DB/IO.
 *
 * Governança:
 *  - Não inventa dados: item sem título, sem slug canônico ou sem data de estreia
 *    futura NÃO entra. A imagem é a URL pública REMOTA do TMDB montada do
 *    `file_path` cru (via helper governado `buildTmdbImageUrl`); sem `file_path`
 *    válido -> null -> card cai no fallback visual do trilho. Servidor não salva
 *    imagem (sem JPG/WebP local, sem `/media/tmdb`).
 *  - TMDB é fonte de CATÁLOGO (data/pôster/slug), nunca editorial: aqui não há
 *    nota, crítica, trailer nem streaming. Por isso o card NÃO tem `duration`
 *    (não fingimos trailer) — a pílula de duração é só do placeholder visual.
 *  - Ordenação determinística (estreia asc) e cap de itens.
 */

import { detailPath, MOVIES_INDEX_PATH } from "./site";
import { buildTmdbImageUrl } from "./tmdb-image-url";

/** Quantos filmes "Em breve" a home exibe no máximo. */
export const HOME_UPCOMING_LIMIT = 6;

/** Meses pt-BR (capitalizados, para casar com o estilo do trilho v4). */
const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/** Subconjunto controlado (já convertido de Prisma) de um filme candidato. */
export interface UpcomingMovieInput {
  titleOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  /** Data de estreia (Movie.releaseDate, @db.Date -> Date em meia-noite UTC). */
  releaseDate: Date | null;
  /**
   * `file_path` CRU do TMDB do backdrop 16:9 (ex.: `/abc.jpg`). Preferido no
   * trilho "Em breve" (thumb widescreen); vira URL remota via `resolveUpcomingImage`.
   */
  backdropPath: string | null;
  /** `file_path` CRU do TMDB do pôster (ex.: `/xyz.jpg`); fallback do backdrop. */
  posterPath: string | null;
}

/** Card "Em breve" pronto para render — objeto PLANO e serializável. */
export interface HomeUpcomingMovie {
  title: string;
  /** Data de estreia formatada em pt-BR (ex.: "22 de Março"). */
  date: string;
  /** `/pt/filmes/{slug}/`. */
  href: string;
  /**
   * URL pública REMOTA do TMDB (backdrop `w780` preferido, senão pôster `w500`)
   * ou null. O trilho renderiza `<img>` quando presente; null -> thumb com
   * gradiente de fallback. Nunca é path local nem de filesystem.
   */
  imageUrl: string | null;
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Início do dia UTC de `now`, em ms (cutoff para "estreia futura"). */
function startOfUtcDayMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Formata uma data de estreia em pt-BR ("22 de Março"), usando componentes UTC
 * (releaseDate é @db.Date em meia-noite UTC — evita off-by-one de fuso).
 */
export function formatUpcomingDate(date: Date): string {
  const day = date.getUTCDate();
  const month = MONTHS_PT[date.getUTCMonth()];
  return `${day} de ${month}`;
}

/**
 * Resolve a imagem REMOTA do card "Em breve" a partir do `file_path` CRU do TMDB
 * (guardado no banco), preferindo o backdrop 16:9 em `w780` (thumb widescreen do
 * trilho) e caindo no pôster em `w500` quando não há backdrop; sem `file_path`
 * válido -> null (card cai no fallback do trilho). Nenhum arquivo local: a URL é
 * a do CDN remoto de imagens do TMDB, construída pelo helper governado
 * `buildTmdbImageUrl` (que rejeita path local antigo `/media/...` e de filesystem).
 */
export function resolveUpcomingImage(
  backdropPath: string | null | undefined,
  posterPath: string | null | undefined,
): string | null {
  return (
    buildTmdbImageUrl(backdropPath, "w780") ?? buildTmdbImageUrl(posterPath, "w500")
  );
}

/** Entrada interna: card resolvido + chave de ordenação por estreia. */
interface SortableUpcoming {
  releaseMs: number;
  entry: HomeUpcomingMovie;
}

/**
 * Monta os cards "Em breve" a partir dos candidatos: mantém só filmes com título,
 * slug canônico e estreia ESTRITAMENTE futura (releaseDate > início de hoje UTC),
 * ordena por estreia ascendente (desempate por título) e aplica o cap.
 *
 * `now` é injetado (testável); a data de estreia de hoje NÃO conta como "em breve"
 * (o filme já estreou). Lista sem candidatos válidos -> [] (a seção some).
 */
export function buildUpcomingMovies(
  items: readonly UpcomingMovieInput[],
  now: Date,
  limit: number = HOME_UPCOMING_LIMIT,
): HomeUpcomingMovie[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HOME_UPCOMING_LIMIT;
  const cutoff = startOfUtcDayMs(now);
  const valid: SortableUpcoming[] = [];

  for (const item of items) {
    const slug = trimToNull(item.slug);
    const title = trimToNull(item.translationTitle) ?? trimToNull(item.titleOriginal);
    const release = item.releaseDate;
    if (slug === null || title === null || release === null) continue;
    const releaseMs = release.getTime();
    if (!Number.isFinite(releaseMs) || releaseMs <= cutoff) continue;
    const href = detailPath(MOVIES_INDEX_PATH, slug);
    if (href === null) continue;
    valid.push({
      releaseMs,
      entry: {
        title,
        date: formatUpcomingDate(release),
        href,
        imageUrl: resolveUpcomingImage(item.backdropPath, item.posterPath),
      },
    });
  }

  valid.sort((a, b) => {
    if (a.releaseMs !== b.releaseMs) return a.releaseMs - b.releaseMs;
    return a.entry.title.localeCompare(b.entry.title);
  });

  return valid.slice(0, cap).map((v) => v.entry);
}
