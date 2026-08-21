/**
 * gallery-presenter.ts — As duas galerias (imagens e vídeos), PURAS.
 *
 * ============================================================================
 * O QUE ESTE MÓDULO DECIDE, E O QUE ELE NÃO DECIDE
 * ============================================================================
 * DECIDE: agrupamento por tipo, ordenação, contagem real, filtros disponíveis,
 * idioma preferido e o PISO de página fina.
 *
 * NÃO DECIDE: licença (vem resolvida de fora, ver `image-license.ts` e o gate
 * por linha de `tmdb_videos`), nem se a entidade existe. Sem rede, sem banco,
 * sem `Date` próprio.
 *
 * ============================================================================
 * O PISO DE PÁGINA FINA, E POR QUE ELE É 4 / 2
 * ============================================================================
 * Uma galeria com duas imagens não é uma página — é um bloco que já cabia no
 * detalhe. Indexá-la produz uma URL que compete com a página do título e não
 * entrega nada a mais.
 *
 * IMAGENS: **4**. Abaixo disso a grade não chega a formar uma linha em desktop
 * (a grade é de 4 colunas), e o que o leitor vê é o mesmo pôster que já estava
 * na ficha. Quatro é o primeiro número em que a página tem forma própria.
 *
 * VÍDEOS: **2**. A lista é vertical e uma linha por vídeo; com dois itens já há
 * comparação (trailer vs teaser, ou duas versões), que é a razão de a página
 * existir. Com um só, o modal do detalhe já resolve — e é o que o detalhe faz.
 *
 * Os dois pisos são DIFERENTES de propósito: um número único para as duas
 * superfícies seria arbitrário em pelo menos uma delas.
 *
 * Abaixo do piso a página continua RESPONDENDO (não é 404 — o conteúdo existe),
 * mas com `noindex`. É o caso técnico da invariante 5, não um gate anti-thin
 * ressuscitado: a entidade dona continua indexando normalmente.
 */

import type { ImageDisplayAuthorization } from "@screena/public-contracts";
import { tmdbImageUrlIfAllowed } from "@screena/public-contracts";

import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl } from "./youtube-embed";

/** Piso de imagens para a galeria de imagens indexar. Ver o cabeçalho. */
export const IMAGES_INDEX_FLOOR = 4;
/** Piso de vídeos para a galeria de vídeos indexar. Ver o cabeçalho. */
export const VIDEOS_INDEX_FLOOR = 2;

/** Uma linha de `tmdb_images`, no subconjunto que a galeria usa. */
export interface GalleryImageRow {
  readonly imageType: string;
  readonly filePath: string;
  readonly languageCode: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly voteAverage: number | null;
}

/** Uma linha de `tmdb_videos`, no subconjunto que a galeria usa. */
export interface GalleryVideoRow {
  readonly site: string;
  readonly videoKey: string;
  readonly name: string | null;
  readonly videoType: string | null;
  readonly official: boolean | null;
  readonly languageCode: string | null;
  readonly size: number | null;
  readonly publishedAt: Date | null;
}

/** Uma imagem pronta para a grade. */
export interface GalleryImageView {
  /** `poster` | `backdrop` | `logo` | `still`. Nunca cru na tela. */
  readonly kind: GalleryImageKind;
  readonly kindLabel: string;
  /** URL da miniatura (grade). */
  readonly thumbUrl: string;
  /** URL do tamanho grande (clique). */
  readonly fullUrl: string;
  readonly width: number | null;
  readonly height: number | null;
  /** `pt`, `en`, … ou `null` quando a arte não tem idioma (sem texto). */
  readonly languageCode: string | null;
  readonly languageLabel: string;
  /** Texto alternativo. Nunca inventa descrição da arte. */
  readonly alt: string;
}

/** Um vídeo pronto para a lista. */
export interface GalleryVideoView {
  readonly videoKey: string;
  readonly site: string;
  readonly title: string;
  /**
   * O player, na forma que `TrailerModal` já consome (`TrailerView`).
   *
   * `null` quando o vídeo não é reproduzível por nós: site que não é YouTube,
   * ou id fora do padrão de 11 caracteres. Nesses casos a linha CONTINUA na
   * lista — o vídeo existe e a contagem tem de ser verdadeira — mas sem botão
   * de play. Sumir com ele esconderia conteúdo real; desenhar um play que não
   * abre nada mentiria para o leitor.
   *
   * As URLs saem de `youtube-embed.ts`, o ÚNICO lugar do `apps/web` autorizado
   * a escrever domínio do YouTube. Montá-las aqui seria a segunda política que
   * aquele módulo existe para impedir.
   */
  readonly player: { readonly embedUrl: string; readonly watchUrl: string; readonly name: string | null } | null;
  /** `Trailer` | `Teaser` | `Bastidores` | … já em pt-BR. */
  readonly typeLabel: string;
  /** `02:14`, ou `null` quando a duração não veio. */
  readonly durationLabel: string | null;
  readonly languageLabel: string;
  readonly official: boolean;
  /**
   * Imagem de fundo do cartão, vinda do **TMDB** (backdrop do título), já
   * gateada pela licença de imagem. `null` quando o título não tem backdrop
   * exibível.
   *
   * ============================================================================
   * POR QUE NÃO A MINIATURA DO YOUTUBE
   * ============================================================================
   * A primeira escrita deste módulo montava `https://i.ytimg.com/vi/{key}/…`.
   * Duas coisas erradas de uma vez:
   *
   * 1. **Privacidade.** Uma miniatura do YouTube é uma requisição ao Google
   *    NO RENDER, antes de qualquer clique — o IP e o user-agent do leitor
   *    saem sem que ele tenha pedido vídeo nenhum. Toda a política de trailer
   *    do produto (PR #174, política de privacidade item 6.1) existe para que
   *    nada de terceiro carregue antes do clique. Uma miniatura na lista
   *    quebraria isso em toda visita.
   * 2. **Segunda política.** `youtube-embed.ts` é o ÚNICO lugar do `apps/web`
   *    autorizado a escrever domínio do YouTube, com id de EXATAMENTE 11
   *    caracteres. Inventar `i.ytimg.com` aqui, com outro padrão de id, seria
   *    começar a segunda política que aquele módulo existe para impedir.
   *
   * O backdrop do TMDB resolve os dois: é imagem que o produto já serve, do
   * host que ele já declara, sob licença que ele já checa.
   */
  readonly backdropUrl: string | null;
}

/** Um filtro disponível, com a contagem real. */
export interface GalleryFacet {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** A galeria de imagens inteira. */
export interface ImagesGalleryView {
  readonly images: readonly GalleryImageView[];
  readonly total: number;
  /** Filtros por TIPO, com contagem. Vazio quando há um tipo só. */
  readonly kindFacets: readonly GalleryFacet[];
  /** Filtros por IDIOMA, com contagem. Vazio quando há um idioma só. */
  readonly languageFacets: readonly GalleryFacet[];
  /** `false` quando abaixo de {@link IMAGES_INDEX_FLOOR}. */
  readonly indexable: boolean;
}

/** A galeria de vídeos inteira. */
export interface VideosGalleryView {
  readonly videos: readonly GalleryVideoView[];
  readonly total: number;
  readonly typeFacets: readonly GalleryFacet[];
  /** `false` quando abaixo de {@link VIDEOS_INDEX_FLOOR}. */
  readonly indexable: boolean;
}

/** Os tipos de imagem que a galeria exibe. `profile` é de pessoa, não de título. */
export type GalleryImageKind = "poster" | "backdrop" | "logo" | "still";

const IMAGE_KIND_LABELS: Readonly<Record<GalleryImageKind, string>> = {
  poster: "Pôster",
  backdrop: "Cena",
  logo: "Logotipo",
  still: "Still",
};

/**
 * Ordem de exibição dos tipos. Pôster primeiro porque é o que o leitor veio ver;
 * logotipo por último porque é material de marca, não imagem da obra.
 */
const IMAGE_KIND_ORDER: readonly GalleryImageKind[] = ["poster", "backdrop", "still", "logo"];

/**
 * Rótulos de tipo de vídeo, em pt-BR.
 *
 * A chave é o `type` cru do TMDB. Tipo DESCONHECIDO não vira "Outro" nem some:
 * ele aparece com o próprio nome, porque inventar um rótulo esconderia um tipo
 * novo do fornecedor — e sumir com o vídeo esconderia conteúdo real.
 */
const VIDEO_TYPE_LABELS: Readonly<Record<string, string>> = {
  Trailer: "Trailer",
  Teaser: "Teaser",
  Clip: "Cena",
  Featurette: "Featurette",
  "Behind the Scenes": "Bastidores",
  Bloopers: "Erros de gravação",
  "Opening Credits": "Abertura",
  Recap: "Recapitulação",
};

/** Rótulos de idioma. `null` = arte sem texto, que NÃO é "idioma desconhecido". */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  it: "Italiano",
  de: "Alemão",
  ja: "Japonês",
  ko: "Coreano",
  zh: "Chinês",
};

/** "Sem texto" e não "Desconhecido": arte sem idioma é uma categoria REAL. */
const NO_LANGUAGE_LABEL = "Sem texto";

function languageLabel(code: string | null): string {
  if (code === null || code.trim() === "") return NO_LANGUAGE_LABEL;
  return LANGUAGE_LABELS[code] ?? code.toUpperCase();
}

function isGalleryImageKind(value: string): value is GalleryImageKind {
  return (IMAGE_KIND_ORDER as readonly string[]).includes(value);
}

/**
 * Prioridade de idioma: pt-BR na frente, depois sem-texto, depois o resto.
 *
 * "Sem texto" vem ANTES de `en` de propósito: uma arte sem texto serve a
 * qualquer leitor, e uma em inglês serve a menos gente que uma em português.
 * Nenhuma é descartada — a galeria mostra TUDO; isto é só a ordem.
 */
function languageRank(code: string | null): number {
  if (code === "pt") return 0;
  if (code === null || code.trim() === "") return 1;
  return 2;
}

function countBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) out.set(key(row), (out.get(key(row)) ?? 0) + 1);
  return out;
}

/**
 * Monta a galeria de imagens.
 *
 * O `alt` NÃO descreve a arte: descreve o PAPEL dela ("Pôster de X"). Descrever
 * a imagem exigiria olhar para ela, e nada aqui olha — inventar a descrição
 * seria a mesma família de defeito que o Entity Writer existe para não cometer.
 */
export function buildImagesGallery(
  rows: readonly GalleryImageRow[],
  title: string,
  authorization: ImageDisplayAuthorization,
): ImagesGalleryView {
  const usable: Array<{ row: GalleryImageRow; kind: GalleryImageKind; thumb: string; full: string }> = [];

  for (const row of rows) {
    if (!isGalleryImageKind(row.imageType)) continue;
    // O gate de licença, no MESMO lugar em que a URL nasce.
    const thumb = tmdbImageUrlIfAllowed(row.filePath, "w300", authorization);
    const full = tmdbImageUrlIfAllowed(row.filePath, "original", authorization);
    if (thumb === null || full === null) continue;
    usable.push({ row, kind: row.imageType, thumb, full });
  }

  usable.sort((a, b) => {
    const porTipo = IMAGE_KIND_ORDER.indexOf(a.kind) - IMAGE_KIND_ORDER.indexOf(b.kind);
    if (porTipo !== 0) return porTipo;
    const porIdioma = languageRank(a.row.languageCode) - languageRank(b.row.languageCode);
    if (porIdioma !== 0) return porIdioma;
    // Voto do TMDB como desempate: é o sinal de qualidade que a fonte já dá.
    // Empate residual resolve por `file_path`, que é único — ordem TOTAL, sem
    // resultado que muda entre dois renders da mesma entrada.
    const porVoto = (b.row.voteAverage ?? 0) - (a.row.voteAverage ?? 0);
    if (porVoto !== 0) return porVoto;
    return a.row.filePath.localeCompare(b.row.filePath);
  });

  const images: GalleryImageView[] = usable.map((item) => ({
    kind: item.kind,
    kindLabel: IMAGE_KIND_LABELS[item.kind],
    thumbUrl: item.thumb,
    fullUrl: item.full,
    width: item.row.width,
    height: item.row.height,
    languageCode: item.row.languageCode,
    languageLabel: languageLabel(item.row.languageCode),
    alt: `${IMAGE_KIND_LABELS[item.kind]} de ${title}`,
  }));

  const porTipo = countBy(images, (image) => image.kind);
  const porIdioma = countBy(images, (image) => image.languageLabel);

  return {
    images,
    total: images.length,
    // Um filtro com uma opção só não é filtro — é ruído que sugere escolha
    // onde não há.
    kindFacets:
      porTipo.size < 2
        ? []
        : IMAGE_KIND_ORDER.filter((kind) => porTipo.has(kind)).map((kind) => ({
            value: kind,
            label: IMAGE_KIND_LABELS[kind],
            count: porTipo.get(kind) ?? 0,
          })),
    languageFacets:
      porIdioma.size < 2
        ? []
        : [...porIdioma.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([label, count]) => ({ value: label, label, count })),
    indexable: images.length >= IMAGES_INDEX_FLOOR,
  };
}

/** Duração `MM:SS` a partir de segundos. `null` quando ausente ou inválida. */
function durationLabel(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const minutos = Math.floor(total / 60);
  const resto = total % 60;
  return `${String(minutos).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

/**
 * Monta a galeria de vídeos.
 *
 * `backdropPath` é o `backdrop_path` CRU do título (coluna de `movies`/
 * `tv_shows`); a URL sai do mesmo gate de licença das imagens. Um só backdrop
 * para todos os cartões: o TMDB não publica still POR VÍDEO, e escolher um
 * still qualquer e apresentá-lo como "o frame deste trailer" seria afirmar algo
 * que o dado não diz.
 */
export function buildVideosGallery(
  rows: readonly GalleryVideoRow[],
  backdropPath: string | null,
  authorization: ImageDisplayAuthorization,
): VideosGalleryView {
  const backdropUrl = tmdbImageUrlIfAllowed(backdropPath, "w780", authorization);
  const usable = rows.filter((row) => row.site.trim() !== "" && row.videoKey.trim() !== "");

  usable.sort((a, b) => {
    // Oficial primeiro: é o material do estúdio, não recorte de terceiro.
    if (a.official !== b.official) return a.official === true ? -1 : 1;
    const porIdioma = languageRank(a.languageCode) - languageRank(b.languageCode);
    if (porIdioma !== 0) return porIdioma;
    const aTempo = a.publishedAt?.getTime() ?? 0;
    const bTempo = b.publishedAt?.getTime() ?? 0;
    if (aTempo !== bTempo) return bTempo - aTempo;
    return a.videoKey.localeCompare(b.videoKey);
  });

  const videos: GalleryVideoView[] = usable.map((row) => {
    const tipo = row.videoType?.trim() ?? "";
    // Comparação EXATA com "YouTube", igual à de `trailer-presenter.ts`. Um
    // `includes` deixaria passar "YouTubeKids" e afins.
    const embedUrl = row.site === "YouTube" ? buildYouTubeEmbedUrl(row.videoKey) : null;
    const watchUrl = row.site === "YouTube" ? buildYouTubeWatchUrl(row.videoKey) : null;
    return {
      videoKey: row.videoKey,
      site: row.site,
      // Sem nome, o rótulo do tipo vira o título. Nunca "Sem título".
      title: row.name?.trim() ?? (VIDEO_TYPE_LABELS[tipo] ?? tipo) ?? "Vídeo",
      typeLabel: tipo === "" ? "Vídeo" : (VIDEO_TYPE_LABELS[tipo] ?? tipo),
      durationLabel: durationLabel(row.size),
      languageLabel: languageLabel(row.languageCode),
      official: row.official === true,
      backdropUrl,
      player:
        embedUrl === null || watchUrl === null
          ? null
          : { embedUrl, watchUrl, name: row.name?.trim() ?? null },
    };
  });

  const porTipo = countBy(videos, (video) => video.typeLabel);

  return {
    videos,
    total: videos.length,
    typeFacets:
      porTipo.size < 2
        ? []
        : [...porTipo.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([label, count]) => ({ value: label, label, count })),
    indexable: videos.length >= VIDEOS_INDEX_FLOOR,
  };
}
