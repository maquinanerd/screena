/**
 * publication-request.test.ts — O contrato de publicacao automatica.
 *
 * Este contrato e o unico caminho pelo qual uma automacao pode fazer uma materia
 * aparecer no site. Cada teste aqui corresponde a uma forma concreta de isso dar
 * errado.
 */

import { describe, expect, it } from 'vitest'

import {
  buildContractManifest,
  canonicalJson,
  checkContractCompatibility,
  contractHashOf,
  contractSchemaHash,
  jsonSchemaOf,
  findContract,
  parseEditorialPublicationRequestV1,
  invalidPublicationRequests,
  validPublicationRequest,
  countKeyphraseOccurrences,
  normalizeKeyphrase,
  SEO_POLICY,
  explainForbiddenKey,
  findDuplicateSeoKey,
  FORBIDDEN_TOP_LEVEL_SEO_KEYS,
  validPublicationUpdate,
  routedToReviewRequest,
  conflictingUpdateRequest,
} from '../index.js'

describe('manifesto de contratos', () => {
  it('publica os quatro contratos com hash', () => {
    const manifest = buildContractManifest()
    expect(manifest.map((entry) => entry.contractName).sort()).toEqual(
      [
        'cinerie-editorial-context-v1',
        'editorial-draft-v1',
        'editorial-publication-request-v1',
        'publication-event-v1',
      ].sort(),
    )
    for (const entry of manifest) {
      expect(entry.schemaHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
  })

  it('o manifesto NAO vaza schema, segredo nem configuracao', () => {
    // Ele e chamado por um consumidor externo a cada boot: precisa ser so
    // identidade.
    const text = JSON.stringify(buildContractManifest())
    expect(text).not.toContain('properties')
    expect(text).not.toContain('postgres')
    expect(text).not.toContain('secret')
  })

  it('o hash e DETERMINISTICO — a ordem das chaves nao muda o resultado', () => {
    // Sem serializacao canonica, dois processos que montassem o mesmo objeto por
    // caminhos diferentes produziriam hashes diferentes, e o consumidor
    // recusaria um contrato identico.
    expect(contractHashOf({ b: 1, a: 2 })).toBe(contractHashOf({ a: 2, b: 1 }))
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('a ordem de ARRAY continua importando', () => {
    // Em array a ordem e semantica: [1,2] nao e [2,1].
    expect(contractHashOf([1, 2])).not.toBe(contractHashOf([2, 1]))
  })

  it('o hash muda quando o SCHEMA muda', () => {
    // Controle positivo do detector: um hash constante passaria em tudo acima.
    const original = contractSchemaHash('editorial-publication-request-v1')
    expect(original).not.toBeNull()
    const contract = findContract('editorial-publication-request-v1')
    expect(contract).not.toBeNull()
    const mutated = contractHashOf({ ...jsonSchemaOf(contract!.schema), extra: true })
    expect(mutated).not.toBe(original)
  })
})

describe('compatibilidade de contrato', () => {
  const name = 'editorial-publication-request-v1'
  const version = '1.0.0'

  it('aceita nome, versao e hash corretos', () => {
    // NOME e VERSAO sao conceitos separados desde esta revisao: o nome carrega
    // o `-v1` (quebra incompativel = contrato novo), a versao evolui dentro dele.
    expect(
      checkContractCompatibility({
        contractName: name,
        declaredVersion: version,
        declaredHash: contractSchemaHash(name) ?? '',
      }),
    ).toEqual({ compatible: true })
  })

  it('recusa hash divergente — schema diferente com o mesmo nome', () => {
    // "Quase compativel" e como se publica materia errada: um campo pode ter o
    // mesmo nome e outra semantica.
    expect(
      checkContractCompatibility({
        contractName: name,
        declaredVersion: version,
        declaredHash: `sha256:${'bcdef01234567890'.repeat(4)}`,
      }),
    ).toEqual({ compatible: false, reason: 'hash_mismatch' })
  })

  it('recusa versao divergente e contrato desconhecido', () => {
    expect(
      checkContractCompatibility({
        contractName: name,
        declaredVersion: '2.0.0',
        declaredHash: contractSchemaHash(name) ?? '',
      }).compatible,
    ).toBe(false)
    expect(
      checkContractCompatibility({
        contractName: 'nao-existe',
        declaredVersion: 'x',
        declaredHash: 'y',
      }),
    ).toEqual({ compatible: false, reason: 'unknown_contract' })
  })
})

describe('pedido de publicacao', () => {
  it('CONTROLE POSITIVO: a fixture canonica e valida', () => {
    const parsed = parseEditorialPublicationRequestV1(validPublicationRequest)
    expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.issues)).toBe(true)
  })

  it('recusa campo do Yoast em qualquer profundidade', () => {
    const parsed = parseEditorialPublicationRequestV1(invalidPublicationRequests.yoastField)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]?.message).toContain('WordPress/Yoast')
  })

  it('recusa `post_status` — estado publico nao vem do produtor', () => {
    const parsed = parseEditorialPublicationRequestV1(
      invalidPublicationRequests.wordpressPostStatus,
    )
    expect(parsed.ok).toBe(false)
  })

  it('recusa canonical vindo do produtor', () => {
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.canonicalFromProducer).ok,
    ).toBe(false)
  })

  it('recusa tentativa de burlar revisao', () => {
    const parsed = parseEditorialPublicationRequestV1(invalidPublicationRequests.bypassReview)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    // A mensagem NOMEIA o campo: e a diferenca entre corrigir o pipeline e
    // tentar de novo.
    expect(parsed.issues[0]?.path).toBe('bypassReview')
  })

  it('mas ACEITA `publicationIntent: publish` — pedir publicacao e legitimo', () => {
    // A distincao central da fase: pedir e legitimo, decidir o estado nao e.
    const parsed = parseEditorialPublicationRequestV1(validPublicationRequest)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.publicationIntent).toBe('publish')
  })

  it('exige fonte externa para publicacao automatica', () => {
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.noExternalSources).ok,
    ).toBe(false)
  })

  it('exige que QA reprovado diga o que quebrou', () => {
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.qaFailedWithoutErrors).ok,
    ).toBe(false)
  })

  it('`update` sem alvo e recusado', () => {
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.updateWithoutTarget).ok,
    ).toBe(false)
  })

  it('alt precisa apontar para midia DO pedido', () => {
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.altForUnknownMedia).ok,
    ).toBe(false)
  })

  it('meta description curta demais e recusada', () => {
    expect(parseEditorialPublicationRequestV1(invalidPublicationRequests.metaTooShort).ok).toBe(
      false,
    )
  })

  it('autor por NOME LIVRE e recusado', () => {
    // Assinatura por string nao tem entidade, nem politica, nem auditoria.
    expect(
      parseEditorialPublicationRequestV1(invalidPublicationRequests.authorAsFreeText).ok,
    ).toBe(false)
  })
})

describe('politica de SEO', () => {
  it('normaliza keyphrase para comparacao', () => {
    expect(normalizeKeyphrase('Data de Estreia!')).toBe('data de estreia')
    expect(normalizeKeyphrase('  ESTREIA  ')).toBe('estreia')
  })

  it('conta repeticoes da keyphrase no CONJUNTO de campos', () => {
    // Contar por campo seria permissivo: a mesma frase em titulo, meta, og e alt
    // e o padrao classico de texto escrito para robo.
    const occurrences = countKeyphraseOccurrences(validPublicationRequest.seo)
    expect(occurrences).toBeGreaterThan(0)
    expect(occurrences).toBeLessThanOrEqual(SEO_POLICY.maxKeyphraseRepetition)
  })

  it('detecta STUFFING quando a keyphrase satura os campos', () => {
    const stuffed = {
      ...validPublicationRequest.seo,
      title: 'data de estreia data de estreia data de estreia',
      metaDescription:
        'data de estreia data de estreia data de estreia data de estreia data de estreia data de estreia data de estreia',
    }
    expect(countKeyphraseOccurrences(stuffed)).toBeGreaterThan(
      SEO_POLICY.maxKeyphraseRepetition,
    )
  })

  it('recusa keyphrase relacionada duplicando a principal', () => {
    const parsed = parseEditorialPublicationRequestV1({
      ...validPublicationRequest,
      seo: {
        ...validPublicationRequest.seo,
        relatedKeyphrases: ['Data de Estreia'],
      },
    })
    expect(parsed.ok).toBe(false)
  })

  it('recusa link interno sem alvo', () => {
    const parsed = parseEditorialPublicationRequestV1({
      ...validPublicationRequest,
      seo: {
        ...validPublicationRequest.seo,
        internalLinkSuggestions: [{ targetType: 'article', anchorText: 'veja tambem' }],
      },
    })
    expect(parsed.ok).toBe(false)
  })

  it('recusa URL absoluta como alvo interno', () => {
    const parsed = parseEditorialPublicationRequestV1({
      ...validPublicationRequest,
      seo: {
        ...validPublicationRequest.seo,
        internalLinkSuggestions: [
          {
            targetType: 'article',
            targetPath: 'https://outro-site.test/x',
            anchorText: 'veja',
          },
        ],
      },
    })
    expect(parsed.ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* CHECKPOINT CONTRATUAL — os quatro pontos sob revisao                */
/* ------------------------------------------------------------------ */

describe('1. identidade tecnica NUNCA vem do cliente', () => {
  it('recusa `technicalActorId`, `serviceAccountId` e `scopes`', () => {
    // Se o corpo pudesse declarar a identidade, a auditoria registraria o que o
    // cliente DISSE ser — e um cliente comprometido assinaria acoes com a
    // identidade de outro.
    for (const key of [
      'clientDeclaredTechnicalActor',
      'clientDeclaredServiceAccount',
      'clientDeclaredScopes',
    ]) {
      const parsed = parseEditorialPublicationRequestV1(invalidPublicationRequests[key])
      expect(parsed.ok, key).toBe(false)
      if (parsed.ok) continue
      expect(parsed.issues[0]?.message).toContain('credencial autenticada')
    }
  })

  it('a varredura de identidade e PROFUNDA', () => {
    // Esconder `publishedBy` dentro de `provenance` nao pode funcionar.
    const parsed = parseEditorialPublicationRequestV1(
      invalidPublicationRequests.nestedTechnicalActor,
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]?.path).toBe('publishedBy')
  })

  it('CONTROLE NEGATIVO: o detector nao acusa campo legitimo parecido', () => {
    // Sem isto, um detector que recusasse tudo passaria nos testes acima.
    expect(explainForbiddenKey('publicAuthorId')).not.toContain('credencial')
    expect(parseEditorialPublicationRequestV1(validPublicationRequest).ok).toBe(true)
  })

  it('o que o cliente PODE declarar continua aceito', () => {
    const parsed = parseEditorialPublicationRequestV1(validPublicationRequest)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.publicAuthorId).toBe('author-redacao-cinerie')
    expect(parsed.value.attributionMode).toBe('newsroom')
    expect(parsed.value.pipelineVersion).toBe('mnscr@2026.07')
    expect(parsed.value.generatedAt).toBe('2026-07-29T12:00:00.000Z')
    expect(parsed.value.publicationIntent).toBe('publish')
  })
})

describe('2. SEO tem UMA fonte de verdade', () => {
  it('recusa `seoProposal` (do draft) convivendo com `seo`', () => {
    const parsed = parseEditorialPublicationRequestV1(
      invalidPublicationRequests.duplicateSeoProposal,
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]?.path).toBe('seoProposal')
    expect(parsed.issues[0]?.message).toContain('UMA fonte de verdade')
  })

  it('recusa campo de SEO SOLTO no nivel superior', () => {
    const parsed = parseEditorialPublicationRequestV1(invalidPublicationRequests.looseSeoField)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.issues[0]?.path).toBe('metaDescription')
  })

  it('mas ACEITA os mesmos nomes DENTRO de `seo` — la eles sao o contrato', () => {
    // A varredura de SEO e de TOPO, nao profunda. Recursiva, ela recusaria o
    // proprio objeto valido — foi o defeito da primeira versao da lista.
    const parsed = parseEditorialPublicationRequestV1(validPublicationRequest)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.seo.metaDescription.length).toBeGreaterThan(0)
    expect(parsed.value.seo.slugSuggestion).toBe('nova-serie-data-de-estreia')
    expect(parsed.value.seo.focusKeyphrase).toBe('data de estreia')
  })

  it('a lista de topo cobre os campos concorrentes', () => {
    expect([...FORBIDDEN_TOP_LEVEL_SEO_KEYS]).toContain('seoproposal')
    expect([...FORBIDDEN_TOP_LEVEL_SEO_KEYS]).toContain('metatitle')
    expect([...FORBIDDEN_TOP_LEVEL_SEO_KEYS]).toContain('slugsuggestion')
    expect(findDuplicateSeoKey({ seo: { metaTitle: 'x' } })).toBeNull()
    expect(findDuplicateSeoKey({ metaTitle: 'x' })).toBe('metaTitle')
  })
})

describe('4. o hash de schema e determinista e livre de ruido', () => {
  it('duas geracoes consecutivas sao IDENTICAS byte a byte', () => {
    const first = JSON.stringify(buildContractManifest())
    const second = JSON.stringify(buildContractManifest())
    expect(second).toBe(first)
  })

  it('nao depende de instante nem de valores de instancia', () => {
    // O hash e do JSON SCHEMA, nao de uma instancia. `generatedAt` e um CAMPO do
    // schema; o VALOR que uma instancia carrega nunca entra no calculo — e isso
    // que impede o hash de mudar a cada pedido.
    const before = contractSchemaHash('editorial-publication-request-v1')
    for (const instance of [
      { ...validPublicationRequest, generatedAt: '2020-01-01T00:00:00.000Z' },
      { ...validPublicationRequest, pipelineVersion: 'outro@1' },
    ]) {
      expect(parseEditorialPublicationRequestV1(instance).ok).toBe(true)
    }
    expect(contractSchemaHash('editorial-publication-request-v1')).toBe(before)
  })

  it('o hash de um contrato NAO depende dos outros', () => {
    // Se dependesse, mexer no `cinerie-editorial-context-v1` invalidaria o
    // contrato do MNScr sem que nada relevante para ele tivesse mudado.
    const contract = findContract('editorial-publication-request-v1')
    expect(contract).not.toBeNull()
    if (contract === null) return
    expect(contractSchemaHash('editorial-publication-request-v1')).toBe(
      contractHashOf(jsonSchemaOf(contract.schema)),
    )
  })

  it('os conceitos de hash sao DISTINTOS entre si', () => {
    // `schemaHash` (sha256:<hex>) identifica o CONTRATO;
    // `contentHash` (hex puro) identifica um PAYLOAD;
    // `idempotencyKey` identifica uma INTENCAO e nao e hash nenhum.
    const parsed = parseEditorialPublicationRequestV1(validPublicationRequest)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.schemaHash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(parsed.value.sourcePayloadHash).toMatch(/^[0-9a-f]+$/)
    expect(parsed.value.sourcePayloadHash).not.toMatch(/^sha256:/)
    expect(parsed.value.idempotencyKey).toBe('mnscr:cluster-4711:rev-3')
  })
})

describe('fixtures de update, revisao e conflito', () => {
  it('update valido: alvo presente e revisao MAIOR', () => {
    const parsed = parseEditorialPublicationRequestV1(validPublicationUpdate)
    expect(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.issues)).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.targetArticleId).toBe('article-8801')
    expect(parsed.value.sourceRevision).toBe(4)
  })

  it('ROUTED_TO_REVIEW e CONFLICT sao VALIDOS no contrato', () => {
    // O schema nao conhece o estado do artigo nem o resultado do QA: recusar
    // esses casos aqui seria impossivel, e tentar seria mentir sobre o escopo do
    // contrato. Quem decide o desfecho e o servidor.
    expect(parseEditorialPublicationRequestV1(routedToReviewRequest).ok).toBe(true)
    expect(parseEditorialPublicationRequestV1(conflictingUpdateRequest).ok).toBe(true)
  })

  it('hash incompativel morre na COMPATIBILIDADE, nao no parse', () => {
    // O parse valida FORMA; a compatibilidade valida IDENTIDADE do schema. Um
    // hash bem formado porem errado passa no primeiro e e recusado no segundo.
    const parsed = parseEditorialPublicationRequestV1(
      invalidPublicationRequests.incompatibleSchemaHash,
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(
      checkContractCompatibility({
        contractName: parsed.value.contractName,
        declaredVersion: parsed.value.contractVersion,
        declaredHash: parsed.value.schemaHash,
      }),
    ).toEqual({ compatible: false, reason: 'hash_mismatch' })
  })
})
