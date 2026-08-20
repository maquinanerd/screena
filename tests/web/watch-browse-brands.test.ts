/**
 * watch-browse-brands.test.ts — o hub /pt/onde-assistir agrupa pela MARCA.
 *
 * O QUE ISTO GUARDA. Antes da leva BR o hub listava provedor, e isso passava
 * despercebido. Com os 24 provedores novos ele passou a listar "Paramount Plus",
 * "Paramount Plus Premium" e "Paramount+ Amazon Channel" como se fossem tres
 * servicos — enquanto o painel da PAGINA DE TITULO ja agrupava desde
 * 2026-08-19. A mesma pagina contava duas historias sobre o mesmo provedor.
 *
 * As declaracoes usadas aqui sao as REAIS (`@screena/public-contracts`), nao
 * fixtures: o que se quer provar e que o hub le a MESMA fonte do painel. Um
 * fixture proprio provaria apenas que a copia concorda consigo mesma.
 */

import { describe, expect, it } from "vitest";

import { groupBrowseProvidersByBrand } from "../../apps/web/src/lib/watch-browse-brands";

interface Title {
  readonly href: string;
}

const titleKey = (title: Title) => title.href;

function provider(slug: string, name: string, hrefs: string[] = []) {
  return { providerSlug: slug, providerName: name, titles: hrefs.map((href) => ({ href })) };
}

describe("uma marca, N rotas", () => {
  it("as tres rotas do Paramount+ viram UMA entrada", () => {
    const brands = groupBrowseProvidersByBrand(
      [
        provider("paramount-plus", "Paramount Plus"),
        provider("paramount-plus-premium", "Paramount Plus Premium"),
        provider("paramount-plus-amazon-channel", "Paramount+ Amazon Channel"),
      ],
      { titleKey },
    );

    expect(brands).toHaveLength(1);
    expect(brands[0]?.name).toBe("Paramount+");
    expect(brands[0]?.routes).toHaveLength(3);
  });

  it("a rota mais DIRETA vem primeiro; o canal vem por ultimo", () => {
    const brands = groupBrowseProvidersByBrand(
      [
        provider("paramount-plus-amazon-channel", "Paramount+ Amazon Channel"),
        provider("paramount-plus-premium", "Paramount Plus Premium"),
        provider("paramount-plus", "Paramount Plus"),
      ],
      { titleKey },
    );

    expect(brands[0]?.routes.map((route) => route.label)).toEqual([
      "direto",
      "plano Premium",
      "canal no Prime Video",
    ]);
  });

  it("o rotulo nomeia o HOSPEDEIRO — some-lo esconderia um custo", () => {
    const brands = groupBrowseProvidersByBrand(
      [provider("telecine-amazon-channel", "Telecine Amazon Channel")],
      { titleKey },
    );
    // Marca de rota unica: o nome ja e a linha inteira, mas o canal precisa
    // dizer onde e vendido.
    expect(brands[0]?.name).toBe("Telecine");
    expect(brands[0]?.routes[0]?.label).toBe("canal no Prime Video");
  });

  it("o mesmo titulo em duas rotas da marca aparece UMA vez", () => {
    const brands = groupBrowseProvidersByBrand(
      [
        provider("max", "Max", ["/pt/filmes/a/"]),
        provider("hbo-max-amazon-channel", "HBO Max Amazon Channel", ["/pt/filmes/a/", "/pt/filmes/b/"]),
      ],
      { titleKey },
    );
    expect(brands[0]?.titles.map((title) => title.href)).toEqual(["/pt/filmes/a/", "/pt/filmes/b/"]);
  });
});

describe("agrupar e OPT-IN — nao existe `else` que adivinhe marca", () => {
  it("provedor com `brand: null` continua sozinho, com o proprio nome", () => {
    const brands = groupBrowseProvidersByBrand([provider("netflix", "Netflix")], { titleKey });
    expect(brands[0]?.declared).toBe(false);
    expect(brands[0]?.name).toBe("Netflix");
    expect(brands[0]?.routes[0]?.label).toBeNull();
  });

  it("provedor NAO declarado tambem fica sozinho — nunca some, nunca funde", () => {
    const brands = groupBrowseProvidersByBrand(
      [provider("provedor-que-ninguem-declarou", "Provedor Novo")],
      { titleKey },
    );
    expect(brands).toHaveLength(1);
    expect(brands[0]?.declared).toBe(false);
    expect(brands[0]?.name).toBe("Provedor Novo");
  });

  it("prefixo parecido NAO funde: a loja da Claro e o streaming da Claro", () => {
    const brands = groupBrowseProvidersByBrand(
      [provider("claro-video", "Claro video"), provider("claro-tv-plus", "Claro tv+")],
      { titleKey },
    );
    expect(brands).toHaveLength(2);
  });

  it("prefixo parecido NAO funde: a loja da Amazon e a assinatura", () => {
    const brands = groupBrowseProvidersByBrand(
      [provider("amazon-video", "Amazon Video"), provider("prime-video", "Amazon Prime Video")],
      { titleKey },
    );
    // Fundi-las afirmaria que a compra avulsa esta inclusa na assinatura.
    expect(brands).toHaveLength(2);
  });

  it("nomes DIFERENTES da mesma marca fundem: Max e HBO Max Amazon Channel", () => {
    const brands = groupBrowseProvidersByBrand(
      [provider("max", "Max"), provider("hbo-max-amazon-channel", "HBO Max Amazon Channel")],
      { titleKey },
    );
    expect(brands).toHaveLength(1);
    expect(brands[0]?.name).toBe("HBO Max");
  });
});

describe("nenhum provedor some no caminho", () => {
  it("toda entrada vira exatamente uma rota", () => {
    const slugs = [
      "max",
      "hbo-max-amazon-channel",
      "paramount-plus",
      "paramount-plus-premium",
      "netflix",
      "claro-video",
      "provedor-desconhecido",
    ];
    const brands = groupBrowseProvidersByBrand(
      slugs.map((slug) => provider(slug, slug)),
      { titleKey },
    );
    const routes = brands.flatMap((brand) => brand.routes.map((route) => route.providerSlug));
    expect(routes.slice().sort()).toEqual(slugs.slice().sort());
  });
});
