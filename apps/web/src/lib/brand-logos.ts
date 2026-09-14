/**
 * brand-logos.ts — As marcas da CINERIE, por área do site. PURO (sem rede, DB,
 * env ou IO): importável por client component.
 *
 * ============================================================================
 * DE ONDE VEM CADA ARQUIVO
 * ============================================================================
 * As artes foram entregues pelo proprietário em 2026-09-11 ("substitua as logos,
 * para cada área do site"), em PNG com transparência, duas cores por área:
 *
 *   área      rota               arte ("preta" = fundo claro, "branca" = escuro)
 *   neutra    home e o restante  cinérie
 *   filmes    /pt/filmes         cinérie /cinema      (barra e "cinema" vermelhos)
 *   séries    /pt/series         cinérie /série e tv  (barra e "série e tv" verdes)
 *   notícias  /pt/noticias       cinérie /news
 *   score     Cinerie Score      cinérie score        (degradê, versão única)
 *
 * Servidas como WEBP SEM PERDA: os pixels visíveis são os mesmos do PNG
 * entregue e o arquivo cai para ~40%. A marca-mãe também existe em PNG
 * (`CINERIE_ORGANIZATION_LOGO`) porque é ela que o JSON-LD `Organization`
 * aponta, e ali o formato mais aceito pelos buscadores é o que conta.
 *
 * ============================================================================
 * A PALAVRA "cinérie" TEM O MESMO TAMANHO EM TODAS AS ÁREAS
 * ============================================================================
 * Medido nos arquivos: a palavra ocupa 672 × 163 px em TODAS as artes. As de
 * área têm 181 px de altura porque a barra "/" passa 2 px acima e 16 px abaixo
 * da palavra. Se o header fixasse a mesma ALTURA para todas, a palavra
 * encolheria ~10% nas páginas de filme, série e notícia — a marca mudaria de
 * tamanho ao trocar de seção. Por isso o CSS fixa a altura da PALAVRA
 * (`--brand-word-h`) e cada arte escala por `brandLogoScale` (altura do
 * arquivo ÷ 163). Travado por `__tests__/brand-logos.test.ts`, que lê os bytes.
 *
 * A diferenciação filme/série NUNCA é só esta marca (invariante 11): rota,
 * breadcrumb, badge, label e schema continuam carregando o sinal.
 */

/** Um arquivo de marca: caminho público e dimensões INTRÍNSECAS (px). */
export interface BrandLogoFile {
  /** Caminho servido por `apps/web/public`. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** As áreas que têm marca própria. */
export type BrandArea = "neutral" | "movie" | "series" | "news";

/** A marca de uma área, nas duas cores. */
export interface BrandAreaLogo {
  readonly area: BrandArea;
  /** Nome da área por extenso (auditoria/teste; o link continua "Cinerie — início"). */
  readonly label: string;
  /** Arte para fundo CLARO (barra sólida, páginas). */
  readonly solid: BrandLogoFile;
  /** Arte para fundo ESCURO (barra transparente sobre o hero, rodapé). */
  readonly inverse: BrandLogoFile;
}

/** Altura, em px do ARQUIVO, da palavra "cinérie" — a mesma em todas as artes. */
export const CINERIE_WORD_HEIGHT = 163;

export const CINERIE_AREA_LOGOS: Readonly<Record<BrandArea, BrandAreaLogo>> = {
  neutral: {
    area: "neutral",
    label: "Cinerie",
    solid: { src: "/brand/cinerie-wordmark-black.webp", width: 672, height: 163 },
    inverse: { src: "/brand/cinerie-wordmark-white.webp", width: 672, height: 163 },
  },
  movie: {
    area: "movie",
    label: "Cinerie /cinema",
    solid: { src: "/brand/cinerie-wordmark-black-cinema.webp", width: 1376, height: 181 },
    inverse: { src: "/brand/cinerie-wordmark-white-cinema.webp", width: 1376, height: 181 },
  },
  series: {
    area: "series",
    label: "Cinerie /série e tv",
    solid: { src: "/brand/cinerie-wordmark-black-series.webp", width: 1430, height: 181 },
    inverse: { src: "/brand/cinerie-wordmark-white-series.webp", width: 1430, height: 181 },
  },
  news: {
    area: "news",
    label: "Cinerie /news",
    solid: { src: "/brand/cinerie-wordmark-black-news.webp", width: 1208, height: 181 },
    inverse: { src: "/brand/cinerie-wordmark-white-news.webp", width: 1208, height: 181 },
  },
};

/** A marca do Cinerie Score (degradê vermelho → verde; uma versão só). */
export const CINERIE_SCORE_LOGO: BrandLogoFile = {
  src: "/brand/cinerie-score.webp",
  width: 1156,
  height: 163,
};

/**
 * A marca-mãe em PNG, para o JSON-LD `Organization` (e o `publisher` das
 * matérias). Mesma arte da versão preta neutra, sem recodificação.
 */
export const CINERIE_ORGANIZATION_LOGO: BrandLogoFile = {
  src: "/brand/cinerie-logo.png",
  width: 672,
  height: 163,
};

/**
 * O cartão social da MARCA (1200 × 630): a última candidata do `og:image` quando
 * a página não tem arte própria (decisão do dono D4).
 *
 * DERIVADO de `cinerie-logo.png`, não desenhado: a mesma arte, sem escala nem
 * recolor, centralizada sobre `#fdfdfd` (`--c-bg-page`, o fundo do site). A
 * palavra-marca sozinha não serve de cartão: seus 163 px de altura ficam abaixo
 * do mínimo de 200 px que o Facebook exige de `og:image`, e o fundo transparente
 * fica à mercê da cor que cada aplicativo pinta atrás. 1200 × 630 é a proporção
 * dos cartões grandes do Facebook e do LinkedIn; o recorte 2:1 do X tira 15 px de
 * cima e de baixo, longe da marca.
 */
export const CINERIE_SOCIAL_CARD: BrandLogoFile = {
  src: "/brand/cinerie-social-card.png",
  width: 1200,
  height: 630,
};

/**
 * A área de uma rota. Prefixo de SEGMENTO, nunca de string solta: `/pt/filmes`
 * e `/pt/filmes/...` são filmes; `/pt/filmesx` não é.
 */
export function brandAreaOf(pathname: string | null): BrandArea {
  if (pathname === null) return "neutral";
  if (isUnder(pathname, "/pt/filmes")) return "movie";
  if (isUnder(pathname, "/pt/series")) return "series";
  if (isUnder(pathname, "/pt/noticias")) return "news";
  return "neutral";
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Quanto a arte é mais alta que a palavra "cinérie": 1 na marca-mãe, 181/163 nas
 * de área. O CSS multiplica a altura da palavra por este fator.
 */
export function brandLogoScale(file: BrandLogoFile): number {
  return Number((file.height / CINERIE_WORD_HEIGHT).toFixed(4));
}
