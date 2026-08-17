/**
 * entity-synopsis.test.tsx — "O TEXTO EM INGLES NAO ENTRA MUDO."
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR DE VOLTAR
 * ============================================================================
 * A politica de idioma do T2 foi decidida pelo dono: a semente exige `pt-BR`,
 * mas o caminho SOB DEMANDA aceita o idioma de origem, porque recusar quem
 * digitou o nome e pediu e pior que mostrar o texto original.
 *
 * A ingestao passou a implementar essa assimetria. O RENDER nao: filme e serie
 * liam a traducao com `languageCode: 'pt-BR'` no WHERE, entao a sinopse em
 * `en-US` nao chegava rotulada errada — ela nao chegava. A pagina saia sem
 * sinopse nenhuma para o leitor que a tinha pedido, e nada dizia por que.
 *
 * As DUAS metades sao provadas aqui, e uma sozinha nao vale nada:
 *
 *   1. o texto em idioma de origem APARECE (o descarte mudo acabou);
 *   2. ele nunca aparece SEM o aviso (a marca nao e opcional).
 *
 * MEDIDO EM TEXTO VISIVEL, nao em `markup.includes`: `lang` e
 * `data-synopsis-source` sao atributos, e um `includes` sobre o HTML acharia a
 * palavra dentro deles — o defeito da PR #165, em que quatro assercoes passavam
 * pelo motivo errado.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntitySynopsis } from "../entity-synopsis";
import {
  selectSynopsis,
  type SynopsisView,
} from "../../../src/lib/synopsis-language";

/** Texto que a pessoa LE: tags fora, entidades resolvidas, espaco normalizado. */
function visibleText(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const EM_INGLES = "A washed-up boxer gets one last shot at the title.";
const EM_PORTUGUES = "Um boxeador decadente ganha uma ultima chance pelo titulo.";

/** O mesmo titulo do teste puro, atravessando o seletor de verdade. */
function viewFrom(
  rows: { languageCode: string; summary: string | null }[],
): SynopsisView {
  const view = selectSynopsis(
    rows.map((r) => ({ ...r, metaDescription: null })),
    "en",
  );
  if (view === null) throw new Error("esperava uma sinopse");
  return view;
}

describe("sinopse em idioma de origem", () => {
  const view = viewFrom([{ languageCode: "en-US", summary: EM_INGLES }]);

  it("APARECE — o descarte silencioso acabou", () => {
    expect(visibleText(<EntitySynopsis synopsis={view} />)).toContain(EM_INGLES);
  });

  it("nunca aparece sem o aviso, e o aviso nomeia o idioma", () => {
    const texto = visibleText(<EntitySynopsis synopsis={view} />);
    expect(texto).toContain("Inglês");
    expect(texto).toContain("sem tradução");
  });

  it("carrega `lang` — leitor de tela pronuncia no idioma certo", () => {
    const markup = renderToStaticMarkup(<EntitySynopsis synopsis={view} />);
    expect(markup).toContain('lang="en-US"');
  });
});

describe("sinopse traduzida", () => {
  const view = viewFrom([
    { languageCode: "en-US", summary: EM_INGLES },
    { languageCode: "pt-BR", summary: EM_PORTUGUES },
  ]);

  it("mostra o pt-BR e NAO mostra o ingles", () => {
    const texto = visibleText(<EntitySynopsis synopsis={view} />);
    expect(texto).toContain(EM_PORTUGUES);
    expect(texto).not.toContain(EM_INGLES);
  });

  it("nao carrega aviso nenhum — a marca so existe quando ha o que marcar", () => {
    const texto = visibleText(<EntitySynopsis synopsis={view} />);
    expect(texto).not.toContain("sem tradução");
    expect(texto).not.toContain("idioma original");
  });
});

describe("ausencia", () => {
  it("sem sinopse em idioma nenhum, a secao inteira some", () => {
    expect(visibleText(<EntitySynopsis synopsis={null} />)).toBe("");
  });
});

describe("CONTROLE NEGATIVO — a marca e obrigatoria por CONSTRUCAO", () => {
  it("um aviso vazio nao passa despercebido: a assercao mede o que se le", () => {
    // Simula o que um `notice` esvaziado produziria. Nao ha caminho no codigo
    // que gere isso (o tipo exige a frase e `originalLanguageNotice` nunca
    // devolve vazio) — o teste existe para provar que, se alguem abrir esse
    // caminho, a assercao de texto visivel acusa em vez de passar.
    const adulterado = {
      source: "original_language",
      text: EM_INGLES,
      languageCode: "en-US",
      notice: "",
    } as const satisfies SynopsisView;

    const texto = visibleText(<EntitySynopsis synopsis={adulterado} />);
    expect(texto).toContain(EM_INGLES);
    expect(texto).not.toContain("sem tradução");
  });
});
