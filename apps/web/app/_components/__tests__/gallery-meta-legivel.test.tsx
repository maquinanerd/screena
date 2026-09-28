/**
 * gallery-meta-legivel.test.tsx — os rotulos da galeria separados no TEXTO, nao
 * so na tela.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * MEDIDO no Google em 28/09/2026, na primeira vez que a marca apareceu na busca:
 * o snippet de uma galeria de video saiu
 *
 *     "Cast and Crew Q&A | TIFF 2025. Featurette1080pInglesOficial ..."
 *
 * Quatro rotulos colados. Os `span` sao adjacentes no HTML e o `gap: 10px` do
 * CSS separa para o OLHO — o texto extraido (snippet do buscador, copiar-colar,
 * leitor de tela) nao ve `gap` nenhum e junta tudo.
 *
 * ============================================================================
 * POR QUE ESTE TESTE LE O TEXTO, E NAO O JSX
 * ============================================================================
 * Um guard que procurasse `visually-hidden` no fonte passaria com o separador
 * no lugar errado — depois do ultimo rotulo, por exemplo. O que interessa e o
 * TEXTO que sai do componente, que e exatamente o que o buscador leu. Por isso
 * aqui se renderiza e se arranca a marcacao, como o extrator faz.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GalleryImageView, GalleryVideoView } from "../../../src/lib/gallery-presenter";
import { GalleryImageGrid, GalleryVideoList } from "../gallery-grids";

/** O texto como um extrator o ve: sem marcacao, sem estilo, sem `gap`. */
function textoExtraido(markup: string): string {
  return markup.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
}

const VIDEO: GalleryVideoView = {
  videoKey: "dQw4w9WgXcQ",
  site: "YouTube",
  title: "Cast and Crew Q&A | TIFF 2025",
  player: {
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    name: null,
  },
  typeLabel: "Featurette",
  resolutionLabel: "1080p",
  languageLabel: "Inglês",
  official: true,
} as GalleryVideoView;

const IMAGEM: GalleryImageView = {
  kind: "poster",
  kindLabel: "Pôster",
  thumbUrl: "https://image.tmdb.org/t/p/w300/a.jpg",
  fullUrl: "https://image.tmdb.org/t/p/original/a.jpg",
  width: 300,
  height: 450,
  languageCode: "pt",
  languageLabel: "Português",
  alt: "Pôster de Um Filme",
} as GalleryImageView;

describe("galeria: os rótulos saem separados no texto extraído", () => {
  it("(1) vídeo: tipo, resolução, idioma e oficial NÃO saem colados", () => {
    const texto = textoExtraido(
      renderToStaticMarkup(<GalleryVideoList videos={[VIDEO]} entityTitle="Um Filme" />),
    );
    // O defeito exato que o Google exibiu.
    expect(texto).not.toContain("Featurette1080p");
    expect(texto).not.toContain("1080pInglês");
    expect(texto).not.toContain("InglêsOficial");
    // E os quatro continuam TODOS presentes: separar nao pode apagar rotulo.
    for (const rotulo of ["Featurette", "1080p", "Inglês", "Oficial"]) {
      expect(texto, rotulo).toContain(rotulo);
    }
  });

  it("(2) vídeo sem resolução e não oficial: sem separador sobrando", () => {
    // O separador acompanha o rotulo que ele separa. Sem o rotulo, sem o
    // separador — senao o texto sai com virgula solta.
    const magro = { ...VIDEO, resolutionLabel: null, official: false } as GalleryVideoView;
    const texto = textoExtraido(
      renderToStaticMarkup(<GalleryVideoList videos={[magro]} entityTitle="Um Filme" />),
    );
    expect(texto).toContain("Featurette, Inglês");
    expect(texto).not.toContain(", ,");
    expect(texto).not.toContain("Oficial");
  });

  it("(3) imagem: tipo e idioma não saem colados", () => {
    const texto = textoExtraido(renderToStaticMarkup(<GalleryImageGrid images={[IMAGEM]} />));
    expect(texto).not.toContain("PôsterPortuguês");
    expect(texto).toContain("Pôster, Português");
  });

  it("(4) CONTROLE: o extrator deste teste acusa a colagem quando ela existe", () => {
    // Sem este controle, um extrator quebrado faria os tres de cima passarem
    // por vacuidade — tudo "não contém" o que ele nunca leria.
    const colado = textoExtraido("<p><span>Featurette</span><span>1080p</span></p>");
    expect(colado).toBe("Featurette1080p");
  });
});
