/**
 * footer-source-logo.test.tsx — A marca grafica de uma fonte, nos DOIS sentidos.
 *
 * ============================================================================
 * O QUE MUDOU, E POR QUE UM ARQUIVO NOVO
 * ============================================================================
 * Ate 20/08/2026 o repositorio tratava logo de fonte como uma politica unica:
 * `logoAllowed` era o literal `false` no TIPO de `LicenseTarget`, e o rodape
 * creditava so em texto. A leitura dos termos, fonte por fonte, mostrou que a
 * politica estava certa para cinco e ERRADA para uma:
 *
 *   "You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or
 *    TMDB Content."  — Termos de uso da API do TMDB, secao 3 (Attribution)
 *
 * Ou seja: o `false` global nao era zelo, era descumprimento de uma fonte.
 *
 * `footer-credits.test.tsx` prova o estado de HOJE (nenhum arquivo oficial no
 * repositorio, portanto nenhum logo no ar). Ele nao consegue provar a outra
 * direçao, porque le `DATA_CREDITS` real. Este arquivo existe para isso: com o
 * modulo de configuraçao substituido, ele exercita o COMPONENTE DE VERDADE nos
 * dois estados — logo presente e logo ausente — na mesma renderizacao.
 *
 * A regra que nenhum dos dois estados pode quebrar: **o credito textual fica**.
 * Logo nunca substitui atribuicao; os termos pedem os dois.
 */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/config/footer", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/config/footer")>();
  return {
    ...real,
    // Tres creditos, cobrindo os TRES estados possiveis de marca:
    //  1. autorizada e com arquivo presente  -> logo no ar
    //  2. autorizada e sem arquivo (pendente) -> so texto, ausencia LOGADA
    //  3. nao autorizada                      -> so texto, nada devido
    DATA_CREDITS: [
      {
        creditKey: "com-logo",
        text: "Fonte De Marca Presente",
        roleLabel: "Catálogo",
        role: "catalog-provider" as const,
        logo: { src: "/brand/sources/fixture.svg", alt: "Fonte De Marca Presente", heightPx: 18 },
        logoPending: false,
      },
      {
        creditKey: "logo-pendente",
        text: "Fonte De Marca Pendente",
        roleLabel: "Catálogo",
        role: "catalog-provider" as const,
        logo: null,
        logoPending: true,
      },
      {
        creditKey: "sem-logo",
        text: "Fonte De Texto Puro",
        roleLabel: "Notas",
        role: "editorial-rating-source" as const,
        logo: null,
        logoPending: false,
      },
    ],
  };
});

const { SiteFooter } = await import("../site-footer");

function creditsBlock(markup: string): string {
  const abre = markup.indexOf('class="footer__credits"');
  expect(abre, "bloco de creditos nao encontrado").toBeGreaterThan(-1);
  return markup.slice(abre, markup.indexOf('class="footer__base"'));
}

describe("logo de fonte no rodape — os dois sentidos", () => {
  it("POSITIVO: a fonte com licenca E arquivo presente EXIBE a marca", () => {
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    expect(bloco).toContain('data-credit-logo="com-logo"');
    expect(bloco).toContain('src="/brand/sources/fixture.svg"');
  });

  it("NEGATIVO: a fonte SEM licenca de marca nao exibe nada", () => {
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    expect(bloco).not.toContain('data-credit-logo="sem-logo"');
  });

  it("NEGATIVO: licenca sem o arquivo oficial tambem nao exibe — nao se desenha aproximacao", () => {
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    expect(bloco).not.toContain('data-credit-logo="logo-pendente"');
  });

  it("exatamente UMA marca no ar — a que tem as duas condicoes", () => {
    // Contagem, nao presenca: `not.toContain` sozinho passaria se o componente
    // desenhasse o logo certo E um extra sem atributo.
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    expect((bloco.match(/<img/g) ?? []).length).toBe(1);
  });
});

describe("o crédito TEXTUAL nunca depende da marca", () => {
  /**
   * ESTRUTURAL, e a primeira versao deste teste prova por que.
   *
   * Ela media `visibleText(...).toContain("Fonte Com Logo")` para cada credito.
   * O controle negativo (fazer o logo SUBSTITUIR o texto) passou — porque
   * "Fonte Com Logo Pendente" contem "Fonte Com Logo" como substring: a
   * asserçao do credito COM logo era satisfeita pelo texto de OUTRO credito.
   * Verde pelo motivo errado, exatamente o defeito que este repositorio ja teve
   * cinco vezes.
   *
   * O conserto tem duas partes: textos de fixture que nao se contem, e uma
   * medida que conta os <span> de texto EM VEZ de procurar frases soltas no
   * documento inteiro.
   */
  it("cada credito tem seu proprio <span> de texto — um por fonte, com ou sem logo", () => {
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    const textos = [...bloco.matchAll(/<span class="footer__credit-text">([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    expect(textos).toEqual([
      "Fonte De Marca Presente",
      "Fonte De Marca Pendente",
      "Fonte De Texto Puro",
    ]);
  });

  it("a marca e decorativa no HTML: o nome acessivel vem do TEXTO, nao do alt", () => {
    // `alt=""` + `aria-hidden` de proposito: o nome ja esta escrito ao lado.
    // Um `alt="Fonte Com Logo"` faria o leitor de tela anunciar duas vezes.
    const bloco = creditsBlock(renderToStaticMarkup(<SiteFooter /> as ReactNode));
    const img = /<img[^>]*data-credit-logo="com-logo"[^>]*>/.exec(bloco)?.[0] ?? "";
    expect(img, "a <img> do controle positivo tem de existir").not.toBe("");
    expect(img).toContain('alt=""');
    expect(img).toContain('aria-hidden="true"');
  });
});

/**
 * O log da pendencia precisa de MODULO NOVO a cada asserçao, e o motivo e o
 * proprio contrato do `SectionBoundary`: em modo `once` ele guarda a causa ja
 * registrada num `Set` de escopo de modulo, para nao emitir uma linha por
 * pageview de uma causa que e propriedade do DEPLOY.
 *
 * Sem `resetModules`, as renderizacoes dos blocos acima ja teriam consumido o
 * `once` e este bloco mediria zero — passando a impressao de que a ausencia e
 * muda quando na verdade ela ja tinha falado. Foi exatamente o que aconteceu na
 * primeira versao deste arquivo.
 */
async function renderizarComModuloNovo(): Promise<string[]> {
  vi.resetModules();
  const avisos: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    avisos.push(args.map(String).join(" "));
  });
  const { SiteFooter: Fresh } = await import("../site-footer");
  renderToStaticMarkup(<Fresh /> as ReactNode);
  spy.mockRestore();
  return avisos;
}

describe("a pendencia de marca NAO e silenciosa", () => {
  it("licenca que exige logo sem arquivo emite section_absent acionavel", async () => {
    // A diferenca entre "nada e devido" e "ha obrigacao descumprida". Sem esta
    // linha, `logo_allowed=false` e `arquivo faltando` seriam o mesmo silencio.
    const avisos = await renderizarComModuloNovo();

    const eventos = avisos
      .map((linha) => {
        try {
          return JSON.parse(linha) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e !== null)
      .filter((e) => e["reason"] === "source_logo_asset_missing");

    expect(eventos.length, "a ausencia do arquivo oficial tem de ser logada").toBeGreaterThan(0);
    expect(eventos[0]!["section"]).toBe("creditos-de-dados");
    expect(eventos[0]!["surface"]).toBe("footer");
    expect(eventos[0]!["actionable"], "colocar um arquivo e acionavel").toBe(true);
  });

  it("NEGATIVO: a fonte sem licenca de marca NAO gera evento (nada e devido)", async () => {
    // Ruido de log afirmando obrigacao inexistente e tao ruim quanto silencio
    // sobre obrigacao real. So `logoPending` fala.
    const avisos = await renderizarComModuloNovo();

    const eventos = avisos.filter((l) => l.includes("source_logo_asset_missing"));
    // Um credito pendente na fixture => no maximo um evento (o `once` do
    // SectionBoundary deduplica por causa, nao por credito).
    expect(eventos.length).toBeLessThanOrEqual(1);
    expect(avisos.join(" ")).not.toContain("sem-logo");
  });
});
