/**
 * not-found-page.test.tsx — o 404 fala a lingua do site.
 *
 * O DEFEITO (auditoria de SEO, 11/09/2026): a ficha inexistente respondia sem H1,
 * e o 404 generico trazia o texto padrao do Next, em ingles.
 *
 * O que se mede e a MARCACAO renderizada: um H1 em portugues, nenhum resto do
 * texto padrao e um caminho de volta para o site. O status 404 e o `noindex` sao
 * do Next e ficam para a auditoria por fora (`seo:audit`), que le a resposta real.
 */

import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotFound from "../../not-found";
import { REPO_ROOT, readSourceWithoutComments } from "../../../../../tests/support/source-text";

describe("404 em pt-BR", () => {
  const html = renderToStaticMarkup(<NotFound />);

  it("(1) exatamente um H1, em portugues", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("<h1>Página não encontrada</h1>");
  });

  it("(2) nenhum resto do texto padrao do Next, em ingles", () => {
    expect(html).not.toMatch(/could not be found|This page/i);
  });

  it("(3) um caminho de volta para o site", () => {
    expect(html).toContain('href="/pt/"');
    expect(html).toContain('href="/pt/filmes/"');
  });

  it("(4) nao declara canonical nem robots proprios: o status 404 decide", () => {
    const fonte = readSourceWithoutComments(path.join(REPO_ROOT, "apps", "web", "app", "not-found.tsx"));
    expect(fonte).not.toMatch(/canonical|robots|generateMetadata|export const metadata/);
  });
});
