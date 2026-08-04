/**
 * Capa editorial governada: `alt`, credito e dimensoes vindos de
 * `editorial_media_assets` pelo vinculo `articles.hero_media_asset_id`.
 *
 * O defeito que estes testes trancam: a projecao preservava credito, licenca e
 * dimensoes, e NENHUMA query do site fazia o join — os campos ficavam orfaos no
 * banco e a pagina exibia imagem sem atribuir. Isso e conformidade
 * (`requires_attribution`), nao estetica.
 */

import { describe, expect, it } from "vitest";

import {
  buildNewsArticleView,
  buildNewsCard as buildNewsCardAt,
  type ArticleFactsInput,
  type ArticleTranslationInput,
  type NewsHeroMediaInput,
  type NewsListItemInput,
} from "../../apps/web/src/lib/news-presenter";

const NOW = "2026-08-01T00:00:00.000Z";
const HERO_PATH = "/media/editorial/92/927ab0a3.jpg";

const buildNewsCard = (input: NewsListItemInput) => buildNewsCardAt(input, NOW);

function media(overrides: Partial<NewsHeroMediaInput> = {}): NewsHeroMediaInput {
  return {
    alt: "Cena do filme com os dois protagonistas",
    credit: "Divulgacao/Netflix",
    width: 1600,
    height: 900,
    ...overrides,
  };
}

function item(overrides: Partial<NewsListItemInput> = {}): NewsListItemInput {
  return {
    authorName: null,
    category: null,
    heroImagePath: HERO_PATH,
    articlePublishedAtIso: null,
    readTimeMinutes: null,
    licenseStatus: "official",
    displayAllowed: true,
    slug: "artigo",
    title: "Artigo",
    deck: null,
    reviewStatus: "published",
    translationPublishedAtIso: "2026-07-30T12:00:00.000Z",
    ...overrides,
  };
}

function facts(overrides: Partial<ArticleFactsInput> = {}): ArticleFactsInput {
  return {
    authorName: null,
    category: null,
    heroImagePath: HERO_PATH,
    articlePublishedAtIso: null,
    readTimeMinutes: null,
    aiAssisted: false,
    sourceName: null,
    sourceUrl: null,
    licenseStatus: "official",
    displayAllowed: true,
    requiresAttribution: false,
    requiresLinkback: false,
    ...overrides,
  };
}

function translation(
  overrides: Partial<ArticleTranslationInput> = {},
): ArticleTranslationInput {
  return {
    slug: "artigo",
    title: "Artigo",
    deck: null,
    body: null,
    metaTitle: null,
    metaDescription: null,
    socialTitle: null,
    socialDescription: null,
    canonicalOverride: null,
    articleSection: null,
    schemaTypeRecommendation: null,
    approvedImageAlt: null,
    reviewStatus: "published",
    indexStatus: "index",
    translationPublishedAtIso: "2026-07-30T12:00:00.000Z",
    translationUpdatedAtIso: null,
    ...overrides,
  };
}

const article = (f: Partial<ArticleFactsInput> = {}, t: Partial<ArticleTranslationInput> = {}) =>
  buildNewsArticleView({
    facts: facts(f),
    translation: translation(t),
    related: [],
    entityCard: null,
  });

describe("capa do DETALHE: credito e alt chegam do asset", () => {
  it("traz credito e alt do asset vinculado", () => {
    const view = article({ heroMedia: media() });
    expect(view.heroImage?.credit).toBe("Divulgacao/Netflix");
    expect(view.heroImage?.alt).toBe("Cena do filme com os dois protagonistas");
  });

  it("dimensoes reais do arquivo substituem o 1280x720 fixo", () => {
    const view = article({ heroMedia: media({ width: 1600, height: 900 }) });
    expect(view.heroImage?.width).toBe(1600);
    expect(view.heroImage?.height).toBe(900);
  });

  it("dimensao ausente ou invalida cai no spec padrao, sem quebrar", () => {
    const semDim = article({ heroMedia: media({ width: null, height: null }) });
    expect(semDim.heroImage?.width).toBe(1280);
    expect(semDim.heroImage?.height).toBe(720);

    const invalida = article({ heroMedia: media({ width: 0, height: -5 }) });
    expect(invalida.heroImage?.width).toBe(1280);
    expect(invalida.heroImage?.height).toBe(720);
  });
});

describe("capa da LISTAGEM: o card deixa de nascer mudo", () => {
  it("o card recebe alt NAO-VAZIO do asset", () => {
    const card = buildNewsCard(item({ heroMedia: media() }));
    expect(card?.image?.alt).toBe("Cena do filme com os dois protagonistas");
    expect(card?.image?.alt).not.toBe("");
    expect(card?.image?.alt).not.toBeNull();
  });

  it("o card tambem carrega o credito (mesma forma de NewsImageAsset)", () => {
    const card = buildNewsCard(item({ heroMedia: media() }));
    expect(card?.image?.credit).toBe("Divulgacao/Netflix");
  });

  it("REGRESSAO: sem o asset o alt do card era null na origem", () => {
    // Antes do join a listagem chamava heroImageAsset SEM alt algum. Este teste
    // falha se alguem remover `heroMedia` do caminho da listagem.
    const semAsset = buildNewsCard(item());
    expect(semAsset?.image?.alt).toBeNull();

    const comAsset = buildNewsCard(item({ heroMedia: media() }));
    expect(comAsset?.image?.alt).not.toBeNull();
  });
});

describe("origem do alt: o asset vinculado vence approvedImageAlt", () => {
  it("o asset vence, porque o pareamento por hero_media_asset_id e EXATO", () => {
    const view = article(
      { heroMedia: media({ alt: "alt do asset" }) },
      { approvedImageAlt: [{ mediaId: "outra", alt: "alt posicional" }] },
    );
    // `approvedImageAlt` nao pareia por mediaId: ela assume que o hero e o
    // primeiro item da lista. O vinculo do asset nao assume nada.
    expect(view.heroImage?.alt).toBe("alt do asset");
  });

  it("approvedImageAlt continua servindo linhas antigas, sem asset vinculado", () => {
    const view = article({}, { approvedImageAlt: [{ mediaId: "m1", alt: "alt legado" }] });
    expect(view.heroImage?.alt).toBe("alt legado");
  });

  it("placeholder 'sem descricao' NAO vira alt — cai para o fallback", () => {
    // O proprio CMS grava esse texto quando o editor nao descreveu
    // (publication.ts:259) e o filtra ao montar approvedImageAlt (:355). Deixar
    // passar faria o leitor de tela anunciar "sem descricao" como se fosse
    // conteudo.
    const comFallback = article(
      { heroMedia: media({ alt: "sem descricao" }) },
      { approvedImageAlt: [{ mediaId: "m1", alt: "alt aprovado" }] },
    );
    expect(comFallback.heroImage?.alt).toBe("alt aprovado");

    const semFallback = article({ heroMedia: media({ alt: "Sem Descricao" }) });
    expect(semFallback.heroImage?.alt).toBeNull();
  });

  it("alt em branco no asset nao mascara o fallback", () => {
    const view = article(
      { heroMedia: media({ alt: "   " }) },
      { approvedImageAlt: [{ mediaId: "m1", alt: "alt aprovado" }] },
    );
    expect(view.heroImage?.alt).toBe("alt aprovado");
  });
});

describe("ausencias nao quebram nenhuma das duas superficies", () => {
  it("artigo SEM asset de capa continua montando a view", () => {
    const view = article();
    expect(view.heroImage).not.toBeNull();
    expect(view.heroImage?.src).toBe(HERO_PATH);
    expect(view.heroImage?.credit).toBeNull();
    expect(view.heroImage?.alt).toBeNull();
  });

  it("card SEM asset de capa continua montando o card", () => {
    const card = buildNewsCard(item());
    expect(card).not.toBeNull();
    expect(card?.image?.src).toBe(HERO_PATH);
    expect(card?.image?.credit).toBeNull();
  });

  it("heroMedia explicitamente null e tratado como ausencia", () => {
    expect(article({ heroMedia: null }).heroImage?.credit).toBeNull();
    expect(buildNewsCard(item({ heroMedia: null }))?.image?.credit).toBeNull();
  });

  it("sem caminho de imagem nao ha asset, mesmo com heroMedia preenchido", () => {
    expect(article({ heroImagePath: null, heroMedia: media() }).heroImage).toBeNull();
    expect(buildNewsCard(item({ heroImagePath: null, heroMedia: media() }))?.image).toBeNull();
  });
});

describe("credito ausente nunca vira rotulo vazio nem 'null'", () => {
  it("credit NULL sai como null — o render testa `!= null` e omite", () => {
    const view = article({ heroMedia: media({ credit: null }) });
    expect(view.heroImage?.credit).toBeNull();
    expect(view.heroImage?.credit).not.toBe("");
    expect(String(view.heroImage?.credit)).not.toBe("undefined");
  });

  it("credit em branco tambem sai como null, nao como string vazia", () => {
    // `<p>{""}</p>` renderiza um paragrafo vazio com margem: um buraco visual
    // que ninguem associa a credito faltando.
    expect(article({ heroMedia: media({ credit: "   " }) }).heroImage?.credit).toBeNull();
    expect(buildNewsCard(item({ heroMedia: media({ credit: "" }) }))?.image?.credit).toBeNull();
  });

  it("a string 'null' NUNCA aparece como credito", () => {
    for (const credit of [null, "", "  "]) {
      const view = article({ heroMedia: media({ credit }) });
      expect(view.heroImage?.credit).not.toBe("null");
      expect(view.heroImage?.credit).toBeNull();
    }
  });

  it("credito real e preservado sem normalizacao alem do trim", () => {
    const view = article({ heroMedia: media({ credit: "  Foto: Ana Souza/AFP  " }) });
    expect(view.heroImage?.credit).toBe("Foto: Ana Souza/AFP");
  });
});
