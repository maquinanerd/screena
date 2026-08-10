/**
 * hero-link.test.ts — a decisao de "esta foto vira a capa desta materia".
 *
 * Como em `media-intake.test.ts`, a maior parte destes casos mede RECUSA. A
 * rota escreve num artigo, e o artigo e o objeto mais sensivel do CMS: cada
 * recusa aqui e um caminho pelo qual a automacao NAO alcanca uma decisao que
 * nao e dela.
 */

import { describe, expect, it } from 'vitest'

import {
  HERO_LINK_WITHDRAWN_WORKFLOW_STATUSES,
  MAX_HERO_LINK_REQUEST_BYTES,
  decideHeroLink,
  intakeHeroLink,
  type HeroLinkArticleFacts,
  type HeroLinkMediaFacts,
} from '../hero-link.js'

const AUTHORIZED = { authenticated: true, hasMediaIngestScope: true } as const

function intake(overrides: {
  auth?: { authenticated: boolean; hasMediaIngestScope: boolean }
  rawBodyBytes?: number
  mediaIdParam?: unknown
  body?: unknown
}) {
  return intakeHeroLink({
    auth: overrides.auth ?? AUTHORIZED,
    rawBodyBytes: overrides.rawBodyBytes ?? 32,
    mediaIdParam: 'mediaIdParam' in overrides ? overrides.mediaIdParam : '14',
    body: 'body' in overrides ? overrides.body : { articleId: '19' },
  })
}

/** Foto ingerida por maquina PARA a materia 19, aprovada e liberada para capa. */
function media(overrides: Partial<HeroLinkMediaFacts> = {}): HeroLinkMediaFacts {
  return {
    exists: true,
    ingestedForArticleId: '19',
    licenseApproved: true,
    allowedForHero: true,
    ...overrides,
  }
}

/** Materia 19, de origem automacao, em `needs_review`, ainda sem capa. */
function article(overrides: Partial<HeroLinkArticleFacts> = {}): HeroLinkArticleFacts {
  return {
    exists: true,
    // `needs_review` de proposito, e nao `automation_draft`: e onde a materia
    // REALMENTE esta quando o emissor recebe o `articleId` e chama esta rota.
    workflowStatus: 'needs_review',
    automationOrigin: true,
    currentHeroMediaId: null,
    currentHeroIngestedForArticleId: null,
    ...overrides,
  }
}

function decide(
  mediaOverrides: Partial<HeroLinkMediaFacts> = {},
  articleOverrides: Partial<HeroLinkArticleFacts> = {},
) {
  return decideHeroLink({
    command: { mediaId: '14', articleId: '19' },
    media: media(mediaOverrides),
    article: article(articleOverrides),
  })
}

/* ------------------------------------------------------------------ */
/* Identidade e forma                                                  */
/* ------------------------------------------------------------------ */

describe('identidade: escopo proprio, e o mesmo da ingestao de bytes', () => {
  it('sem credencial: 401', () => {
    const result = intake({ auth: { authenticated: false, hasMediaIngestScope: false } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection).toMatchObject({ code: 'unauthenticated', status: 401 })
  })

  it('autenticado SEM editorial_media_ingest: 403 — e nao 401', () => {
    // Colapsar os dois faria alguem regerar uma chave que estava certa.
    const result = intake({ auth: { authenticated: true, hasMediaIngestScope: false } })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection).toMatchObject({ code: 'forbidden_scope', status: 403 })
  })

  it('a identidade e conferida ANTES da forma do corpo', () => {
    // Um corpo invalido nao pode revelar a quem nao tem escopo que a rota
    // existe e o que ela espera.
    const result = intake({
      auth: { authenticated: true, hasMediaIngestScope: false },
      body: 'nao e objeto',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('forbidden_scope')
  })
})

describe('forma: os dois ids sao ids do Payload', () => {
  it('caminho e corpo validos produzem o comando', () => {
    const result = intake({})
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.command).toEqual({ mediaId: '14', articleId: '19' })
  })

  it('corpo que nao e objeto JSON: 400', () => {
    for (const body of [null, 'texto', 42, ['14']]) {
      const result = intake({ body })
      expect(result.ok, JSON.stringify(body)).toBe(false)
      if (!result.ok) expect(result.rejection.code).toBe('invalid_json')
    }
  })

  it('id nao numerico, com zero a esquerda ou zero e recusado ANTES de consultar', () => {
    // `findByID` com lixo levanta erro de driver, e erro de driver carrega
    // detalhe de banco na resposta.
    for (const bad of ['abc', '0', '007', '1.5', '-3', '1e3', ' ']) {
      const byPath = intake({ mediaIdParam: bad })
      expect(byPath.ok, `path ${bad}`).toBe(false)
      const byBody = intake({ body: { articleId: bad } })
      expect(byBody.ok, `body ${bad}`).toBe(false)
    }
  })

  it('os dois campos faltando saem JUNTOS em issues[]', () => {
    const result = intake({ mediaIdParam: undefined, body: {} })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejection).toMatchObject({ code: 'validation_failed', status: 422 })
      expect(result.rejection.issues.join(' ')).toContain('mediaId ausente')
      expect(result.rejection.issues.join(' ')).toContain('articleId ausente')
    }
  })

  it('corpo acima do teto e recusado: 413', () => {
    const result = intake({ rawBodyBytes: MAX_HERO_LINK_REQUEST_BYTES + 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.status).toBe(413)
  })
})

/* ------------------------------------------------------------------ */
/* Decisao                                                             */
/* ------------------------------------------------------------------ */

describe('o caminho feliz', () => {
  it('materia sem capa recebe a capa', () => {
    expect(decide()).toEqual({ ok: true, outcome: 'linked' })
  })

  it('reenviar o MESMO pedido nao vira recusa nem escrita', () => {
    expect(decide({}, { currentHeroMediaId: '14', currentHeroIngestedForArticleId: '19' })).toEqual({
      ok: true,
      outcome: 'unchanged',
    })
  })

  it('trocar uma capa que a PROPRIA maquina pos e permitido', () => {
    // A fonte trocou a foto no mesmo endereco: a ingestao devolveu `replaced`
    // com um `mediaId` novo, e a capa precisa acompanhar.
    expect(decide({}, { currentHeroMediaId: '13', currentHeroIngestedForArticleId: '19' })).toEqual({
      ok: true,
      outcome: 'replaced',
    })
  })
})

describe('existencia', () => {
  it('midia inexistente: 404', () => {
    const result = decide({ exists: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection).toMatchObject({ code: 'media_not_found', status: 404 })
  })

  it('materia inexistente: 404', () => {
    const result = decide({}, { exists: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejection).toMatchObject({ code: 'article_not_found', status: 404 })
    }
  })
})

describe('pertencimento: a foto tem de ser DAQUELA materia', () => {
  it('foto ingerida para OUTRA materia e recusada', () => {
    // Sem esta guarda o `mediaId` seria escrita arbitraria: bastaria enumerar
    // ids para pendurar qualquer imagem do acervo em qualquer materia.
    const result = decide({ ingestedForArticleId: '77' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejection).toMatchObject({
        code: 'media_not_ingested_for_article',
        status: 409,
      })
      expect(result.rejection.issues.join(' ')).toContain('77')
    }
  })

  it('foto de humano (sem ingestao por maquina) e recusada', () => {
    const result = decide({ ingestedForArticleId: null })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('media_not_ingested_for_article')
  })
})

describe('licenca por finalidade (invariante 6)', () => {
  it('sem licenca editorial aprovada, nao vira capa', () => {
    const result = decide({ licenseApproved: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('media_not_hero_eligible')
  })

  it('sem allowedForHero, nao vira capa — mesmo com licenca editorial', () => {
    // Capa e a imagem que representa a materia em lista e compartilhamento: o
    // direito de uso costuma ser distinto do direito editorial.
    const result = decide({ allowedForHero: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('media_not_hero_eligible')
  })
})

describe('a rota e alcancavel pelo caminho REAL do emissor', () => {
  it('todo estado em que a materia realmente esta ao receber o articleId aceita a capa', () => {
    // ESTE CASO E O DEFEITO MEDIDO EM PRODUCAO (materia 23, midia 18).
    //
    // A versao anterior exigia `automation_draft`, mas
    // `editorial-publications.ts` cria a materia nesse estado e caminha ate
    // `needs_review` ou `published` na MESMA chamada, ANTES de a resposta com o
    // `articleId` sair. Nenhum destes estados existia quando o emissor podia
    // chamar a rota — e por isso ela recusava sempre, nos dois desfechos.
    for (const status of [
      'automation_draft',
      'needs_review',
      'draft',
      'in_review',
      'human_reviewed',
      'ready_to_publish',
      'published',
      'needs_update',
      null,
    ]) {
      const result = decide({}, { workflowStatus: status })
      expect(result, String(status)).toEqual({ ok: true, outcome: 'linked' })
    }
  })

  it('materia fora de circulacao continua recusada, com motivo proprio', () => {
    for (const status of HERO_LINK_WITHDRAWN_WORKFLOW_STATUSES) {
      const result = decide({}, { workflowStatus: status })
      expect(result.ok, status).toBe(false)
      if (!result.ok) {
        expect(result.rejection).toMatchObject({ code: 'article_withdrawn', status: 409 })
        expect(result.rejection.issues.join(' ')).toContain(status)
      }
    }
  })
})

describe('proveniencia da MATERIA: o gate que substituiu a trava de estado', () => {
  it('materia sem marca de automacao recusa a capa, em qualquer estado', () => {
    // O acervo e compartilhado. Sem esta recusa bastaria ingerir uma foto "para"
    // uma pauta escrita por gente para pendurar a capa nela.
    for (const status of ['draft', 'in_review', 'ready_to_publish', 'published']) {
      const result = decide({}, { automationOrigin: false, workflowStatus: status })
      expect(result.ok, status).toBe(false)
      if (!result.ok) {
        expect(result.rejection).toMatchObject({
          code: 'article_not_automation_origin',
          status: 409,
        })
      }
    }
  })

  it('a proveniencia e julgada ANTES do estado de circulacao', () => {
    // Materia humana arquivada: o emissor precisa saber que o problema e a
    // materia nao ser dele, e nao o arquivamento — corrigir o estado nao daria
    // acesso nenhum.
    const result = decide({}, { automationOrigin: false, workflowStatus: 'archived' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('article_not_automation_origin')
  })
})

describe('capa escolhida por gente nao e reescrita por robo', () => {
  it('capa cuja origem nao e a ingestao por maquina desta materia e preservada', () => {
    const result = decide({}, { currentHeroMediaId: '99', currentHeroIngestedForArticleId: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rejection).toMatchObject({
        code: 'hero_not_owned_by_automation',
        status: 409,
      })
    }
  })

  it('capa ingerida para OUTRA materia tambem nao e trocada por esta rota', () => {
    const result = decide({}, { currentHeroMediaId: '99', currentHeroIngestedForArticleId: '77' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('hero_not_owned_by_automation')
  })

  it('a idempotencia vem ANTES da proveniencia da capa atual', () => {
    // Se a ordem fosse inversa, reenviar o mesmo pedido depois de um humano
    // mexer em qualquer coisa viraria `409` para um pedido que nao pede nada.
    const result = decide(
      {},
      { currentHeroMediaId: '14', currentHeroIngestedForArticleId: null },
    )
    expect(result).toEqual({ ok: true, outcome: 'unchanged' })
  })
})

describe('a ordem das recusas aponta a causa mais corrigivel primeiro', () => {
  it('foto de outra materia EM materia humana acusa o pertencimento, nao a origem', () => {
    // O emissor que recebe "a materia nao e de automacao" sabe que o `mediaId`
    // estava certo. Inverter a ordem faria ele corrigir a coisa errada.
    const result = decide({ ingestedForArticleId: '77' }, { automationOrigin: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('media_not_ingested_for_article')
  })

  it('midia inexistente vence tudo', () => {
    const result = decide({ exists: false }, { exists: false, automationOrigin: false })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('media_not_found')
  })
})
