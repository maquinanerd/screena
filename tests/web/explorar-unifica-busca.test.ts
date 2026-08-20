/**
 * explorar-unifica-busca.test.ts — uma superfície só para navegar e buscar.
 *
 * O QUE FOI MEDIDO. `/pt/busca/` era um formulário nu: campo "Termo", botão
 * "Buscar", uma frase instrutiva e zero conteúdo — sempre `noindex`.
 * `/pt/explorar/` tinha Em Alta, Lançamentos, Mais aguardados, Populares e o
 * filtro Tudo/Filmes/Séries. Duas páginas finas na mesma intenção. Busca sem
 * termo É navegação.
 *
 * O QUE ESTE ARQUIVO GUARDA, NOS DOIS SENTIDOS:
 *  - o 301 existe e PRESERVA a query (link antigo compartilhado não quebra);
 *  - sem termo a rota é indexável; com termo é `noindex`. Provar só um lado
 *    deixaria passar exatamente o defeito oposto.
 *
 * A asserção de fonte roda sobre o arquivo SEM COMENTÁRIOS — neste repositório
 * uma guarda que varre texto já aprovou e reprovou pelo motivo errado por causa
 * de comentário.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPLORE_PATH } from "../../apps/web/src/lib/routes";
import { foldSearchTerm } from "../../apps/web/src/server/search-page";

const ROOT = process.cwd();

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function withoutComments(text: string): string {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const nextConfig = withoutComments(source("apps/web/next.config.ts"));
const explorePage = withoutComments(source("apps/web/app/pt/explorar/page.tsx"));
const header = withoutComments(source("apps/web/app/_components/site-header.tsx"));

describe("a rota que sobrevive é /pt/explorar/", () => {
  it("a página fina saiu do app — não há mais duas rotas na mesma intenção", () => {
    expect(existsSync(path.join(ROOT, "apps/web/app/pt/busca/page.tsx"))).toBe(false);
  });

  it("o 301 existe para a forma COM e SEM barra final", () => {
    // `trailingSlash: true` normaliza, mas declarar as duas formas é o que
    // impede um 308 de normalização entrar na frente do 301.
    expect(nextConfig).toMatch(/source: '\/pt\/busca',[\s\S]{0,80}statusCode: 301/);
    expect(nextConfig).toMatch(/source: '\/pt\/busca\/',[\s\S]{0,80}statusCode: 301/);
  });

  it("o destino NÃO declara query — é isso que faz o Next preservar `?q=`", () => {
    // Um destino com `?` próprio faria o Next DESCARTAR a query de origem, e o
    // link antigo `/pt/busca/?q=duna` chegaria em Explorar sem o termo.
    const destinos = [...nextConfig.matchAll(/destination: '([^']+)'/g)].map((m) => m[1]);
    expect(destinos.length).toBeGreaterThan(0);
    for (const destino of destinos) {
      expect(destino).toBe("/pt/explorar/");
      expect(destino).not.toContain("?");
    }
  });

  it("o ícone de busca do cabeçalho aponta para a rota sobrevivente", () => {
    expect(header).toContain("href={EXPLORE_PATH}");
    expect(header).not.toContain('href="/pt/busca/"');
  });

  it("o form de busca faz GET na própria rota", () => {
    expect(explorePage).toContain("action={EXPLORE_PATH}");
    expect(explorePage).toContain('method="get"');
    expect(explorePage).toContain('name="q"');
    expect(EXPLORE_PATH).toBe("/pt/explorar/");
  });
});

describe("indexabilidade nos DOIS sentidos", () => {
  it("COM termo: `noindex`, e antes de qualquer outra checagem", () => {
    // O ramo do termo tem de RETORNAR antes do gate de conteúdo. Se ele viesse
    // depois, uma página de resultado rica o bastante indexaria — e cada termo
    // digitado viraria uma URL no índice.
    const ramo = explorePage.slice(
      explorePage.indexOf("if (hasTerm) {"),
      explorePage.indexOf("const { indexability }"),
    );
    expect(ramo).toContain("robots: { index: false, follow: true }");
    expect(explorePage.indexOf("if (hasTerm) {")).toBeLessThan(
      explorePage.indexOf("const { indexability }"),
    );
  });

  it("COM termo: o canonical continua apontando para a rota BASE, sem o termo", () => {
    const ramo = explorePage.slice(
      explorePage.indexOf("if (hasTerm) {"),
      explorePage.indexOf("const { indexability }"),
    );
    expect(ramo).toContain("canonical: canonicalPublicUrl(EXPLORE_PATH)");
    // O termo pode aparecer no `title` (e aparece); o que ele NAO pode fazer e
    // entrar na URL canonica — cada combinacao viraria uma canonica propria.
    expect(ramo).not.toMatch(/canonical:.*query/);
    expect(ramo).not.toMatch(/canonical:.*[?]q=/);
  });

  it("SEM termo: a decisão volta para o gate de conteúdo (pode indexar)", () => {
    expect(explorePage).toContain("robots: publicRobots(shouldIndex)");
  });
});

describe("o que conta como TERMO é a mesma dobra da busca", () => {
  it("espaço e acento sozinhos não ligam o estado de resultado", () => {
    // Se `hasTerm` usasse `query !== ''`, um `?q=%20` viraria página de
    // resultado vazia — e `noindex` — sem que ninguém tivesse buscado nada.
    expect(foldSearchTerm("   ")).toBe("");
    expect(foldSearchTerm("")).toBe("");
    expect(foldSearchTerm(" duna ")).not.toBe("");
  });

  it("a página usa `foldSearchTerm` em TODOS os pontos que decidem `hasTerm`", () => {
    // Contar importa. `hasTerm` é calculado DUAS vezes — em `generateMetadata`
    // e no componente — e as duas precisam concordar: se só uma dobrar o termo,
    // `?q=%20` vira `noindex` no metadata e navegação no corpo (ou o inverso).
    // Um `toContain` simples fica verde com metade do defeito no lugar.
    const comFold = explorePage.match(/foldSearchTerm\(query\) !== ''/g) ?? [];
    expect(comFold).toHaveLength(2);
    // E nenhuma comparação crua sobreviveu em nenhum dos dois pontos.
    expect(explorePage).not.toMatch(/hasTerm\s*=\s*query\s*!==/);
  });

  it("`?q=a&q=b` é resolvido de forma determinística, sem inventar termo", () => {
    // Concatenar produziria um termo que ninguém digitou.
    expect(explorePage).toContain("return raw[0] ?? ''");
  });
});
