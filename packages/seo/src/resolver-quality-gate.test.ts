/**
 * O resolver unico recebe as duas causas novas da remediacao de 11/09/2026:
 *
 *  - PORTAO DE QUALIDADE (decisoes do dono D1-D3): `noindex, follow`;
 *  - DECISAO AUSENTE COM GATE ARMADO: a regra do sitemap chegando a pagina.
 *
 * O que se trava e a PRECEDENCIA: nenhuma causa nova pode mascarar uma causa
 * mais basica (licenca, idioma, caso tecnico), e nenhuma decisao persistida
 * pode relaxar um portao barrado.
 */

import { describe, expect, it } from "vitest";

import {
  evaluateGalleryGate,
  evaluateLocalizationGate,
  evaluatePersonQualityGate,
} from "./entity-quality-gates.js";
import { mergePersistedDecision, resolvePageSeo, type PageSeoFacts } from "./resolver.js";

const BASE: PageSeoFacts = {
  language: "pt-BR",
  hasReliableStructuredData: true,
  displayedRatings: [],
  canonicalUrl: "https://cinerie.com/pt/filmes/tmdb-1/",
};

const BARRADA = evaluateLocalizationGate({
  canonicalSlug: "tmdb-1",
  localizedTitle: null,
  originalTitle: "Τίποτα",
  hasLocalizedDescription: false,
});

describe("portao de qualidade no resolver", () => {
  it("(1) portao barrado => noindex, FOLLOW, fora do sitemap, com o motivo do portao", () => {
    const r = resolvePageSeo({ ...BASE, qualityGate: BARRADA });
    expect(r.decision).toBe("noindex");
    expect(r.robots).toEqual({ index: false, follow: true });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("quality-gate");
    expect(r.reason).toBe(BARRADA.reason);
  });

  it("(2) portao aprovado nao muda nada: indexacao total", () => {
    const aprovado = evaluateLocalizationGate({
      canonicalSlug: "a-origem",
      localizedTitle: null,
      originalTitle: "Inception",
      hasLocalizedDescription: false,
    });
    const r = resolvePageSeo({ ...BASE, qualityGate: aprovado });
    expect(r.decision).toBe("index");
    expect(r.decisionSource).toBe("total-indexing");
  });

  it("(3) CONTROLE: sem portao informado, a pagina indexa como antes", () => {
    expect(resolvePageSeo(BASE).decision).toBe("index");
  });

  it("(4) licenca bloqueada vence o portao: blocked, e o motivo continua sendo a licenca", () => {
    const r = resolvePageSeo({
      ...BASE,
      qualityGate: BARRADA,
      displayedRatings: [{ licenseDisplayAllowed: false }],
    });
    expect(r.decision).toBe("blocked");
    expect(r.decisionSource).toBe("license-blocked");
  });

  it("(5) idioma nao publicado vence o portao", () => {
    expect(resolvePageSeo({ ...BASE, language: "en", qualityGate: BARRADA }).decisionSource).toBe(
      "language-not-published",
    );
  });

  it("(6) caso tecnico vence o portao: dado invalido e causa mais basica que dado insuficiente", () => {
    const r = resolvePageSeo({ ...BASE, hasReliableStructuredData: false, qualityGate: BARRADA });
    expect(r.decisionSource).toBe("technical-invalid");
  });

  it("(7) os tres portoes das decisoes do dono entram pelo mesmo caminho", () => {
    const pessoa = evaluatePersonQualityGate({
      name: "X",
      hasCanonicalSlug: true,
      biography: null,
      biographySourceStatus: "unknown",
      profilePath: null,
      indexableCreditCount: 0,
    });
    for (const portao of [evaluateGalleryGate(), pessoa, BARRADA]) {
      const r = resolvePageSeo({ ...BASE, qualityGate: portao });
      expect(r.decisionSource, portao.gate).toBe("quality-gate");
      expect(r.robots, portao.gate).toEqual({ index: false, follow: true });
    }
  });
});

describe("decisao ausente com gate armado — a regra do sitemap na pagina", () => {
  const viva = resolvePageSeo(BASE);

  it("(8) armado e sem linha => noindex, follow, fora do sitemap", () => {
    const r = mergePersistedDecision(viva, null, { absentDecision: "noindex" });
    expect(r.decision).toBe("noindex");
    expect(r.robots).toEqual({ index: false, follow: true });
    expect(r.includeInSitemap).toBe(false);
    expect(r.decisionSource).toBe("absent-decision-armed");
  });

  it("(9) DESARMADO (default) e sem linha => a resolucao viva, inalterada", () => {
    expect(mergePersistedDecision(viva, null)).toBe(viva);
    expect(mergePersistedDecision(viva, null, { absentDecision: "index" })).toBe(viva);
  });

  it("(10) armado nao REESCREVE um bloqueio vivo: o motivo de quem bloqueou fica", () => {
    const bloqueada = resolvePageSeo({ ...BASE, displayedRatings: [{ licenseDisplayAllowed: false }] });
    const barrada = resolvePageSeo({ ...BASE, qualityGate: BARRADA });
    expect(mergePersistedDecision(bloqueada, null, { absentDecision: "noindex" })).toBe(bloqueada);
    expect(mergePersistedDecision(barrada, null, { absentDecision: "noindex" })).toBe(barrada);
  });

  it("(11) uma decisao persistida `index` NAO relaxa um portao barrado", () => {
    // A decisao persistida pode restringir; nunca reabre o que os fatos vivos
    // fecharam. Um `index` gravado antes de a pessoa perder a foto nao pode
    // mante-la no indice.
    const barrada = resolvePageSeo({ ...BASE, qualityGate: BARRADA });
    const r = mergePersistedDecision(
      barrada,
      { decision: "index", decisionOrigin: "catalog_policy_engine", policyVersion: "v2" },
      { absentDecision: "noindex" },
    );
    expect(r.decision).toBe("noindex");
    expect(r.decisionSource).toBe("quality-gate");
  });

  it("(12) uma decisao persistida presente ignora `absentDecision`: ela so vale na AUSENCIA", () => {
    const r = mergePersistedDecision(
      viva,
      { decision: "index", decisionOrigin: "catalog_policy_engine", policyVersion: "v2" },
      { absentDecision: "noindex" },
    );
    expect(r.decision).toBe("index");
  });
});
