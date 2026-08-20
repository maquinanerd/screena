/**
 * tmdb-video-license.test.ts — A licenca de VIDEO do TMDB, registrada em
 * 13/08/2026.
 *
 * POR QUE ELA PRECISOU EXISTIR. `tmdb_videos` era ingerida desde a Fase 7 e
 * nascia `display_allowed = false`. O enum `SourceLicenseContentType` ja tinha o
 * valor `video` — mas nao havia NENHUMA entrada de autorizacao para ele: so
 * metadados (`other`) e imagens (`image`). Sem licenca, a invariante 6 bloqueia,
 * e o botao de trailer nunca poderia aparecer.
 *
 * O QUE ESTE ARQUIVO TRANCA. Duas coisas em direcoes opostas:
 *
 *  1. Que a licenca REALMENTE autoriza exibir (senao a PR seria decorativa).
 *  2. Que ela nao autoriza NADA ALEM disso — nem logo, nem obra derivada, nem
 *     promocao de dado. Uma entrada de licenca e o lugar mais barato do
 *     repositorio para conceder demais sem ninguem notar.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { STATIC_AUTHORIZATION } from "../authorization-spec";
import { planAuthorization } from "../plan";

const TMDB_DISCLAIMER =
  "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.";

const video = STATIC_AUTHORIZATION.find(
  (entry) => entry.license.sourceKey === "tmdb" && entry.license.contentType === "video",
);

describe("a licenca de video do TMDB existe e autoriza exibir", () => {
  it("CONTROLE POSITIVO: a entrada existe, e e `video` + `official` + display", () => {
    // Sem esta, todas as asserçoes negativas abaixo passariam por vacuidade.
    expect(video).toBeDefined();
    expect(video!.license.contentType).toBe("video");
    expect(video!.license.licenseStatus).toBe("official");
    expect(video!.license.displayAllowed).toBe(true);
  });

  it("e a UNICA entrada de video — duas licencas vigentes brigariam pelo mesmo grupo", () => {
    const todas = STATIC_AUTHORIZATION.filter((e) => e.license.contentType === "video");
    expect(todas).toHaveLength(1);
  });

  it("credita o TMDB com o disclaimer LITERAL, igual as outras entradas TMDB", () => {
    // Texto identico e o que permite ao rodape deduplicar: TMDB tem tres
    // licencas e aparece uma vez so.
    expect(video!.license.attributionText).toBe(TMDB_DISCLAIMER);
    const tmdb = STATIC_AUTHORIZATION.filter((e) => e.license.sourceKey === "tmdb");
    expect(tmdb.length).toBeGreaterThanOrEqual(3);
    for (const entry of tmdb) {
      expect(entry.license.attributionText, entry.label).toBe(TMDB_DISCLAIMER);
    }
  });

  it("o provedor tecnico e o TMDB e NAO ha fonte editorial de rating (invariante 2)", () => {
    expect(video!.license.providerKey).toBe("tmdb");
    expect(video!.license.ratingSourceKey).toBeNull();
  });
});

describe("NEGATIVO — o que a licenca de video NAO concede", () => {
  it("nota e citacao de critica seguem bloqueados", () => {
    expect(video!.license.scoreAllowed).toBe(false);
    expect(video!.license.reviewQuoteAllowed).toBe(false);
  });

  /**
   * O LOGO INVERTEU, e a inversao merece ficar escrita aqui: quando esta
   * licenca foi registrada (13/08/2026) o comentario dela dizia "Logo do TMDB e
   * do YouTube seguem bloqueados: nenhuma marca de terceiro e desenhada por
   * nos". A metade sobre o YouTube continua certa. A metade sobre o TMDB estava
   * errada — os termos da API EXIGEM o logo do TMDB, e `false` era
   * descumprimento, nao zelo.
   */
  it("o logo do TMDB e AUTORIZADO (os termos o exigem), e declara o arquivo oficial", () => {
    expect(video!.license.logoAllowed).toBe(true);
    expect(video!.license.logoAsset).not.toBeNull();
    expect(video!.license.logoAsset!.officialSourceUrl).toContain("themoviedb.org");
  });

  it("NEGATIVO: nenhuma marca do YOUTUBE e autorizada por esta licenca", () => {
    // O player e do YouTube, e a licenca do TMDB nao concede marca do Google.
    // A licenca declara UM arquivo, e ele e do TMDB.
    expect(video!.license.logoAsset!.alt).toBe("TMDB");
    expect(JSON.stringify(video!.license).toLowerCase()).not.toContain("youtube.com/");
  });

  it("nenhuma decisao autoriza obra derivada", () => {
    for (const decision of video!.decisions) {
      expect(decision.derivativeAllowed, decision.useCase).toBe(false);
    }
  });

  it("nenhuma decisao de video e `cinerie_score_display`", () => {
    for (const decision of video!.decisions) {
      expect(decision.useCase).not.toBe("cinerie_score_display");
    }
  });

  it("a decisao nunca concede MAIS que a licenca-mae (teto do trigger)", () => {
    // O trigger `data_usage_decisions_guard` reprova isso no banco; aqui a
    // mesma regra e afirmada no spec, antes de chegar la.
    for (const decision of video!.decisions) {
      if (decision.displayAllowed) expect(video!.license.displayAllowed).toBe(true);
      expect(decision.storageAllowed).toBe(true);
    }
  });

  it("a atribuicao continua obrigatoria — licenca nao dispensa credito", () => {
    expect(video!.license.requiresAttribution).toBe(true);
    for (const decision of video!.decisions) {
      expect(decision.attributionRequired).toBe(true);
    }
  });
});

/**
 * A parte que mais engana: registrar a licenca NAO acende o trailer.
 *
 * `source_licenses` diz o que a fonte PERMITE. Quem decide se uma linha
 * especifica de `tmdb_videos` e exibivel e a coluna `display_allowed` daquela
 * linha — e nada no repositorio a escreve. Mesma separacao de ratings e
 * streaming, onde a promocao e um passo proprio com guardrails.
 *
 * Este bloco existe para que "melhorar" o apply para ligar a coluna reprove
 * aqui, e nao em producao.
 */
describe("a licenca NAO promove dado — sao dois passos, nao um", () => {
  const ROOT = process.cwd();
  const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

  it("NEGATIVO — `apply` e `plan` nao tocam em `tmdb_videos`", () => {
    for (const rel of ["services/legal/src/apply.ts", "services/legal/src/plan.ts"]) {
      const source = read(rel);
      expect(source, rel).not.toContain("tmdb_video");
      expect(source, rel).not.toContain("tmdbVideo");
    }
  });

  it("CONTROLE POSITIVO: eles tocam mesmo em source_licenses (o guard nao e vacuo)", () => {
    expect(read("services/legal/src/apply.ts")).toContain("source_licenses");
  });

  it("o plano trata a entrada de video como as demais (idempotente)", () => {
    const plan = planAuthorization(STATIC_AUTHORIZATION, [], []);
    expect(plan.summary.licensesCreate).toBe(STATIC_AUTHORIZATION.length);
  });
});
