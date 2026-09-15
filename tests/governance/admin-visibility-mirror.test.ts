/**
 * Teste de governanca — a FICHA do painel da o MESMO veredito que a pagina.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE TESTE IMPEDE
 * ============================================================================
 * A ficha de diagnostico diz, linha a linha, se uma nota, um video, as imagens e
 * o Cinerie Score aparecem na pagina — e POR QUE nao. Os portoes de verdade vivem
 * em `apps/web` e so devolvem o veredito; o painel reconstroi os motivos em
 * `apps/admin/src/lib/ops/visibility.ts`. Se a reconstrucao divergir, a ficha
 * afirma "aparece" para o que a pagina esconde — exatamente o numero que o painel
 * existe para nao mostrar.
 *
 * O espelho e por COMPORTAMENTO: a mesma linha passa pelos dois, variando uma
 * condicao por vez, e os vereditos tem de ser iguais.
 */

import { describe, expect, it } from "vitest";

import { MINIMUM_COUNTED_SOURCES, rebuildCountedSources, resolveSourceGroup } from "@screena/cinerie-score";
import { RATING_SOURCES, RATING_STALE_POLICY } from "@screena/config";
import { authorizeImageDisplay } from "@screena/public-contracts";

import {
  explainCinerieScore,
  explainImageSource,
  explainRatingRow,
  explainTrailerRow,
  MINIMUM_SCORE_SOURCES,
  parseExplanationSources,
  SCORE_SOURCE_LABELS,
  type RatingRowFacts,
} from "../../apps/admin/src/lib/ops/visibility";
import { decideCinerieScore } from "../../apps/web/src/lib/cinerie-score-presenter";
import { parseScoreExplanation } from "../../apps/web/src/lib/score-explanation";
import { isDisplayableTrailerRow, type TrailerRow } from "../../apps/web/src/lib/trailer-presenter";
import { toPublicRating, type RatingRow } from "../../apps/web/src/server/entity-ratings";

const HORA = 60 * 60 * 1000;
const AGORA = new Date("2026-09-15T12:00:00.000Z");

function base(): RatingRowFacts {
  return {
    ratingSource: "imdb",
    rowDisplayAllowed: true,
    scoreType: "audience",
    ratingValue: 8.1,
    fetchedAt: new Date(AGORA.getTime() - HORA),
    requiresAttribution: true,
    attributionText: "Nota via IMDb",
    requiresLinkback: true,
    attributionUrl: "https://www.imdb.com/title/tt0000001/",
    decision: {
      useCase: "rating_display",
      isCurrent: true,
      stage: "approved_for_display",
      displayAllowed: true,
      territory: null,
      validFrom: new Date(AGORA.getTime() - 24 * HORA),
      validUntil: null,
    },
    license: {
      isCurrent: true,
      licenseStatus: "third_party",
      displayAllowed: true,
      scoreAllowed: true,
      contentType: "rating",
      ratingSourceKey: "imdb",
    },
  };
}

/** A pagina: a consulta so le `display_allowed = true`, e o projetor decide o resto. */
function paginaExibe(facts: RatingRowFacts): boolean {
  if (!facts.rowDisplayAllowed) return false;
  const row: RatingRow = {
    ratingSource: facts.ratingSource,
    ratingLabel: "rotulo",
    scoreType: facts.scoreType,
    ratingValue: facts.ratingValue,
    ratingScale: 10,
    ratingCount: 10,
    fetchedAt: facts.fetchedAt,
    attributionText: facts.attributionText,
    attributionUrl: facts.attributionUrl,
    requiresAttribution: facts.requiresAttribution,
    requiresLinkback: facts.requiresLinkback,
    dataUsageDecision:
      facts.decision === null || facts.license === null ? null : { ...facts.decision, sourceLicense: facts.license },
  };
  return toPublicRating(row, AGORA) !== null;
}

type Variacao = readonly [string, RatingRowFacts];

function com(nome: string, mudar: (facts: RatingRowFacts) => RatingRowFacts): Variacao {
  return [nome, mudar(base())];
}

const decisao = (facts: RatingRowFacts, patch: Partial<NonNullable<RatingRowFacts["decision"]>>): RatingRowFacts => ({
  ...facts,
  decision: { ...(facts.decision as NonNullable<RatingRowFacts["decision"]>), ...patch },
});
const licenca = (facts: RatingRowFacts, patch: Partial<NonNullable<RatingRowFacts["license"]>>): RatingRowFacts => ({
  ...facts,
  license: { ...(facts.license as NonNullable<RatingRowFacts["license"]>), ...patch },
});

const VARIACOES: readonly Variacao[] = [
  com("referencia", (f) => f),
  com("linha com display_allowed false", (f) => ({ ...f, rowDisplayAllowed: false })),
  com("fonte fora da lista", (f) => ({ ...f, ratingSource: "fonte_inventada" })),
  com("sem decisao", (f) => ({ ...f, decision: null, license: null })),
  com("decisao de outro uso", (f) => decisao(f, { useCase: "cinerie_score_display" })),
  com("decisao nao vigente", (f) => decisao(f, { isCurrent: false })),
  com("decisao em outro estagio", (f) => decisao(f, { stage: "license_pending" })),
  com("decisao sem exibicao", (f) => decisao(f, { displayAllowed: false })),
  com("decisao que comeca amanha", (f) => decisao(f, { validFrom: new Date(AGORA.getTime() + HORA) })),
  com("decisao vencida ontem", (f) => decisao(f, { validUntil: new Date(AGORA.getTime() - HORA) })),
  com("decisao vence exatamente agora", (f) => decisao(f, { validUntil: AGORA })),
  com("territorio BR", (f) => decisao(f, { territory: "BR" })),
  com("territorio PT", (f) => decisao(f, { territory: "PT" })),
  com("licenca nao vigente", (f) => licenca(f, { isCurrent: false })),
  ...["official", "licensed", "third_party", "unknown", "blocked"].map((status) =>
    com(`licenca ${status}`, (f) => licenca(f, { licenseStatus: status })),
  ),
  com("licenca sem exibicao", (f) => licenca(f, { displayAllowed: false })),
  com("licenca sem score", (f) => licenca(f, { scoreAllowed: false })),
  com("licenca de imagem", (f) => licenca(f, { contentType: "image" })),
  com("licenca de outra fonte", (f) => licenca(f, { ratingSourceKey: "rotten_tomatoes" })),
  com("sem data de coleta", (f) => ({ ...f, fetchedAt: null })),
  com("coleta no futuro", (f) => ({ ...f, fetchedAt: new Date(AGORA.getTime() + 1) })),
  com("sem score_type", (f) => ({ ...f, scoreType: null })),
  com("sem valor", (f) => ({ ...f, ratingValue: null })),
  com("credito exigido e vazio", (f) => ({ ...f, attributionText: "   " })),
  com("credito exigido e nulo", (f) => ({ ...f, attributionText: null })),
  com("credito vazio mas nao exigido", (f) => ({ ...f, attributionText: "", requiresAttribution: false })),
  com("link exigido e vazio", (f) => ({ ...f, attributionUrl: "" })),
  com("link vazio mas nao exigido", (f) => ({ ...f, attributionUrl: null, requiresLinkback: false })),
  ...Object.entries(RATING_STALE_POLICY).flatMap(([fonte, politica]) => {
    const expira = politica.expireAfterHours * HORA;
    const daFonte = (f: RatingRowFacts): RatingRowFacts => licenca({ ...f, ratingSource: fonte }, { ratingSourceKey: fonte });
    return [
      com(`${fonte}: 1 ms antes de expirar`, (f) => ({ ...daFonte(f), fetchedAt: new Date(AGORA.getTime() - expira + 1) })),
      com(`${fonte}: exatamente na expiracao`, (f) => ({ ...daFonte(f), fetchedAt: new Date(AGORA.getTime() - expira) })),
    ];
  }),
  ...RATING_SOURCES.filter((fonte) => !Object.prototype.hasOwnProperty.call(RATING_STALE_POLICY, fonte)).map((fonte) =>
    com(`${fonte}: fonte sem politica de frescor`, (f) => licenca({ ...f, ratingSource: fonte }, { ratingSourceKey: fonte })),
  ),
];

describe("nota: ficha x pagina (toPublicRating + filtro da consulta)", () => {
  it.each(VARIACOES)("%s", (_nome, facts) => {
    const ficha = explainRatingRow(facts, AGORA);
    expect(ficha.visible).toBe(paginaExibe(facts));
    // Recusa sem motivo nomeado seria "nao aparece" sem "por que".
    expect(ficha.visible).toBe(ficha.refusals.length === 0);
  });

  it("CONTROLE POSITIVO: a referencia aparece nos dois", () => {
    expect(paginaExibe(base())).toBe(true);
    expect(explainRatingRow(base(), AGORA).visible).toBe(true);
  });
});

function video(patch: Partial<TrailerRow>): TrailerRow {
  return {
    site: "YouTube",
    videoKey: "dQw4w9WgXcQ",
    name: "Trailer oficial",
    videoType: "Trailer",
    official: true,
    languageCode: "pt",
    publishedAt: null,
    displayAllowed: true,
    licenseStatus: "licensed",
    ...patch,
  } as TrailerRow;
}

describe("trailer: ficha x isDisplayableTrailerRow", () => {
  const casos: ReadonlyArray<readonly [string, Partial<TrailerRow>]> = [
    ["referencia", {}],
    ["display_allowed false", { displayAllowed: false }],
    ["licenca unknown", { licenseStatus: "unknown" }],
    ["licenca blocked", { licenseStatus: "blocked" }],
    ["licenca official", { licenseStatus: "official" }],
    ["Vimeo", { site: "Vimeo" }],
    ["sem tipo", { videoType: null }],
    ["Clip", { videoType: "Clip" }],
    ["Teaser", { videoType: "Teaser" }],
    ["chave curta", { videoKey: "abc" }],
    ["chave com 12 caracteres", { videoKey: "dQw4w9WgXcQQ" }],
    ["chave com espaco", { videoKey: "dQw4w9WgXc " }],
  ];
  it.each(casos)("%s", (_nome, patch) => {
    const row = video(patch);
    const ficha = explainTrailerRow({
      displayAllowed: row.displayAllowed,
      licenseStatus: row.licenseStatus,
      site: row.site,
      videoType: row.videoType,
      videoKey: row.videoKey,
    });
    expect(ficha.visible).toBe(isDisplayableTrailerRow(row));
  });
});

describe("imagens: ficha x authorizeImageDisplay", () => {
  it("sem licenca vigente: negado nos dois", () => {
    expect(authorizeImageDisplay([]).authorized).toBe(false);
    expect(explainImageSource(null).authorized).toBe(false);
  });

  it.each(
    ["official", "licensed", "third_party", "unknown", "blocked"].flatMap((status) =>
      [true, false].map((displayAllowed) => [status, displayAllowed] as const),
    ),
  )("licenca %s, display_allowed %s", (licenseStatus, displayAllowed) => {
    const pagina = authorizeImageDisplay([{ sourceKey: "tmdb", contentType: "image", licenseStatus, displayAllowed, isCurrent: true }]);
    expect(explainImageSource({ licenseStatus, displayAllowed }).authorized).toBe(pagina.authorized);
  });
});

describe("Cinerie Score: ficha x decideCinerieScore (com a leitura da ficha da pagina)", () => {
  const entrada = (source: string) => ({ source, normalized: 70, weight: 1 });
  const explicacoes: ReadonlyArray<readonly [string, unknown]> = [
    ["vazia", []],
    ["uma fonte", [entrada("imdb")]],
    ["duas fontes", [entrada("imdb"), entrada("tmdb")]],
    ["tres fontes", [entrada("imdb"), entrada("rotten_tomatoes"), entrada("metacritic")]],
    ["fonte fora da formula + uma valida", [entrada("letterboxd"), entrada("imdb")]],
    ["entrada malformada", [{ source: "imdb" }, entrada("tmdb")]],
    ["nao e lista", { imdb: 7 }],
  ];

  const casos = [true, false].flatMap((authorized) =>
    [null, 71.4].flatMap((value) => explicacoes.map(([nome, explanation]) => [`${authorized ? "autorizado" : "sem decisao"}, valor ${String(value)}, ${nome}`, authorized, value, explanation] as const)),
  );

  it.each(casos)("%s", (_nome, authorized, value, explanation) => {
    // A pagina (entity-hero.ts): sem decisao ou sem valor, `counted` e vazio.
    const pagina = decideCinerieScore(
      !authorized
        ? { authorized: false, value: null, counted: [] }
        : value === null
          ? { authorized: true, value: null, counted: [] }
          : { authorized: true, value, counted: rebuildCountedSources(parseScoreExplanation(explanation)) },
    );
    const ficha = explainCinerieScore({ authorized, value, explanationSources: parseExplanationSources(explanation) });
    expect(ficha.rendered).toBe(pagina.rendered);
    if (!ficha.rendered && !pagina.rendered) expect(ficha.reason).toBe(pagina.reason);
  });

  it("o minimo de fontes e os nomes sao os da formula", () => {
    expect(MINIMUM_SCORE_SOURCES).toBe(MINIMUM_COUNTED_SOURCES);
    for (const fonte of ["imdb", "tmdb", "rotten_tomatoes", "metacritic", "letterboxd", "filmaffinity"]) {
      expect(SCORE_SOURCE_LABELS[fonte] !== undefined, fonte).toBe(resolveSourceGroup(fonte) !== null);
    }
  });
});
