/**
 * omdb-linkback-dispensation.test.ts — A decisao de licenca de 2026-08-12.
 *
 * Trava a forma da dispensa, nao so o seu efeito: ela e NOMINAL (duas fontes),
 * o credito textual continua obrigatorio para todas, e as fontes nao servidas
 * pela OMDb ficam intocadas — de modo que o registry devolva `keep` para elas
 * em vez de supersedir licencas que ninguem mexeu.
 */

import { describe, expect, it } from "vitest";

import { STATIC_AUTHORIZATION, ratingRequiresLinkback } from "../authorization-spec.js";
import { planAuthorization, type CurrentLicense } from "../plan.js";

const RATING_ENTRIES = STATIC_AUTHORIZATION.filter(
  (entry) => entry.license.contentType === "rating",
);

function licenseOf(source: string) {
  const entry = RATING_ENTRIES.find((e) => e.license.ratingSourceKey === source);
  if (entry === undefined) throw new Error(`sem licenca de rating para "${source}"`);
  return entry.license;
}

describe("dispensa de linkback — quem foi dispensado", () => {
  it("Rotten Tomatoes e Metacritic NAO exigem linkback", () => {
    expect(licenseOf("rotten_tomatoes").requiresLinkback).toBe(false);
    expect(licenseOf("metacritic").requiresLinkback).toBe(false);
  });

  it("IMDb CONTINUA exigindo linkback — a dispensa nao e geral", () => {
    expect(licenseOf("imdb").requiresLinkback).toBe(true);
  });

  it("Letterboxd e FilmAffinity (nao servidas pela OMDb) seguem exigindo", () => {
    expect(licenseOf("letterboxd").requiresLinkback).toBe(true);
    expect(licenseOf("filmaffinity").requiresLinkback).toBe(true);
  });

  it("`ratingRequiresLinkback` nomeia exatamente as duas dispensadas", () => {
    expect(ratingRequiresLinkback("imdb")).toBe(true);
    expect(ratingRequiresLinkback("rotten_tomatoes")).toBe(false);
    expect(ratingRequiresLinkback("metacritic")).toBe(false);
    expect(ratingRequiresLinkback("letterboxd")).toBe(true);
  });
});

describe("o que a dispensa NAO tocou", () => {
  it("credito TEXTUAL continua obrigatorio em todas as fontes", () => {
    for (const entry of RATING_ENTRIES) {
      expect(entry.license.requiresAttribution, entry.label).toBe(true);
      expect(entry.license.attributionText.trim().length, entry.label).toBeGreaterThan(0);
    }
  });

  it("logo e citacao integral continuam proibidos", () => {
    for (const entry of RATING_ENTRIES) {
      expect(entry.license.logoAllowed, entry.label).toBe(false);
      expect(entry.license.reviewQuoteAllowed, entry.label).toBe(false);
    }
  });

  it("nenhuma decisao autoriza obra derivada nem o Cinerie Score", () => {
    for (const entry of RATING_ENTRIES) {
      for (const decision of entry.decisions) {
        expect(decision.derivativeAllowed, entry.label).toBe(false);
        expect(decision.useCase as string, entry.label).not.toBe("cinerie_score_display");
      }
    }
  });

  it("as fontes continuam third_party (a OMDb e intermediaria, nao a fonte)", () => {
    for (const entry of RATING_ENTRIES) {
      expect(entry.license.licenseStatus, entry.label).toBe("third_party");
    }
  });
});

describe("coerencia entre licenca e decisao", () => {
  it("`linkbackRequired` da decisao espelha `requiresLinkback` da licenca", () => {
    for (const entry of RATING_ENTRIES) {
      for (const decision of entry.decisions) {
        expect(decision.linkbackRequired, entry.label).toBe(entry.license.requiresLinkback);
      }
    }
  });
});

describe("rastreabilidade da mudanca", () => {
  it("as tres fontes da OMDb subiram de versao de politica", () => {
    for (const source of ["imdb", "rotten_tomatoes", "metacritic"]) {
      expect(licenseOf(source).policyVersion, source).toContain("2026-08-v1");
    }
  });

  it("as nao servidas pela OMDb mantem a versao de julho (nao sao supersedidas)", () => {
    for (const source of ["letterboxd", "filmaffinity"]) {
      expect(licenseOf(source).policyVersion, source).toContain("2026-07-v1");
    }
  });

  it("as notas das dispensadas explicam o motivo E o gatilho de reversao", () => {
    for (const source of ["rotten_tomatoes", "metacritic"]) {
      const notes = licenseOf(source).notes;
      expect(notes, source).toContain("LINKBACK DISPENSADO");
      expect(notes, source).toContain("2026-08-12");
      expect(notes, source).toContain("Pablo Eduardo");
      expect(notes, source).toContain("REVERSAO AUTOMATICA");
    }
  });

  it("a nota do IMDb diz explicitamente que a dispensa nao se aplica a ele", () => {
    const notes = licenseOf("imdb").notes;
    expect(notes).toContain("LINKBACK OBRIGATORIO");
    expect(notes).toContain("NAO se aplica");
  });

  it("as tres notas da OMDb citam o fornecedor tecnico correto", () => {
    for (const source of ["imdb", "rotten_tomatoes", "metacritic"]) {
      expect(licenseOf(source).notes, source).toContain("provider_api=omdb");
    }
  });
});

describe("o registry planeja a mudanca como SUPERSEDE, nunca UPDATE destrutivo", () => {
  /** Projecao do estado vigente ANTES desta leva (as licencas de 2026-07). */
  function currentJulyLicense(source: string, id: string): CurrentLicense {
    return {
      id,
      sourceKey: source,
      contentType: "rating",
      ratingSourceKey: source,
      providerKey: null,
      territory: null,
      licenseStatus: "third_party",
      displayAllowed: true,
      logoAllowed: false,
      scoreAllowed: true,
      reviewQuoteAllowed: false,
      requiresAttribution: true,
      // Como era em julho: linkback obrigatorio para TODAS.
      requiresLinkback: true,
      attributionText: `Nota fornecida por ${source}`,
      policyVersion: `cinerie-source-auth/${source}/2026-07-v1`,
    };
  }

  it("RT e Metacritic sao supersedidas; letterboxd/filmaffinity nao", () => {
    const current = [
      currentJulyLicense("rotten_tomatoes", "10"),
      currentJulyLicense("metacritic", "11"),
    ];
    const entries = RATING_ENTRIES.filter((e) =>
      ["rotten_tomatoes", "metacritic"].includes(e.license.ratingSourceKey!),
    );

    const plan = planAuthorization(entries, current, []);
    expect(plan.summary.licensesSupersede).toBe(2);
    expect(plan.summary.licensesKeep).toBe(0);
    // Historico preservado: a licenca antiga e referenciada, nao apagada.
    for (const entry of plan.entries) {
      expect(entry.license.action).toBe("supersede");
      expect(entry.license.currentId).not.toBeNull();
    }
  });

  it("e IDEMPOTENTE: aplicar duas vezes o mesmo spec nao escreve na segunda", () => {
    const applied: CurrentLicense[] = RATING_ENTRIES.map((entry, index) => ({
      id: String(100 + index),
      sourceKey: entry.license.sourceKey,
      contentType: entry.license.contentType,
      ratingSourceKey: entry.license.ratingSourceKey,
      providerKey: entry.license.providerKey,
      territory: entry.license.territory,
      licenseStatus: entry.license.licenseStatus,
      displayAllowed: entry.license.displayAllowed,
      logoAllowed: entry.license.logoAllowed,
      scoreAllowed: entry.license.scoreAllowed,
      reviewQuoteAllowed: entry.license.reviewQuoteAllowed,
      requiresAttribution: entry.license.requiresAttribution,
      requiresLinkback: entry.license.requiresLinkback,
      attributionText: entry.license.attributionText,
      policyVersion: entry.license.policyVersion,
    }));

    const plan = planAuthorization(RATING_ENTRIES, applied, []);
    expect(plan.summary.licensesCreate).toBe(0);
    expect(plan.summary.licensesSupersede).toBe(0);
    expect(plan.summary.licensesKeep).toBe(RATING_ENTRIES.length);
  });
});
