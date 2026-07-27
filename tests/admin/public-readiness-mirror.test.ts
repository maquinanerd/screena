/**
 * Trava de espelhamento (Fase 7B): a prontidao publica calculada no admin DEVE
 * concordar com o pipeline publico REAL do app web
 * (`apps/web/src/lib/news-presenter.ts` + `apps/web/src/lib/site.ts`). O admin
 * NAO importa o apps/web em runtime (fronteira limpa); este teste garante que as
 * duas definicoes nao divergem — se a regra publica mudar, este teste quebra e
 * forca o alinhamento.
 *
 * Regras cruzadas:
 *  - origin/paths publicos identicos;
 *  - limiar de corpo suficiente identico;
 *  - EXIBIR (canDisplay) == isPublishableArticle (para pt-BR);
 *  - INDEXAR (canIndex) == exibivel && evaluateArticleIndexability == 'index';
 *  - index_status NUNCA forca indexacao quando o corpo e insuficiente.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_ARTICLE_BODY_CHARS as WEB_MIN_BODY,
  evaluateArticleIndexability,
  isDisplayableLicense as webIsDisplayableLicense,
  isPubliclyRenderableNewsReview,
  isPublishableArticle,
  isSufficientBody as webIsSufficientBody,
} from "../../apps/web/src/lib/news-presenter";
import { NEWS_INDEX_PATH as WEB_NEWS_INDEX_PATH, SITE_URL } from "../../apps/web/src/lib/site";
import {
  NEWS_INDEX_PATH as ADMIN_NEWS_INDEX_PATH,
  PUBLIC_SITE_ORIGIN,
  buildPublicArticleUrl,
  evaluateArticlePublicReadiness as evaluateArticlePublicReadinessAt,
  isSufficientBodyChars,
  type ArticleReadinessInput,
} from "../../apps/admin/src/lib/public-readiness";

/** Instante bem depois das datas das fixtures; agendamento tem teste proprio. */
const NOW = "2026-07-05T00:00:00.000Z";

const evaluateArticlePublicReadiness = (input: ArticleReadinessInput) =>
  evaluateArticlePublicReadinessAt(input, NOW);

const isPublishableArticleNow = (input: Parameters<typeof isPublishableArticle>[0]) =>
  isPublishableArticle(input, NOW);


describe("constantes publicas espelhadas", () => {
  it("origin e path de noticias identicos ao apps/web", () => {
    expect(PUBLIC_SITE_ORIGIN).toBe(SITE_URL);
    expect(ADMIN_NEWS_INDEX_PATH).toBe(WEB_NEWS_INDEX_PATH);
  });

  it("buildPublicArticleUrl produz a mesma URL canonica do apps/web", () => {
    const slug = "meu-artigo";
    expect(buildPublicArticleUrl(slug, "pt-BR")).toBe(`${SITE_URL}${WEB_NEWS_INDEX_PATH}${slug}/`);
  });

  it("limiar de corpo suficiente identico", () => {
    expect(isSufficientBodyChars(WEB_MIN_BODY)).toBe(true);
    expect(isSufficientBodyChars(WEB_MIN_BODY - 1)).toBe(false);
    // Concorda com o helper do web por string.
    expect(isSufficientBodyChars(WEB_MIN_BODY)).toBe(webIsSufficientBody("x".repeat(WEB_MIN_BODY)));
    expect(isSufficientBodyChars(WEB_MIN_BODY - 1)).toBe(
      webIsSufficientBody("x".repeat(WEB_MIN_BODY - 1)),
    );
  });

  it("isDisplayableLicense concorda com o web para os status do schema", () => {
    for (const status of ["official", "licensed", "third_party", "unknown", "blocked"]) {
      // O admin usa o mesmo conjunto (via editorial-status, ja espelhado); reforca aqui
      // que o resultado de exibicao bate com o web para cada licenca.
      const r = evaluateArticlePublicReadiness(article({ licenseStatus: status }));
      expect(r.canDisplay).toBe(
        webIsDisplayableLicense(status) &&
          // demais gates do `article()` base estao ok (publishable, slug, etc.)
          true,
      );
    }
  });
});

/** Artigo pt-BR base "pronto"; overrides mudam um gate por vez. */
function article(overrides: Partial<ArticleReadinessInput> = {}): ArticleReadinessInput {
  return {
    reviewStatus: "published",
    licenseStatus: "official",
    displayAllowed: true,
    slug: "meu-artigo",
    title: "Meu Artigo",
    publishedAtIso: "2026-06-30T12:00:00.000Z",
    bodyChars: WEB_MIN_BODY,
    indexStatus: "index",
    languageCode: "pt-BR",
    ...overrides,
  };
}

const REVIEWS = ["published", "human_reviewed", "draft", "needs_review", "blocked", "archived"];
const LICENSES = ["official", "licensed", "third_party", "unknown", "blocked"];
const DISPLAYS = [true, false];
const INDEX_STATUSES = ["index", "noindex"];
const BODY_LENGTHS = [WEB_MIN_BODY, 40];

describe("matriz pt-BR: admin concorda com o pipeline publico real", () => {
  it("canDisplay == isPublishableArticle e canIndex == indexability=='index'", () => {
    let checked = 0;
    for (const reviewStatus of REVIEWS) {
      for (const licenseStatus of LICENSES) {
        for (const displayAllowed of DISPLAYS) {
          for (const indexStatus of INDEX_STATUSES) {
            for (const bodyChars of BODY_LENGTHS) {
              const body = "x".repeat(bodyChars);
              const input = article({
                reviewStatus,
                licenseStatus,
                displayAllowed,
                indexStatus,
                bodyChars,
              });
              const admin = evaluateArticlePublicReadiness(input);

              const webPublishable = isPublishableArticleNow({
                reviewStatus,
                licenseStatus,
                displayAllowed,
                slug: input.slug,
                title: input.title,
                publishedAtIso: input.publishedAtIso,
              });
              const webIndex =
                webPublishable &&
                evaluateArticleIndexability({
                  indexStatus,
                  bodySufficient: webIsSufficientBody(body),
                  reviewStatusOk: isPubliclyRenderableNewsReview(reviewStatus),
                }).decision === "index";

              expect(admin.canDisplay, JSON.stringify(input)).toBe(webPublishable);
              expect(admin.canIndex, JSON.stringify(input)).toBe(webIndex);
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBe(
      REVIEWS.length * LICENSES.length * DISPLAYS.length * INDEX_STATUSES.length * BODY_LENGTHS.length,
    );
  });
});

describe("campos ausentes tambem espelham isPublishableArticle", () => {
  it("sem slug/titulo/publishedAt -> nao exibivel (como no web)", () => {
    for (const override of [
      { slug: null },
      { title: null },
      { publishedAtIso: null },
    ] as Partial<ArticleReadinessInput>[]) {
      const input = article(override);
      const admin = evaluateArticlePublicReadiness(input);
      const web = isPublishableArticleNow({
        reviewStatus: input.reviewStatus,
        licenseStatus: input.licenseStatus,
        displayAllowed: input.displayAllowed,
        slug: input.slug,
        title: input.title,
        publishedAtIso: input.publishedAtIso,
      });
      expect(admin.canDisplay).toBe(web);
      expect(admin.canDisplay).toBe(false);
    }
  });
});

describe("index_status nao forca indexacao com corpo insuficiente", () => {
  it("corpo curto + index_status=index -> noindex nos dois lados", () => {
    const input = article({ bodyChars: 40, indexStatus: "index" });
    const admin = evaluateArticlePublicReadiness(input);
    const web = evaluateArticleIndexability({
      indexStatus: "index",
      bodySufficient: webIsSufficientBody("x".repeat(40)),
      reviewStatusOk: true,
    });
    expect(admin.canIndex).toBe(false);
    expect(web.decision).not.toBe("index");
  });
});
