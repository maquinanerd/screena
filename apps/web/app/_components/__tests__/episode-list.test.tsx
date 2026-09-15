/**
 * episode-list.test.tsx — a lista de episodios da ficha de serie, agora client
 * component, entrega o MESMO HTML que a pagina entregava.
 *
 * O que se trava aqui:
 *  1. e client component de verdade — e isso que tira do payload RSC a arvore
 *     de elementos de cada linha (a prova contra o Next real e do
 *     `validate:route-cache`);
 *  2. cada episodio sai com numero, still, titulo, sinopse inteira e meta, na
 *     ordem recebida e com a marcacao que a ficha sempre teve;
 *  3. o still so aparece quando o servidor o autorizou (chega `null` sem licenca);
 *  4. o numero e UM texto, sem os `<!-- -->` que o HTML do servidor intercalava.
 */

import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readSourceWithoutComments } from "../../../../../tests/support/source-text";
import type { SeriesEpisodeView } from "../../../src/lib/series-presenter";
import { EpisodeList } from "../episode-list";

const STILL = { src: "https://image.tmdb.org/t/p/w500/still.jpg", width: 640, height: 360 };

function episode(overrides: Partial<SeriesEpisodeView> = {}): SeriesEpisodeView {
  return {
    episodeNumber: 1,
    title: "Piloto",
    overview: "Sinopse inteira do piloto, sem corte nenhum.",
    airYear: 2019,
    runtimeLabel: "45 min",
    still: STILL,
    ...overrides,
  };
}

describe("EpisodeList — a lista de episodios da ficha de serie", () => {
  it("(1) e client component: a diretiva e a primeira instrucao do arquivo", () => {
    // A diretiva e instrucao, nao comentario: sobrevive a remocao de comentarios.
    const source = readSourceWithoutComments("apps/web/app/_components/episode-list.tsx");
    expect(source.trimStart().startsWith("'use client'")).toBe(true);
  });

  it("(2) um item por episodio, na ordem recebida, com a marcacao da ficha", () => {
    const html = renderToStaticMarkup(
      <EpisodeList
        episodes={[episode(), episode({ episodeNumber: 2, title: "Segundo episodio" })]}
        seasonNumber={3}
      />,
    );
    expect(html.startsWith('<ol class="episode-list" style="margin-top:6px">')).toBe(true);
    expect(html.match(/<li><article class="episode-row">/g)).toHaveLength(2);
    expect(html.indexOf(">Piloto<")).toBeLessThan(html.indexOf(">Segundo episodio<"));
    expect(html).toContain('<span class="episode-row__num">T3 · E1</span>');
    expect(html).toMatch(
      /<img alt="" height="360" loading="lazy" src="https:\/\/image\.tmdb\.org\/t\/p\/w500\/still\.jpg" width="640"\/?>/,
    );
    expect(html).toContain(
      '<h4 class="episode-row__title" style="letter-spacing:-0.01em;text-transform:none">Piloto</h4>',
    );
    expect(html).toContain(
      '<p class="episode-row__synopsis">Sinopse inteira do piloto, sem corte nenhum.</p>',
    );
    expect(html).toContain('<p class="episode-row__meta">2019 · 45 min</p>');
    expect(html).toContain('<span aria-hidden="true" class="episode-row__chevron"><svg');
  });

  it("(3) sem still autorizado nao ha img; campo ausente nao vira elemento vazio", () => {
    const html = renderToStaticMarkup(
      <EpisodeList
        episodes={[episode({ still: null, title: null, overview: null, airYear: null, runtimeLabel: null })]}
        seasonNumber={1}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("episode-row__title");
    expect(html).not.toContain("episode-row__synopsis");
    expect(html).not.toContain("episode-row__meta");
    expect(html).toContain('<span class="episode-row__num">T1 · E1</span>');
  });

  it("(4) o numero do episodio e UM texto: sem `<!-- -->` no HTML do servidor", () => {
    const html = renderToString(
      <EpisodeList episodes={[episode({ episodeNumber: 23, airYear: null })]} seasonNumber={1} />,
    );
    expect(html).toContain('<span class="episode-row__num">T1 · E23</span>');
    expect(html).not.toContain("<!-- -->");
  });
});
