/**
 * vertical.ts — Resolucao da vertical de apresentacao (filme/serie/neutro).
 *
 * Este modulo e PURO: sem rede, DB ou IO. Dado um tipo de entidade, ele
 * resolve TODOS os sinais de diferenciacao de uma vez: cor de acento, token
 * de cor, label, badge e schema.org type.
 *
 * Invariante 11 (inegociavel): a diferenciacao entre filme e serie NUNCA pode
 * depender apenas da cor. Por isso resolveVertical sempre devolve label e
 * badge NAO vazios, e assertNotColorOnly valida essa garantia. A cor e apenas
 * um dos cinco sinais (label + badge + breadcrumb + schema + URL).
 *
 * Invariantes 9 e 10: filme usa o acento vermelho (--screena-movie-red) e
 * serie usa o acento verde (--screena-series-green).
 */

/**
 * Eixo de vertical de conteudo. 'neutral' cobre home, busca, conteudo misto,
 * pessoas, noticias e paginas institucionais.
 */
export type VerticalKind = "movie" | "series" | "neutral";

/**
 * Cor de acento associada a uma vertical.
 */
export type AccentColor = "red" | "green" | "neutral";

/**
 * Conjunto completo de sinais de apresentacao de uma vertical.
 *
 * Carregar todos juntos garante que nenhum consumidor diferencie filme/serie
 * apenas pela cor (invariante 11): o label e o badge viajam sempre com o
 * accent.
 */
export interface Vertical {
  /** Eixo de vertical resolvido. */
  readonly vertical: VerticalKind;
  /** Cor de acento da vertical. */
  readonly accent: AccentColor;
  /** Nome da CSS custom property do acento (ex.: "--screena-movie-red"). */
  readonly accentToken: string;
  /** Rotulo curto em ingles para identificadores/UI internacional. */
  readonly label: string;
  /** Badge visivel ao usuario (pt-BR), nunca vazio. */
  readonly badge: string;
  /** Tipo schema.org correspondente (ex.: "Movie", "TVSeries"). */
  readonly schemaType: string;
}

/**
 * Opcoes para refinar o schemaType de uma serie (temporada/episodio).
 */
export interface ResolveVerticalOptions {
  /** Quando true e a entidade e serie, schemaType vira "TVSeason". */
  readonly isSeason?: boolean;
  /** Quando true e a entidade e serie, schemaType vira "TVEpisode". */
  readonly isEpisode?: boolean;
}

/**
 * Vertical neutra padrao (home/busca/misto/institucional).
 *
 * Usa o token branco como acento neutro e schema.org WebSite. label e badge
 * sao sempre preenchidos para nunca depender so da cor.
 */
const NEUTRAL_DEFAULT: Vertical = {
  vertical: "neutral",
  accent: "neutral",
  accentToken: "--screena-white",
  label: "Screen",
  badge: "Screen",
  schemaType: "WebSite",
};

/**
 * Variantes neutras especificas por tipo de entidade. Cada uma mantem label
 * e badge nao vazios e o schema.org apropriado.
 */
const NEUTRAL_VARIANTS: Record<string, Vertical> = {
  person: {
    vertical: "neutral",
    accent: "neutral",
    accentToken: "--screena-white",
    label: "Person",
    badge: "Pessoa",
    schemaType: "Person",
  },
  news: {
    vertical: "neutral",
    accent: "neutral",
    accentToken: "--screena-white",
    label: "News",
    badge: "Noticia",
    schemaType: "NewsArticle",
  },
  home: {
    vertical: "neutral",
    accent: "neutral",
    accentToken: "--screena-white",
    label: "Home",
    badge: "Screen",
    schemaType: "WebSite",
  },
  mixed: NEUTRAL_DEFAULT,
};

/**
 * Vertical de filme. Acento vermelho (invariante 9), schema.org Movie.
 */
const MOVIE_VERTICAL: Vertical = {
  vertical: "movie",
  accent: "red",
  accentToken: "--screena-movie-red",
  label: "Movie",
  badge: "Filme",
  schemaType: "Movie",
};

/**
 * Resolve a vertical de apresentacao a partir do tipo de entidade.
 *
 * Mapeamento:
 *   - "movie" | "filme"                  -> vertical filme (acento vermelho).
 *   - "tv" | "series" | "serie"          -> vertical serie (acento verde);
 *       opts.isSeason  => schemaType "TVSeason";
 *       opts.isEpisode => schemaType "TVEpisode".
 *   - "person" | "pessoa"                -> neutro, schema Person.
 *   - "news" | "noticia"                 -> neutro, schema NewsArticle.
 *   - "home"                             -> neutro, schema WebSite.
 *   - "mixed" | qualquer outro/default   -> neutro, schema WebSite.
 *
 * GARANTIA (invariante 11): label e badge nunca sao vazios, para que a
 * diferenciacao filme/serie/neutro nao dependa apenas da cor.
 *
 * @param entityType Tipo da entidade (case-insensitive, espacos ignorados).
 * @param opts       Refinamentos de schema para series.
 */
export function resolveVertical(
  entityType: string,
  opts?: ResolveVerticalOptions,
): Vertical {
  const key = (entityType ?? "").trim().toLowerCase();

  if (key === "movie" || key === "filme") {
    return MOVIE_VERTICAL;
  }

  if (key === "tv" || key === "series" || key === "serie") {
    let schemaType = "TVSeries";
    if (opts?.isEpisode) {
      schemaType = "TVEpisode";
    } else if (opts?.isSeason) {
      schemaType = "TVSeason";
    }
    return {
      vertical: "series",
      accent: "green",
      accentToken: "--screena-series-green",
      label: "Series",
      badge: "Serie",
      schemaType,
    };
  }

  if (key === "person" || key === "pessoa") {
    return NEUTRAL_VARIANTS.person!;
  }

  if (key === "news" || key === "noticia") {
    return NEUTRAL_VARIANTS.news!;
  }

  if (key === "home") {
    return NEUTRAL_VARIANTS.home!;
  }

  // "mixed" e qualquer tipo desconhecido caem no neutro institucional.
  return NEUTRAL_DEFAULT;
}

/**
 * Verifica a invariante 11 em runtime: uma vertical so e valida para UI se
 * carrega sinais alem da cor — ou seja, label E badge presentes (truthy).
 *
 * @returns true quando label e badge sao nao vazios; false caso contrario.
 */
export function assertNotColorOnly(v: Vertical): boolean {
  return Boolean(v.label) && Boolean(v.badge);
}
