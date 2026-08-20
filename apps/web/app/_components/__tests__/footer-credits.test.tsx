/**
 * footer-credits.test.tsx — "O CREDITO NAO SUMIU: ELE MUDOU DE ENDERECO."
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Ate 2026-08-12 o credito de fonte ficava colado ao dado: dentro do chip da
 * nota, sob o painel de streaming, na faixa da home. A PROXIMIDADE era a prova
 * de que a licenca (`requires_attribution = true`) estava cumprida, e os
 * presenters recusavam qualquer linha sem credito.
 *
 * Decisao do proprietario (Pablo Eduardo, 2026-08-13): todo credito de fonte sai
 * do corpo das paginas e passa a viver no RODAPE GLOBAL.
 *
 * Isso apaga a prova antiga. Este arquivo e a prova nova, e ela tem DUAS
 * metades — uma sozinha nao vale nada:
 *
 *   1. o rodape nomeia TODA fonte autorizada, com o texto verbatim da licenca;
 *   2. o rodape esta em TODA pagina que exibe dado licenciado.
 *
 * Se este arquivo for deletado, a licenca das fontes passa a ser cumprida por
 * coincidencia. Se ele for afrouxado ("basta o texto estar no HTML"), volta o
 * defeito da PR #165: quatro assercoes passavam pelo motivo errado porque
 * `markup.includes(...)` encontrava a frase dentro de um `aria-label`. Por isso
 * TUDO aqui e medido em TEXTO VISIVEL — tags fora, e o que sobra e o que a
 * pessoa le.
 *
 * MORA EM `apps/web/**` de proposito: `react` e dependencia de `@screena/web`, e
 * um teste .tsx em `tests/` nem carrega (`react/jsx-dev-runtime` nao resolve).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RATING_SOURCES } from "@screena/config";
import { STATIC_AUTHORIZATION } from "@screena/legal";

import { RatingsPanel } from "../ratings-panel";
import { SiteFooter } from "../site-footer";
import { WatchAvailabilityPanel } from "../watch-availability-panel";
import { DATA_CREDITS, TMDB_DISCLAIMER } from "../../../src/config/footer";
import { buildRatingsView } from "../../../src/lib/ratings-presenter";
import { buildWatchAvailabilityView } from "../../../src/lib/watch-availability-presenter";

/** `apps/web/app` — a raiz do App Router. */
const WEB_APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * O que a PESSOA le. Tags fora, entidades resolvidas, espaco colapsado.
 *
 * Medir markup cru e o erro que esta suite existe para nao repetir: um credito
 * dentro de `aria-label`/`title` satisfaz `markup.includes(...)` e NAO satisfaz
 * a licenca, que exige credito visivel.
 */
function visibleText(markup: string): string {
  return markup
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O DOCUMENTO como o navegador o recebe: conteudo da rota + chrome global.
 *
 * `SiteHeader` fica de fora de proposito — e `"use client"` e depende de
 * `usePathname`, e o que esta em julgamento aqui e o rodape. A presenca do
 * rodape em TODA rota e provada estruturalmente no ultimo bloco.
 */
function renderDocument(content: ReactNode): string {
  return renderToStaticMarkup(
    <>
      <div id="main-content">{content}</div>
      <SiteFooter />
    </>,
  );
}

const RATING_IMDB = {
  sourceKey: "imdb",
  sourceLabel: "IMDb",
  scoreType: "audience",
  label: "IMDb Rating",
  value: 7.9,
  best: 10,
  count: 8114,
  updatedAt: "2026-08-10T00:00:00.000Z",
  attribution: { text: "Nota fornecida por IMDb", url: "https://www.imdb.com/title/tt1/" },
} as const;

const RATING_RT = {
  sourceKey: "rotten_tomatoes",
  sourceLabel: "Rotten Tomatoes",
  scoreType: "critics",
  label: "Tomatometer",
  value: 85,
  best: 100,
  count: null,
  updatedAt: "2026-08-10T00:00:00.000Z",
  attribution: { text: "Nota fornecida por Rotten Tomatoes", url: null },
} as const;

/** Oferta vinda do TMDB (revenda de JustWatch): destino e a pagina do pais. */
const OFERTA_JUSTWATCH = {
  providerKey: "fictiflix",
  providerName: "Fictiflix",
  providerSlug: "fictiflix",
  offerType: "subscription",
  deepLink: null,
  webUrl: "https://exemplo.test/br/fictiflix",
  quality: null,
  priceAmount: null,
  currency: null,
  displayAllowed: true,
  fetchedAtIso: "2026-08-10T00:00:00.000Z",
  requiresAttribution: true,
  requiresLinkback: true,
  attributionText: "Disponibilidade fornecida por JustWatch",
  attributionUrl: "https://www.justwatch.com/",
} as const;

describe("METADE 1 — o rodape nomeia TODA fonte autorizada", () => {
  it("CONTROLE POSITIVO: o rodape renderiza e tem conteudo", () => {
    // Sem isto, todo negativo abaixo passaria pelo motivo errado: um rodape que
    // nao renderiza produz string vazia, e "nao contem X" fica trivialmente
    // verdadeiro. Foi assim que a primeira versao de
    // `credit-required-on-display.test.ts` nasceu verde e sem valor.
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    expect(texto.length).toBeGreaterThan(120);
    expect(texto).toContain("Cinerie");
  });

  it("todo credito de `services/legal` aparece no TEXTO VISIVEL do rodape", () => {
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    expect(DATA_CREDITS.length).toBeGreaterThan(0);
    for (const credit of DATA_CREDITS) {
      expect(texto).toContain(credit.text);
    }
  });

  it("A PONTE: fonte que PODE aparecer e creditada; fonte revogada NAO e", () => {
    // Esta e a garantia ESTRUTURAL que substitui a proximidade, e ela e de DOIS
    // lados de proposito. Um teste que so verificasse o lado positivo pararia de
    // vigiar uma fonte no instante em que alguem a revogasse — que e justamente
    // quando vale a pena olhar. Nenhum nome de fonte e citado aqui: o vinculo e
    // `RATING_SOURCES` -> licenca no registro legal -> texto no rodape.
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    let creditadas = 0;
    let revogadas = 0;

    for (const source of RATING_SOURCES) {
      const licenca = STATIC_AUTHORIZATION.find(
        (entry) => entry.license.ratingSourceKey === source,
      );
      // Toda fonte do vocabulario precisa de licenca DECLARADA — inclusive as
      // revogadas. Uma fonte sem entrada no spec deixaria uma licenca orfa e
      // vigente no banco, porque `planAuthorization` so visita o que esta la.
      expect(licenca, `sem licenca declarada para a fonte "${source}"`).toBeDefined();

      if (licenca!.license.displayAllowed) {
        creditadas += 1;
        expect(
          texto,
          `o rodape nao credita "${source}" (esperado: "${licenca!.license.attributionText}")`,
        ).toContain(licenca!.license.attributionText);
      } else {
        revogadas += 1;
        expect(
          texto,
          `o rodape credita "${source}", que NAO esta autorizada a aparecer`,
        ).not.toContain(licenca!.license.attributionText);
      }
    }

    // Anti-vacuidade nos dois sentidos: sem isto, um bug que zerasse
    // `displayAllowed` em todas as fontes passaria por este teste sem verificar
    // um unico credito positivo.
    expect(creditadas).toBeGreaterThan(0);
    expect(revogadas).toBeGreaterThan(0);
  });

  it("as DUAS origens de oferta sao creditadas (Movie of the Night e JustWatch)", () => {
    // O JustWatch nao esta em `STATIC_AUTHORIZATION` — as licencas de streaming
    // nascem por provedor canonico, dinamicamente. Sem `STREAMING_ORIGIN_CREDITS`
    // ele nao apareceria enquanto nenhum provedor estivesse registrado, e os
    // termos do TMDB exigem o credito nominalmente.
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    expect(texto).toContain("Disponibilidade fornecida por Movie of the Night");
    expect(texto).toContain("Disponibilidade fornecida por JustWatch");
  });

  it("o disclaimer de nao-endosso do TMDB sai LITERAL, sem parafrase", () => {
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    expect(TMDB_DISCLAIMER).toBe(
      "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB.",
    );
    expect(texto).toContain(TMDB_DISCLAIMER);
  });

  /**
   * Ate 20/08/2026 este teste dizia "nenhum <img>/<svg> no bloco de creditos",
   * justificado por "`logoAllowed` e o literal `false` no TIPO". Deixou de ser
   * verdade: os termos da API do TMDB EXIGEM o logo deles.
   *
   * A asserçao NAO virou "pode ter imagem". Ela virou uma regra de PROCEDENCIA:
   * toda imagem dentro do bloco tem de ser um logo que a LICENÇA autorizou, e o
   * `data-credit-logo` diz de qual credito ela e. Uma marca decorativa "so para
   * ficar como o desenho" continua reprovando, porque nao teria o atributo.
   *
   * `<svg>` continua proibido sem excecao: SVG inline no componente e marca de
   * terceiro DESENHADA por nos — exatamente o que a licenca nao permite, mesmo
   * quando ela exige o logo. O arquivo oficial entra por `src`, nunca por path.
   */
  it("imagem no bloco de creditos SO como logo autorizado pela licenca", () => {
    const markup = renderToStaticMarkup(<SiteFooter />);
    const abre = markup.indexOf('class="footer__credits"');
    expect(abre).toBeGreaterThan(-1);
    const bloco = markup.slice(abre, markup.indexOf('class="footer__base"'));

    // Nenhum SVG desenhado a mao, nunca.
    expect(bloco).not.toContain("<svg");

    // Toda <img> presente tem de se declarar logo de um credito conhecido.
    const imgs = bloco.match(/<img[^>]*>/g) ?? [];
    for (const img of imgs) {
      const chave = /data-credit-logo="([^"]+)"/.exec(img)?.[1];
      expect(chave, `<img> sem data-credit-logo no bloco de creditos: ${img}`).toBeDefined();
      const credito = DATA_CREDITS.find((c) => c.creditKey === chave);
      expect(credito, `data-credit-logo desconhecido: ${chave}`).toBeDefined();
      expect(credito!.logo, `credito ${chave} nao tem logo autorizado`).not.toBeNull();
    }

    // CONTROLE POSITIVO da varredura: se o bloco fosse recortado errado, o loop
    // acima passaria com zero imagens e zero informacao. O bloco tem de conter
    // os creditos de verdade.
    expect(bloco).toContain("footer__credit-text");
  });

  it("o TEXTO do credito nao depende do logo: toda fonte creditada tem texto visivel", () => {
    // A regra que o logo nunca pode quebrar. Os termos do TMDB pedem os DOIS
    // (marca E disclaimer); um credito que virasse so imagem sumiria para
    // leitor de tela e para quem bloqueia imagem.
    const texto = visibleText(renderToStaticMarkup(<SiteFooter />));
    for (const credit of DATA_CREDITS) {
      expect(texto, `credito sem texto visivel: ${credit.creditKey}`).toContain(credit.text);
    }
  });

  it("o credito NAO vive so em atributo (o defeito da #165)", () => {
    const markup = renderToStaticMarkup(<SiteFooter />);
    for (const credit of DATA_CREDITS) {
      expect(markup).not.toContain(`aria-label="${credit.text}"`);
      expect(markup).not.toContain(`title="${credit.text}"`);
    }
  });
});

describe("METADE 2 — a pagina que exibe o dado contem o credito", () => {
  it("pagina com NOTA do IMDb contem o credito do IMDb", () => {
    const view = buildRatingsView({ ratings: [RATING_IMDB] } as never);
    expect(view).not.toBeNull(); // controle positivo: a nota realmente foi ao ar
    const texto = visibleText(renderDocument(<RatingsPanel view={view} />));

    expect(texto).toContain("7,9"); // o dado esta na pagina...
    expect(texto).toContain("Nota fornecida por IMDb"); // ...e o credito tambem
  });

  it("pagina com nota do Rotten Tomatoes contem o credito do Rotten Tomatoes", () => {
    const view = buildRatingsView({ ratings: [RATING_RT] } as never);
    expect(view).not.toBeNull();
    const texto = visibleText(renderDocument(<RatingsPanel view={view} />));

    expect(texto).toContain("85");
    expect(texto).toContain("Nota fornecida por Rotten Tomatoes");
  });

  it("pagina com OFERTA de streaming contem o credito da origem", () => {
    const view = buildWatchAvailabilityView([OFERTA_JUSTWATCH] as never);
    expect(view).not.toBeNull();
    const texto = visibleText(renderDocument(<WatchAvailabilityPanel view={view} />));

    expect(texto).toContain("Fictiflix");
    expect(texto).toContain("Disponibilidade fornecida por JustWatch");
  });

  it("O CREDITO MUDOU DE LUGAR, NAO FOI DUPLICADO: o chip da nota nao o repete", () => {
    const view = buildRatingsView({ ratings: [RATING_IMDB] } as never);
    const chips = renderToStaticMarkup(<RatingsPanel view={view} />);

    expect(visibleText(chips)).toContain("7,9"); // a nota esta la
    expect(visibleText(chips)).not.toContain("Nota fornecida por IMDb"); // o credito nao
  });

  it("O CREDITO MUDOU DE LUGAR: o painel de streaming nao o repete", () => {
    const view = buildWatchAvailabilityView([OFERTA_JUSTWATCH] as never);
    const painel = renderToStaticMarkup(<WatchAvailabilityPanel view={view} />);

    expect(visibleText(painel)).toContain("Fictiflix");
    expect(visibleText(painel)).not.toContain("Disponibilidade fornecida por JustWatch");
  });

  it("CONTROLE NEGATIVO: sem o rodape, o documento perde o credito e o teste acusa", () => {
    // Este e o controle negativo REAL exigido pelo enunciado, expresso como
    // codigo: um documento montado SEM o rodape exibe a nota e nao credita
    // ninguem. E o estado exato que a metade 2 existe para impedir.
    const view = buildRatingsView({ ratings: [RATING_IMDB] } as never);
    const semRodape = visibleText(
      renderToStaticMarkup(
        <div id="main-content">
          <RatingsPanel view={view} />
        </div>,
      ),
    );

    expect(semRodape).toContain("7,9");
    expect(semRodape).not.toContain("Nota fornecida por IMDb");
  });
});

describe("METADE 2 (estrutural) — o rodape esta em TODA rota", () => {
  /** Todos os `layout.tsx` sob `apps/web/app`. */
  function layoutFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) {
        layoutFiles(abs, out);
      } else if (/^layout\.[jt]sx?$/.test(entry)) {
        out.push(abs);
      }
    }
    return out;
  }

  it("existe UM unico layout RAIZ e ele monta o SiteFooter", () => {
    const layouts = layoutFiles(WEB_APP_DIR);
    // Mais de um layout nao e proibido em si — layouts aninhados herdam o raiz.
    // O que seria fatal e um SEGUNDO layout RAIZ (route group com <html>), que
    // substituiria o chrome inteiro. Por isso a checagem e por `<html`.
    const raizes = layouts.filter((file) => readFileSync(file, "utf8").includes("<html"));
    expect(raizes).toHaveLength(1);

    const raiz = readFileSync(raizes[0]!, "utf8");
    expect(raiz).toContain("<SiteFooter />");
  });

  it("nenhuma pagina desliga o chrome global", () => {
    // Uma pagina nao consegue remover o layout raiz no App Router. O que ela
    // PODERIA fazer e reimplementar `<html>`/`<body>` por conta propria; isso
    // sim escaparia do rodape.
    const paginas: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const abs = path.join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs);
        else if (/^page\.[jt]sx?$/.test(entry)) paginas.push(abs);
      }
    };
    walk(WEB_APP_DIR);

    expect(paginas.length).toBeGreaterThan(20); // controle positivo da varredura
    for (const pagina of paginas) {
      const src = readFileSync(pagina, "utf8");
      expect(src, `${pagina} monta <html> proprio e escaparia do rodape`).not.toContain(
        "<html",
      );
    }
  });
});
