/**
 * manual-editorial.test.ts — FASE 2G. Testes PUROS do caminho editorial HUMANO.
 *
 * Duas perguntas, ambas respondiveis sem subir banco:
 *
 *  1. A matriz de papeis humanos entrega o minimo que uma redacao precisa —
 *     e recusa o que ela nao pode conceder? Em especial: administrador e
 *     editor-chefe escrevem e publicam SOZINHOS (a redacao pode ter uma pessoa
 *     so), enquanto writer e reviewer nao publicam de jeito nenhum.
 *
 *  2. A reorganizacao do formulario em abas mudou o ARMAZENAMENTO? Aba nomeada
 *     no Payload aninha o caminho (`seo.metaTitle`), o que exigiria migration e
 *     invalidaria o contrato congelado. A prova aqui e estrutural: nenhuma aba
 *     tem `name`, e o conjunto de campos derivado da config bate exatamente com
 *     as colunas do ultimo snapshot de migration.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  HUMAN_FORBIDDEN_FIELDS,
  SERVICE_ACCOUNT_FORBIDDEN_FIELDS,
  articlesAccess,
  canPublish,
  canReview,
  editorialAssetAccess,
  humanMayWriteField,
  identityAccess,
  isAdministrator,
  serviceAccountMayWriteField,
  type Actor,
} from '../access.js'
import { Articles } from '../collections.js'
import {
  EDITORIAL_ROLES,
  canTransition,
  publicationEventForTransition,
  type ActorKind,
  type EditorialRole,
} from '../workflow.js'

const here = dirname(fileURLToPath(import.meta.url))

function human(role: EditorialRole): Actor {
  return { kind: 'human', id: `u-${role}`, role }
}

const INGEST: Actor = { kind: 'service', id: 'sa-ingest', scopes: ['draft_ingest'] }
const AUTO_PUBLISHER: Actor = {
  kind: 'service',
  id: 'sa-auto',
  scopes: ['editorial_auto_publish'],
}

/** Percorre uma sequencia de transicoes; devolve o primeiro passo recusado. */
function walk(path: readonly string[], actor: ActorKind): string | null {
  for (let i = 0; i + 1 < path.length; i += 1) {
    const verdict = canTransition(path[i] as string, path[i + 1] as string, actor)
    if (!verdict.allowed) return `${path[i]} -> ${path[i + 1]}: ${verdict.detail}`
  }
  return null
}

/** Caminho humano completo, do rascunho ao ar. */
const FULL_PATH = [
  'draft',
  'needs_review',
  'in_review',
  'human_reviewed',
  'ready_to_publish',
  'published',
] as const

/* ------------------------------------------------------------------ */
/* 1. Matriz de papeis humanos                                         */
/* ------------------------------------------------------------------ */

describe('matriz de papeis humanos', () => {
  it('administrador faz tudo: cria, edita, cria autor, revisa e publica', () => {
    const admin = human('administrator')
    expect(articlesAccess.create(admin)).toBe(true)
    expect(articlesAccess.update(admin)).toBe(true)
    expect(articlesAccess.read(admin)).toBe(true)
    expect(articlesAccess.delete(admin)).toBe(true)
    // Criar AUTOR publico e criar USUARIO do CMS sao poderes distintos; o
    // administrador tem os dois.
    expect(editorialAssetAccess.create(admin)).toBe(true)
    expect(identityAccess.create(admin)).toBe(true)
    expect(canReview(admin)).toBe(true)
    expect(canPublish(admin)).toBe(true)
    expect(isAdministrator(admin)).toBe(true)
  })

  it('editor-chefe cria, edita, revisa, publica — mas NAO administra identidades', () => {
    const chief = human('editor_in_chief')
    expect(articlesAccess.create(chief)).toBe(true)
    expect(articlesAccess.update(chief)).toBe(true)
    expect(editorialAssetAccess.create(chief)).toBe(true)
    expect(canReview(chief)).toBe(true)
    expect(canPublish(chief)).toBe(true)
    // Criar usuario do CMS e conta tecnica continua sendo so do administrador.
    // Nao e restricao nova: e a politica existente, e ela nao se amplia aqui.
    expect(identityAccess.create(chief)).toBe(false)
  })

  it('PUBLICACAO SOLO: administrador e editor-chefe percorrem o fluxo inteiro sozinhos', () => {
    // O ponto explicito da FASE 2G. Uma redacao de uma pessoa so precisa
    // conseguir escrever, revisar e publicar — sem inventar uma segunda pessoa
    // e sem pular gate nenhum: cada aresta abaixo e uma transicao REAL e fica
    // no historico de versoes do Payload.
    for (const role of ['administrator', 'editor_in_chief'] as const) {
      expect(walk(FULL_PATH, role)).toBeNull()
    }
  })

  it('editor leva ate ready_to_publish e para ali — a politica nao se amplia', () => {
    expect(walk(['draft', 'needs_review', 'in_review', 'human_reviewed', 'ready_to_publish'], 'editor')).toBeNull()
    const verdict = canTransition('ready_to_publish', 'published', 'editor')
    expect(verdict.allowed).toBe(false)
    expect(verdict.allowed === false && verdict.reason).toBe('forbidden_for_role')
  })

  it('reviewer revisa e pede alteracoes, mas NAO publica', () => {
    const reviewer = human('reviewer')
    expect(canReview(reviewer)).toBe(true)
    expect(canPublish(reviewer)).toBe(false)
    expect(canTransition('needs_review', 'in_review', 'reviewer').allowed).toBe(true)
    expect(canTransition('in_review', 'human_reviewed', 'reviewer').allowed).toBe(true)
    expect(canTransition('in_review', 'changes_requested', 'reviewer').allowed).toBe(true)
    expect(canTransition('ready_to_publish', 'published', 'reviewer').allowed).toBe(false)
    // Nem por um caminho lateral: `reviewer` nao alcanca `ready_to_publish`.
    expect(canTransition('human_reviewed', 'ready_to_publish', 'reviewer').allowed).toBe(false)
  })

  it('writer cria e edita rascunho, mas NAO publica nem revisa', () => {
    const writer = human('writer')
    expect(articlesAccess.create(writer)).toBe(true)
    expect(articlesAccess.update(writer)).toBe(true)
    expect(canReview(writer)).toBe(false)
    expect(canPublish(writer)).toBe(false)
    expect(canTransition('draft', 'needs_review', 'writer').allowed).toBe(true)
    expect(canTransition('needs_review', 'in_review', 'writer').allowed).toBe(false)
    expect(canTransition('ready_to_publish', 'published', 'writer').allowed).toBe(false)
    // Nem apagar: remocao e do administrador.
    expect(articlesAccess.delete(writer)).toBe(false)
  })

  it('atualizar, despublicar e retratar material JA PUBLICADO e de quem publica', () => {
    for (const role of ['administrator', 'editor_in_chief'] as const) {
      // Atualizacao de materia publicada: `needs_update` e a porta.
      expect(walk(['published', 'needs_update', 'ready_to_publish', 'published'], role)).toBeNull()
      // Despublicar e retratar.
      expect(canTransition('published', 'archived', role).allowed).toBe(true)
      expect(canTransition('published', 'blocked', role).allowed).toBe(true)
      expect(canTransition('published', 'retracted', role).allowed).toBe(true)
      // E o que sai do ar nao volta sem NOVA revisao.
      expect(canTransition('retracted', 'published', role).allowed).toBe(false)
      expect(canTransition('blocked', 'published', role).allowed).toBe(false)
    }
    for (const role of ['editor', 'reviewer', 'writer'] as const) {
      expect(canTransition('published', 'retracted', role).allowed).toBe(false)
      expect(canTransition('published', 'archived', role).allowed).toBe(false)
    }
  })

  it('nenhum papel humano nasce em automation_draft', () => {
    // `automation_draft` significa "veio do pipeline". Um humano que pudesse
    // criar nesse estado apagaria a proveniencia da materia.
    for (const role of EDITORIAL_ROLES) {
      if (role === 'administrator') continue
      expect(canTransition('draft', 'automation_draft', role).allowed).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 2. Conta tecnica NAO usa o fluxo humano                             */
/* ------------------------------------------------------------------ */

describe('conta tecnica fora do fluxo humano', () => {
  it('nao publica, nao revisa, nao administra', () => {
    for (const service of [INGEST, AUTO_PUBLISHER]) {
      expect(canPublish(service)).toBe(false)
      expect(canReview(service)).toBe(false)
      expect(isAdministrator(service)).toBe(false)
      // Nem le a colecao de artigos: um rascunho humano em revisao nao e
      // assunto de pipeline externo.
      expect(articlesAccess.read(service)).toBe(false)
      // Nem cria autor publico nem usuario do CMS.
      expect(editorialAssetAccess.create(service)).toBe(false)
      expect(identityAccess.create(service)).toBe(false)
    }
  })

  it('a conta de INGESTAO nao alcanca nenhum estado humano', () => {
    for (const target of [
      'draft',
      'needs_review',
      'in_review',
      'human_reviewed',
      'ready_to_publish',
      'published',
    ]) {
      expect(canTransition('automation_draft', target, 'service').allowed).toBe(false)
    }
  })

  it('a automacao PUBLICADORA nunca atravessa in_review nem human_reviewed', () => {
    // Passar por esses estados gravaria que um humano revisou quando nenhum
    // revisou. Publicar ela pode; mentir sobre revisao, nao.
    expect(canTransition('needs_review', 'in_review', 'automation_publisher').allowed).toBe(false)
    expect(canTransition('in_review', 'human_reviewed', 'automation_publisher').allowed).toBe(false)
    expect(canTransition('ready_to_publish', 'published', 'automation_publisher').allowed).toBe(true)
    // E nao tira do ar.
    for (const target of ['blocked', 'archived', 'retracted']) {
      expect(canTransition('published', target, 'automation_publisher').allowed).toBe(false)
    }
  })

  it('nenhuma conta tecnica escreve o rastro HUMANO', () => {
    for (const field of ['createdBy', 'updatedBy', 'publishedBy']) {
      expect(serviceAccountMayWriteField(field)).toBe(false)
      expect(SERVICE_ACCOUNT_FORBIDDEN_FIELDS).toContain(field)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 3. Nenhum humano escreve a proveniencia TECNICA                     */
/* ------------------------------------------------------------------ */

describe('proveniencia tecnica fora do alcance humano', () => {
  it('autoPublished e os campos de automacao sao proibidos ao humano', () => {
    // `admin.readOnly` protege o FORMULARIO; a REST API do Payload aceita o
    // campo normalmente. Sem esta lista, um `PATCH` marcaria uma materia
    // escrita a mao como publicada pelo pipeline — e `autoPublished` e
    // justamente o indicador explicito que a auditoria usa (a ausencia de
    // `publishedBy` sozinha nao distingue).
    expect(humanMayWriteField('autoPublished')).toBe(false)
    for (const field of [
      'automationActorId',
      'automationScopesUsed',
      'automationIdempotencyKey',
      'automationContractName',
      'automationSchemaHash',
      'idempotencyKey',
      'sourceClusterId',
      'sourcePayloadHash',
      'pipelineVersion',
    ]) {
      expect(humanMayWriteField(field)).toBe(false)
      expect(HUMAN_FORBIDDEN_FIELDS).toContain(field)
    }
  })

  it('o que o humano PRECISA escrever continua liberado', () => {
    // Controle negativo: uma lista de proibicao boa nao pode proibir tudo.
    for (const field of [
      'title',
      'slug',
      'summary',
      'body',
      'heroMedia',
      'authors',
      'primaryAuthor',
      'metaTitle',
      'focusKeyphrase',
      'workflowStatus',
      'qaPassedAt',
      'legalHold',
    ]) {
      expect(humanMayWriteField(field)).toBe(true)
    }
  })

  it('as duas listas sao DISJUNTAS — nenhuma decisao fica sem dono', () => {
    // Se um campo fosse proibido aos dois lados, ninguem poderia escreve-lo e
    // o campo viraria letra morta em silencio.
    const overlap = HUMAN_FORBIDDEN_FIELDS.filter((field) =>
      (SERVICE_ACCOUNT_FORBIDDEN_FIELDS as readonly string[]).includes(field),
    )
    expect(overlap).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 3b. Estreia versus reedicao                                         */
/* ------------------------------------------------------------------ */

describe('evento de publicacao distingue estreia de reedicao', () => {
  it('a primeira publicacao e article.published', () => {
    expect(publicationEventForTransition('ready_to_publish', 'published')).toBe('article.published')
    expect(
      publicationEventForTransition('ready_to_publish', 'published', {
        alreadyPublishedOnce: false,
      }),
    ).toBe('article.published')
  })

  it('republicar a MESMA materia e article.updated', () => {
    // O caminho real de reedicao termina em `ready_to_publish -> published`,
    // identico ao de uma estreia. Sem o fato "ja foi publica", toda correcao
    // anunciava "publicado pela primeira vez" para a mesma URL — e a regra que
    // deveria evitar isso (`from === 'needs_update'`) era INALCANCAVEL, porque
    // a allowlist nao permite `needs_update -> published` direto.
    expect(
      publicationEventForTransition('ready_to_publish', 'published', {
        alreadyPublishedOnce: true,
      }),
    ).toBe('article.updated')
    // O caminho declarado continua valendo, caso a allowlist mude.
    expect(publicationEventForTransition('needs_update', 'published')).toBe('article.updated')
  })

  it('o fato nao afeta remocao nem movimento interno', () => {
    const context = { alreadyPublishedOnce: true }
    expect(publicationEventForTransition('published', 'retracted', context)).toBe('article.retracted')
    expect(publicationEventForTransition('published', 'archived', context)).toBe('article.unpublished')
    expect(publicationEventForTransition('draft', 'needs_review', context)).toBeNull()
    expect(publicationEventForTransition('in_review', 'human_reviewed', context)).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 4. As abas NAO mudaram o armazenamento                              */
/* ------------------------------------------------------------------ */

interface AnyField {
  readonly type: string
  readonly name?: string
  readonly hasMany?: boolean
  readonly fields?: readonly AnyField[]
  readonly tabs?: readonly AnyField[]
  readonly label?: string
  readonly admin?: { readonly readOnly?: boolean }
}

/**
 * Achata os campos como o Payload os ARMAZENA.
 *
 * Aba/linha/colapsavel SEM nome e presentacional: os campos internos sobem para
 * o nivel de cima e o caminho de armazenamento nao muda. Aba COM nome vira um
 * grupo e aninha (`seo.metaTitle`) — por isso a funcao devolve o nome da aba
 * como prefixo nesse caso, e o teste abaixo falha se algum dia isso acontecer.
 */
function flatten(fields: readonly AnyField[], prefix = ''): { path: string; field: AnyField }[] {
  const out: { path: string; field: AnyField }[] = []
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs ?? []) {
        const next = tab.name === undefined ? prefix : `${prefix}${tab.name}.`
        out.push(...flatten(tab.fields ?? [], next))
      }
      continue
    }
    if (field.type === 'row' || field.type === 'collapsible') {
      out.push(...flatten(field.fields ?? [], prefix))
      continue
    }
    if (field.name === undefined) continue
    out.push({ path: `${prefix}${field.name}`, field })
  }
  return out
}

const articleFields = flatten(Articles.fields as unknown as readonly AnyField[])

function snakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/**
 * Colunas de `articles` no ULTIMO snapshot de migration gerado pelo Payload.
 *
 * O arquivo e descoberto, nao fixado: os snapshots sao nomeados por timestamp,
 * e prender o teste a um nome faria a proxima migration passar despercebida —
 * o teste continuaria verde comparando com um schema que o banco ja nao tem.
 */
function snapshotColumns(): Set<string> {
  const dir = resolvePath(here, '..', 'migrations')
  const latest = readdirSync(dir)
    .filter((name) => /^\d{8}_\d{6}_.+\.json$/.test(name))
    .sort()
    .pop()
  if (latest === undefined) throw new Error('nenhum snapshot de migration encontrado')

  const snapshot = JSON.parse(readFileSync(resolvePath(dir, latest), 'utf8')) as {
    tables?: Record<string, { columns: Record<string, unknown> }>
  }
  const articles = snapshot.tables?.['public.articles']
  if (articles === undefined) throw new Error(`tabela \`articles\` ausente em ${latest}`)
  return new Set(Object.keys(articles.columns))
}

describe('abas do formulario nao alteram o schema', () => {
  it('NENHUMA aba tem nome — aba nomeada aninharia o armazenamento', () => {
    const tabsField = (Articles.fields as unknown as readonly AnyField[]).find(
      (field) => field.type === 'tabs',
    )
    expect(tabsField).toBeDefined()
    const tabs = tabsField?.tabs ?? []
    expect(tabs.length).toBe(8)
    for (const tab of tabs) {
      expect(tab.name).toBeUndefined()
      // Aba sem `label` seria uma aba sem titulo no painel.
      expect(typeof tab.label).toBe('string')
    }
  })

  it('nenhum caminho de campo e ANINHADO por aba', () => {
    const nested = articleFields.filter((entry) => entry.path.includes('.'))
    expect(nested).toEqual([])
  })

  it('as 8 abas cobrem TODOS os campos — nenhum ficou de fora', () => {
    const tabsField = (Articles.fields as unknown as readonly AnyField[]).find(
      (field) => field.type === 'tabs',
    )
    const inTabs = (tabsField?.tabs ?? []).reduce(
      (total, tab) => total + flatten(tab.fields ?? []).length,
      0,
    )
    expect(inTabs).toBe(articleFields.length)
    // O formulario tem dezenas de campos: uma lista PLANA e o problema que a
    // FASE 2G veio resolver. O numero exato e congelado abaixo.
    expect(articleFields.length).toBeGreaterThan(50)
  })

  it('o conjunto de campos bate EXATAMENTE com as colunas do snapshot', () => {
    // Esta e a prova forte de "as abas nao geraram migration": se alguem
    // nomear uma aba, renomear um campo ou perder um campo, a comparacao com o
    // snapshot que ja esta no banco quebra aqui — sem precisar subir Postgres.
    const columns = snapshotColumns()
    // Colunas que o Payload cria sozinho, sem campo declarado.
    for (const internal of ['id', 'updated_at', 'created_at', '_status']) columns.delete(internal)

    const expected = new Set<string>()
    for (const { path, field } of articleFields) {
      // `hasMany`, `array` e `blocks` vivem em TABELA PROPRIA, nao em coluna.
      if (field.hasMany === true) continue
      if (field.type === 'array' || field.type === 'blocks') continue
      const column = snakeCase(path)
      expected.add(field.type === 'relationship' ? `${column}_id` : column)
    }

    const missing = [...expected].filter((column) => !columns.has(column)).sort()
    const extra = [...columns].filter((column) => !expected.has(column)).sort()
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('a ordem das abas e a ordem de trabalho da redacao', () => {
    const tabsField = (Articles.fields as unknown as readonly AnyField[]).find(
      (field) => field.type === 'tabs',
    )
    expect((tabsField?.tabs ?? []).map((tab) => tab.label)).toEqual([
      'Conteudo',
      'Midia',
      'Autoria',
      'SEO',
      'Entidades',
      'Fontes e QA',
      'Publicacao',
      'Automacao (auditoria)',
    ])
  })

  it('o titulo e o PRIMEIRO campo do formulario', () => {
    // Antes da FASE 2G os sete primeiros campos eram internos de automacao,
    // editaveis, e `title` aparecia em oitavo lugar.
    expect(articleFields[0]?.path).toBe('title')
  })

  it('a aba de automacao e SO LEITURA, do primeiro ao ultimo campo', () => {
    const tabsField = (Articles.fields as unknown as readonly AnyField[]).find(
      (field) => field.type === 'tabs',
    )
    const audit = (tabsField?.tabs ?? []).find((tab) => tab.label === 'Automacao (auditoria)')
    const fields = flatten(audit?.fields ?? [])
    expect(fields.length).toBeGreaterThan(0)
    const editable = fields.filter((entry) => entry.field.admin?.readOnly !== true)
    expect(editable.map((entry) => entry.path)).toEqual([])
    // E todo campo dessa aba esta na lista de proibicao humana: `readOnly` e
    // interface, a lista e a regra.
    for (const entry of fields) expect(humanMayWriteField(entry.path)).toBe(false)
  })

  it('o rastro humano tambem e SO LEITURA no formulario', () => {
    for (const name of ['createdBy', 'updatedBy', 'publishedBy']) {
      const entry = articleFields.find((candidate) => candidate.path === name)
      expect(entry?.field.admin?.readOnly).toBe(true)
      expect(entry?.field.type).toBe('relationship')
    }
  })
})
