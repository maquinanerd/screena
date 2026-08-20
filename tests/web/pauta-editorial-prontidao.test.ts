/**
 * pauta-editorial-prontidao.test.ts — Os dois blocos que esperam TEXTO, não código.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * "Guia por temporada" e "Notícias vinculadas" aparecem como pendências no mapa
 * de telas, e não são pendências de **engenharia**: zero críticas escritas, zero
 * artigos publicados. A ausência é de CONTEÚDO.
 *
 * O risco de registrar isso só em prosa é que ninguém sabe se o buraco é de
 * texto ou de fiação — e as duas coisas se parecem exatamente com nada na tela.
 * Este arquivo separa as duas: ele prova que a **fiação existe**, para que a
 * pendência que sobra seja, comprovadamente, só a editorial.
 *
 * O que ele NÃO faz: inventar conteúdo, gerar placeholder, ou afrouxar o gate
 * de revisão para "mostrar alguma coisa". Bloco vazio é honesto; bloco
 * preenchido com enchimento não é.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildSectionAbsence } from "../../apps/web/src/lib/section-absence";
import { NEWS_RENDERABLE_REVIEW_STATUSES } from "../../apps/web/src/lib/news-presenter";
import { RENDERABLE_REVIEW_STATUSES } from "../../apps/web/src/lib/movie-indexability";

const ROOT = process.cwd();

function semComentarios(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SERIE = semComentarios(
  readFileSync(path.join(ROOT, "apps/web/app/pt/series/[slug]/page.tsx"), "utf8"),
);
const FILME = semComentarios(
  readFileSync(path.join(ROOT, "apps/web/app/pt/filmes/[slug]/page.tsx"), "utf8"),
);

describe("GUIA POR TEMPORADA: a fiacao existe, o texto e que nao", () => {
  it("a serie renderiza `season_guide` e `episode_context` quando eles existirem", () => {
    expect(SERIE).toContain("'season_guide'");
    expect(SERIE).toContain("'episode_context'");
  });

  it("o guia de critica le `review_summary` e passa pelo SectionBoundary", () => {
    expect(SERIE).toContain("const REVIEW_BLOCK_TYPE = 'review_summary'");
    expect(SERIE).toMatch(/section: 'guia-critica'/);
    expect(SERIE).toMatch(/reason: 'no_editorial_review'/);
  });

  it("o motivo e um FATO sobre a obra, nao um passo de operacao pendente", () => {
    // `actionable: false` de proposito. Nenhum comando destrava isto — alguem
    // precisa ESCREVER a critica. Marca-lo como acionavel mandaria o operador
    // procurar uma configuracao que nao existe.
    const absence = buildSectionAbsence({
      section: "guia-critica",
      reason: "no_editorial_review",
      entityType: "tv",
      entityId: "1",
    });
    expect(absence.actionable).toBe(false);
  });

  it("o gate de revisao NAO foi afrouxado para mostrar rascunho", () => {
    // So `human_reviewed` e `published` chegam a tela. Um bloco `ai_generated`
    // visivel seria texto que nenhum humano leu, publicado como editorial.
    expect([...RENDERABLE_REVIEW_STATUSES]).toEqual(["human_reviewed", "published"]);
  });
});

describe("NOTICIAS VINCULADAS: a fiacao existe, o artigo e que nao", () => {
  it("as duas verticais montam a secao e registram a ausencia", () => {
    for (const [nome, code] of [["serie", SERIE], ["filme", FILME]] as const) {
      expect(code, nome).toMatch(/section: 'noticias'/);
    }
  });

  it("o gate de revisao de noticia tambem nao foi afrouxado", () => {
    expect([...NEWS_RENDERABLE_REVIEW_STATUSES]).toEqual(["human_reviewed", "published"]);
  });

  it("a ausencia de noticia e fato sobre a obra, nao pendencia de operacao", () => {
    // `no_linked_article`, e o nome importa: o que falta nao e "noticia
    // existir" — e o VINCULO. Um artigo publicado sem `entity_news_links`
    // aparece em /pt/noticias/ e some do detalhe do titulo.
    const absence = buildSectionAbsence({
      section: "noticias",
      reason: "no_linked_article",
      entityType: "movie",
      entityId: "1",
    });
    expect(absence.actionable).toBe(false);
  });
});

describe("NENHUM placeholder — a ausencia continua sendo ausencia", () => {
  it("NEGATIVO: as paginas nao carregam texto de enchimento para os dois blocos", () => {
    // O defeito que este arquivo existe para NAO introduzir: preencher o bloco
    // com "Em breve", "Nenhuma critica disponivel" ou lorem para a grade nao
    // colapsar. A secao sai do DOM; o log diz por que.
    for (const [nome, code] of [["serie", SERIE], ["filme", FILME]] as const) {
      for (const enchimento of ["Lorem", "lorem ipsum", "Nenhuma crítica", "Sem notícias ainda"]) {
        expect(code, `${nome} / ${enchimento}`).not.toContain(enchimento);
      }
    }
  });

  it("CONTROLE POSITIVO: as paginas de fato contem os blocos (a varredura nao e vacua)", () => {
    // Sem isto, um caminho de arquivo errado faria todos os `not.toContain`
    // acima passarem sobre uma string vazia.
    expect(SERIE.length).toBeGreaterThan(1000);
    expect(FILME.length).toBeGreaterThan(1000);
    expect(SERIE).toContain("SectionBoundary");
    expect(FILME).toContain("SectionBoundary");
  });
});
