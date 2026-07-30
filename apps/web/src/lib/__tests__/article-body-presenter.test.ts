/**
 * Corpo estruturado da materia: o que atravessa e o que NAO atravessa.
 *
 * A maior parte destes testes mede recusa, nao aceitacao. `body_blocks` e uma
 * coluna Json: o presenter le dado que o TypeScript nao valida em runtime, e o
 * bloco que chega torto tem de sumir — nunca ser renderizado pela metade, nunca
 * virar link para um destino que ninguem revisou.
 */

import { describe, expect, it } from "vitest";

import {
  buildArticleBodyBlocks,
  collectArticleBodyReferences,
  type ArticleBodyHydration,
} from "../article-body-presenter";
import type { NewsEntityCardInput } from "../news-presenter";

const MOVIE: NewsEntityCardInput = {
  entityType: "movie",
  id: "10",
  titleOriginal: "Superman",
  translationTitle: "Superman",
  summary: "Resumo do catalogo.",
  slug: "superman",
  posterPath: "/poster.jpg",
  year: 2025,
  seasonCount: null,
};

function hydration(overrides: Partial<ArticleBodyHydration> = {}): ArticleBodyHydration {
  return {
    entityCards: new Map([["movie:10", MOVIE]]),
    relatedArticles: new Map([["doc-9", { title: "Materia anterior", slug: "materia-anterior" }]]),
    ...overrides,
  };
}

describe("fallback: ausencia de blocos", () => {
  it("coluna nula, vazia ou nao-lista produz [] (a pagina cai no corpo textual)", () => {
    for (const raw of [null, undefined, [], {}, "texto", 42]) {
      expect(buildArticleBodyBlocks(raw), JSON.stringify(raw)).toEqual([]);
    }
  });

  it("lista so com blocos invalidos tambem produz [] — nao meio corpo", () => {
    const blocks = buildArticleBodyBlocks([
      null,
      { id: "sem-tipo" },
      { type: "paragraph", id: "vazio", text: "   " },
      { type: "tipoQueNaoExiste", id: "x", text: "ola" },
    ]);
    expect(blocks).toEqual([]);
  });
});

describe("blocos textuais", () => {
  it("paragrafo e citacao preservam texto, id e ordem", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "paragraph", id: "p1", text: "Primeiro." },
      { type: "quote", id: "q1", text: "Citado.", attribution: "James Gunn" },
      { type: "divider", id: "d1" },
    ]);
    expect(blocks.map((block) => [block.kind, block.id])).toEqual([
      ["paragraph", "p1"],
      ["quote", "q1"],
      ["divider", "d1"],
    ]);
    expect(blocks[1]).toMatchObject({ text: "Citado.", attribution: "James Gunn" });
  });

  it("heading fora do contrato cai para h2 em vez de perder o texto", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "heading", id: "h-a", level: 3, text: "Nivel tres" },
      { type: "heading", id: "h-b", level: 4, text: "Nivel quatro" },
      // `h1` pertence ao titulo da pagina; 1 e 9 nao existem no contrato.
      { type: "heading", id: "h-c", level: 1, text: "Nivel um" },
      { type: "heading", id: "h-d", level: 9, text: "Nivel nove" },
      { type: "heading", id: "h-e", text: "Sem nivel" },
    ]);
    expect(blocks.map((block) => (block.kind === "heading" ? block.level : null))).toEqual([
      3, 4, 2, 2, 2,
    ]);
  });

  it("bloco sem id ganha chave estavel pelo indice, nao e descartado", () => {
    const blocks = buildArticleBodyBlocks([{ type: "paragraph", text: "Sem id." }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.id).toBe("blk-0");
  });
});

describe("imagem: so caminho LOCAL", () => {
  it("aceita o publicPath que o worker grava", () => {
    const blocks = buildArticleBodyBlocks([
      {
        type: "image",
        id: "img1",
        publicPath: "/media/editorial/ab/abc.jpg",
        alt: "alt do bloco",
        caption: "legenda",
        credit: "Divulgacao",
        width: 800,
        height: 600,
      },
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "image",
      image: {
        src: "/media/editorial/ab/abc.jpg",
        alt: "alt do bloco",
        caption: "legenda",
        credit: "Divulgacao",
        width: 800,
        height: 600,
      },
    });
  });

  it("recusa URL absoluta, travessia e caminho fora dos prefixos locais", () => {
    // O worker grava caminho local por design; uma URL aqui significa que algo
    // contornou a projecao de midia.
    for (const path of [
      "https://cdn.terceiro.test/foto.jpg",
      "//cdn.terceiro.test/foto.jpg",
      "/media/../../etc/passwd.jpg",
      "/qualquer/foto.jpg",
      "/media/editorial/ab/abc.svg",
      "/media/editorial/ab/abc.jpg?x=1",
    ]) {
      const blocks = buildArticleBodyBlocks([
        { type: "image", id: "img1", publicPath: path, alt: "a" },
      ]);
      expect(blocks, path).toEqual([]);
    }
  });

  it("alt ausente vira string vazia (decorativa), nunca alt inventado", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "image", id: "img1", publicPath: "/media/editorial/ab/abc.jpg" },
    ]);
    expect(blocks[0]).toMatchObject({ image: { alt: "" } });
  });

  it("dimensao invalida vira null em vez de atributo quebrado", () => {
    const blocks = buildArticleBodyBlocks([
      {
        type: "image",
        id: "img1",
        publicPath: "/media/editorial/ab/abc.jpg",
        alt: "a",
        width: 0,
        height: -5,
      },
    ]);
    expect(blocks[0]).toMatchObject({ image: { width: null, height: null } });
  });
});

describe("video: link para provedor conhecido, nunca embed livre", () => {
  it("monta o link a partir do externalId de youtube e vimeo", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "video", id: "v1", provider: "youtube", externalId: "dQw4w9WgXcQ" },
      { type: "video", id: "v2", provider: "vimeo", externalId: "123456789" },
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "video",
      href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(blocks[1]).toMatchObject({ href: "https://vimeo.com/123456789" });
  });

  it("aceita url apenas de host permitido", () => {
    const ok = buildArticleBodyBlocks([
      { type: "video", id: "v1", provider: "youtube", url: "https://youtu.be/abc123" },
    ]);
    expect(ok).toHaveLength(1);

    // Host desconhecido nao vira link clicavel em pagina indexavel.
    const bad = buildArticleBodyBlocks([
      { type: "video", id: "v1", provider: "youtube", url: "https://videos.terceiro.test/x" },
    ]);
    expect(bad).toEqual([]);
  });

  it("recusa esquema perigoso, mesmo disfarcado", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      const blocks = buildArticleBodyBlocks([
        { type: "video", id: "v1", provider: "youtube", url },
      ]);
      expect(blocks, url).toEqual([]);
    }
  });

  it("externalId malformado nao e concatenado no href", () => {
    // Sem a validacao, `?v=x&list=<qualquer coisa>` viraria parametro injetado.
    const blocks = buildArticleBodyBlocks([
      { type: "video", id: "v1", provider: "youtube", externalId: "abc&list=EVIL" },
    ]);
    expect(blocks).toEqual([]);
  });

  it("provider desconhecido e `internal` nao viram link", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "video", id: "v1", provider: "html", url: "https://youtu.be/abc123" },
      { type: "video", id: "v2", provider: "internal", externalId: "abc123" },
      { type: "video", id: "v3" },
    ]);
    expect(blocks).toEqual([]);
  });
});

describe("factBox", () => {
  it("mantem so pares completos", () => {
    const blocks = buildArticleBodyBlocks([
      {
        type: "factBox",
        id: "f1",
        title: "Ficha tecnica",
        items: [
          { label: "Diretor", value: "James Gunn" },
          // Fato sem valor nao e um fato.
          { label: "Bilheteria", value: "  " },
          { value: "sem rotulo" },
          "texto solto",
        ],
      },
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "factBox",
      title: "Ficha tecnica",
      items: [{ label: "Diretor", value: "James Gunn" }],
    });
  });

  it("sem titulo ou sem nenhum item valido o bloco desaparece", () => {
    expect(
      buildArticleBodyBlocks([{ type: "factBox", id: "f1", items: [{ label: "a", value: "b" }] }]),
    ).toEqual([]);
    expect(
      buildArticleBodyBlocks([{ type: "factBox", id: "f1", title: "T", items: [] }]),
    ).toEqual([]);
  });
});

describe("entityCard: hidratado pelo catalogo, nunca inventado", () => {
  it("resolve a ficha e usa a nota editorial do bloco por cima do resumo", () => {
    const blocks = buildArticleBodyBlocks(
      [{ type: "entityCard", id: "e1", entityKind: "movie", entityId: "10", note: "Nota do editor." }],
      hydration(),
    );
    expect(blocks[0]).toMatchObject({
      kind: "entityCard",
      note: "Nota do editor.",
      card: { entityType: "movie", title: "Superman", href: "/pt/filmes/superman/" },
    });
  });

  it("entidade que nao esta no catalogo NAO produz card falso", () => {
    const blocks = buildArticleBodyBlocks(
      [{ type: "entityCard", id: "e1", entityKind: "movie", entityId: "999" }],
      hydration(),
    );
    expect(blocks).toEqual([]);
  });

  it("entidade sem slug canonico tambem desaparece (card sem link nao leva a lugar)", () => {
    const blocks = buildArticleBodyBlocks(
      [{ type: "entityCard", id: "e1", entityKind: "movie", entityId: "10" }],
      hydration({ entityCards: new Map([["movie:10", { ...MOVIE, slug: null }]]) }),
    );
    expect(blocks).toEqual([]);
  });
});

describe("relatedContent: so artigo publicavel", () => {
  it("resolve ref para slug interno pt-BR e deduplica", () => {
    const blocks = buildArticleBodyBlocks(
      [{ type: "relatedContent", id: "r1", articleRefs: ["doc-9", "doc-9", "doc-inexistente"] }],
      hydration(),
    );
    expect(blocks[0]).toMatchObject({
      kind: "relatedContent",
      items: [{ label: "Materia anterior", href: "/pt/noticias/materia-anterior/" }],
    });
  });

  it("nenhuma ref resolvida remove o bloco (nunca lista vazia na pagina)", () => {
    const blocks = buildArticleBodyBlocks(
      [{ type: "relatedContent", id: "r1", articleRefs: ["doc-inexistente"] }],
      hydration(),
    );
    expect(blocks).toEqual([]);
  });
});

describe("sourceList: fontes ja resolvidas pelo worker", () => {
  it("aceita nome + url http(s) e deduplica por url", () => {
    const blocks = buildArticleBodyBlocks([
      {
        type: "sourceList",
        id: "s1",
        sources: [
          { name: "Variety", url: "https://variety.test/a" },
          { name: "Variety (repetida)", url: "https://variety.test/a" },
        ],
      },
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "sourceList",
      items: [{ label: "Variety", href: "https://variety.test/a" }],
    });
  });

  it("bloco que chegou com sourceRefs NAO resolvidos desaparece", () => {
    // Contrato antigo (sem `sourceId`) ou ref quebrada: o worker nao consegue
    // resolver, e creditar a fonte errada e pior do que nao creditar.
    const blocks = buildArticleBodyBlocks([
      { type: "sourceList", id: "s1", sourceRefs: ["s1", "s2"] },
    ]);
    expect(blocks).toEqual([]);
  });

  it("recusa esquema perigoso na url da fonte", () => {
    const blocks = buildArticleBodyBlocks([
      { type: "sourceList", id: "s1", sources: [{ name: "X", url: "javascript:alert(1)" }] },
    ]);
    expect(blocks).toEqual([]);
  });
});

describe("teto de blocos", () => {
  it("nao renderiza acima do limite do contrato", () => {
    const raw = Array.from({ length: 260 }, (_, index) => ({
      type: "paragraph",
      id: `p${String(index)}`,
      text: `Paragrafo ${String(index)}.`,
    }));
    expect(buildArticleBodyBlocks(raw)).toHaveLength(200);
  });
});

describe("coleta de referencias a resolver", () => {
  it("junta entidades e refs de artigo, deduplicadas, ignorando o resto", () => {
    const refs = collectArticleBodyReferences([
      { type: "paragraph", id: "p1", text: "x" },
      { type: "entityCard", id: "e1", entityKind: "movie", entityId: "10" },
      { type: "entityCard", id: "e2", entityKind: "movie", entityId: "10" },
      { type: "entityCard", id: "e3", entityKind: "tv", entityId: "10" },
      { type: "entityCard", id: "e4", entityKind: "person" },
      { type: "relatedContent", id: "r1", articleRefs: ["doc-1", "doc-1", 42] },
      { type: "relatedContent", id: "r2", articleRefs: ["doc-2"] },
    ]);
    expect(refs.entities).toEqual([
      { entityKind: "movie", entityId: "10" },
      { entityKind: "tv", entityId: "10" },
    ]);
    expect(refs.articleRefs).toEqual(["doc-1", "doc-2"]);
  });

  it("entrada nao-lista nao produz consulta nenhuma", () => {
    expect(collectArticleBodyReferences(null)).toEqual({ entities: [], articleRefs: [] });
  });
});
