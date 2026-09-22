/**
 * Barra final: a regra que decide QUEM redireciona.
 *
 * O ponto de atencao nao e o caso feliz — e o `false`. Onde esta funcao devolve
 * `false`, o middleware sai do caminho e o Next faz o que sempre fez. Se ela
 * devolvesse `true` para `/robots.txt`, `/sitemap.xml` ou `/news-sitemap.xml`,
 * os tres arquivos mais importantes que este site serve passariam a responder
 * 308 para uma URL com barra que nao existe.
 */

import path from "node:path";

import { describe, expect, it } from "vitest";

import { needsTrailingSlash } from "../../apps/web/src/lib/trailing-slash";
import { REPO_ROOT, readSourceWithoutComments } from "../support/source-text";

describe("barra final — o middleware assume o redirect", () => {
  it("acrescenta barra em rota de pagina", () => {
    for (const pathname of [
      "/pt",
      "/pt/filmes",
      "/pt/series/breaking-bad",
      "/pt/pessoas/bryan-cranston",
      "/pt/series/breaking-bad/temporadas/1/episodios/1",
      "/pt/noticias/alguma-materia",
    ]) {
      expect(needsTrailingSlash(pathname), pathname).toBe(true);
    }
  });

  it("NAO toca em arquivo servido na raiz", () => {
    for (const pathname of [
      "/robots.txt",
      "/sitemap.xml",
      "/news-sitemap.xml",
      "/favicon.ico",
      "/sitemaps/sitemap-pt-BR-movies-1.xml",
      "/brand/cinerie.png",
    ]) {
      expect(needsTrailingSlash(pathname), pathname).toBe(false);
    }
  });

  it("NAO toca no que ja esta normalizado nem no que o Next normaliza de outro jeito", () => {
    for (const pathname of [
      "/",
      "/pt/",
      "/pt/filmes/",
      // Barra dupla e outra normalizacao; acrescentar barra aqui so criaria um
      // salto a mais antes da do Next.
      "//pt/filmes",
      "/pt//filmes",
      // Caminho relativo nunca chega do roteador; fail-closed mesmo assim.
      "pt/filmes",
    ]) {
      expect(needsTrailingSlash(pathname), pathname).toBe(false);
    }
  });

  it("o middleware liga a regra, e no lugar certo da ordem", () => {
    // SEM comentarios: este arquivo EXPLICA o `nextUrl.clone()` que nao deve
    // usar, e um guard ingenuo casaria com a explicacao.
    // O removedor troca o comentario por ESPACOS (ele preserva as posicoes),
    // entao o espaco em branco e colapsado antes de casar.
    const source = readSourceWithoutComments(
      path.join(REPO_ROOT, "apps", "web", "middleware.ts"),
    ).replace(/\s+/g, " ");
    // O redirect tem de sair por `withSecurityHeaders` — e o motivo de ele ter
    // mudado de lugar — e montar o destino com `URL` padrao, nunca com
    // `nextUrl.clone()`, que devolve a barra e fecha o laço.
    expect(source).toMatch(
      /if \(needsTrailingSlash\(.{0,40}?const url = new URL\(request\.url\);.{0,80}?withSecurityHeaders\(NextResponse\.redirect\(url, 308\)\)/,
    );
    // DEPOIS do redirect persistido: a consulta a tabela `redirects` continua
    // acontecendo sobre o caminho SEM barra, exatamente como antes.
    expect(source.indexOf("resolvePersistedRedirect(request)")).toBeLessThan(
      source.indexOf("needsTrailingSlash("),
    );
    // E ANTES do `next()`, senao nunca rodaria.
    expect(source.indexOf("needsTrailingSlash(")).toBeLessThan(
      source.indexOf("NextResponse.next()"),
    );
  });
});
