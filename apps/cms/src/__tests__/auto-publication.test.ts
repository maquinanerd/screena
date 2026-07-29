/**
 * auto-publication.test.ts — O gate que decide se uma automacao publica.
 *
 * Cada teste corresponde a uma forma concreta de a publicacao automatica dar
 * errado. A ORDEM dos desfechos e testada explicitamente: uma mensagem enganosa
 * ("meta ausente" para um pedido com revisao antiga) faz o produtor consertar a
 * coisa errada.
 */

import { describe, expect, it } from 'vitest'

import { canTransition } from '../workflow.js'

import { validPublicationRequest } from '@screena/editorial-contracts'

import {
  decideAutoPublication,
  outcomeHttpStatus,
  evaluateSchemaChoice,
  shouldRetry,
  validateSeoForPublication,
  type PublicationGateInput,
} from '../auto-publication.js'
import { SCHEMA_BY_CONTENT_TYPE } from '@screena/editorial-contracts'
import { authorizeAutomationAuthor, type AuthorAutomationFacts } from '../author-automation.js'
import {
  canonicalizeSlug,
  decideSlugChange,
  resolveSlugCollision,
  SLUG_LIMITS,
} from '../canonical-slug.js'
import {
  CONSERVATIVE_DAILY_LIMIT,
  DEFAULT_EDITORIAL_TIME_ZONE,
  describeAutoPublish,
  editorialDayWindowUtc,
  isValidIanaTimeZone,
  isWithinEditorialDay,
  resolveAutoPublishConfig,
} from '../env-auto-publish.js'

function gate(overrides: Partial<PublicationGateInput> = {}): PublicationGateInput {
  return {
    limits: { enabled: true, dailyLimit: 50, perAuthorLimit: 20 },
    usage: { publishedTodayGlobal: 0, publishedTodayByAuthor: 0 },
    authorAuthorization: { allowed: true },
    contractCompatible: true,
    qaPassed: true,
    qaBlockingErrors: [],
    qaWarnings: [],
    seo: validPublicationRequest.seo,
    body: { hasSteps: false, hasList: false, hasRating: false, blockCount: 2 },
    contentType: 'news',
    unauthorizedMediaCount: 0,
    staleRevision: false,
    idempotencyConflict: false,
    slugValid: true,
    authorChangeRequiresHuman: false,
    ...overrides,
  }
}

describe('desfecho da publicacao automatica', () => {
  it('CONTROLE POSITIVO: pedido completo PUBLICA', () => {
    // Sem ele, um gate que bloqueasse tudo passaria em todos os testes
    // negativos sem nunca publicar nada.
    const decision = decideAutoPublication(gate())
    expect(decision.outcome).toBe('PUBLISHED')
    expect(outcomeHttpStatus(decision.outcome)).toBe(201)
  })

  it('kill switch DESLIGADO roteia para revisao, nao bloqueia', () => {
    // Desligar a automacao e decisao operacional, nao defeito do pedido. Jogar
    // fora o conteudo seria perder trabalho valido.
    const decision = decideAutoPublication(gate({ limits: { enabled: false, dailyLimit: null, perAuthorLimit: null } }))
    expect(decision.outcome).toBe('ROUTED_TO_REVIEW')
    expect(decision.reasons[0]?.code).toBe('auto_publish_disabled')
    expect(outcomeHttpStatus(decision.outcome)).toBe(202)
  })

  it('QA reprovado roteia para revisao', () => {
    const decision = decideAutoPublication(
      gate({ qaPassed: false, qaBlockingErrors: ['fato sem fonte'] }),
    )
    expect(decision.outcome).toBe('ROUTED_TO_REVIEW')
    expect(decision.reasons[0]?.detail).toContain('fato sem fonte')
  })

  it('limite diario global e por autor roteiam para revisao', () => {
    expect(
      decideAutoPublication(
        gate({ usage: { publishedTodayGlobal: 50, publishedTodayByAuthor: 0 } }),
      ).reasons[0]?.code,
    ).toBe('daily_limit_reached')
    expect(
      decideAutoPublication(
        gate({ usage: { publishedTodayGlobal: 0, publishedTodayByAuthor: 20 } }),
      ).reasons[0]?.code,
    ).toBe('author_limit_reached')
  })

  it('contrato incompativel e CONFLICT, nao BLOCKED', () => {
    // O pedido pode estar perfeito: o que nao encaixa e a versao do schema.
    const decision = decideAutoPublication(gate({ contractCompatible: false }))
    expect(decision.outcome).toBe('CONFLICT')
    expect(outcomeHttpStatus(decision.outcome)).toBe(409)
  })

  it('revisao ANTIGA e CONFLICT — evento velho nao sobrescreve versao nova', () => {
    expect(decideAutoPublication(gate({ staleRevision: true })).outcome).toBe('CONFLICT')
  })

  it('idempotencyKey repetida com conteudo diferente e CONFLICT', () => {
    expect(decideAutoPublication(gate({ idempotencyConflict: true })).outcome).toBe('CONFLICT')
  })

  it('CONFLITO tem PRECEDENCIA sobre analise de conteudo', () => {
    // Dizer "meta ausente" para um pedido que chegou com revisao antiga faria o
    // produtor consertar a coisa errada.
    const decision = decideAutoPublication(
      gate({
        staleRevision: true,
        seo: { ...validPublicationRequest.seo, metaDescription: '' },
      }),
    )
    expect(decision.outcome).toBe('CONFLICT')
    expect(decision.reasons[0]?.code).toBe('stale_revision')
  })

  it('autor nao autorizado BLOQUEIA', () => {
    const decision = decideAutoPublication(
      gate({
        authorAuthorization: {
          allowed: false,
          code: 'automation_not_allowed',
          detail: 'autor nao aceita publicacao automatica',
        },
      }),
    )
    expect(decision.outcome).toBe('BLOCKED')
    expect(outcomeHttpStatus(decision.outcome)).toBe(422)
  })

  it('midia nao autorizada BLOQUEIA (invariante 6)', () => {
    expect(decideAutoPublication(gate({ unauthorizedMediaCount: 1 })).outcome).toBe('BLOCKED')
  })

  it('slug inderivavel BLOQUEIA', () => {
    expect(decideAutoPublication(gate({ slugValid: false })).outcome).toBe('BLOCKED')
  })

  it('TROCA DE AUTOR em materia publicada vai para revisao, nao CONFLICT', () => {
    // Pode ser um pedido editorial legitimo — so precisa de um humano. Tratar
    // como CONFLICT diria ao produtor que o pedido nao encaixa, quando ele
    // encaixa e apenas requer decisao.
    const decision = decideAutoPublication(gate({ authorChangeRequiresHuman: true }))
    expect(decision.outcome).toBe('ROUTED_TO_REVIEW')
    expect(decision.reasons.map((r) => r.code)).toContain('AUTHOR_CHANGE_REQUIRES_HUMAN')
    expect(outcomeHttpStatus(decision.outcome)).toBe(202)
  })

  it('mas um CONFLITO real ainda tem precedencia sobre a troca de autor', () => {
    const decision = decideAutoPublication(
      gate({ authorChangeRequiresHuman: true, staleRevision: true }),
    )
    expect(decision.outcome).toBe('CONFLICT')
  })

  it('e um BLOQUEIO real tambem vem antes', () => {
    // Se o conteudo nem pode ser aceito, discutir autoria e irrelevante.
    const decision = decideAutoPublication(
      gate({ authorChangeRequiresHuman: true, unauthorizedMediaCount: 1 }),
    )
    expect(decision.outcome).toBe('BLOCKED')
  })

  it('nenhum desfecho manda o produtor retentar cegamente', () => {
    // Reenviar igual repete o defeito; o que muda tem de mudar do lado dele.
    expect(shouldRetry()).toBe(false)
  })
})

describe('SEO: transporte x auto-publicacao', () => {
  const base = validPublicationRequest.seo

  it('CONTROLE POSITIVO: o SEO da fixture e elegivel', () => {
    const verdict = validateSeoForPublication({ ...base, metaDescription: 'x'.repeat(140) })
    expect(verdict.blocking).toEqual([])
    expect(verdict.review).toEqual([])
  })

  it('meta AUSENTE bloqueia', () => {
    expect(
      validateSeoForPublication({ ...base, metaDescription: '' }).blocking.map((r) => r.code),
    ).toContain('SEO_META_MISSING')
  })

  it('BORDAS do titulo', () => {
    const at = (length: number) =>
      validateSeoForPublication({ ...base, title: 'a'.repeat(length) })
    // 14 = fora do transporte; 15 = elegivel; 65 = elegivel; 66 = revisao;
    // 120 = revisao; 121 = fora do transporte.
    expect(at(14).blocking.map((r) => r.code)).toContain('SEO_TITLE_OUT_OF_TRANSPORT_RANGE')
    expect(at(15).blocking).toEqual([])
    expect(at(15).review).toEqual([])
    expect(at(65).review).toEqual([])
    expect(at(66).review.map((r) => r.code)).toContain('SEO_TITLE_OUTSIDE_AUTO_PUBLISH_RANGE')
    expect(at(120).review.map((r) => r.code)).toContain('SEO_TITLE_OUTSIDE_AUTO_PUBLISH_RANGE')
    expect(at(120).blocking).toEqual([])
    expect(at(121).blocking.map((r) => r.code)).toContain('SEO_TITLE_OUT_OF_TRANSPORT_RANGE')
  })

  it('BORDAS da meta description', () => {
    const at = (length: number) =>
      validateSeoForPublication({ ...base, metaDescription: 'a'.repeat(length) })
    expect(at(69).blocking.map((r) => r.code)).toContain('SEO_META_OUT_OF_TRANSPORT_RANGE')
    expect(at(70).review.map((r) => r.code)).toContain('SEO_META_TOO_SHORT_FOR_AUTO_PUBLISH')
    expect(at(119).review.map((r) => r.code)).toContain('SEO_META_TOO_SHORT_FOR_AUTO_PUBLISH')
    expect(at(120).review).toEqual([])
    expect(at(160).review).toEqual([])
    expect(at(161).review.map((r) => r.code)).toContain('SEO_META_TOO_LONG_FOR_AUTO_PUBLISH')
    expect(at(320).review.map((r) => r.code)).toContain('SEO_META_TOO_LONG_FOR_AUTO_PUBLISH')
    expect(at(320).blocking).toEqual([])
    expect(at(321).blocking.map((r) => r.code)).toContain('SEO_META_OUT_OF_TRANSPORT_RANGE')
  })

  it('faixa PREFERENCIAL da redacao avisa, nao impede', () => {
    // 120-139 e elegivel para auto-publicacao, mas fora do ideal editorial.
    const verdict = validateSeoForPublication({ ...base, metaDescription: 'a'.repeat(125) })
    expect(verdict.blocking).toEqual([])
    expect(verdict.review).toEqual([])
    expect(verdict.warnings.join(' ')).toContain('preferencial')
  })

  it('STUFFING bloqueia', () => {
    const verdict = validateSeoForPublication({
      ...base,
      title: 'data de estreia data de estreia data de estreia',
      metaDescription:
        'data de estreia data de estreia data de estreia data de estreia data de estreia',
    })
    expect(verdict.blocking.map((r) => r.code)).toContain('SEO_KEYWORD_STUFFING')
  })
})

describe('matriz contentType x Schema.org', () => {
  const empty = { hasSteps: false, hasList: false, hasRating: false, blockCount: 3 }
  const full = { hasSteps: true, hasList: true, hasRating: true, blockCount: 3 }

  it('a matriz cobre todos os contentType e sempre admite Article', () => {
    // `Article` nao promete estrutura nenhuma, e por isso nunca produz
    // structured data falso: e o fallback seguro de todos.
    for (const contentType of [
      'news',
      'feature',
      'review',
      'guide',
      'list',
      'interview',
      'evergreen',
    ]) {
      expect(SCHEMA_BY_CONTENT_TYPE[contentType], contentType).toBeDefined()
      expect(SCHEMA_BY_CONTENT_TYPE[contentType], contentType).toContain('Article')
      expect(evaluateSchemaChoice('Article', empty, contentType).kind, contentType).toBe('ok')
    }
  })

  it('combinacao PREVISTA com estrutura presente passa', () => {
    expect(evaluateSchemaChoice('NewsArticle', empty, 'news').kind).toBe('ok')
    expect(evaluateSchemaChoice('Review', full, 'review').kind).toBe('ok')
    expect(evaluateSchemaChoice('HowTo', full, 'guide').kind).toBe('ok')
    expect(evaluateSchemaChoice('ItemList', full, 'list').kind).toBe('ok')
    expect(evaluateSchemaChoice('HowTo', full, 'evergreen').kind).toBe('ok')
  })

  it('estrutura PROMETIDA e ausente BLOQUEIA', () => {
    // Structured data falso: o buscador promete ao leitor algo que a pagina nao
    // entrega, e a penalidade vem difusa e dificil de rastrear.
    expect(evaluateSchemaChoice('HowTo', empty, 'guide')).toMatchObject({
      kind: 'blocked',
      reason: { code: 'schema_howto_without_steps' },
    })
    expect(evaluateSchemaChoice('ItemList', empty, 'list').kind).toBe('blocked')
    expect(evaluateSchemaChoice('Review', empty, 'review').kind).toBe('blocked')
  })

  it('combinacao FORA da matriz vai para revisao, nao bloqueia', () => {
    // Classificacao ambigua com conteudo valido e exatamente o caso de revisao
    // humana: bloquear jogaria fora material bom por um rotulo errado.
    expect(evaluateSchemaChoice('NewsArticle', empty, 'interview')).toMatchObject({
      kind: 'review',
      reason: { code: 'schema_not_allowed_for_content_type' },
    })
    expect(evaluateSchemaChoice('Review', full, 'news').kind).toBe('review')
    expect(evaluateSchemaChoice('HowTo', full, 'interview').kind).toBe('review')
  })

  it('contentType desconhecido vai para revisao', () => {
    expect(evaluateSchemaChoice('Article', empty, 'inventado').kind).toBe('review')
  })
})

describe('slug canonica', () => {
  it('remove acento, caixa e pontuacao', () => {
    const result = canonicalizeSlug('Ação & Aventura: O Retorno!')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slug).toBe('acao-e-aventura-o-retorno')
  })

  it('decompoe o Unicode ANTES de limpar', () => {
    // A ordem inversa descartaria a letra acentuada inteira: `caf` no lugar de
    // `cafe`.
    const result = canonicalizeSlug('café')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slug).toBe('cafe')
  })

  it('corta por PALAVRA, nao no meio dela', () => {
    const result = canonicalizeSlug(Array.from({ length: 40 }, () => 'palavra').join(' '))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.slug.length).toBeLessThanOrEqual(SLUG_LIMITS.maxLength)
    expect(result.slug.endsWith('-')).toBe(false)
    expect(result.slug.split('-').every((word) => word === 'palavra')).toBe(true)
  })

  it('recusa slug RESERVADA', () => {
    // Uma materia com slug `api` seria inalcancavel, e o defeito so apareceria
    // em producao.
    for (const reserved of ['api', 'admin', 'sitemap', 'noticias']) {
      const result = canonicalizeSlug(reserved)
      expect(result.ok, reserved).toBe(false)
      if (result.ok) continue
      expect(result.reason).toBe('reserved')
    }
  })

  it('recusa sugestao que some na normalizacao', () => {
    const result = canonicalizeSlug('!!! ???')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('empty_after_normalization')
  })

  it('e DETERMINISTICA', () => {
    expect(canonicalizeSlug('Título da Matéria')).toEqual(canonicalizeSlug('Título da Matéria'))
  })

  it('resolve colisao de forma deterministica', () => {
    // Nada de timestamp: uma slug que muda a cada tentativa quebraria o retry e
    // produziria duas URLs para a mesma materia.
    const taken = new Set(['nota', 'nota-2'])
    expect(resolveSlugCollision('nota', taken)).toBe('nota-3')
    expect(resolveSlugCollision('nota', taken)).toBe('nota-3')
    expect(resolveSlugCollision('livre', taken)).toBe('livre')
  })
})

describe('mudanca de slug', () => {
  it('automacao NUNCA muda slug de materia publicada', () => {
    // Mudar a URL de algo indexado quebra links de terceiros e apaga historico
    // de ranqueamento — e sem ninguem olhando.
    const policy = decideSlugChange({
      currentSlug: 'antiga',
      proposedSlug: 'nova',
      alreadyPublished: true,
      automated: true,
    })
    expect(policy.action).toBe('keep')
  })

  it('antes de publicar, trocar e livre e nao exige redirect', () => {
    const policy = decideSlugChange({
      currentSlug: 'antiga',
      proposedSlug: 'nova',
      alreadyPublished: false,
      automated: true,
    })
    expect(policy).toEqual({ action: 'change', slug: 'nova', needsRedirect: false })
  })

  it('decisao HUMANA sobre materia publicada muda COM redirect', () => {
    const policy = decideSlugChange({
      currentSlug: 'antiga',
      proposedSlug: 'nova',
      alreadyPublished: true,
      automated: false,
    })
    expect(policy).toEqual({ action: 'change', slug: 'nova', needsRedirect: true })
  })
})

describe('politica de autor para automacao', () => {
  function author(overrides: Partial<AuthorAutomationFacts> = {}): AuthorAutomationFacts {
    return {
      exists: true,
      active: true,
      automationPublishingAllowed: true,
      allowedAutomationContentTypes: [],
      allowedAutomationSections: [],
      automationDailyLimit: null,
      automationAttributionModes: ['newsroom'],
      ...overrides,
    }
  }
  const base = {
    contentType: 'news',
    section: 'Series',
    attributionMode: 'newsroom' as const,
    publishedTodayByAuthor: 0,
  }

  it('CONTROLE POSITIVO: autor autorizado assina', () => {
    expect(authorizeAutomationAuthor({ facts: author(), ...base })).toEqual({ allowed: true })
  })

  it('autor inexistente, inativo ou sem permissao e recusado', () => {
    expect(
      authorizeAutomationAuthor({ facts: author({ exists: false }), ...base }),
    ).toMatchObject({ code: 'author_not_found' })
    expect(authorizeAutomationAuthor({ facts: author({ active: false }), ...base })).toMatchObject(
      { code: 'author_inactive' },
    )
    expect(
      authorizeAutomationAuthor({
        facts: author({ automationPublishingAllowed: false }),
        ...base,
      }),
    ).toMatchObject({ code: 'automation_not_allowed' })
  })

  it('lista VAZIA significa sem restricao, nao nada permitido', () => {
    // A alternativa faria todo autor recem-autorizado enumerar os seis
    // contentTypes, e o esquecimento viraria recusa incompreensivel.
    expect(
      authorizeAutomationAuthor({
        facts: author({ allowedAutomationContentTypes: [] }),
        ...base,
        contentType: 'evergreen',
      }).allowed,
    ).toBe(true)
  })

  it('restricao de contentType e de secao e respeitada', () => {
    expect(
      authorizeAutomationAuthor({
        facts: author({ allowedAutomationContentTypes: ['news'] }),
        ...base,
        contentType: 'review' as never,
      }),
    ).toMatchObject({ code: 'content_type_not_allowed' })
    expect(
      authorizeAutomationAuthor({
        facts: author({ allowedAutomationSections: ['Filmes'] }),
        ...base,
      }),
    ).toMatchObject({ code: 'section_not_allowed' })
  })

  it('o MODO de assinatura e decisao do autor sobre o proprio nome', () => {
    expect(
      authorizeAutomationAuthor({
        facts: author({ automationAttributionModes: ['assisted'] }),
        ...base,
        attributionMode: 'byline',
      }),
    ).toMatchObject({ code: 'attribution_mode_not_allowed' })
  })

  it('limite diario do autor e respeitado', () => {
    expect(
      authorizeAutomationAuthor({
        facts: author({ automationDailyLimit: 3 }),
        ...base,
        publishedTodayByAuthor: 3,
      }),
    ).toMatchObject({ code: 'author_daily_limit_reached' })
  })

  it('a ORDEM da recusa e util: permissao antes de restricao fina', () => {
    // "Secao nao permitida" para um autor que nem aceita automacao mandaria o
    // pipeline ajustar a secao a toa.
    expect(
      authorizeAutomationAuthor({
        facts: author({ automationPublishingAllowed: false, allowedAutomationSections: ['X'] }),
        ...base,
      }),
    ).toMatchObject({ code: 'automation_not_allowed' })
  })
})

/** Atalho: resolve e exige sucesso. Falha do resolver e testada a parte. */
function config(env: Record<string, string | undefined>) {
  const result = resolveAutoPublishConfig(env)
  if (!result.ok) throw new Error(`config invalida: ${result.errors.join('; ')}`)
  return result.config
}

describe('kill switch', () => {
  it('variavel AUSENTE nao autoriza publicacao', () => {
    // Um default ligado faria um deploy com env incompleta comecar a publicar
    // sozinho, e ninguem descobriria pela ausencia de erro.
    expect(config({}).enabled).toBe(false)
  })

  it('so `true`/`1` ligam — typo deixa desligado', () => {
    expect(config({ EDITORIAL_AUTO_PUBLISH_ENABLED: 'true' }).enabled).toBe(true)
    expect(config({ EDITORIAL_AUTO_PUBLISH_ENABLED: '1' }).enabled).toBe(true)
    for (const value of ['false', '0', 'yes', 'sim', 'TRUE ', '']) {
      expect(config({ EDITORIAL_AUTO_PUBLISH_ENABLED: value }).enabled, value).toBe(
        value.trim().toLowerCase() === 'true',
      )
    }
  })

  it('PRODUCTION aplica teto conservador quando ninguem declarou', () => {
    // Publicar sem teto por esquecimento e a diferenca entre uma pauta e um flood.
    const resolved = config({
      NODE_ENV: 'production',
      EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
      EDITORIAL_AUTO_PUBLISH_TIME_ZONE: 'America/Sao_Paulo',
    })
    expect(resolved.dailyLimit).toBe(CONSERVATIVE_DAILY_LIMIT)
    expect(resolved.perAuthorLimit).not.toBeNull()
  })

  it('o resumo nao carrega credencial', () => {
    const text = describeAutoPublish(config({ EDITORIAL_AUTO_PUBLISH_ENABLED: 'true' }))
    expect(text).toContain('habilitada')
    expect(text).toContain('America/Sao_Paulo')
    expect(text).not.toMatch(/key|secret|postgres/i)
  })
})

describe('fuso editorial', () => {
  const ZONE = 'America/Sao_Paulo'

  it('default em desenvolvimento e America/Sao_Paulo', () => {
    expect(config({}).timeZone).toBe(DEFAULT_EDITORIAL_TIME_ZONE)
    expect(DEFAULT_EDITORIAL_TIME_ZONE).toBe('America/Sao_Paulo')
  })

  it('PRODUCTION exige a variavel', () => {
    const result = resolveAutoPublishConfig({
      NODE_ENV: 'production',
      EDITORIAL_AUTO_PUBLISH_ENABLED: 'true',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('EDITORIAL_AUTO_PUBLISH_TIME_ZONE')
  })

  it('recusa OFFSET FIXO e ABREVIACAO', () => {
    // Os dois ignoram horario de verao e mudanca historica: a conta erraria em
    // silencio exatamente nos dias em que a virada importa.
    for (const zone of ['-03:00', 'BRT', 'GMT-3', 'America/Nao_Existe']) {
      expect(isValidIanaTimeZone(zone), zone).toBe(false)
      expect(
        resolveAutoPublishConfig({
          NODE_ENV: 'production',
          EDITORIAL_AUTO_PUBLISH_TIME_ZONE: zone,
        }).ok,
        zone,
      ).toBe(false)
    }
    // CONTROLE POSITIVO: identificadores IANA reais passam.
    for (const zone of ['America/Sao_Paulo', 'UTC', 'Europe/Lisbon']) {
      expect(isValidIanaTimeZone(zone), zone).toBe(true)
    }
  })

  it('a janela do dia e do DIA CIVIL local, nao do dia UTC', () => {
    // 2026-07-29 as 02:00 UTC e ainda 28/07 em Sao Paulo (UTC-3). Truncar em UTC
    // colocaria esta publicacao no dia seguinte, e o teto do dia 28 nunca
    // fecharia.
    const window = editorialDayWindowUtc('2026-07-29T02:00:00.000Z', ZONE)
    expect(window.startUtcIso).toBe('2026-07-28T03:00:00.000Z')
    expect(window.nextStartUtcIso).toBe('2026-07-29T03:00:00.000Z')
  })

  it('BORDAS: 23:59:59 local, meia-noite e o instante seguinte', () => {
    const window = editorialDayWindowUtc('2026-07-29T12:00:00.000Z', ZONE)
    // 29/07 23:59:59 local = 30/07 02:59:59 UTC -> DENTRO.
    expect(isWithinEditorialDay('2026-07-30T02:59:59.000Z', window)).toBe(true)
    // 30/07 00:00:00 local = 30/07 03:00:00 UTC -> FORA (half-open).
    expect(isWithinEditorialDay('2026-07-30T03:00:00.000Z', window)).toBe(false)
    // O proprio inicio esta DENTRO.
    expect(isWithinEditorialDay(window.startUtcIso, window)).toBe(true)
  })

  it('timestamp UTC do dia seguinte pode pertencer ao dia local ANTERIOR', () => {
    const window = editorialDayWindowUtc('2026-07-29T12:00:00.000Z', ZONE)
    // 30/07 01:00 UTC ainda e 29/07 as 22:00 em Sao Paulo.
    expect(isWithinEditorialDay('2026-07-30T01:00:00.000Z', window)).toBe(true)
  })

  it('a janela dura ~24h e nunca e vazia', () => {
    for (const instant of [
      '2026-01-15T12:00:00.000Z',
      '2026-07-29T12:00:00.000Z',
      '2026-10-20T12:00:00.000Z',
      '2026-02-28T23:30:00.000Z',
    ]) {
      const window = editorialDayWindowUtc(instant, ZONE)
      const duration =
        Date.parse(window.nextStartUtcIso) - Date.parse(window.startUtcIso)
      expect(duration, instant).toBeGreaterThanOrEqual(23 * 3_600_000)
      expect(duration, instant).toBeLessThanOrEqual(25 * 3_600_000)
      expect(isWithinEditorialDay(instant, window), instant).toBe(true)
    }
  })

  it('o deslocamento vem do ICU, nao de um offset fixo', () => {
    // Fuso com horario de verao ativo: se houvesse `-03:00` hardcoded, estas
    // duas janelas teriam o mesmo offset — e uma delas estaria errada.
    const winter = editorialDayWindowUtc('2026-01-15T12:00:00.000Z', 'Europe/Lisbon')
    const summer = editorialDayWindowUtc('2026-07-15T12:00:00.000Z', 'Europe/Lisbon')
    expect(winter.startUtcIso.slice(11, 13)).not.toBe(summer.startUtcIso.slice(11, 13))
  })
})

/* ------------------------------------------------------------------ */
/* Maquina de estados: os DOIS poderes tecnicos sao disjuntos          */
/* ------------------------------------------------------------------ */

describe('automation_publisher e service sao atores diferentes', () => {
  // A tentacao, ao fazer o MNScr publicar, e afrouxar `service`. Isso daria a
  // conta de INGESTAO o poder de publicar por tabela. Estes testes provam a
  // trava nos dois sentidos: o que o publicador ganhou e o que o ingestor
  // continua sem poder.

  it('service (draft_ingest) NAO alcanca ready_to_publish nem published', () => {
    expect(canTransition('automation_draft', 'ready_to_publish', 'service').allowed).toBe(false)
    expect(canTransition('ready_to_publish', 'published', 'service').allowed).toBe(false)
    expect(canTransition('needs_review', 'in_review', 'service').allowed).toBe(false)
  })

  it('automation_publisher sobe de automation_draft ate published', () => {
    expect(canTransition('automation_draft', 'ready_to_publish', 'automation_publisher').allowed).toBe(
      true,
    )
    expect(canTransition('ready_to_publish', 'published', 'automation_publisher').allowed).toBe(true)
  })

  it('automation_publisher NAO atravessa estados de revisao humana', () => {
    // Passar por `in_review`/`human_reviewed` gravaria que um humano revisou
    // quando nenhum revisou — e essa mentira ficaria no historico da materia.
    expect(canTransition('needs_review', 'in_review', 'automation_publisher').allowed).toBe(false)
    expect(canTransition('in_review', 'human_reviewed', 'automation_publisher').allowed).toBe(false)
  })

  it('automation_publisher NAO tira do ar', () => {
    // Despublicar, bloquear, arquivar e retratar sao decisoes humanas. Uma
    // automacao em loop nao pode retirar uma materia sozinha.
    for (const target of ['blocked', 'archived', 'retracted'] as const) {
      expect(canTransition('published', target, 'automation_publisher').allowed).toBe(false)
    }
  })

  it('automation_publisher continua obrigado a passar pelo gate', () => {
    // A allowlist so diz QUEM pode mover. O que a materia precisa ter para
    // virar publica e decidido por `evaluatePublishGate`, no servidor, contra o
    // documento persistido — nao contra o que o pedido afirmou.
    expect(canTransition('automation_draft', 'published', 'automation_publisher').allowed).toBe(
      false,
    )
  })
})
