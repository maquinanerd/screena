/**
 * title-relevance.test.ts — o portao de relevancia do lado da PAGINA.
 *
 * Decisao do dono (24/09/2026): nasce LIGADO; so `CINERIE_RELEVANCE_GATE=off`
 * desliga, e desligado a pagina fica exatamente como antes — sem nem consultar
 * pais e oferta. Ligado, le as MESMAS fontes que o SQL do sitemap: paises de
 * origem gravados (qualquer posicao) e QUALQUER linha BR de watch_availability.
 *
 * A paridade com o SQL rodando no PostgreSQL esta em `validate:relevance-gate`.
 */

import { afterEach, describe, expect, it } from "vitest";

import { evaluateTitleRelevance } from "../../apps/web/src/server/seo/title-relevance";

const ENV = "CINERIE_RELEVANCE_GATE";

interface Chamadas {
  movieCountries: unknown[];
  tvCountries: unknown[];
  offers: unknown[];
}

function fakePrisma(opts: { countries: string[]; offerBr: boolean }) {
  const calls: Chamadas = { movieCountries: [], tvCountries: [], offers: [] };
  const rows = opts.countries.map((countryCode) => ({ countryCode }));
  const prisma = {
    movieProductionCountry: {
      findMany: async (args: unknown) => {
        calls.movieCountries.push(args);
        return rows;
      },
    },
    tvShowOriginCountry: {
      findMany: async (args: unknown) => {
        calls.tvCountries.push(args);
        return rows;
      },
    },
    watchAvailability: {
      findFirst: async (args: unknown) => {
        calls.offers.push(args);
        return opts.offerBr ? { id: 1n } : null;
      },
    },
  };
  return { prisma: prisma as never, calls };
}

afterEach(() => {
  delete process.env[ENV];
});

describe("evaluateTitleRelevance", () => {
  it("AUSENTE = ligado: le paises e oferta e reprova o tailandes sem oferta", async () => {
    const { prisma, calls } = fakePrisma({ countries: ["TH"], offerBr: false });
    const v = await evaluateTitleRelevance(prisma, { entityType: "movie", entityId: 7n, voteCount: 3 });
    expect(v).toMatchObject({ passed: false, gate: "relevance", code: "country_outside_anchor" });
    expect(calls.movieCountries).toHaveLength(1);
    expect(calls.offers).toEqual([
      { where: { entityType: "movie", entityId: 7n, countryCode: "BR" }, select: { id: true } },
    ]);
  });

  it("serie le tv_show_origin_countries; oferta BR mantem no indice", async () => {
    const { prisma, calls } = fakePrisma({ countries: ["KR"], offerBr: true });
    const v = await evaluateTitleRelevance(prisma, { entityType: "tv", entityId: 9n, voteCount: 0 });
    expect(v).toMatchObject({ passed: true, code: "brazil_offer" });
    expect(calls.tvCountries).toHaveLength(1);
    expect(calls.movieCountries).toHaveLength(0);
  });

  it("sem pais e 0 votos sai com o motivo proprio", async () => {
    const { prisma } = fakePrisma({ countries: [], offerBr: false });
    const v = await evaluateTitleRelevance(prisma, { entityType: "movie", entityId: 1n, voteCount: null });
    expect(v).toMatchObject({ passed: false, code: "no_country" });
  });

  it("`off` = passa SEM consultar o banco (a pagina de antes da decisao)", async () => {
    process.env[ENV] = "off";
    const { prisma, calls } = fakePrisma({ countries: ["TH"], offerBr: false });
    const v = await evaluateTitleRelevance(prisma, { entityType: "movie", entityId: 7n, voteCount: 0 });
    expect(v).toMatchObject({ passed: true, code: "gate_off" });
    expect(calls).toEqual({ movieCountries: [], tvCountries: [], offers: [] });
  });

  it("valor diferente de `off` NAO desliga", async () => {
    process.env[ENV] = "false";
    const { prisma } = fakePrisma({ countries: ["TH"], offerBr: false });
    const v = await evaluateTitleRelevance(prisma, { entityType: "movie", entityId: 7n, voteCount: 0 });
    expect(v.passed).toBe(false);
  });
});
