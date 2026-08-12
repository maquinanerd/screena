/**
 * display-gate.test.ts — O gate de EXIBICAO aplicado as notas que a OMDb produz.
 *
 * Este e o teste que responde a pergunta que travou a implementacao: **com a
 * OMDb, quais fontes acendem?**
 *
 * Ele nao usa credito inventado. Ele LE a licenca de
 * `services/legal/src/authorization-spec.ts` — a mesma que o registry aplica no
 * banco — e a passa para `resolveDisplayAllowed`, a mesma politica pura que o
 * adapter de escrita chama. Se alguem mudar a licenca, este teste muda de
 * resultado; e esse o ponto.
 *
 * O que fica provado:
 *  1. IMDb acende COM linkback (a URL sai do `imdbID` do payload);
 *  2. Rotten Tomatoes e Metacritic acendem SEM link, so com credito textual —
 *     a dispensa nominal decidida em 2026-08-12;
 *  3. o IMDb NAO herda a dispensa: sem URL, ele nao acende;
 *  4. REVERSAO AUTOMATICA: se um dia RT/MC ganharem URL, elas passam a exibir
 *     COM link sem nova decisao humana e sem tocar no spec.
 */

import { OMDB_PROVIDER_API } from '@screena/omdb-client'
import { resolveDisplayAllowed, type SourceCredit } from '@screena/schemas'
import { STATIC_AUTHORIZATION } from '@screena/legal'
import { describe, expect, it } from 'vitest'

import { mapOmdbPayload } from '../mapping.js'
import type { RatingDraft } from '../types.js'
import { assertFixtureIntact, OMDB_GUARDIANS_PAYLOAD } from './fixture.js'

/** Id ficticio de decisao de uso vigente (o registry cria a real no banco). */
const USAGE_DECISION_ID = '1'

/**
 * Monta o `SourceCredit` como o adapter de escrita monta em producao: os campos
 * de licenca vem do spec; o `attributionUrl` vem da LINHA (`rating_url`), porque
 * o linkback de uma nota e a URL daquela nota na fonte.
 */
function creditFor(ratingSource: string, ratingUrl: string | null): SourceCredit {
  const entry = STATIC_AUTHORIZATION.find(
    (candidate) =>
      candidate.license.contentType === 'rating' &&
      candidate.license.ratingSourceKey === ratingSource,
  )
  if (entry === undefined) {
    throw new Error(`sem licenca declarada para "${ratingSource}" no authorization-spec`)
  }
  const license = entry.license
  return {
    licenseStatus: license.licenseStatus,
    licenseDisplayAllowed: license.displayAllowed,
    licenseScoreAllowed: license.scoreAllowed,
    requiresAttribution: license.requiresAttribution,
    requiresLinkback: license.requiresLinkback,
    attributionText: license.attributionText,
    attributionUrl: ratingUrl,
    usageDecisionId: USAGE_DECISION_ID,
  }
}

/** Roda a politica exatamente como `applyDisplayDecision` faz. */
function resolveFor(draft: RatingDraft, ratingUrl: string | null = draft.ratingUrl) {
  return resolveDisplayAllowed(
    {
      sourceKey: draft.ratingSource,
      // Exibir uma NOTA e exibir o numero: a licenca precisa de `score_allowed`.
      needsScorePermission: true,
      classified: draft.scoreType !== null,
    },
    creditFor(draft.ratingSource, ratingUrl),
  )
}

function drafts(): ReadonlyMap<string, RatingDraft> {
  assertFixtureIntact(OMDB_GUARDIANS_PAYLOAD)
  const mapping = mapOmdbPayload(OMDB_GUARDIANS_PAYLOAD, OMDB_PROVIDER_API)
  return new Map(mapping.ratings.map((rating) => [rating.ratingSource, rating]))
}

describe('gate de exibicao com a licenca vigente da OMDb', () => {
  it('IMDb ACENDE — tem linkback derivado do imdbID', () => {
    const imdb = drafts().get('imdb')!
    expect(imdb.ratingUrl).toBe('https://www.imdb.com/title/tt3896198/')

    const decision = resolveFor(imdb)
    expect(decision.displayAllowed).toBe(true)
    expect(decision.reason).toBeNull()
  })

  it('Rotten Tomatoes ACENDE sem link — credito textual apenas', () => {
    const rt = drafts().get('rotten_tomatoes')!
    expect(rt.ratingUrl).toBeNull()

    const decision = resolveFor(rt)
    expect(decision.displayAllowed).toBe(true)
    expect(decision.reason).toBeNull()
  })

  it('Metacritic ACENDE sem link — credito textual apenas', () => {
    const mc = drafts().get('metacritic')!
    expect(mc.ratingUrl).toBeNull()

    const decision = resolveFor(mc)
    expect(decision.displayAllowed).toBe(true)
    expect(decision.reason).toBeNull()
  })

  it('as tres fontes da OMDb acendem — nenhuma cai em missing-linkback', () => {
    for (const [source, draft] of drafts()) {
      const decision = resolveFor(draft)
      expect(decision.reason, `fonte ${source}`).not.toBe('missing-linkback')
      expect(decision.displayAllowed, `fonte ${source}`).toBe(true)
    }
  })

  it('o credito TEXTUAL nunca e dispensado: some o texto, some a nota', () => {
    // A dispensa foi de LINKBACK, nao de atribuicao. Uma licenca sem
    // `attribution_text` continua barrando as tres.
    for (const [source, draft] of drafts()) {
      const credit = { ...creditFor(source, draft.ratingUrl), attributionText: '   ' }
      const decision = resolveDisplayAllowed(
        { sourceKey: source, needsScorePermission: true, classified: draft.scoreType !== null },
        credit,
      )
      expect(decision.displayAllowed, `fonte ${source}`).toBe(false)
      expect(decision.reason, `fonte ${source}`).toBe('missing-attribution')
    }
  })
})

describe('a dispensa e NOMINAL — o IMDb nao a herda', () => {
  it('IMDb SEM url NAO acende: para ele o linkback continua obrigatorio', () => {
    const imdb = drafts().get('imdb')!
    const decision = resolveFor(imdb, null)

    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('missing-linkback')
  })

  it('a licenca do IMDb declara requiresLinkback=true; a de RT/MC, false', () => {
    const linkbackOf = (source: string): boolean =>
      STATIC_AUTHORIZATION.find(
        (e) => e.license.contentType === 'rating' && e.license.ratingSourceKey === source,
      )!.license.requiresLinkback

    expect(linkbackOf('imdb')).toBe(true)
    expect(linkbackOf('rotten_tomatoes')).toBe(false)
    expect(linkbackOf('metacritic')).toBe(false)
    // Nao servidas pela OMDb: intocadas, seguem exigindo linkback.
    expect(linkbackOf('letterboxd')).toBe(true)
    expect(linkbackOf('filmaffinity')).toBe(true)
  })
})

describe('reversao automatica: se surgir resolvedor de URL, o link volta sozinho', () => {
  it('Rotten Tomatoes COM url continua acendendo — agora com link', () => {
    const rt = drafts().get('rotten_tomatoes')!
    const decision = resolveFor(rt, 'https://www.rottentomatoes.com/m/exemplo')

    expect(decision.displayAllowed).toBe(true)
    expect(decision.reason).toBeNull()
    // `requiresLinkback: false` significa "nao EXIGE link", nunca "nao PODE ter".
  })

  it('Metacritic COM url continua acendendo — agora com link', () => {
    const mc = drafts().get('metacritic')!
    const decision = resolveFor(mc, 'https://www.metacritic.com/movie/exemplo')

    expect(decision.displayAllowed).toBe(true)
    expect(decision.reason).toBeNull()
  })

  it('mas um link RUIM nao passa: a checagem de HTTPS continua valendo', () => {
    const rt = drafts().get('rotten_tomatoes')!
    const decision = resolveFor(rt, 'http://www.rottentomatoes.com/m/exemplo')

    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('unsafe-attribution-url')
  })
})

describe('o resto do gate continua fail-closed', () => {
  it('sem licenca resolvida, nada acende', () => {
    const imdb = drafts().get('imdb')!
    const decision = resolveDisplayAllowed(
      { sourceKey: 'imdb', needsScorePermission: true, classified: true },
      null,
    )
    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('no-license')
    expect(imdb.scoreType).not.toBeNull()
  })

  it('nota nao classificada nao acende, mesmo com licenca e credito completos', () => {
    const decision = resolveDisplayAllowed(
      { sourceKey: 'rotten_tomatoes', needsScorePermission: true, classified: false },
      creditFor('rotten_tomatoes', null),
    )
    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('unclassified')
  })

  it('sem decisao de uso vigente, nada acende', () => {
    const decision = resolveDisplayAllowed(
      { sourceKey: 'metacritic', needsScorePermission: true, classified: true },
      { ...creditFor('metacritic', null), usageDecisionId: null },
    )
    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('no-usage-decision')
  })

  it('licenca sem score_allowed nao exibe o numero', () => {
    const decision = resolveDisplayAllowed(
      { sourceKey: 'imdb', needsScorePermission: true, classified: true },
      { ...creditFor('imdb', 'https://www.imdb.com/title/tt3896198/'), licenseScoreAllowed: false },
    )
    expect(decision.displayAllowed).toBe(false)
    expect(decision.reason).toBe('license-forbids-score')
  })
})
