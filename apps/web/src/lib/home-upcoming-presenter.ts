/**
 * home-upcoming-presenter.ts — Lógica PURA da seção "Em breve": monta os cards
 * de FILMES e de SÉRIES com estreia FUTURA a partir do payload controlado do
 * PostgreSQL. Sem rede/DB/IO.
 *
 * A MESMA seção aparece em três rotas, com datasets DIFERENTES:
 *
 *   /pt/filmes/  -> só filmes    (`buildUpcomingItems` com vertical `movie`)
 *   /pt/series/  -> só séries    (`buildUpcomingItems` com vertical `series`)
 *   /pt/         -> os dois      (`mergeUpcomingVerticals`, cota equilibrada)
 *
 * Governança:
 *  - Não inventa dados: item sem título, sem slug canônico ou sem data de estreia
 *    futura NÃO entra. A imagem é a URL pública REMOTA do TMDB montada do
 *    `file_path` cru (via helper governado `buildTmdbImageUrl`); sem `file_path`
 *    válido -> null -> card cai no fallback visual do trilho. Servidor não salva
 *    imagem (sem JPG/WebP local, sem `/media/tmdb`).
 *  - TMDB é fonte de CATÁLOGO (data/pôster/slug), nunca editorial: aqui não há
 *    nota, crítica, trailer nem streaming. Por isso o card não tem `duration`
 *    e não mostra pílula de reprodução.
 *  - Invariante 11: a vertical de cada card NUNCA viaja só como cor. O item
 *    carrega `verticalLabel` ("Filme"/"Série") e um `href` cujo segmento já
 *    diverge (`/pt/filmes/` vs `/pt/series/`) — label + URL saem daqui; badge,
 *    breadcrumb e schema são responsabilidade da superfície que renderiza.
 *  - Ordenação determinística (estreia asc) e cap de itens.
 */

import { detailPath, MOVIES_INDEX_PATH, SERIES_INDEX_PATH } from "./site";
import { buildTmdbImageUrl } from "./tmdb-image-url";
import type { TrailerView } from "./trailer-presenter";

/** Quantos itens "Em breve" uma superfície exibe no máximo. */
export const HOME_UPCOMING_LIMIT = 6;

/**
 * Piso do trilho: abaixo disto a seção NÃO renderiza.
 *
 * Um carrossel com um ou dois cards não é um carrossel — é um card solto com
 * setas mortas ao lado, e o trilho tem sangria à direita justamente para
 * prometer que há mais adiante. Com 3 ou menos essa promessa é falsa.
 *
 * O piso não silencia nada: abaixo dele a ausência vira log com
 * `below_upcoming_floor` e a contagem real, que é diferente de `no_upcoming_title`
 * (zero). "Tem 3, precisa de 4" e "não tem nenhum" pedem ações diferentes.
 */
export const HOME_UPCOMING_MIN = 4;

/**
 * O trilho tem itens suficientes para renderizar?
 *
 * FONTE ÚNICA do piso. Quem decide renderizar e quem conta seções populadas
 * para a indexabilidade chamam ESTA função — se cada um aplicasse o seu próprio
 * `>= 4`, um dos dois acabaria esquecido num refactor e a home passaria a contar
 * como populada uma seção que não está na página.
 */
export function hasEnoughUpcoming(items: readonly HomeUpcomingItem[]): boolean {
  return items.length >= HOME_UPCOMING_MIN;
}

/** As duas verticais que a seção cobre. Pessoa/temporada/episódio não entram. */
export type UpcomingVertical = "movie" | "series";

/** Rótulo TEXTUAL da vertical — o primeiro dos cinco sinais da invariante 11. */
const VERTICAL_LABELS: Record<UpcomingVertical, string> = {
  movie: "Filme",
  series: "Série",
};

/** Índice de rota por vertical: a URL do card já separa filme de série. */
const VERTICAL_INDEX_PATHS: Record<UpcomingVertical, string> = {
  movie: MOVIES_INDEX_PATH,
  series: SERIES_INDEX_PATH,
};

/** Alvo do bookmark no Backend C (`UserWatchState.entityType`). */
const VERTICAL_BOOKMARK_TYPES: Record<UpcomingVertical, "movie" | "tv"> = {
  movie: "movie",
  series: "tv",
};

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

const WEEKDAYS_PT = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"] as const;

/** Subconjunto controlado (já convertido de Prisma) de um candidato. */
export interface UpcomingEntityInput {
  /** Id interno (bigint serializado), para acoes de biblioteca (bookmark). */
  id?: string | null;
  /** Filme ou série. Define rótulo, rota, bookmark e acento do card. */
  vertical: UpcomingVertical;
  /** `Movie.titleOriginal` para filme; `TvShow.nameOriginal` para série. */
  titleOriginal: string;
  translationTitle: string | null;
  slug: string | null;
  /**
   * Data de estreia: `Movie.releaseDate` para filme, `TvShow.firstAirDate` para
   * série (ambos @db.Date -> Date em meia-noite UTC).
   */
  releaseDate: Date | null;
  /**
   * `file_path` CRU do TMDB do backdrop 16:9 (ex.: `/abc.jpg`). Preferido no
   * trilho "Em breve" (thumb widescreen); vira URL remota via `resolveUpcomingImage`.
   */
  backdropPath: string | null;
  /** `file_path` CRU do TMDB do pôster (ex.: `/xyz.jpg`); fallback do backdrop. */
  posterPath: string | null;
  /**
   * Trailer JÁ aprovado pelo gate de licença (`pickTrailer`), ou null.
   *
   * Chega pronto: o presenter não decide licença. Ausente/null => o card não
   * ganha botão "Watch" e continua exatamente como está hoje.
   */
  trailer?: TrailerView | null;
}

/** Card "Em breve" pronto para render — objeto PLANO e serializável. */
export interface HomeUpcomingItem {
  /** Id interno da entidade (para o bookmark real), ou null. */
  entityId: string | null;
  /** Vertical do item — o trilho misto da home depende dela. */
  vertical: UpcomingVertical;
  /**
   * Rótulo visível da vertical ("Filme"/"Série"). Existe porque a home mistura
   * as duas: sem texto, a única diferença entre um card de filme e um de série
   * seria a cor — e cor sozinha não é sinal (invariante 11).
   */
  verticalLabel: string;
  /** `movie` | `tv` — o que o Backend C grava em `UserWatchState`. */
  bookmarkType: "movie" | "tv";
  title: string;
  /** Data ISO UTC usada por agendas e filtros de janela temporal. */
  dateIso: string;
  /** Data de estreia formatada em pt-BR (ex.: "22 de Março"). */
  date: string;
  /** Dia da semana abreviado, em pt-BR, para a agenda canônica. */
  weekday: string;
  /** `/pt/filmes/{slug}/` ou `/pt/series/{slug}/`. */
  href: string;
  /**
   * URL pública REMOTA do TMDB (backdrop `w780` preferido, senão pôster `w500`)
   * ou null. O trilho renderiza `<img>` quando presente; null -> thumb com
   * gradiente de fallback. Nunca é path local nem de filesystem.
   */
  imageUrl: string | null;
  /**
   * Trailer exibível, ou null. `null` é o estado NORMAL hoje: vídeo do TMDB
   * ainda não tem licença de exibição registrada (ver `trailer-presenter.ts`),
   * e sem ele o card não mostra botão de trailer.
   */
  trailer: TrailerView | null;
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
 * (a data é @db.Date em meia-noite UTC — evita off-by-one de fuso).
 */
export function formatUpcomingDate(date: Date): string {
  const day = date.getUTCDate();
  const month = MONTHS_PT[date.getUTCMonth()];
  return `${day} de ${month}`;
}

/** Dia da semana canônico, calculado em UTC para evitar deslocamento de data. */
export function formatUpcomingWeekday(date: Date): string {
  return WEEKDAYS_PT[date.getUTCDay()] ?? "";
}

/**
 * Recorta a agenda para os próximos sete dias, sem fabricar itens fora da
 * janela. A entrada já chega ordenada por data do presenter principal.
 */
export function takeUpcomingWeek(
  items: readonly HomeUpcomingItem[],
  now: Date,
  limit: number,
): HomeUpcomingItem[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HOME_UPCOMING_LIMIT;
  const start = startOfUtcDayMs(now);
  const end = start + 7 * 24 * 60 * 60 * 1000;

  return items
    .filter((item) => {
      const release = Date.parse(`${item.dateIso}T00:00:00.000Z`);
      return Number.isFinite(release) && release > start && release <= end;
    })
    .slice(0, cap);
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
  entry: HomeUpcomingItem;
}

/** Ordem de EXIBIÇÃO canônica: estreia ascendente, desempate por título. */
function byReleaseThenTitle(a: SortableUpcoming, b: SortableUpcoming): number {
  if (a.releaseMs !== b.releaseMs) return a.releaseMs - b.releaseMs;
  return a.entry.title.localeCompare(b.entry.title);
}

/**
 * Monta os cards "Em breve" a partir dos candidatos: mantém só itens com título,
 * slug canônico e estreia ESTRITAMENTE futura (data > início de hoje UTC),
 * ordena por estreia ascendente (desempate por título) e aplica o cap.
 *
 * `now` é injetado (testável); a estreia de hoje NÃO conta como "em breve"
 * (a obra já estreou). Lista sem candidatos válidos -> [] (a seção some).
 */
export function buildUpcomingItems(
  items: readonly UpcomingEntityInput[],
  now: Date,
  limit: number = HOME_UPCOMING_LIMIT,
): HomeUpcomingItem[] {
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
    const href = detailPath(VERTICAL_INDEX_PATHS[item.vertical], slug);
    if (href === null) continue;
    valid.push({
      releaseMs,
      entry: {
        entityId: trimToNull(item.id ?? null),
        vertical: item.vertical,
        verticalLabel: VERTICAL_LABELS[item.vertical],
        bookmarkType: VERTICAL_BOOKMARK_TYPES[item.vertical],
        title,
        dateIso: release.toISOString().slice(0, 10),
        date: formatUpcomingDate(release),
        weekday: formatUpcomingWeekday(release),
        href,
        imageUrl: resolveUpcomingImage(item.backdropPath, item.posterPath),
        trailer: item.trailer ?? null,
      },
    });
  }

  valid.sort(byReleaseThenTitle);

  return valid.slice(0, cap).map((v) => v.entry);
}

/**
 * O trilho MISTO da home: filmes e séries no mesmo "Em breve".
 *
 * DUAS ordenações diferentes, e as duas importam:
 *
 *  1. SELEÇÃO por cota equilibrada. Metade da vaga para cada vertical
 *     (6 -> 3 + 3). Sem isso, uma data-sort simples deixaria a home mostrar
 *     seis filmes e nenhuma série sempre que a fila de filmes fosse mais
 *     densa — que é exatamente o estado que esta função existe para corrigir.
 *     Vertical com menos itens que a cota devolve as vagas sobrando para a
 *     outra: 6 filmes e 0 séries ainda produz 6 filmes (honesto), não 3.
 *  2. EXIBIÇÃO por estreia ascendente, com o conjunto já selecionado.
 *
 * As duas listas de entrada já vêm ordenadas por estreia asc de
 * `buildUpcomingItems`.
 */
export function mergeUpcomingVerticals(
  movies: readonly HomeUpcomingItem[],
  series: readonly HomeUpcomingItem[],
  limit: number = HOME_UPCOMING_LIMIT,
): HomeUpcomingItem[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : HOME_UPCOMING_LIMIT;

  // 1. Cota: metade para cada vertical, e o que uma não usa a outra herda.
  const movieQuota = Math.ceil(cap / 2);
  const seriesQuota = cap - movieQuota;
  const movieTake = Math.min(movies.length, movieQuota + Math.max(0, seriesQuota - series.length));
  const seriesTake = Math.min(series.length, cap - movieTake);

  const selected: SortableUpcoming[] = [
    ...movies.slice(0, movieTake),
    ...series.slice(0, seriesTake),
  ].map((entry) => ({
    releaseMs: Date.parse(`${entry.dateIso}T00:00:00.000Z`),
    entry,
  }));

  // 2. Exibição por data — a seleção equilibrada não sobrevive à ordem de chegada.
  selected.sort(byReleaseThenTitle);

  return selected.map((v) => v.entry);
}
