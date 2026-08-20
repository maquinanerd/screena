/**
 * plan.test.ts — Planejamento idempotente e as travas do spec.
 */

import { describe, expect, it } from "vitest";

import {
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
  type AuthorizationEntry,
  type LicenseTarget,
} from "../authorization-spec.js";
import {
  assertNoBlockedGrants,
  isPlanClean,
  planAuthorization,
  type CurrentDecision,
  type CurrentLicense,
} from "../plan.js";

/** Projeta o estado que o apply de um plano deixaria (para provar idempotência). */
function projectAfterApply(entries: readonly AuthorizationEntry[]): {
  licenses: CurrentLicense[];
  decisions: CurrentDecision[];
} {
  const licenses: CurrentLicense[] = [];
  const decisions: CurrentDecision[] = [];
  let licId = 1;
  let decId = 1;
  for (const e of entries) {
    const id = String(licId++);
    const l = e.license;
    licenses.push({
      id,
      sourceKey: l.sourceKey,
      contentType: l.contentType,
      ratingSourceKey: l.ratingSourceKey,
      providerKey: l.providerKey,
      territory: l.territory,
      licenseStatus: l.licenseStatus,
      displayAllowed: l.displayAllowed,
      logoAllowed: l.logoAllowed,
      scoreAllowed: l.scoreAllowed,
      reviewQuoteAllowed: l.reviewQuoteAllowed,
      requiresAttribution: l.requiresAttribution,
      requiresLinkback: l.requiresLinkback,
      attributionText: l.attributionText,
      policyVersion: l.policyVersion,
    });
    for (const d of e.decisions) {
      decisions.push({
        id: String(decId++),
        sourceLicenseId: id,
        useCase: d.useCase,
        territory: d.territory,
        stage: d.stage,
        displayAllowed: d.displayAllowed,
        storageAllowed: d.storageAllowed,
        derivativeAllowed: d.derivativeAllowed,
        attributionRequired: d.attributionRequired,
        linkbackRequired: d.linkbackRequired,
        policyVersion: d.policyVersion,
      });
    }
  }
  return { licenses, decisions };
}

describe("plano — do zero (banco sem autorização)", () => {
  it("planeja criar todas as licenças e decisões estáticas", () => {
    const plan = planAuthorization(STATIC_AUTHORIZATION, [], []);
    expect(plan.summary.licensesCreate).toBe(STATIC_AUTHORIZATION.length);
    expect(plan.summary.licensesSupersede).toBe(0);
    expect(plan.summary.decisionsCreate).toBeGreaterThan(0);
    expect(isPlanClean(plan)).toBe(false);
  });

  it("aplicado uma vez, um segundo plano NÃO escreve nada (idempotente)", () => {
    const { licenses, decisions } = projectAfterApply([...STATIC_AUTHORIZATION]);
    const plan2 = planAuthorization(STATIC_AUTHORIZATION, licenses, decisions);
    expect(isPlanClean(plan2)).toBe(true);
    expect(plan2.summary.licensesKeep).toBe(STATIC_AUTHORIZATION.length);
    expect(plan2.summary.decisionsSupersede).toBe(0);
  });
});

describe("plano — supersede da licença-semente", () => {
  it("uma licença vigente diferente do alvo é SUPERSEDIDA (não duplicada)", () => {
    // Semente conservadora do imdb/rating: global, unknown, nada exibível.
    const seed: CurrentLicense = {
      id: "100",
      sourceKey: "imdb",
      contentType: "rating",
      ratingSourceKey: "imdb",
      providerKey: null,
      territory: null,
      licenseStatus: "unknown",
      displayAllowed: false,
      logoAllowed: false,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: null,
      policyVersion: null,
    };
    const imdbEntry = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "imdb" && e.license.contentType === "rating")!;
    const plan = planAuthorization([imdbEntry], [seed], []);
    expect(plan.entries[0]!.license.action).toBe("supersede");
    expect(plan.entries[0]!.license.currentId).toBe("100");
    // Decisões nascem novas na licença nova (não podem herdar a antiga).
    expect(plan.entries[0]!.decisions.every((d) => d.action === "create")).toBe(true);
  });
});

describe("plano — streaming por provedor real (nunca inventado)", () => {
  it("sem provedores em watch_providers, não há entrada de streaming display", () => {
    expect(streamingProviderEntries([])).toEqual([]);
  });

  /**
   * UMA ENTRADA POR ORIGEM, nao uma por provedor. O credito de uma oferta
   * pertence ao FORNECEDOR TECNICO do dado: `streaming_availability` credita
   * Movie of the Night; `tmdb` credita JustWatch (o TMDB revende dado do
   * JustWatch e seus termos exigem essa atribuicao). Uma entrada so por provedor
   * obrigaria as duas origens a dividir um credito — proveniencia falsa.
   *
   * Detalhe de credito e proveniencia fica em
   * `tests/governance/watch-attribution-provenance.test.ts`; aqui checa-se a
   * FORMA (source_key = slug, content_type, use_case, territorio).
   */
  it("com um provedor real, gera watch_availability + watch_offer_display POR ORIGEM (source_key = slug)", () => {
    const entries = streamingProviderEntries([{ slug: "netflix", canonicalName: "Netflix" }]);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.license.providerKey).sort()).toEqual([
      "streaming_availability",
      "tmdb",
    ]);
    for (const entry of entries) {
      expect(entry.license.sourceKey).toBe("netflix");
      expect(entry.license.contentType).toBe("watch_availability");
      expect(entry.decisions[0]!.useCase).toBe("watch_offer_display");
      expect(entry.decisions[0]!.territory).toBe("BR");
    }
  });
});

describe("travas do spec — o que a decisao do proprietario (2026-08-20) autorizou, e SO ele", () => {
  it("review_quote continua proibido em toda entrada; derivada SO na decisao do score", () => {
    for (const e of STATIC_AUTHORIZATION) {
      expect(e.license.reviewQuoteAllowed, e.label).toBe(false);
      for (const d of e.decisions) {
        if (d.useCase === "cinerie_score_display") {
          expect(d.derivativeAllowed, e.label).toBe(true);
          expect(d.derivativeBasis, e.label).toBe("owner_decision");
        } else {
          expect(d.derivativeAllowed, `${e.label}/${d.useCase}`).toBe(false);
          expect(d.derivativeBasis, `${e.label}/${d.useCase}`).toBe(null);
        }
      }
    }
  });

  /**
   * LOGO: IGUALDADE DE CONJUNTO, nunca "some". A lista nomeia exatamente quem
   * pode — nem mais, nem menos. Desde 20/08/2026 ela tem DUAS bases: o TMDB
   * entra pelos proprios termos (que EXIGEM o logo) e as tres fontes de nota
   * exibiveis entram pela decisao do proprietario
   * (docs/legal/owner-authorization-2026-08-20.md). Uma setima entrada liberada
   * por engano reprova aqui.
   */
  it("logo liberado no conjunto exato: TMDB (termos) + 3 fontes de nota (decisao do dono)", () => {
    const comLogo = STATIC_AUTHORIZATION.filter((e) => e.license.logoAllowed).map(
      (e) => `${e.license.sourceKey}/${e.license.contentType}:${e.license.logoBasis}`,
    );
    expect(comLogo.sort()).toEqual([
      "imdb/rating:owner_decision",
      "metacritic/rating:owner_decision",
      "rotten_tomatoes/rating:owner_decision",
      "tmdb/image:source_terms",
      "tmdb/other:source_terms",
      "tmdb/video:source_terms",
    ]);
  });

  it("fonte com exibicao REVOGADA nao ganha marca (logo de fonte invisivel e afirmacao sem lastro)", () => {
    for (const source of ["letterboxd", "filmaffinity"]) {
      const e = STATIC_AUTHORIZATION.find((x) => x.license.sourceKey === source)!;
      expect(e.license.logoAllowed, source).toBe(false);
      expect(e.license.logoBasis, source).toBe(null);
      expect(e.license.logoAsset, source).toBe(null);
    }
  });

  it("toda entrada explica o REGIME de marca — inclusive as que nao tem logo", () => {
    // Regime sem registro escrito e indistinguivel de "ninguem olhou".
    for (const e of STATIC_AUTHORIZATION) {
      expect(e.license.logoRationale.trim().length, e.label).toBeGreaterThan(40);
    }
  });

  it("marca autorizada declara o ARQUIVO oficial e a BASE; bloqueada nao declara nada", () => {
    // As tres direçoes: `logoAllowed` sem arquivo deixaria a pagina livre para
    // desenhar uma aproximaçao; arquivo sem `logoAllowed` seria marca declarada
    // que ninguem pode usar; base sem marca (ou marca sem base) faria o
    // registro afirmar procedencia que nao existe.
    for (const e of STATIC_AUTHORIZATION) {
      expect(e.license.logoAsset !== null, e.label).toBe(e.license.logoAllowed);
      expect(e.license.logoBasis !== null, e.label).toBe(e.license.logoAllowed);
    }
  });

  it("ha EXATAMENTE UMA decisao cinerie_score_display, sob a licenca do IMDb (fonte-ancora)", () => {
    const portadores = STATIC_AUTHORIZATION.filter((e) =>
      e.decisions.some((d) => d.useCase === "cinerie_score_display"),
    );
    expect(portadores.map((e) => e.license.sourceKey)).toEqual(["imdb"]);
    const decisao = portadores[0]!.decisions.filter(
      (d) => d.useCase === "cinerie_score_display",
    );
    expect(decisao).toHaveLength(1);
    expect(decisao[0]!.stage).toBe("approved_for_display");
    expect(decisao[0]!.displayAllowed).toBe(true);
    expect(decisao[0]!.derivativeAllowed).toBe(true);
    expect(decisao[0]!.derivativeBasis).toBe("owner_decision");
  });

  it("assertNoBlockedGrants passa no plano estático", () => {
    const plan = planAuthorization(STATIC_AUTHORIZATION, [], []);
    expect(() => assertNoBlockedGrants(plan)).not.toThrow();
  });

  it("assertNoBlockedGrants REJEITA derivative_allowed fora da decisao do score", () => {
    const poisoned: AuthorizationEntry = {
      label: "veneno",
      role: "editorial-rating-source",
      license: { ...STATIC_AUTHORIZATION.find((e) => e.license.contentType === "rating")!.license },
      decisions: [
        {
          useCase: "internal_analytics",
          territory: null,
          stage: "approved_for_internal_use",
          displayAllowed: false,
          storageAllowed: true,
          derivativeAllowed: true,
          derivativeBasis: null,
          attributionRequired: true,
          linkbackRequired: true,
          policyVersion: "x",
        },
      ],
    };
    const plan = planAuthorization([poisoned], [], []);
    expect(() => assertNoBlockedGrants(plan)).toThrow(/derivative/);
  });

  it("assertNoBlockedGrants REJEITA decisao de score SEM a base do proprietario", () => {
    const imdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "imdb")!;
    const semBase: AuthorizationEntry = {
      ...imdb,
      label: "score sem base",
      decisions: imdb.decisions.map((d) =>
        d.useCase === "cinerie_score_display" ? { ...d, derivativeBasis: null } : d,
      ),
    };
    const plan = planAuthorization([semBase], [], []);
    expect(() => assertNoBlockedGrants(plan)).toThrow(/owner_decision/);
  });

  it("assertNoBlockedGrants REJEITA logo fora das allowlists nominais", () => {
    const imdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "imdb")!;
    const foraDaLista: AuthorizationEntry = {
      ...imdb,
      label: "fonte fora da lista",
      license: { ...imdb.license, sourceKey: "fonte-nova-sem-decisao" },
      decisions: [],
    };
    const plan = planAuthorization([foraDaLista], [], []);
    expect(() => assertNoBlockedGrants(plan)).toThrow(/allowlists nominais/);
  });

  it("assertNoBlockedGrants REJEITA base que nao bate com a allowlist (mentira de procedencia)", () => {
    const imdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "imdb")!;
    const baseErrada: AuthorizationEntry = {
      ...imdb,
      label: "imdb com base de termos",
      license: { ...imdb.license, logoBasis: "source_terms" },
      decisions: [],
    };
    const plan = planAuthorization([baseErrada], [], []);
    expect(() => assertNoBlockedGrants(plan)).toThrow(/a base gravada tem que dizer a verdade/);
  });
});

describe("fontes cobertas — papéis distintos (invariante 2)", () => {
  it("classifica corretamente official vs third_party", () => {
    const tmdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb" && e.license.contentType === "other")!;
    expect(tmdb.license.licenseStatus).toBe("official");
    for (const source of ["imdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"]) {
      const e = STATIC_AUTHORIZATION.find((x) => x.license.sourceKey === source)!;
      expect(e.license.licenseStatus, source).toBe("third_party");
    }
    const motn = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "movie-of-the-night")!;
    expect(motn.license.licenseStatus).toBe("third_party");
  });

  it("TMDB carrega o disclaimer literal exigido", () => {
    const tmdb = STATIC_AUTHORIZATION.find((e) => e.license.sourceKey === "tmdb")!;
    expect(tmdb.license.attributionText).toBe(
      "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
    );
  });
});

describe("chave de agrupamento — codificacao injetiva (nao por separador)", () => {
  /**
   * `sourceKey`, `providerKey` e `territory` sao strings LIVRES vindas do banco.
   * Os testes abaixo exercitam o agrupamento SO pela API publica
   * (`planAuthorization`): se duas licencas distintas colidissem na chave, a
   * segunda seria vista como "ja existe" e viraria `keep`/`supersede` em vez de
   * `create`.
   */
  function licenca(over: {
    sourceKey: string;
    providerKey: string | null;
    territory: string | null;
  }): LicenseTarget {
    return {
      sourceKey: over.sourceKey,
      contentType: "other",
      ratingSourceKey: null,
      providerKey: over.providerKey,
      territory: over.territory,
      licenseStatus: "third_party",
      displayAllowed: false,
      logoAllowed: false,
      logoBasis: null,
      logoRationale: "fixture de teste: sem marca declarada",
      logoAsset: null,
      scoreAllowed: false,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      requiresLinkback: true,
      attributionText: "atribuicao de teste",
      policyVersion: "teste-v1",
      notes: "fixture",
    };
  }

  function entrada(license: LicenseTarget): AuthorizationEntry {
    return {
      label: `fixture ${license.sourceKey}`,
      role: "streaming-aggregator",
      license,
      decisions: [],
    };
  }

  function vigente(id: string, license: LicenseTarget): CurrentLicense {
    return {
      id,
      sourceKey: license.sourceKey,
      contentType: license.contentType,
      ratingSourceKey: license.ratingSourceKey,
      providerKey: license.providerKey,
      territory: license.territory,
      licenseStatus: license.licenseStatus,
      displayAllowed: license.displayAllowed,
      logoAllowed: license.logoAllowed,
      scoreAllowed: license.scoreAllowed,
      reviewQuoteAllowed: license.reviewQuoteAllowed,
      requiresAttribution: license.requiresAttribution,
      requiresLinkback: license.requiresLinkback,
      attributionText: license.attributionText,
      policyVersion: license.policyVersion,
    };
  }

  it("campos contendo o delimitador obvio NAO colidem", () => {
    // Com um separador "|", as duas chaves seriam a MESMA string
    // ("fonte|other|a|b|c") e a segunda licenca seria confundida com a primeira.
    // E por isso que a codificacao e `JSON.stringify` de tupla, e nao um
    // separador: os campos sao livres, entao nenhum delimitador pode ser provado
    // ausente deles.
    const a = licenca({ sourceKey: "fonte", providerKey: "a|b", territory: "c" });
    const b = licenca({ sourceKey: "fonte", providerKey: "a", territory: "b|c" });

    const plan = planAuthorization([entrada(a), entrada(b)], [vigente("1", a)], []);

    expect(plan.entries[0]!.license.action).toBe("keep");
    expect(plan.entries[0]!.license.currentId).toBe("1");
    // A segunda e OUTRA licenca: nunca pode casar com a vigente da primeira.
    expect(plan.entries[1]!.license.action).toBe("create");
    expect(plan.entries[1]!.license.currentId).toBeNull();
  });

  it("campos contendo byte de controle tambem NAO colidem", () => {
    // O separador ANTIGO era 0x1F. Montado com `String.fromCharCode` para que
    // este arquivo jamais carregue o byte cru que a governanca proibe.
    const US = String.fromCharCode(0x1f);
    const a = licenca({ sourceKey: "fonte", providerKey: `a${US}b`, territory: "c" });
    const b = licenca({ sourceKey: "fonte", providerKey: "a", territory: `b${US}c` });

    const plan = planAuthorization([entrada(a), entrada(b)], [vigente("1", a)], []);

    expect(plan.entries[0]!.license.action).toBe("keep");
    expect(plan.entries[1]!.license.action).toBe("create");
  });

  it("licencas iguais continuam agrupando (a guarda nao virou paranoia)", () => {
    // Controle POSITIVO: sem ele, um encoder que devolvesse valor unico por
    // chamada passaria nos dois testes acima e quebraria a idempotencia.
    const a = licenca({ sourceKey: "fonte", providerKey: "p", territory: "BR" });
    const plan = planAuthorization([entrada(a)], [vigente("1", a)], []);
    expect(plan.entries[0]!.license.action).toBe("keep");
    expect(plan.entries[0]!.license.currentId).toBe("1");
  });

  it("null e string vazia continuam sendo o MESMO grupo (comportamento preservado)", () => {
    // Caracterizacao do `?? ""` que ja existia: a correcao de encoding nao podia
    // mudar agrupamento nenhum, e este teste trava isso.
    const comNull = licenca({ sourceKey: "fonte", providerKey: null, territory: null });
    const comVazio = licenca({ sourceKey: "fonte", providerKey: "", territory: "" });

    const plan = planAuthorization([entrada(comVazio)], [vigente("1", comNull)], []);
    expect(plan.entries[0]!.license.currentId).toBe("1");
  });

  it("a chave de agrupamento nunca aparece no plano (so existe em memoria)", () => {
    const a = licenca({ sourceKey: "fonte", providerKey: "p", territory: "BR" });
    const plan = planAuthorization([entrada(a)], [], []);
    const serializado = JSON.stringify(plan);
    // Se a chave vazasse para o plano, o valor concatenado apareceria no JSON.
    expect(serializado).not.toContain('["fonte","other"');
  });
});
