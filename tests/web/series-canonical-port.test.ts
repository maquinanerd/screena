import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PAGE = readFileSync(path.join(ROOT, "apps/web/app/pt/series/[slug]/page.tsx"), "utf8");
const CSS = readFileSync(
  path.join(ROOT, "apps/web/app/pt/series/[slug]/series-canonical.module.css"),
  "utf8",
);

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf("//");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

describe("porte canônico 07/08 — detalhe de série", () => {
  it("usa CSS escopado e preserva a ordem estrutural desktop da tela 07", () => {
    expect(PAGE).toContain('import styles from "./series-canonical.module.css"');
    expect(PAGE).toContain('data-screen="series-detail"');

    const hero = PAGE.indexOf("className={styles.hero}");
    const media = PAGE.indexOf("className={`${styles.media}");
    const work = PAGE.indexOf("className={styles.work}");
    const critique = PAGE.indexOf("className={styles.critique}");
    const episodes = PAGE.indexOf("className={styles.episodes}");
    const cast = PAGE.indexOf("className={styles.cast}");
    const news = PAGE.indexOf("className={styles.news}");
    const details = PAGE.indexOf("className={styles.details}");

    expect([hero, media, work, critique, episodes, cast, news, details].every((at) => at > -1)).toBe(true);
    expect(hero).toBeLessThan(media);
    expect(media).toBeLessThan(work);
    expect(work).toBeLessThan(critique);
    expect(critique).toBeLessThan(episodes);
    expect(episodes).toBeLessThan(cast);
    expect(cast).toBeLessThan(news);
    expect(news).toBeLessThan(details);
  });

  it("omite cada bloco sem seu dado real e mantém o gate licenciado existente", () => {
    const code = withoutComments(PAGE);

    expect(code).toContain('const REVIEW_BLOCK_TYPE = "review_summary"');
    expect(code).toContain("const hasEditorial = editorialBlocks.length > 0");
    expect(code).toContain("critiqueBlock !== null ?");
    expect(code).toContain("const hasSeasons = view.seasons.length > 0");
    expect(code).toContain("const visibleCast = cast.slice(0, 6)");
    expect(code).toContain("visibleCast.length > 0 ?");
    expect(code).toContain("visibleNews.length > 0 ?");
    expect(code).toContain("watch !== null ?");
    expect(code).toContain("<WatchAvailabilityPanel view={watch} />");
  });

  it("não converte backdrop em trailer nem inventa rating, prêmio ou recomendação", () => {
    const code = withoutComments(PAGE);

    expect(code).not.toMatch(/Screen Score|IMDb|Rotten Tomatoes|TMDB/);
    expect(code).not.toMatch(/Assistir trailer|vídeos|fotos|vitórias|indicações/);
    expect(code).not.toMatch(/Mais como este/);
    expect(code).not.toMatch(/ic-play|rating|seasonInfo|moreLikeThis/);
  });

  it("copia as medidas essenciais do desktop canônico 07", () => {
    expect(CSS).toMatch(/max-width:\s*1360px/);
    expect(CSS).toMatch(/padding-right:\s*64px/);
    expect(CSS).toMatch(/padding-left:\s*64px/);
    expect(CSS).toMatch(/font-size:\s*38px/);
    expect(CSS).toMatch(/height:\s*472px/);
    expect(CSS).toMatch(/grid-template-columns:\s*1fr 3fr 2fr/);
    expect(CSS).toMatch(/grid-column:\s*2 \/ 4/);
    expect(CSS).toMatch(/width:\s*288px/);
    expect(CSS).toMatch(/grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)/);
  });

  it("aplica a linguagem mobile 08 sem overflow e mantém thumb 16:9 de 128px", () => {
    expect(CSS).toContain("@media (max-width: 767px)");
    expect(CSS).toMatch(/\.media\s*\{\s*order:\s*1;/);
    expect(CSS).toMatch(/\.hero\s*\{\s*order:\s*2;/);
    expect(CSS).toMatch(/\.backdropFrame\s*\{[\s\S]*?aspect-ratio:\s*16 \/ 10;/);
    expect(CSS).toMatch(/\.episodeMedia\s*\{[\s\S]*?width:\s*128px;[\s\S]*?flex-basis:\s*128px;/);
    expect(CSS).toContain("@media (max-width: 390px)");
    expect(CSS).toMatch(/padding-right:\s*16px/);
    expect(CSS).toMatch(/overflow-x:\s*auto/);
  });

  it("mantém exatamente um h1 e os sinais textuais/semânticos da vertical", () => {
    const code = withoutComments(PAGE);
    expect(code.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(code).toContain('data-vertical="series"');
    expect(code).toContain(">Série</span>");
    expect(code).toContain('"@type": "TVSeries"');
    expect(code).toContain('const SERIES_INDEX_PATH = "/pt/series/"');
  });
});
