/**
 * synopsis-language.test.ts — A politica de idioma do T2, nos DOIS sentidos.
 *
 * O que este arquivo tranca:
 *
 *  1. Texto no locale publicado VENCE sempre. A excecao do T2 e para ausencia,
 *     nunca preferencia.
 *  2. Texto em idioma de origem entra — e NUNCA sem aviso.
 *  3. A prioridade global (`pt-BR` > `pt`) nao foi afrouxada.
 *  4. A escolha e deterministica: nao depende da ordem em que o banco devolveu.
 */

import { describe, expect, it } from "vitest";

import {
  isPublishedLocale,
  originalLanguageNotice,
  primarySubtag,
  PUBLISHED_LOCALES,
  publishedLocaleRank,
  selectSynopsis,
  type TranslationCandidate,
} from "../synopsis-language";

function row(
  languageCode: string,
  summary: string | null,
  metaDescription: string | null = null,
): TranslationCandidate {
  return { languageCode, summary, metaDescription };
}

describe("prioridade do locale publicado NAO foi afrouxada", () => {
  it("o conjunto publicado continua sendo exatamente pt-BR e pt", () => {
    // Se alguem acrescentar `en` aqui para "resolver" o T2, este teste reprova:
    // a decisao do dono foi excecao com ESCOPO, nao mudanca global.
    expect([...PUBLISHED_LOCALES]).toEqual(["pt-BR", "pt"]);
    expect(isPublishedLocale("en-US")).toBe(false);
    expect(isPublishedLocale("en")).toBe(false);
  });

  it("pt-BR vence pt, e locale desconhecido perde de todos", () => {
    expect(publishedLocaleRank("pt-BR")).toBeLessThan(publishedLocaleRank("pt"));
    expect(publishedLocaleRank("en-US")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("havendo pt-BR e pt, escolhe pt-BR — em qualquer ordem de entrada", () => {
    const rows = [row("pt", "texto pt"), row("pt-BR", "texto pt-BR")];
    for (const ordem of [rows, [...rows].reverse()]) {
      const escolhido = selectSynopsis(ordem, "en");
      expect(escolhido?.source).toBe("published_locale");
      expect(escolhido?.text).toBe("texto pt-BR");
    }
  });
});

describe("O MESMO TITULO nos dois caminhos", () => {
  // Um unico titulo, com sinopse SO em ingles — o caso que a medicao mostrou
  // ser ~70% das recusas do meio da distribuicao.
  const soIngles = [row("en-US", "A washed-up boxer gets one last shot.")];

  it("SEMENTE: sem texto publicado, a pagina nao finge — ela marca", () => {
    // Na semente esse titulo nem entra (ver `on-demand/eligibility.ts`). Se ele
    // ESTIVER no banco, o render nao pode exibir ingles como se fosse pt-BR.
    const view = selectSynopsis(soIngles, "en");
    expect(view).not.toBeNull();
    expect(view?.source).toBe("original_language");
  });

  it("SOB DEMANDA: o texto entra, e o aviso vem junto e nao vazio", () => {
    const view = selectSynopsis(soIngles, "en");
    if (view?.source !== "original_language") {
      throw new Error("esperado o braco original_language");
    }
    expect(view.text).toContain("washed-up boxer");
    expect(view.notice.length).toBeGreaterThan(0);
    // O aviso nomeia o idioma, nao so diz "outro idioma".
    expect(view.notice).toContain("Inglês");
    expect(view.languageCode).toBe("en-US");
  });

  it("o mesmo titulo COM traducao pt-BR nao ganha aviso nenhum", () => {
    const view = selectSynopsis(
      [...soIngles, row("pt-BR", "Um boxeador decadente ganha uma ultima chance.")],
      "en",
    );
    expect(view?.source).toBe("published_locale");
    // O braco publicado nao tem `notice` — o TIPO garante isso; aqui provamos
    // que o caminho escolhido foi mesmo esse.
    expect(view && "notice" in view).toBe(false);
  });
});

describe("o aviso nunca e vazio, nem para idioma desconhecido", () => {
  it("idioma reconhecido nomeia o idioma", () => {
    expect(originalLanguageNotice("ja-JP")).toContain("Japonês");
    expect(originalLanguageNotice("fr")).toContain("Francês");
  });

  it("idioma FORA da tabela ainda avisa — frase generica, nunca silencio", () => {
    const aviso = originalLanguageNotice("zz-ZZ");
    expect(aviso.length).toBeGreaterThan(0);
    expect(aviso).toContain("idioma original");
  });

  it("BCP-47 e reduzido a subtag primaria antes de consultar a tabela", () => {
    expect(primarySubtag("en-US")).toBe("en");
    expect(primarySubtag("PT_br")).toBe("pt");
  });
});

describe("determinismo e ausencia", () => {
  it("sem texto em locale nenhum, retorna null (pagina omite a secao)", () => {
    expect(selectSynopsis([], "en")).toBeNull();
    expect(selectSynopsis([row("pt-BR", null), row("en-US", "   ")], "en")).toBeNull();
  });

  it("linha do locale publicado SEM texto nao bloqueia o fallback", () => {
    // A linha pt-BR existe (titulo traduzido) mas nao tem sinopse. Antes, o
    // `findFirst` por pt-BR devolvia essa linha e a pagina ficava sem sinopse.
    const view = selectSynopsis(
      [row("pt-BR", null), row("en-US", "Original text.")],
      "en",
    );
    expect(view?.source).toBe("original_language");
  });

  it("entre varios idiomas estrangeiros, prefere o ORIGINAL da obra", () => {
    const rows = [
      row("fr-FR", "Texte francais."),
      row("en-US", "English text."),
      row("ja-JP", "Texto japones."),
    ];
    const view = selectSynopsis(rows, "ja");
    expect(view?.languageCode).toBe("ja-JP");
  });

  it("sem idioma original informado, a escolha e TOTAL e estavel", () => {
    const rows = [row("fr-FR", "Texte."), row("en-US", "Text."), row("de-DE", "Text.")];
    const primeira = selectSynopsis(rows, null)?.languageCode;
    const segunda = selectSynopsis([...rows].reverse(), null)?.languageCode;
    expect(primeira).toBe(segunda);
    expect(primeira).toBe("de-DE");
  });

  it("meta_description vence summary dentro da MESMA linha", () => {
    const view = selectSynopsis([row("pt-BR", "do summary", "do meta")], "en");
    expect(view?.text).toBe("do meta");
  });
});
