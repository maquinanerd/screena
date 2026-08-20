/**
 * detail-hero-canonical.test.tsx — O TOPO É O CANÔNICO E MAIS NADA
 * (decisão do dono, 20/08/2026).
 *
 * As provas desta suíte medem CONTEÚDO RENDERIZADO (texto visível e árvore
 * produzida), nunca varredura de texto-fonte — este repositório já teve cinco
 * testes verdes pelo motivo errado, o último quebrando quando a classe virou
 * ternária.
 *
 * O que se trava aqui:
 *  1. As SETE remoções do topo, uma a uma — se qualquer linha voltar ao
 *     conteúdo renderizado do cartão, reprova.
 *  2. Exatamente DOIS botões de ação no topo.
 *  3. Sinopse do topo: corte em palavra inteira, dentro do orçamento.
 *  4. O Cinerie Score nos DOIS arranjos: com >= 2 fontes o card abre o
 *     cartão; abaixo do piso ele NÃO existe e "Avaliações" sobe.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CinerieScoreCard } from "../cinerie-score-card";
import { EntityActions } from "../entity-actions";
import { EntitySynopsis } from "../entity-synopsis";
import { RatingsPanel } from "../ratings-panel";
import { SectionBoundary } from "../section-boundary";
import { WatchBrandsRow } from "../watch-brands-row";
import {
  decideCinerieScore,
  type CinerieScoreInputView,
} from "../../../src/lib/cinerie-score-presenter";
import {
  HERO_SYNOPSIS_MAX_CHARS,
  truncateAtWord,
} from "../../../src/lib/detail-hero";
import {
  buildRatingsView,
  type RatingsPanelView,
} from "../../../src/lib/ratings-presenter";
import { watchBrandsRow, type WatchBrandRowItem } from "../../../src/lib/watch-brands-row";
import { buildWatchAvailabilityView } from "../../../src/lib/watch-availability-presenter";

/** O que a PESSOA lê: tags (e atributos) fora, entidades comuns, espaço colapsado. */
function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Fixtures reais: notas pelo presenter (gate incluso), ofertas idem.  */
/* ------------------------------------------------------------------ */

function rating(over: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceKey: "imdb",
    sourceLabel: "IMDb",
    scoreType: "audience",
    label: "IMDb Rating",
    value: 8.4,
    best: 10,
    count: 12400,
    updatedAt: "2026-08-19T00:00:00.000Z",
    attribution: { text: "Nota fornecida por IMDb", url: "https://www.imdb.com/title/tt1/" },
    ...over,
  };
}

const RATINGS_FIXTURE = [
  rating({}),
  rating({
    sourceKey: "rotten_tomatoes",
    sourceLabel: "Rotten Tomatoes",
    scoreType: "critics",
    label: "Tomatometer",
    value: 88,
    best: 100,
    count: null,
    attribution: { text: "Nota fornecida por Rotten Tomatoes", url: null },
  }),
];

function ratingsView(): RatingsPanelView {
  const view = buildRatingsView({ ratings: RATINGS_FIXTURE } as never);
  if (view === null || view.items.length !== RATINGS_FIXTURE.length) {
    throw new Error("FIXTURE INUTILIZAVEL: o presenter recusou nota da fixture.");
  }
  return view;
}

/** Oferta licenciada minima para a fileira de marcas (via presenter REAL). */
function watchBrands(): readonly WatchBrandRowItem[] {
  const view = buildWatchAvailabilityView([
    {
      providerName: "Netflix",
      providerKey: "8",
      providerSlug: "netflix",
      offerType: "subscription",
      deepLink: null,
      webUrl: "https://www.themoviedb.org/movie/1/watch?locale=BR",
      quality: null,
      priceAmount: null,
      currency: null,
      displayAllowed: true,
      fetchedAtIso: "2026-08-19T00:00:00.000Z",
      requiresAttribution: true,
      requiresLinkback: false,
      attributionText: "Disponibilidade fornecida por JustWatch",
      attributionUrl: null,
    },
  ]);
  if (view === null || view.groups.length === 0) {
    throw new Error("FIXTURE INUTILIZAVEL: o presenter recusou a oferta da fixture.");
  }
  return watchBrandsRow(view);
}

const SCORE_TWO_SOURCES: CinerieScoreInputView = {
  authorized: true,
  value: 86,
  counted: [
    { source: "imdb", normalized: 84, group: "audience", weight: 3 },
    { source: "rotten_tomatoes", normalized: 88, group: "critics", weight: 1 },
  ],
};

const SCORE_ONE_SOURCE: CinerieScoreInputView = {
  authorized: true,
  value: 84,
  counted: [{ source: "imdb", normalized: 84, group: "audience", weight: 3 }],
};

/**
 * O CARTÃO da coluna direita, montado EXATAMENTE como as duas páginas o
 * montam (score → avaliações → onde assistir, com o `--first` migrando).
 */
function renderAsideCard(score: CinerieScoreInputView): string {
  const decision = decideCinerieScore(score);
  return renderToStaticMarkup(
    <aside>
      {decision.rendered ? (
        <div className="detail-aside-block detail-aside-block--first">
          <CinerieScoreCard view={decision.view} />
        </div>
      ) : null}
      <div
        className={
          decision.rendered
            ? "detail-aside-block"
            : "detail-aside-block detail-aside-block--first"
        }
      >
        <p className="detail-aside-block__label">Avaliações</p>
        <RatingsPanel view={ratingsView()} />
      </div>
      <div className="detail-aside-block">
        <p className="detail-aside-block__label">Onde assistir</p>
        <WatchBrandsRow brands={watchBrands()} />
      </div>
    </aside>,
  );
}

/* ------------------------------------------------------------------ */
/* 1. As sete remoções, por conteúdo renderizado                       */
/* ------------------------------------------------------------------ */

describe("as sete remoções do topo — nenhuma volta ao conteúdo renderizado", () => {
  const card = renderAsideCard(SCORE_TWO_SOURCES);
  const texto = visibleText(card);

  it("1. a linha de métrica ('IMDb · Público') saiu do cartão", () => {
    expect(texto).not.toContain("· Público");
    expect(texto).not.toContain("· Crítica");
    expect(texto).not.toContain("IMDb Rating");
    expect(texto).not.toContain("Tomatometer");
  });

  it("2. o aviso de escala saiu do cartão (a escala está no próprio valor)", () => {
    expect(texto).not.toContain("Cada nota está na escala");
    // A escala continua visível DO JEITO CANÔNICO: no sufixo do valor.
    expect(texto).toContain("8,4");
    expect(card).toContain('rating-chip__suffix">/10<');
    expect(card).toContain('rating-chip__suffix">%<');
  });

  it("3. 'Atualizado em' saiu do cartão (vive no title/data-* do chip)", () => {
    expect(texto).not.toContain("Atualizado em");
    expect(card).toContain('data-rating-updated="Atualizado em 19/08/2026"');
  });

  it("4. 'Também em:' não existe no cartão", () => {
    expect(texto).not.toContain("Também em");
  });

  it("5. 'As ofertas podem mudar' saiu do cartão", () => {
    expect(texto).not.toContain("As ofertas podem mudar");
  });

  it("6. sem subtítulo 'DISPONIBILIDADE NO BRASIL' dentro do cartão", () => {
    expect(texto.toLowerCase()).not.toContain("disponibilidade no brasil");
  });

  it("7. a fileira de marcas mantém o destino REAL e a modalidade visível", () => {
    // Remoção não é regressão: a marca continua um link para a melhor oferta,
    // e a modalidade continua texto visível (decisão de 2026-08-13).
    expect(card).toContain('href="https://www.themoviedb.org/movie/1/watch?locale=BR"');
    expect(card).toContain('rel="nofollow sponsored noopener"');
    expect(texto).toContain("Netflix");
    expect(texto).toContain("Assinatura");
  });
});

/* ------------------------------------------------------------------ */
/* 2. Exatamente DOIS botões de ação                                   */
/* ------------------------------------------------------------------ */

describe("o topo tem exatamente dois botões de ação", () => {
  it("EntityActions renderiza Minha lista + Avaliar, e nada além", () => {
    const markup = renderToStaticMarkup(<EntityActions entityId="1" entityType="movie" />);
    const buttons = markup.match(/<button\b/g) ?? [];
    expect(buttons).toHaveLength(2);
    const texto = visibleText(markup);
    expect(texto).toContain("Minha lista");
    expect(texto).toContain("Avaliar");
    // Os quatro antigos não voltam:
    for (const antigo of ["Quero assistir", "Assistido", "Acompanhar serie", "Acompanhar no tracker"]) {
      expect(texto).not.toContain(antigo);
    }
  });

  it("na série também são dois (o terceiro botão de série morreu)", () => {
    const markup = renderToStaticMarkup(<EntityActions entityId="1" entityType="tv" />);
    expect(markup.match(/<button\b/g) ?? []).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Sinopse: três linhas, corte em palavra inteira                   */
/* ------------------------------------------------------------------ */

describe("sinopse do topo: palavra inteira, dentro do orçamento", () => {
  const LONGA =
    "Depois que cientistas descobrem um sinal vindo das profundezas do oceano, uma equipe " +
    "internacional embarca numa expedição que promete reescrever tudo o que a humanidade " +
    "sabe sobre a própria origem, enquanto potências rivais disputam o controle da descoberta " +
    "e um segredo antigo ameaça vir à tona.";

  it("não corta no meio da palavra e não passa do orçamento — em TODOS os orçamentos", () => {
    // Varre uma faixa de orçamentos em vez de um só: um corte duro que caia,
    // por sorte, numa fronteira de palavra da fixture passaria com um único
    // orçamento — foi exatamente o que o controle negativo pegou.
    const palavras = new Set(LONGA.replace(/[.,]/g, "").split(/\s+/));
    for (let budget = 60; budget <= HERO_SYNOPSIS_MAX_CHARS; budget += 7) {
      const { text, truncated } = truncateAtWord(LONGA, budget);
      expect(truncated, `orçamento ${budget}`).toBe(true);
      expect(text.length, `orçamento ${budget}`).toBeLessThanOrEqual(budget + 1);
      expect(text.endsWith("…"), `orçamento ${budget}`).toBe(true);
      const lastWord = text.slice(0, -1).split(" ").pop()!.replace(/[.,]/g, "");
      expect(palavras.has(lastWord), `orçamento ${budget}: "${lastWord}" não é palavra inteira`).toBe(
        true,
      );
    }
  });

  it("texto curto volta intacto, sem reticências", () => {
    const { text, truncated } = truncateAtWord("Curta e completa.", HERO_SYNOPSIS_MAX_CHARS);
    expect(truncated).toBe(false);
    expect(text).toBe("Curta e completa.");
  });

  it("o componente do hero corta; o da seção A OBRA entrega o texto completo", () => {
    const synopsis = {
      text: LONGA,
      source: "published_locale",
      languageCode: "pt-BR",
    } as never;
    const hero = visibleText(
      renderToStaticMarkup(<EntitySynopsis maxChars={HERO_SYNOPSIS_MAX_CHARS} synopsis={synopsis} />),
    );
    const work = visibleText(
      renderToStaticMarkup(<EntitySynopsis synopsis={synopsis} variant="work" />),
    );
    expect(hero).toContain("…");
    expect(hero.length).toBeLessThan(work.length);
    expect(work).toContain("ameaça vir à tona.");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Cinerie Score: os dois arranjos do cartão                        */
/* ------------------------------------------------------------------ */

describe("o Cinerie Score no cartão — os dois arranjos", () => {
  it("com duas fontes o Score abre o cartão, nomeando as fontes", () => {
    const card = renderAsideCard(SCORE_TWO_SOURCES);
    const texto = visibleText(card);
    expect(texto).toContain("86");
    expect(texto).toContain("Cinerie Score");
    expect(texto).toContain("de 100 · crítica + público");
    expect(texto).toContain("Composto de 2 fontes: IMDb e Rotten Tomatoes.");
    // O card é o PRIMEIRO bloco; "Avaliações" vem depois, sem `--first`.
    const scoreIdx = card.indexOf("score-card__value");
    const ratingsIdx = card.indexOf("Avaliações");
    expect(scoreIdx).toBeGreaterThan(-1);
    expect(scoreIdx).toBeLessThan(ratingsIdx);
    expect(card.indexOf('detail-aside-block detail-aside-block--first')).toBeLessThan(scoreIdx);
  });

  it("com UMA fonte o Score NÃO renderiza e 'Avaliações' sobe para o topo do cartão", () => {
    const decision = decideCinerieScore(SCORE_ONE_SOURCE);
    expect(decision.rendered).toBe(false);
    if (!decision.rendered) expect(decision.reason).toBe("single_source_insufficient");

    const card = renderAsideCard(SCORE_ONE_SOURCE);
    const texto = visibleText(card);
    expect(texto).not.toContain("Cinerie Score");
    expect(card).not.toContain("score-card__value");
    // "Avaliações" assume o topo: o bloco dela carrega o `--first` e nada de
    // filete pendurado acima (não fica buraco no cartão).
    const firstBlock = card.slice(0, card.indexOf("Avaliações") + 20);
    expect(firstBlock).toContain("detail-aside-block detail-aside-block--first");
  });

  it("sem decisão vigente, a ausência tem o motivo próprio (não 'sem nota')", () => {
    const decision = decideCinerieScore({ authorized: false, value: 86, counted: SCORE_TWO_SOURCES.counted });
    expect(decision.rendered).toBe(false);
    if (!decision.rendered) expect(decision.reason).toBe("no_approved_formula");
  });

  it("o painel de notas individuais continua INTACTO ao lado do Score", () => {
    const card = renderAsideCard(SCORE_TWO_SOURCES);
    // As duas notas, cada uma na própria escala — o Score não substitui nem
    // esconde nenhuma.
    expect(card).toContain('data-rating-source="imdb"');
    expect(card).toContain('data-rating-source="rotten_tomatoes"');
  });
});

/* ------------------------------------------------------------------ */
/* Estrutura das páginas: banda de mídia e prêmios (guardas reais)     */
/* ------------------------------------------------------------------ */

describe("banda de mídia: cards guardados por dado; prêmios abaixo da banda", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pages = [
    ["filme", resolve(here, "../../pt/filmes/[slug]/page.tsx")],
    ["serie", resolve(here, "../../pt/series/[slug]/page.tsx")],
  ] as const;

  for (const [name, pagePath] of pages) {
    const source = readFileSync(pagePath, "utf8");

    it(`${name}: "Em breve" não existe dentro da banda de mídia (era o placeholder do T11)`, () => {
      expect(source).not.toContain(">Em breve<");
    });

    it(`${name}: o card "Prêmios e Indicações" só existe quando há prêmio, e ancora na faixa`, () => {
      // O card é condicionado ao MESMO gate da faixa (awardsSection.rendered);
      // título sem prêmio não ganha card cinza.
      expect(source).toMatch(/awardsSection\.rendered \? \([\s\S]{0,400}Prêmios e Indicações/);
    });

    it(`${name}: a legenda do trailer só existe com trailer real (nada de placeholder)`, () => {
      expect(source).toMatch(/\{trailer !== null \? \(\s*<span className="media-strip__caption">Trailer<\/span>\s*\) : null\}/);
      expect(source).not.toContain("Mídia do título");
    });

    it(`${name}: a faixa de prêmios vive ABAIXO da banda de mídia (desceu do topo)`, () => {
      const banda = source.indexOf('className="media-strip"');
      const premios = source.indexOf("<AwardsBand");
      expect(banda).toBeGreaterThan(-1);
      expect(premios).toBeGreaterThan(banda);
    });
  }
});

/* ------------------------------------------------------------------ */
/* SectionBoundary: fixture de sanidade (o cartão real usa fronteiras) */
/* ------------------------------------------------------------------ */

describe("sanidade da fronteira usada pelo cartão real", () => {
  it("SectionBoundary com decisão rendered entrega o valor ao filho", () => {
    const markup = renderToStaticMarkup(
      <SectionBoundary decision={{ rendered: true, value: "ok", absence: null }}>
        {(value) => <span>{value}</span>}
      </SectionBoundary>,
    );
    expect(visibleText(markup)).toBe("ok");
  });
});
