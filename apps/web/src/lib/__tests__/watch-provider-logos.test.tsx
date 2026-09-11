/**
 * watch-provider-logos.test.tsx — O LOGO de cada serviço de streaming, do dado
 * até o DOM.
 *
 * Ordem expressa do proprietário (2026-09-11): "inclua OBRIGATORIAMENTE AS
 * LOGOS dos serviços de stream". Este arquivo prova as três metades que tornam
 * isso seguro, e nenhuma basta sozinha:
 *
 *  1. IDENTIDADE: o logo sai do SLUG canônico da plataforma (via licença do
 *     provedor), nunca do nome que o fornecedor escreveu — "Amazon Prime Video"
 *     e "Prime Video" são o mesmo arquivo; um provedor sem alias não ganha logo
 *     de ninguém.
 *  2. MARCA AGRUPADA: "Paramount+" usa o logo da rota MAIS DIRETA (assinatura
 *     própria), não o do canal dentro do Prime.
 *  3. DOM: a imagem é decorativa (`alt=""`), a palavra-marca continua ESCRITA
 *     ao lado, e nada é desenhado (`<svg>` proibido).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WatchBrandsRow } from "../../../app/_components/watch-brands-row";
import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
} from "../watch-availability-presenter";
import { watchBrandsRow } from "../watch-brands-row";
import { groupBrowseProvidersByBrand } from "../watch-browse-brands";

function row(over: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: "Netflix",
    providerKey: "8",
    providerSlug: "netflix",
    offerType: "subscription",
    deepLink: null,
    webUrl: "https://www.justwatch.com/br/filme/titulo",
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: "2026-09-10T00:00:00.000Z",
    requiresAttribution: true,
    requiresLinkback: false,
    attributionText: "Disponibilidade fornecida por JustWatch",
    attributionUrl: null,
    ...over,
  };
}

describe("identidade: o logo sai do SLUG canônico, nunca do nome", () => {
  it("provedor registrado ganha o PNG declarado pela licença, com o nome no alt", () => {
    const view = buildWatchAvailabilityView([row()])!;
    const brand = view.groups[0]!.brands[0]!;
    expect(brand.logo).toEqual({
      src: "/brand/providers/netflix.png",
      alt: "Netflix",
      heightPx: 24,
      widthPx: 24,
    });
  });

  it("o NOME do fornecedor não decide: outro rótulo, mesmo slug, mesmo arquivo", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Amazon Prime Video", providerKey: "119", providerSlug: "prime-video" }),
    ])!;
    expect(view.groups[0]!.brands[0]!.logo?.src).toBe("/brand/providers/prime-video.png");
  });

  it("oferta sem alias canônico não ganha logo de ninguém", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Fictiloja", providerKey: "99999", providerSlug: null }),
    ])!;
    expect(view.groups[0]!.brands[0]!.logo).toBeNull();
  });
});

describe("marca agrupada: o logo da rota mais DIRETA", () => {
  it("Paramount+ (assinatura própria + canal no Prime) usa o logo da assinatura própria", () => {
    const view = buildWatchAvailabilityView([
      row({
        providerName: "Paramount+ Amazon Channel",
        providerKey: "582",
        providerSlug: "paramount-plus-amazon-channel",
        webUrl: "https://www.justwatch.com/br/filme/titulo?canal",
      }),
      row({ providerName: "Paramount Plus", providerKey: "531", providerSlug: "paramount-plus" }),
    ])!;
    const brands = view.groups[0]!.brands;
    expect(brands).toHaveLength(1);
    expect(brands[0]!.name).toBe("Paramount+");
    expect(brands[0]!.logo?.src).toBe("/brand/providers/paramount-plus.png");
    // O alt é o nome da MARCA, que é o que a tela escreve.
    expect(brands[0]!.logo?.alt).toBe("Paramount+");
  });
});

describe("fileira do topo e hub: o logo viaja com a marca", () => {
  it("watchBrandsRow carrega o logo da marca", () => {
    const view = buildWatchAvailabilityView([row()])!;
    expect(watchBrandsRow(view)[0]!.logo?.src).toBe("/brand/providers/netflix.png");
  });

  it("o hub /pt/onde-assistir carrega o logo por marca", () => {
    const [brand] = groupBrowseProvidersByBrand(
      [{ providerSlug: "globoplay", providerName: "Globoplay", titles: [] as string[] }],
      { titleKey: (t) => t },
    );
    expect(brand!.logo?.src).toBe("/brand/providers/globoplay.png");
  });
});

describe("DOM: imagem decorativa + palavra-marca escrita, nada desenhado", () => {
  it("o <img> é decorativo e o nome continua em texto", () => {
    const view = buildWatchAvailabilityView([row()])!;
    const markup = renderToStaticMarkup(<WatchBrandsRow brands={watchBrandsRow(view)} />);
    const img = /<img[^>]*data-watch-logo=[^>]*>/.exec(markup)?.[0] ?? "";
    expect(img, "o logo tem de estar no DOM").not.toBe("");
    expect(img).toContain('src="/brand/providers/netflix.png"');
    expect(img).toContain('alt=""');
    expect(img).toContain('aria-hidden="true"');
    expect(markup).toContain('class="watch-brands__name">Netflix<');
    expect(markup).not.toContain("<svg");
  });

  it("provedor sem arquivo: nenhuma imagem, só o nome", () => {
    const view = buildWatchAvailabilityView([
      row({ providerName: "Fictiloja", providerKey: "99999", providerSlug: null }),
    ])!;
    const markup = renderToStaticMarkup(<WatchBrandsRow brands={watchBrandsRow(view)} />);
    expect(markup).not.toContain("<img");
    expect(markup).toContain(">Fictiloja<");
  });
});
