/**
 * group-label-redundancy.test.tsx — UMA regra para o rótulo de grupo repetido,
 * cobrindo o rodapé E as seções (mesmo defeito, mesmo conserto).
 *
 * O defeito, nas duas encarnações que o dono riscou:
 *  - rodapé: o título de coluna existia DUAS vezes no DOM — `aria-label` no
 *    `<nav>` + `<p>` visível com o mesmo texto. Invisível no render normal;
 *    "Filmes" em cima de "Filmes" em toda vista derivada da árvore de
 *    acessibilidade (reader mode, inspeção, tradução). Causa:
 *    `site-footer.tsx` (o par aria-label/título).
 *  - seções de detalhe: sobrancelha "— ELENCO" acima de "ELENCO PRINCIPAL" —
 *    coberta pela MESMA regra (`isRedundantGroupLabel`) nas suítes das seções.
 *
 * Caso a caso não serve: a regra é genérica de propósito, senão o defeito some
 * daqui e volta na próxima coluna/seção que alguém criar.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SectionHead } from "../section-head";
import { SiteFooter } from "../site-footer";
import { FOOTER_COLUMNS } from "../../../src/config/footer";
import {
  isRedundantGroupLabel,
  normalizeGroupLabel,
} from "../../../src/lib/group-label-rule";

/** O que a PESSOA lê: tags fora, entidades resolvidas, espaço colapsado. */
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

/** Os blocos `<nav class="footer__column">`, cada um com seu markup inteiro. */
function footerColumnBlocks(markup: string): string[] {
  return markup
    .split(/<nav\b/)
    .slice(1)
    .map((chunk) => `<nav${chunk.split("</nav>")[0] ?? ""}</nav>`)
    .filter((block) => block.includes('class="footer__column"'));
}

/** Quantas vezes `needle` aparece como texto VISÍVEL dentro de `markup`. */
function visibleOccurrences(markup: string, needle: string): number {
  const text = ` ${visibleText(markup)} `;
  const target = ` ${needle} `;
  let count = 0;
  let index = text.indexOf(target);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(target, index + 1);
  }
  return count;
}

describe("a regra: rótulo de grupo igual/prefixo do que o segue é redundante", () => {
  it("reprova igualdade — com ou sem caixa, acento e traço decorativo", () => {
    expect(isRedundantGroupLabel("Filmes", "Filmes")).toBe(true);
    expect(isRedundantGroupLabel("— ELENCO", "Elenco")).toBe(true);
    expect(isRedundantGroupLabel("Séries e TV", "Series e TV")).toBe(true);
  });

  it("reprova prefixo por palavra inteira (a sobrancelha que 'abrevia' o título)", () => {
    expect(isRedundantGroupLabel("Elenco", "ELENCO PRINCIPAL")).toBe(true);
    expect(isRedundantGroupLabel("— DETALHES", "Detalhes do título")).toBe(true);
  });

  it("aprova rótulo que INFORMA algo que o título não diz", () => {
    expect(isRedundantGroupLabel("Editorial", "Notícias e bastidores")).toBe(false);
    expect(isRedundantGroupLabel("Descoberta", "Mais como este")).toBe(false);
    expect(isRedundantGroupLabel("Filmes", "Todos os filmes")).toBe(false);
    // Prefixo de SUBSTRING não conta: "not" não abrevia "notícias".
    expect(isRedundantGroupLabel("Not", "Notícias")).toBe(false);
  });

  it("normaliza sem literal combinante cru (escape unicode)", () => {
    expect(normalizeGroupLabel("— SÉRIES  e   TV")).toBe("series e tv");
  });
});

describe("rodapé: o título de cada coluna existe UMA vez, e o grupo não o repete", () => {
  const markup = renderToStaticMarkup(<SiteFooter />);
  const blocks = footerColumnBlocks(markup);

  it("há um bloco de coluna por entrada da config", () => {
    expect(blocks).toHaveLength(FOOTER_COLUMNS.length);
  });

  it("nenhum <nav> de coluna carrega aria-label (a string viveria duas vezes)", () => {
    for (const block of blocks) {
      expect(block, block.slice(0, 120)).not.toMatch(/<nav[^>]*\saria-label=/);
      // O nome acessível vem do TÍTULO VISÍVEL, por referência — uma fonte só.
      expect(block, block.slice(0, 120)).toMatch(/<nav[^>]*\saria-labelledby="footer-column-/);
    }
  });

  it("no texto visível de cada coluna, o título aparece exatamente uma vez", () => {
    for (const [index, block] of blocks.entries()) {
      const title = FOOTER_COLUMNS[index]!.title;
      expect(visibleOccurrences(block, title), `coluna "${title}"`).toBe(1);
    }
  });

  it("REGRA GENÉRICA sobre o dado: nenhum título de coluna é redundante com item do grupo", () => {
    for (const column of FOOTER_COLUMNS) {
      for (const link of column.links) {
        expect(
          isRedundantGroupLabel(column.title, link.label),
          `coluna "${column.title}" x item "${link.label}"`,
        ).toBe(false);
        // A outra direção também: um item com o MESMO rótulo do cabeçalho é o
        // "Filmes em cima de Filmes" clássico.
        expect(
          normalizeGroupLabel(link.label) === normalizeGroupLabel(column.title),
          `item "${link.label}" repete o cabeçalho "${column.title}"`,
        ).toBe(false);
      }
    }
  });

  it("REGRA NA ORIGEM: SectionHead derruba a sobrancelha redundante — renderizado, não fonte", () => {
    // O caso que o dono riscou: "— ELENCO" acima de "ELENCO PRINCIPAL". O
    // componente É quem emite a sobrancelha, e ele não aceita valor
    // redundante: o kicker some, e o traço decorativo sai junto (nenhum
    // hífen órfão).
    const redundante = renderToStaticMarkup(
      <SectionHead headingId="t1" kicker="Elenco" thin="principal" title="Elenco" />,
    );
    expect(redundante).not.toContain("eyebrow-bar");
    expect(visibleText(redundante)).toBe("Elenco principal");

    // "— DETALHES" acima de "Detalhes do título": prefixo — também cai.
    const prefixo = renderToStaticMarkup(
      <SectionHead headingId="t2" kicker="— DETALHES" thin="do título" title="Detalhes" />,
    );
    expect(prefixo).not.toContain("eyebrow-bar");

    // Sobrancelha que INFORMA fica: "Editorial" diz o que o título não diz.
    const informativa = renderToStaticMarkup(
      <SectionHead headingId="t3" kicker="Editorial" thin="e bastidores" title="Notícias" />,
    );
    expect(informativa).toContain("eyebrow-bar");
    expect(visibleText(informativa)).toContain("Editorial");
  });

  it("nenhuma página monta sobrancelha + título À MÃO (o par passa por SectionHead)", async () => {
    // A regra vive no componente; um par montado inline nas páginas a
    // contornaria — e o defeito voltaria "na próxima seção que alguém criar".
    // Sobrancelha SOZINHA (A obra, Ficha técnica, Detalhes) continua livre:
    // ali o kicker é o próprio título da seção, sem h2 a repetir.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pages = [
      path.resolve(here, "../../pt/filmes/[slug]/page.tsx"),
      path.resolve(here, "../../pt/series/[slug]/page.tsx"),
    ];
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      expect(
        /eyebrow-bar[\s\S]{0,240}detail-section-title/.test(source),
        `${path.basename(path.dirname(page))}: par sobrancelha+título montado à mão — use SectionHead`,
      ).toBe(false);
    }
  });

  it("CONTROLE POSITIVO: a medição pega o defeito reintroduzido", () => {
    // O markup exato que existia antes do conserto: aria-label + título visível.
    const regressed =
      '<nav aria-label="Filmes" class="footer__column"><p class="footer__column-title">Filmes</p>' +
      '<ul><li><a href="/pt/filmes/">Todos os filmes</a></li></ul></nav>';
    expect(regressed).toMatch(/<nav[^>]*\saria-label=/);
    // E um grupo com o cabeçalho repetido como primeiro item reprova na regra.
    const duplicated =
      '<nav class="footer__column"><p>Filmes</p><ul><li><a href="/pt/filmes/">Filmes</a></li></ul></nav>';
    expect(visibleOccurrences(duplicated, "Filmes")).toBe(2);
  });
});
