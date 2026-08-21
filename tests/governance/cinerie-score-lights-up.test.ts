/**
 * cinerie-score-lights-up.test.ts — O SCORE ACENDE? A cadeia inteira, medida.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Havia uma leitura corrente do plano do `legal sources review` que dizia:
 *
 *   "so o `imdb` tem `cinerie_score_display` com `derivative=true`;
 *    `rotten_tomatoes` e `metacritic` so tem `rating_display` com
 *    `derivative=false`; as licencas do `tmdb` tem `score=false`. Logo UMA fonte
 *    e contada, o piso de duas nunca e alcancado e o Score nao renderiza."
 *
 * A PRIMEIRA METADE E VERDADE — e este arquivo a verifica contra o spec real, em
 * vez de contra uma fixture. A CONCLUSAO NAO SEGUE, e a diferenca importa porque
 * a "correcao" que ela sugere (emitir `cinerie_score_display` tambem para
 * `rotten_tomatoes` e `metacritic`) QUEBRARIA o calculo. Ver o ultimo bloco.
 *
 * O que decide quais fontes sao CONTADAS nao e a decisao por licenca de nota. E:
 *
 *   1. UMA decisao vigente de `cinerie_score_display` autoriza DERIVAR
 *      (`derivative_allowed`), e ela e emitida sob a licenca-ancora (imdb);
 *   2. cada NOTA entra se estiver `display_allowed = true` e tiver
 *      `data_usage_decision_id` — a decisao dela, qualquer que seja;
 *   3. o TMDB entra pelo sinal da propria linha do titulo
 *      (`vote_average_tmdb`), sob a decisao `internal_analytics` do TMDB.
 *
 * `score_allowed` da licenca do TMDB nao participa de (3): ele governa exibir o
 * NUMERO do TMDB como nota editorial avulsa — que as invariantes 1 e 2 proibem
 * de qualquer jeito (`vote_average_tmdb` e "dado tecnico TMDB; NUNCA nota
 * editorial", nas palavras do proprio schema).
 */

import { describe, expect, it } from 'vitest'

import {
  CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY,
  CINERIE_SCORE_DECISION_POLICY,
} from '@screena/config'
import {
  computeCinerieScore,
  MINIMUM_COUNTED_SOURCES,
  PRODUCTION_FORMULA_REGISTRY,
  type CinerieScoreDecisionInput,
  type CinerieScoreExplanationEntry,
  type CountedSource,
} from '@screena/cinerie-score'
import { STATIC_AUTHORIZATION } from '@screena/legal'

import {
  buildEntityInputs,
  projectScoreDecision,
  type DisplayableRatingRow,
  type ScoreDecisionRow,
} from '../../services/ratings/src/score/compute-run.js'
import { decideCinerieScore } from '../../apps/web/src/lib/cinerie-score-presenter'

const NOW = new Date('2026-09-01T12:00:00.000Z')

/** A entrada do spec para uma fonte de nota. */
function entryFor(sourceKey: string, contentType: string) {
  return STATIC_AUTHORIZATION.find(
    (entry) => entry.license.sourceKey === sourceKey && entry.license.contentType === contentType,
  )
}

/**
 * A linha de decisao que o `legal sources apply` GRAVARIA, derivada do spec.
 *
 * Nao e uma fixture escrita a mao: sai da entrada de `cinerie_score_display` do
 * proprio `STATIC_AUTHORIZATION`. Se alguem mudar o spec, este teste muda junto.
 */
function scoreDecisionRowFromSpec(): ScoreDecisionRow {
  const imdb = entryFor('imdb', 'rating')
  expect(imdb, 'o spec precisa ter a licenca de rating do imdb').toBeDefined()
  const decision = imdb!.decisions.find((d) => d.useCase === 'cinerie_score_display')
  expect(decision, 'o spec precisa emitir cinerie_score_display sob a licenca-ancora').toBeDefined()

  return {
    id: 'decision-score',
    useCase: decision!.useCase,
    stage: decision!.stage,
    displayAllowed: decision!.displayAllowed,
    derivativeAllowed: decision!.derivativeAllowed,
    isCurrent: true,
    validFrom: new Date('2026-08-20T00:00:00.000Z'),
    validUntil: null,
    policyVersion: decision!.policyVersion,
  }
}

/** Uma nota exibivel, como ela chega de `external_ratings`. */
function ratingRow(
  ratingSource: string,
  ratingValue: number,
  ratingScale: number,
  scoreType: 'critics' | 'audience',
): DisplayableRatingRow {
  return {
    entityId: '1',
    ratingSource,
    ratingValue,
    ratingScale,
    ratingCount: null,
    scoreType,
    // O `apply` do registro legal e quem preenche este id, via o gate de
    // exibicao. Qualquer decisao serve: o que a nota precisa provar aqui e que
    // ALGUEM autorizou o uso dela.
    dataUsageDecisionId: `decision-${ratingSource}`,
  }
}

/**
 * O grupo de cada fonte, para converter a EXPLICACAO persistida em
 * `CountedSource`.
 *
 * ESTE MAPA E UM ACHADO, NAO UM UTILITARIO. `CinerieScoreExplanationEntry` — o
 * que a formula devolve e o que vai para `cinerie_score_calculations.explanation`
 * — carrega `source`, `normalized` e `weight`, mas **nao** `group`. O presenter
 * pede `CountedSource`, que EXIGE `group`. Ou seja: quem for ligar o Score numa
 * pagina vai ter de reconstruir o grupo, e este mapa e a reconstrucao — as mesmas
 * quatro fontes da formula, nada inferido.
 *
 * Na pratica `decideCinerieScore` so le `source`, entao o grupo nao muda o
 * veredito hoje. Mas o tipo o exige, e um `as never` aqui esconderia a lacuna em
 * vez de registra-la.
 */
const GROUP_BY_SOURCE: Readonly<Record<string, 'critics' | 'audience'>> = {
  imdb: 'audience',
  tmdb: 'audience',
  rotten_tomatoes: 'critics',
  metacritic: 'critics',
}

function asCountedSources(
  explanation: readonly CinerieScoreExplanationEntry[],
): readonly CountedSource[] {
  return explanation.map((entry) => ({
    ...entry,
    group: GROUP_BY_SOURCE[entry.source] ?? 'audience',
  }))
}

/** Roda a cadeia inteira e devolve a decisao de TELA. */
function renderScore(
  ratings: readonly DisplayableRatingRow[],
  tmdb: { voteAverageTmdb: number | null; voteCountTmdb: number | null } | null,
) {
  const decision = projectScoreDecision([scoreDecisionRowFromSpec()])
  expect(decision).not.toBeNull()

  const { inputs } = buildEntityInputs(
    ratings,
    tmdb === null ? [] : [{ entityId: '1', ...tmdb }],
    'decision-tmdb-internal',
  )
  const outcome = computeCinerieScore(
    { entityId: '1', ratings: inputs[0]?.ratings ?? [] },
    { registry: PRODUCTION_FORMULA_REGISTRY, decision: decision as CinerieScoreDecisionInput, now: NOW },
  )
  if (outcome.status !== 'calculated') {
    return { outcome, view: decideCinerieScore({ authorized: true, value: null, counted: [] }) }
  }
  return {
    outcome,
    view: decideCinerieScore({
      authorized: true,
      value: outcome.result.value,
      counted: asCountedSources(outcome.result.explanation),
    }),
  }
}

// ---------------------------------------------------------------------------

describe('a leitura do plano: o que o spec DE FATO emite', () => {
  it('so o imdb carrega a decisao cinerie_score_display (a metade verdadeira da leitura)', () => {
    const comScore = STATIC_AUTHORIZATION.filter((entry) =>
      entry.decisions.some((d) => d.useCase === 'cinerie_score_display'),
    ).map((entry) => entry.license.sourceKey)
    expect(comScore).toEqual(['imdb'])
  })

  it('rotten_tomatoes e metacritic tem rating_display com derivative=false', () => {
    for (const source of ['rotten_tomatoes', 'metacritic']) {
      const entry = entryFor(source, 'rating')!
      const display = entry.decisions.find((d) => d.useCase === 'rating_display')
      expect(display, source).toBeDefined()
      expect(display!.derivativeAllowed, source).toBe(false)
      expect(entry.decisions.some((d) => d.useCase === 'cinerie_score_display'), source).toBe(false)
    }
  })

  it('as tres licencas do tmdb tem score_allowed=false', () => {
    const tmdb = STATIC_AUTHORIZATION.filter((entry) => entry.license.sourceKey === 'tmdb')
    expect(tmdb).toHaveLength(3)
    expect(tmdb.every((entry) => entry.license.scoreAllowed === false)).toBe(true)
  })

  it('a decisao aponta para uma formula REGISTRADA neste build', () => {
    const row = scoreDecisionRowFromSpec()
    expect(row.policyVersion).toBe(CINERIE_SCORE_DECISION_POLICY)
    const formula = CINERIE_SCORE_APPROVED_FORMULA_BY_DECISION_POLICY[row.policyVersion!]
    expect(formula).toBeDefined()
    expect(PRODUCTION_FORMULA_REGISTRY.get(formula!)).not.toBeNull()
  })
})

describe('ACENDE: IMDb + Rotten Tomatoes + Metacritic', () => {
  const RATINGS = [
    ratingRow('imdb', 8.4, 10, 'audience'),
    ratingRow('rotten_tomatoes', 92, 100, 'critics'),
    ratingRow('metacritic', 78, 100, 'critics'),
  ]

  it('renderiza', () => {
    const { view } = renderScore(RATINGS, null)
    expect(view.rendered).toBe(true)
  })

  it('conta as TRES fontes e as nomeia na linha de composicao', () => {
    const { view } = renderScore(RATINGS, null)
    expect(view.rendered).toBe(true)
    if (!view.rendered) return
    expect([...view.view.sources].sort()).toEqual(['imdb', 'metacritic', 'rotten_tomatoes'])
    expect(view.view.compositionLine).toContain('Composto de 3 fontes')
    expect(view.view.compositionLine).toContain('Rotten Tomatoes')
    expect(view.view.compositionLine).toContain('Metacritic')
  })

  it('o numero e inteiro, 0-100, e sai da formula aprovada', () => {
    const { outcome, view } = renderScore(RATINGS, null)
    expect(outcome.status).toBe('calculated')
    if (outcome.status !== 'calculated' || !view.rendered) return
    expect(outcome.result.version).toBe('cinerie-score/2026-08-v1')
    expect(Number.isInteger(view.view.value)).toBe(true)
    expect(view.view.value).toBeGreaterThanOrEqual(0)
    expect(view.view.value).toBeLessThanOrEqual(100)
  })
})

describe('NAO ACENDE: so o IMDb', () => {
  it('uma fonte nao compoe — piso de duas', () => {
    const { view } = renderScore([ratingRow('imdb', 8.4, 10, 'audience')], null)
    expect(view.rendered).toBe(false)
    if (view.rendered) return
    expect(view.reason).toBe('single_source_insufficient')
  })

  it('o piso lido do modulo, nao um literal — muda a regra, muda o teste', () => {
    expect(MINIMUM_COUNTED_SOURCES).toBe(2)
  })
})

describe('o TMDB entra no grupo de PUBLICO mesmo com score_allowed=false', () => {
  it('IMDb + TMDB alcancam o piso — a licenca de score do TMDB nao participa', () => {
    const { view } = renderScore([ratingRow('imdb', 8.4, 10, 'audience')], {
      voteAverageTmdb: 7.2,
      // Acima do piso de 50 votos da formula; abaixo dele o TMDB nao contaria.
      voteCountTmdb: 5000,
    })
    expect(view.rendered).toBe(true)
    if (!view.rendered) return
    expect([...view.view.sources].sort()).toEqual(['imdb', 'tmdb'])
  })

  it('CONTROLE NEGATIVO: sem a decisao internal_analytics do TMDB, ele NAO entra', () => {
    const { inputs, skipped } = buildEntityInputs(
      [ratingRow('imdb', 8.4, 10, 'audience')],
      [{ entityId: '1', voteAverageTmdb: 7.2, voteCountTmdb: 5000 }],
      // `null` = nao ha decisao vigente do TMDB.
      null,
    )
    expect(inputs[0]!.ratings.map((r) => r.source)).toEqual(['imdb'])
    // E a recusa e NOMEADA, nunca um descarte mudo.
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.reason).toContain('internal_analytics')
  })

  it('abaixo do piso de votos o TMDB nao conta, e o Score volta a nao acender', () => {
    const { view } = renderScore([ratingRow('imdb', 8.4, 10, 'audience')], {
      voteAverageTmdb: 7.2,
      voteCountTmdb: 10,
    })
    expect(view.rendered).toBe(false)
  })
})

describe('POR QUE NAO emitir cinerie_score_display para rotten_tomatoes e metacritic', () => {
  it('DUAS decisoes vigentes do mesmo use_case DERRUBAM o calculo — nao o melhoram', () => {
    const base = scoreDecisionRowFromSpec()
    // Exatamente o que a "correcao" proposta produziria no banco: a mesma
    // decisao emitida sob TRES licencas de nota, todas vigentes.
    const tres: ScoreDecisionRow[] = [
      base,
      { ...base, id: 'decision-score-rt' },
      { ...base, id: 'decision-score-mc' },
    ]
    expect(() => projectScoreDecision(tres)).toThrowError(/ambiguidade de registro/)
  })

  it('com UMA decisao, o mesmo conjunto de notas calcula normalmente', () => {
    // O controle que separa "duas quebram" de "qualquer coisa quebra".
    expect(() => projectScoreDecision([scoreDecisionRowFromSpec()])).not.toThrow()
  })

  it('a nota entra pelo id de decisao DELA, nao por uma decisao de score propria', () => {
    const { inputs } = buildEntityInputs(
      [
        ratingRow('rotten_tomatoes', 92, 100, 'critics'),
        ratingRow('metacritic', 78, 100, 'critics'),
      ],
      [],
      null,
    )
    // As duas entram carregando `decision-<fonte>` — a decisao `rating_display`
    // delas. Nenhuma precisou de `cinerie_score_display` propria.
    expect(inputs[0]!.ratings.map((r) => r.licenseDecisionId).sort()).toEqual([
      'decision-metacritic',
      'decision-rotten_tomatoes',
    ])
  })

  it('nota SEM decisao nenhuma e recusada, nomeadamente', () => {
    const semDecisao: DisplayableRatingRow = {
      ...ratingRow('metacritic', 78, 100, 'critics'),
      dataUsageDecisionId: null,
    }
    const { inputs, skipped } = buildEntityInputs([semDecisao], [], null)
    expect(inputs).toEqual([])
    expect(skipped[0]!.reason).toContain('sem data_usage_decision_id')
  })
})
