/**
 * awards-authorization.test.ts — A decisao de 2026-08-13 sobre o credito do
 * FATO DE PREMIACAO, travada.
 *
 * O que este arquivo protege, e por que cada metade importa:
 *
 *  1. A DECISAO. Premio e fato publico, nao opiniao; o credito e de quem
 *     ENTREGOU o dado (`omdb`), com o verbo de transporte. Se alguem "arrumar"
 *     o texto para a forma curta da casa ("Premiacao fornecida por OMDb"), a
 *     frase passa a dizer que a OMDb PREMIOU alguem — e este teste cai.
 *  2. O QUE **NAO** MUDOU. A invariante 2 continua inteira para NOTAS: nenhuma
 *     licenca de `rating` credita um fornecedor tecnico. Uma decisao sobre
 *     premiacao que vazasse para ratings seria a regressao mais cara possivel
 *     aqui, e e exatamente o que a segunda metade verifica.
 */

import { RATING_SOURCES } from "@screena/config";
import { API_PROVIDER_SEED } from "@screena/db";
import { describe, expect, it } from "vitest";

import {
  AWARDS_ATTRIBUTION_TEXT,
  AWARDS_DISPLAY_USE_CASE,
  AWARDS_LICENSE_CONTENT_TYPE,
  AWARDS_POLICY_VERSION,
  AWARDS_SOURCE_KEY,
  AUTHORIZATION_BATCH,
  STATIC_AUTHORIZATION,
} from "../authorization-spec.js";

const AWARDS_ENTRIES = STATIC_AUTHORIZATION.filter((entry) =>
  entry.decisions.some((decision) => decision.useCase === AWARDS_DISPLAY_USE_CASE),
);

describe("a decisao: uma licenca de premiacao, creditando quem entregou", () => {
  it("existe EXATAMENTE uma — duas fariam o lookup recusar como `ambiguous`", () => {
    expect(AWARDS_ENTRIES).toHaveLength(1);
  });

  const entry = AWARDS_ENTRIES[0]!;

  it("credita `omdb`, e `omdb` e um fornecedor tecnico registrado", () => {
    expect(entry.license.sourceKey).toBe(AWARDS_SOURCE_KEY);
    expect(AWARDS_SOURCE_KEY).toBe("omdb");
    expect(API_PROVIDER_SEED.map((p) => p.key)).toContain(AWARDS_SOURCE_KEY);
  });

  it("o credito diz TRANSPORTE, nao autoria — assercao literal", () => {
    // "Premiacao fornecida por OMDb" se leria como se a OMDb tivesse concedido
    // o premio. Quem premia e a Academia; a OMDb entrega o dado.
    expect(entry.license.attributionText).toBe("Dados de premiacao fornecidos por OMDb");
    expect(AWARDS_ATTRIBUTION_TEXT).toBe(entry.license.attributionText);
    expect(entry.license.attributionText).not.toBe("Premiacao fornecida por OMDb");
  });

  it("nao e licenca de NOTA: content_type `other` e sem rating_source_key", () => {
    expect(entry.license.contentType).toBe(AWARDS_LICENSE_CONTENT_TYPE);
    expect(entry.license.contentType).toBe("other");
    // Apontar para `rating_sources` faria o premio herdar escala e natureza
    // critica/publico, que ele nao tem.
    expect(entry.license.ratingSourceKey).toBeNull();
    expect(entry.license.scoreAllowed).toBe(false);
  });

  it("logo NUNCA autorizado, e nenhuma obra derivada", () => {
    expect(entry.license.logoAllowed).toBe(false);
    expect(entry.license.reviewQuoteAllowed).toBe(false);
    for (const decision of entry.decisions) expect(decision.derivativeAllowed).toBe(false);
  });

  it("credito TEXTUAL obrigatorio; linkback dispensado por limitacao mecanica", () => {
    // `apply.ts` nao escreve `terms_url`, e e dela que o lookup tira a URL.
    // Exigir linkback deixaria a faixa em `missing-linkback` para sempre.
    expect(entry.license.requiresAttribution).toBe(true);
    expect(entry.license.requiresLinkback).toBe(false);
    expect(entry.decisions.every((d) => d.attributionRequired)).toBe(true);
    // A decisao espelha a licenca-mae: divergir faria o registro afirmar
    // "linkback obrigatorio" enquanto a licenca dispensa.
    expect(entry.decisions.every((d) => d.linkbackRequired === false)).toBe(true);
  });

  it("versao POR FONTE, e nenhuma leva nova foi criada", () => {
    expect(entry.license.policyVersion).toBe(AWARDS_POLICY_VERSION);
    expect(AWARDS_POLICY_VERSION).toBe("cinerie-source-auth/omdb/2026-08-v1");
    // A leva (o `--policy-version` da CLI) continua sendo a de julho.
    expect(AUTHORIZATION_BATCH).toBe("cinerie-source-auth/2026-07-v1");
    expect(entry.license.policyVersion).not.toBe(AUTHORIZATION_BATCH);
  });

  it("exibicao escopada ao territorio de publicacao (BR)", () => {
    const display = entry.decisions.find((d) => d.useCase === AWARDS_DISPLAY_USE_CASE)!;
    expect(display.stage).toBe("approved_for_display");
    expect(display.displayAllowed).toBe(true);
    expect(display.territory).toBe("BR");
  });
});

describe("o que NAO mudou: a invariante 2 continua inteira para NOTAS", () => {
  const providerKeys = new Set(API_PROVIDER_SEED.map((p) => p.key));

  it("nenhuma licenca de `rating` credita um fornecedor tecnico", () => {
    // Esta e a metade cara do arquivo. A decisao sobre premiacao vale SO para
    // premiacao; se ela vazasse para ratings, uma nota passaria a ser creditada
    // ao transportador — e `8,5/10` pertence a quem julgou.
    for (const entry of STATIC_AUTHORIZATION) {
      if (entry.license.contentType !== "rating") continue;
      expect(providerKeys.has(entry.license.sourceKey)).toBe(false);
      expect((RATING_SOURCES as readonly string[]).includes(entry.license.sourceKey)).toBe(true);
      expect(entry.license.ratingSourceKey).toBe(entry.license.sourceKey);
    }
  });

  it("nenhuma decisao de premiacao aparece sob uma licenca de nota", () => {
    for (const entry of STATIC_AUTHORIZATION) {
      if (entry.license.contentType !== "rating") continue;
      expect(entry.decisions.map((d) => d.useCase)).not.toContain(AWARDS_DISPLAY_USE_CASE);
    }
  });

  it("e nenhuma decisao de NOTA aparece sob a licenca de premiacao", () => {
    // O contrario tambem: `rating_display` sob a licenca de premiacao
    // autorizaria exibir nota creditada a `omdb`. O trigger do banco ja recusa,
    // mas o spec nao deve nem propor.
    for (const entry of AWARDS_ENTRIES) {
      expect(entry.decisions.map((d) => d.useCase)).not.toContain("rating_display");
    }
  });
});
