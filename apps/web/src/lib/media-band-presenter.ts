/**
 * media-band-presenter.ts — A BANDA DE MÍDIA da ficha, decidida sem banco.
 *
 * ============================================================================
 * O QUE MUDOU, E POR QUE SÓ AGORA
 * ============================================================================
 * O canônico desenha TRÊS cartões à direita do destaque — "Imagens e Pôsteres",
 * "Notícias e Eventos" e "Trailers e Teasers". Até 21/08/2026 só o do meio
 * existia, e o comentário da página dizia a verdade sobre o porquê:
 *
 *   "só o do meio tem DESTINO neste produto: não existe rota de galeria de
 *    imagens nem de vídeos. Card sem destino não vira card cinza com 'Em
 *    breve'; ele não existe."
 *
 * A regra estava certa. O que faltava era o destino — e agora as quatro rotas
 * de galeria existem. Os cartões voltam porque levam a algum lugar, não porque
 * o canônico os desenha.
 *
 * ============================================================================
 * A CONTAGEM É REAL, OU NÃO EXISTE
 * ============================================================================
 * `9 vídeos · 184 fotos` sai de `COUNT(*)` nas MESMAS condições que a galeria
 * usa para listar (ver `entity-gallery.ts`). Se divergissem, a ficha prometeria
 * um número que a galeria não entrega.
 *
 * ============================================================================
 * `02:14 · Trailer` NÃO PODE SER HONRADO, E ISSO É UM FATO DO DADO
 * ============================================================================
 * O canônico pede a duração no canto inferior esquerdo. **O TMDB não a
 * entrega.** O campo `size` de `/videos` é a RESOLUÇÃO (360/480/720/1080), não
 * segundos — e formatá-lo como `MM:SS` faria um vídeo em 1080p aparecer como
 * "18:00". A legenda sai como `Trailer`, sem número inventado.
 *
 * PURO: sem rede, sem banco, sem relógio próprio.
 */

/** Um cartão da coluna direita. Só existe quando TEM destino e TEM fundo. */
export interface MediaBandCard {
  /** `imagens` | `noticias` | `videos`. Chave estável para teste e CSS. */
  readonly key: MediaBandCardKey;
  readonly label: string;
  /** Destino: rota de galeria ou âncora na própria página. Nunca vazio. */
  readonly href: string;
  /** Fundo do cartão. `null` = sem backdrop exibível; o CSS usa o neutro. */
  readonly backgroundUrl: string | null;
}

export type MediaBandCardKey = "imagens" | "noticias" | "videos";

/** O que a banda precisa saber. */
export interface MediaBandInput {
  /** Caminho da galeria de imagens, ou `null` quando o slug não produz rota. */
  readonly imagesPath: string | null;
  readonly videosPath: string | null;
  /** Âncora da seção de notícias da própria ficha. */
  readonly newsAnchor: string;
  /** Quantas notícias editoriais a ficha tem. `0` = sem cartão de notícias. */
  readonly newsCount: number;
  /** Contagem REAL de imagens da galeria. */
  readonly imageCount: number;
  /** Contagem REAL de vídeos da galeria. */
  readonly videoCount: number;
  /** URL do backdrop já gateada por licença, ou `null`. */
  readonly backdropUrl: string | null;
  /** Há trailer exibível? Decide a legenda do centro. */
  readonly hasTrailer: boolean;
}

/** A banda inteira, pronta para a página. */
export interface MediaBandView {
  readonly cards: readonly MediaBandCard[];
  /**
   * `9 vídeos · 184 fotos`, ou `null` quando NENHUMA das duas tem item.
   *
   * Com uma só, sai só ela — "0 vídeos · 184 fotos" anunciaria uma ausência que
   * ninguém perguntou.
   */
  readonly countsLabel: string | null;
  /** `Trailer`, ou `null` quando não há trailer. Nunca com duração. */
  readonly trailerCaption: string | null;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${String(n)} ${n === 1 ? singular : plural_}`;
}

/** Monta a banda. Determinista. */
export function buildMediaBand(input: MediaBandInput): MediaBandView {
  const cards: MediaBandCard[] = [];

  // A ORDEM é a do canônico: imagens, notícias, vídeos.
  //
  // Cada cartão só entra com destino E com conteúdo. Um cartão de galeria
  // vazia levaria o leitor a uma página que diz "ainda não há imagens" — pior
  // que a ausência do cartão, porque gasta um clique para não entregar nada.
  if (input.imagesPath !== null && input.imageCount > 0) {
    cards.push({
      key: "imagens",
      label: "Imagens e Pôsteres",
      href: input.imagesPath,
      backgroundUrl: input.backdropUrl,
    });
  }
  if (input.newsCount > 0) {
    cards.push({
      key: "noticias",
      label: "Notícias e Eventos",
      href: input.newsAnchor,
      backgroundUrl: input.backdropUrl,
    });
  }
  if (input.videosPath !== null && input.videoCount > 0) {
    cards.push({
      key: "videos",
      label: "Trailers e Teasers",
      href: input.videosPath,
      backgroundUrl: input.backdropUrl,
    });
  }

  const partes: string[] = [];
  if (input.videoCount > 0) partes.push(plural(input.videoCount, "vídeo", "vídeos"));
  if (input.imageCount > 0) partes.push(plural(input.imageCount, "foto", "fotos"));

  return {
    cards,
    countsLabel: partes.length === 0 ? null : partes.join(" · "),
    // Sem duração: ver o cabeçalho. O dado não existe.
    trailerCaption: input.hasTrailer ? "Trailer" : null,
  };
}
