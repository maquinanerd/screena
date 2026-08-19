/**
 * watch-brand-grouping.test.ts — O painel agrupa pela marca DECLARADA, nos dois
 * sentidos: o que e a mesma marca junta, o que so PARECE junta nao.
 *
 * ============ POR QUE OS DOIS SENTIDOS, E NAO SO UM ============
 *
 * Um teste que so prova "Paramount+ agrupa" fica verde com a implementacao mais
 * errada possivel: agrupar por prefixo comum do nome. Essa implementacao passa o
 * caso positivo inteiro e destroi o negativo — funde "Claro video" (loja) com
 * "Claro tv+" (streaming da operadora) e "Amazon Video" (compra avulsa) com
 * "Amazon Prime Video" (assinatura), afirmando ao leitor um acesso que ele nao
 * tem.
 *
 * Por isso metade deste arquivo mede o que NAO agrupa. E os pares negativos nao
 * sao inventados: sao exatamente os que uma derivacao por string fundiria.
 *
 * ============ O QUE NAO PODE ACONTECER, EM NENHUM DOS DOIS ============
 *
 *  - nenhuma oferta pode sumir (agrupar e apresentacao);
 *  - nenhuma rota pode perder o proprio destino;
 *  - o rotulo da rota tem de dizer o que o leitor precisa ter — "canal no Prime
 *    Video" nomeia o hospedeiro, porque assinar o canal exige assinar o Prime.
 */

import { describe, expect, it } from "vitest";

import {
  WATCH_BRAND_DECLARATIONS,
  findWatchBrand,
  validateWatchBrandDeclarations,
  watchRouteLabel,
} from "@screena/public-contracts";

import {
  buildWatchAvailabilityView,
  type WatchAvailabilityRow,
  type WatchAvailabilityView,
} from "../../apps/web/src/lib/watch-availability-presenter";

/** Uma oferta exibivel, ja licenciada, do slug pedido. */
function row(
  providerSlug: string,
  providerName: string,
  over: Partial<WatchAvailabilityRow> = {},
): WatchAvailabilityRow {
  return {
    providerName,
    providerKey: providerSlug,
    providerSlug,
    offerType: "subscription",
    // Destino no PROVEDOR e deliberado: sem deep link a precedencia de
    // proveniencia entraria em cena e poderia descartar uma oferta, e este
    // arquivo mede AGRUPAMENTO, nao precedencia.
    deepLink: `https://exemplo.test/${providerSlug}`,
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: "2026-08-19T00:00:00.000Z",
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: "Disponibilidade fornecida por Agregador Exemplo",
    attributionUrl: "https://exemplo.test/sobre",
    ...over,
  };
}

function view(rows: WatchAvailabilityRow[]): WatchAvailabilityView {
  const built = buildWatchAvailabilityView(rows);
  if (built === null) throw new Error("painel vazio: as fixtures nao passaram nos gates");
  return built;
}

/** O grupo de `subscription`, onde todas as fixtures deste arquivo caem. */
function assinatura(rows: WatchAvailabilityRow[]) {
  const group = view(rows).groups.find((g) => g.offerType === "subscription");
  if (group === undefined) throw new Error("grupo de assinatura ausente");
  return group;
}

describe("declaracoes: forma valida e coerente", () => {
  it("nenhuma declaracao malformada", () => {
    expect(validateWatchBrandDeclarations(WATCH_BRAND_DECLARATIONS)).toEqual([]);
  });

  it("CONTROLE NEGATIVO: qualificador sem marca e recusado", () => {
    // `soldVia` sob `brand: null` renderizaria "· canal no X" numa linha solta,
    // afirmando uma hierarquia que nao existe. A validacao roda de verdade,
    // sobre um objeto de verdade.
    const errors = validateWatchBrandDeclarations([
      { slug: "orfao", brand: null, variant: null, soldVia: "Prime Video" },
      { slug: "orfa-variante", brand: null, variant: "Premium", soldVia: null },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.includes("exige brand"))).toBe(true);
  });
});

describe("SENTIDO 1 — a mesma marca AGRUPA", () => {
  it("as quatro rotas do Paramount+ viram UMA marca", () => {
    const group = assinatura([
      row("paramount-plus", "Paramount Plus"),
      row("paramount-plus-premium", "Paramount Plus Premium"),
      row("paramount-plus-amazon-channel", "Paramount+ Amazon Channel"),
      row("paramount-plus-apple-tv-channel", "Paramount Plus Apple TV Channel"),
    ]);

    expect(group.brands).toHaveLength(1);
    expect(group.brands[0]!.name).toBe("Paramount+");
    expect(group.brands[0]!.declared).toBe(true);
    // NENHUMA OFERTA SUMIU: quatro entraram, quatro rotas sairam.
    expect(group.brands[0]!.routes).toHaveLength(4);
    expect(group.offers).toHaveLength(4);
  });

  it("cada rota diz o que o leitor precisa ter, e leva ao PROPRIO destino", () => {
    const group = assinatura([
      row("paramount-plus", "Paramount Plus"),
      row("paramount-plus-premium", "Paramount Plus Premium"),
      row("paramount-plus-amazon-channel", "Paramount+ Amazon Channel"),
      row("paramount-plus-apple-tv-channel", "Paramount Plus Apple TV Channel"),
    ]);
    const routes = group.brands[0]!.routes;

    // Ordem por ESFORCO do leitor: direto, plano superior, canais. Entre os
    // canais o desempate e pelo hospedeiro DECLARADO ("Apple TV" antes de
    // "Prime Video"), nunca pelo nome que o upstream escreveu — esse muda
    // quando a TMDB quiser.
    expect(routes.map((r) => r.label)).toEqual([
      "direto",
      "plano Premium",
      "canal no Apple TV",
      "canal no Prime Video",
    ]);
    // Destinos distintos: nenhuma rota herdou o link da vizinha.
    const destinos = routes.map((r) => r.offer.destinationUrl);
    expect(new Set(destinos).size).toBe(4);
  });

  it("marca com UMA rota de canal: a marca manda, o canal fica na rota", () => {
    // "Telecine · canal no Prime Video" em vez de "Telecine Amazon Channel". O
    // ganho aqui nao e juntar (nao ha o que juntar) — e dizer o que o nome cru
    // nao dizia.
    const group = assinatura([row("telecine-amazon-channel", "Telecine Amazon Channel")]);
    expect(group.brands).toHaveLength(1);
    expect(group.brands[0]!.name).toBe("Telecine");
    expect(group.brands[0]!.routes[0]!.label).toBe("canal no Prime Video");
  });

  it("marca com UMA rota direta NAO ganha rotulo — seria ruido", () => {
    const group = assinatura([row("max", "HBO Max")]);
    expect(group.brands[0]!.name).toBe("HBO Max");
    expect(group.brands[0]!.routes[0]!.label).toBeNull();
  });

  it('a rota direta SO vira "direto" quando ha outra para distinguir', () => {
    const sozinha = assinatura([row("max", "HBO Max")]);
    expect(sozinha.brands[0]!.routes[0]!.label).toBeNull();

    const acompanhada = assinatura([
      row("max", "HBO Max"),
      row("hbo-max-amazon-channel", "HBO Max Amazon Channel"),
    ]);
    expect(acompanhada.brands).toHaveLength(1);
    expect(acompanhada.brands[0]!.routes.map((r) => r.label)).toEqual([
      "direto",
      "canal no Prime Video",
    ]);
  });
});

describe("SENTIDO 2 — nome parecido NAO agrupa", () => {
  it("Claro video e Claro tv+ continuam separados", () => {
    // Prefixo identico, produtos diferentes: loja transacional vs streaming da
    // operadora. Qualquer heuristica de prefixo os funde.
    const group = assinatura([
      row("claro-video", "Claro video"),
      row("claro-tv-plus", "Claro tv+"),
    ]);
    expect(group.brands).toHaveLength(2);
    expect(group.brands.map((b) => b.name).sort()).toEqual(["Claro tv+", "Claro video"]);
    expect(group.brands.every((b) => b.declared === false)).toBe(true);
  });

  it("a loja da Amazon nao entra na assinatura da Amazon", () => {
    // "Amazon Video" (compra avulsa) e "Amazon Prime Video" (assinatura).
    // Funde-las afirmaria que a compra esta inclusa — o defeito que o slug
    // `amazon-video` nasceu para impedir.
    const group = assinatura([
      row("amazon-video", "Amazon Video"),
      row("prime-video", "Amazon Prime Video"),
    ]);
    expect(group.brands).toHaveLength(2);
    // Cada uma responde por si: uma rota, sem rotulo, com o proprio destino.
    for (const brand of group.brands) {
      expect(brand.routes).toHaveLength(1);
      expect(brand.routes[0]!.label).toBeNull();
    }
    expect(new Set(group.brands.map((b) => b.name)).size).toBe(2);
  });

  it("MGM+ na Amazon e MGM+ na Apple SAO a mesma marca (o contraste)", () => {
    // O par acima nao agrupa apesar do nome parecido; este agrupa apesar de
    // estar em lojas diferentes. Nenhuma regra sobre a STRING acerta os dois.
    const group = assinatura([
      row("mgm-plus-amazon-channel", "MGM Plus Amazon Channel"),
      row("mgm-plus-apple-tv-channel", "MGM+ Apple TV Channel"),
    ]);
    expect(group.brands).toHaveLength(1);
    expect(group.brands[0]!.name).toBe("MGM+");
    expect(group.brands[0]!.routes.map((r) => r.label)).toEqual([
      "canal no Apple TV",
      "canal no Prime Video",
    ]);
  });

  it("CONTROLE NEGATIVO DA PROPRIA SUITE: derivar por prefixo quebraria o SENTIDO 2", () => {
    // Prova que os pares negativos deste arquivo sao mesmo capazes de pegar a
    // implementacao errada — sem isto, "nao agrupou" poderia significar apenas
    // que a fixture nunca chegou perto do agrupador.
    const prefixo = (nome: string): string => nome.split(" ")[0]!;
    // A derivacao ingenua fundiria os dois pares negativos...
    expect(prefixo("Claro video")).toBe(prefixo("Claro tv+"));
    expect(prefixo("Amazon Video")).toBe(prefixo("Amazon Prime Video"));
    // ...e SEPARARIA um par que e a mesma marca.
    expect(prefixo("MGM Plus Amazon Channel")).not.toBe(prefixo("MGM+ Apple TV Channel"));
  });
});

describe("agrupamento e OPT-IN — o desconhecido nunca e engolido", () => {
  it("slug sem declaracao aparece sozinho, com o proprio nome", () => {
    const group = assinatura([row("provedor-que-ninguem-declarou", "Plataforma Nova")]);
    expect(findWatchBrand("provedor-que-ninguem-declarou")).toBeNull();
    expect(group.brands).toHaveLength(1);
    expect(group.brands[0]!.name).toBe("Plataforma Nova");
    expect(group.brands[0]!.declared).toBe(false);
    expect(group.brands[0]!.routes[0]!.label).toBeNull();
  });

  it("oferta SEM slug canonico tambem aparece sozinha", () => {
    // `providerSlug: null` acontece quando nao ha alias. A linha responde so por
    // si — nunca e adotada por uma marca vizinha.
    const group = assinatura([
      row("max", "HBO Max"),
      { ...row("orfa", "Servico Sem Alias"), providerSlug: null },
    ]);
    expect(group.brands).toHaveLength(2);
    const orfa = group.brands.find((b) => b.name === "Servico Sem Alias");
    expect(orfa?.declared).toBe(false);
    expect(orfa?.routes).toHaveLength(1);
  });

  it("nenhuma oferta some, em nenhuma combinacao", () => {
    const rows = [
      row("paramount-plus", "Paramount Plus"),
      row("paramount-plus-premium", "Paramount Plus Premium"),
      row("claro-video", "Claro video"),
      row("claro-tv-plus", "Claro tv+"),
      row("provedor-que-ninguem-declarou", "Plataforma Nova"),
    ];
    const group = assinatura(rows);
    const rotas = group.brands.flatMap((b) => b.routes);
    // Toda oferta que entrou virou EXATAMENTE uma rota.
    expect(rotas).toHaveLength(rows.length);
    expect(group.offers).toHaveLength(rows.length);
    expect(new Set(rotas.map((r) => r.offer.destinationUrl)).size).toBe(rows.length);
  });
});

describe("watchRouteLabel — as quatro formas, num lugar so", () => {
  it("monta o rotulo a partir do que a declaracao afirma", () => {
    const alone = { aloneInBrand: true };
    const junto = { aloneInBrand: false };
    const base = { slug: "x", brand: "Marca" } as const;

    expect(watchRouteLabel({ ...base, variant: null, soldVia: null }, alone)).toBeNull();
    expect(watchRouteLabel({ ...base, variant: null, soldVia: null }, junto)).toBe("direto");
    expect(watchRouteLabel({ ...base, variant: "Premium", soldVia: null }, alone)).toBe(
      "plano Premium",
    );
    expect(watchRouteLabel({ ...base, variant: null, soldVia: "Apple TV" }, alone)).toBe(
      "canal no Apple TV",
    );
    expect(watchRouteLabel({ ...base, variant: "Premium", soldVia: "Apple TV" }, alone)).toBe(
      "plano Premium, canal no Apple TV",
    );
  });

  it("sem marca declarada nao ha rotulo, mesmo com `aloneInBrand: false`", () => {
    expect(watchRouteLabel(null, { aloneInBrand: false })).toBeNull();
    expect(
      watchRouteLabel(
        { slug: "x", brand: null, variant: null, soldVia: null },
        { aloneInBrand: false },
      ),
    ).toBeNull();
  });
});
