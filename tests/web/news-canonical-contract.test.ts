import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("notícias canônicas", () => {
  const index = read("apps/web/app/pt/noticias/page.tsx");
  const indexCss = read("apps/web/app/pt/noticias/news-canonical.module.css");
  const article = read("apps/web/app/pt/noticias/[slug]/page.tsx");
  const articleCss = read(
    "apps/web/app/pt/noticias/[slug]/article-canonical.module.css",
  );

  it("modo Todas mantém os quatro slots reais da composição sem inventar rail", () => {
    expect(index.match(/<AdSlot/g)).toHaveLength(4);
    expect(index).not.toMatch(/Mais lidas|Screen Daily|Assinar grátis|trending/);
    expect(index).not.toMatch(/railPosts|newsTabs|newsIsCat/);
  });

  it("divide o feed sem repetir os cards do magazine", () => {
    expect(index).toContain("view.cards.slice(0, 3)");
    expect(index).toContain("view.cards.slice(3)");
  });

  it("preserva geometria editorial principal do HTML 03", () => {
    expect(indexCss).toContain("max-width: 1280px");
    expect(indexCss).toContain("grid-template-columns: minmax(0, 1fr) 290px");
    expect(indexCss).toContain("grid-template-columns: minmax(0, 1.02fr) minmax(0, 1.18fr)");
    expect(indexCss).toContain("grid-template-columns: 240px minmax(0, 1fr)");
    expect(indexCss).toContain("grid-template-columns: minmax(0, 1fr) 340px");
  });

  it("artigo tem um único anúncio no corpo e não fabrica figuras/tags/share", () => {
    expect(article.match(/<AdSlot/g)).toHaveLength(1);
    expect(article).not.toMatch(/Minha lista|Avaliar|Compartilhar|relatedArticles/);
    expect(article).not.toMatch(/Daredevil|Marvel|Collider/);
    expect(article).not.toContain("className={styles.heroImage}");
    expect(article).not.toContain("news-related-title");
  });

  it("não expõe links visuais duplicados sem nome acessível", () => {
    expect(index).not.toContain("tabIndex={-1}");
    expect(index).toContain('className={styles.feedCardLink} href={card.href}');
    expect(index).toContain('className={styles.magazineLeadLink}');
    expect(index).toContain("<article className={styles.magazineLead}");
  });

  it("preserva hero e coluna de leitura do HTML 05", () => {
    expect(articleCss).toContain("min-height: 560px");
    expect(articleCss).toContain("max-width: 880px");
    expect(articleCss).toContain("font-size: 52px");
    expect(articleCss).toContain("max-width: 720px");
    expect(articleCss).toContain("max-width: 680px");
    expect(articleCss).toContain("min-height: max(480px, 60vh)");
    expect(articleCss).toContain("font-size: 17px");
    expect(articleCss).toContain("line-height: 1.8");
  });
});
