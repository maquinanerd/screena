/**
 * collections.ts — Collections do CMS editorial da Cinerie.
 *
 * Duas identidades SEPARADAS de proposito:
 *  - `editorial-users`  — humanos, login local, papeis editoriais;
 *  - `service-accounts` — maquinas (MNScr), somente API key, sem login local.
 *
 * Manter as duas numa collection so com um papel `automation` faria a conta
 * tecnica herdar, por descuido de um `access` mal escrito, qualquer poder
 * concedido a humanos. Separadas, a automacao nao tem sequer a forma de um
 * publicador.
 *
 * Todo `access` daqui delega para `./access.js`, que e puro e testado sem CMS.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Access, CollectionConfig } from 'payload'

import { PUBLICATION_CONTENT_TYPES } from '@screena/editorial-contracts'

import { QUOTA_DIMENSIONS } from './quota.js'
import {
  isAdministrator,
  articlesAccess,
  editorialAssetAccess,
  identityAccess,
  outboxAccess,
  type Actor,
} from './access.js'
import { toActor as resolveActor } from './actor.js'
import { emitPublicationEvent, enforceEditorialGovernance } from './hooks/articles.js'
import { EDITORIAL_ROLES, WORKFLOW_STATUSES } from './workflow.js'
import { OUTBOX_STATUSES } from './outbox.js'
import { SERVICE_ACCOUNT_SCOPES } from './outbox-api.js'

/**
 * Raiz dos uploads locais, ABSOLUTA e ancorada no diretorio de `apps/cms`.
 *
 * Vem de `PAYLOAD_UPLOAD_LOCAL_ROOT` quando configurado (o caminho do volume
 * persistente no deploy). O default local existe so para desenvolvimento — em
 * `production`, `resolvePayloadUploadConfig` recusa driver local sem
 * confirmacao explicita de persistencia.
 *
 * Caminho ABSOLUTO sempre: um `'media'` relativo resolve contra o `cwd` do
 * PROCESSO, e quem grava pela Local API de outro diretorio deposita o arquivo
 * num `media/` diferente do que o servidor le — a imagem "some" com 404 sem
 * erro nenhum no caminho (defeito real da FASE 2D).
 */
const MEDIA_STATIC_DIR =
  process.env.PAYLOAD_UPLOAD_LOCAL_ROOT?.trim() ||
  process.env.EDITORIAL_MEDIA_CMS_STATIC_DIR?.trim() ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'media')

/* ------------------------------------------------------------------ */
/* Ponte entre o `req.user` do Payload e o `Actor` puro                */
/* ------------------------------------------------------------------ */

// `toActor` vive em `./actor.js`: os hooks tambem precisam dele e sao
// registrados AQUI dentro, entao mante-lo neste arquivo criaria um ciclo.
export { toActor } from './actor.js'

/** Adapta uma politica pura para a assinatura de `access` do Payload. */
function policy(decide: (actor: Actor) => boolean): Access {
  return ({ req }) => decide(resolveActor(req.user))
}

/**
 * Leitura de identidade: administrador ve tudo; qualquer principal autenticado
 * ve APENAS o proprio documento.
 *
 * Sem a parte do "proprio documento", `/api/<slug>/me` devolve um documento
 * vazio — o Payload autentica, mas o access control filtra todos os campos. Um
 * principal ler a si mesmo nao vaza nada: a API key vive cifrada em `apiKey` e
 * o indice esta marcado como `hidden`.
 */
const readOwnIdentity: Access = ({ req }) => {
  const actor = resolveActor(req.user)
  if (identityAccess.read(actor)) return true
  if (actor.kind === 'anonymous') return false
  return { id: { equals: actor.id } }
}

/* ------------------------------------------------------------------ */
/* Blocos do corpo (espelham @screena/editorial-contracts)             */
/* ------------------------------------------------------------------ */

const provenanceField = {
  name: 'provenance',
  type: 'array' as const,
  maxRows: 10,
  admin: { description: 'De onde veio este bloco. O writer nao e fonte primaria.' },
  fields: [
    {
      name: 'origin',
      type: 'select' as const,
      required: true,
      options: [
        'external_source',
        'cinerie_catalog',
        'cinerie_editorial',
        'licensed_media',
        'human_input',
        'inference',
      ],
    },
    { name: 'ref', type: 'text' as const },
  ],
}

const blockIdField = {
  name: 'blockId',
  type: 'text' as const,
  required: true,
  admin: { description: 'Id estavel: ancora comentario e correcao entre versoes.' },
}

/**
 * Blocos do corpo. NAO existe bloco de HTML livre — o corpo e estruturado, e a
 * ausencia desse bloco e a defesa contra injecao vinda do writer.
 */
export const editorialBlocks = [
  {
    slug: 'paragraph',
    fields: [blockIdField, { name: 'text', type: 'textarea' as const, required: true }, provenanceField],
  },
  {
    slug: 'heading',
    fields: [
      blockIdField,
      { name: 'level', type: 'select' as const, required: true, options: ['2', '3', '4'] },
      { name: 'text', type: 'text' as const, required: true },
    ],
  },
  {
    slug: 'image',
    fields: [
      blockIdField,
      { name: 'media', type: 'relationship' as const, relationTo: 'media' as const, required: true },
      { name: 'alt', type: 'text' as const, required: true },
      { name: 'caption', type: 'text' as const },
      { name: 'credit', type: 'text' as const },
    ],
  },
  {
    slug: 'video',
    fields: [
      blockIdField,
      {
        name: 'provider',
        type: 'select' as const,
        required: true,
        options: ['youtube', 'vimeo', 'internal'],
      },
      { name: 'externalId', type: 'text' as const },
      { name: 'url', type: 'text' as const },
      { name: 'title', type: 'text' as const },
      { name: 'credit', type: 'text' as const },
    ],
  },
  {
    slug: 'quote',
    fields: [
      blockIdField,
      { name: 'text', type: 'textarea' as const, required: true },
      { name: 'attribution', type: 'text' as const },
      { name: 'sourceRef', type: 'text' as const },
    ],
  },
  {
    slug: 'entityCard',
    fields: [
      blockIdField,
      {
        name: 'entityKind',
        type: 'select' as const,
        required: true,
        options: ['movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise'],
      },
      { name: 'entityId', type: 'text' as const, required: true },
      { name: 'note', type: 'text' as const },
    ],
  },
  {
    slug: 'factBox',
    fields: [
      blockIdField,
      { name: 'title', type: 'text' as const, required: true },
      {
        name: 'items',
        type: 'array' as const,
        minRows: 1,
        maxRows: 30,
        fields: [
          { name: 'label', type: 'text' as const, required: true },
          { name: 'value', type: 'text' as const, required: true },
        ],
      },
    ],
  },
  {
    slug: 'relatedContent',
    fields: [
      blockIdField,
      { name: 'articleRefs', type: 'text' as const, hasMany: true, required: true },
    ],
  },
  {
    slug: 'sourceList',
    fields: [blockIdField, { name: 'sourceRefs', type: 'text' as const, hasMany: true, required: true }],
  },
  { slug: 'divider', fields: [blockIdField] },
]

/* ------------------------------------------------------------------ */
/* editorial-users — humanos                                           */
/* ------------------------------------------------------------------ */

export const EditorialUsers: CollectionConfig = {
  slug: 'editorial-users',
  auth: true,
  admin: { useAsTitle: 'email', group: 'Identidade' },
  access: {
    create: policy(identityAccess.create),
    read: readOwnIdentity,
    update: policy(identityAccess.update),
    delete: policy(identityAccess.delete),
  },
  fields: [
    { name: 'displayName', type: 'text', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'writer',
      options: [...EDITORIAL_ROLES],
      admin: { description: 'Papel efetivo. Publicacao exige editor_in_chief ou administrator.' },
    },
    { name: 'active', type: 'checkbox', defaultValue: true },
  ],
}

/* ------------------------------------------------------------------ */
/* service-accounts — maquinas                                         */
/* ------------------------------------------------------------------ */

export const ServiceAccounts: CollectionConfig = {
  slug: 'service-accounts',
  auth: {
    useAPIKey: true,
    // Sem login local: uma conta de maquina nao tem senha para vazar nem tela
    // de login para forcar. A unica credencial e a API key.
    disableLocalStrategy: true,
  },
  admin: {
    useAsTitle: 'label',
    group: 'Identidade',
    // Nao aparece na navegacao: nao e superficie de trabalho editorial.
    hidden: true,
  },
  access: {
    create: policy(identityAccess.create),
    read: readOwnIdentity,
    update: policy(identityAccess.update),
    delete: policy(identityAccess.delete),
  },
  fields: [
    // O Payload adiciona `apiKey` como campo base quando `useAPIKey` esta ligado,
    // com um `afterRead` que DECIFRA a chave. Como a conta agora pode ler o
    // proprio documento (`readOwnIdentity`, para `/me` funcionar), sem esta
    // sobrescrita a chave em texto claro voltaria na resposta de `/me` — foi
    // exatamente o que o teste de vazamento pegou. Uma credencial nunca e
    // legivel depois de criada.
    { name: 'apiKey', type: 'text', access: { read: () => false } },
    { name: 'label', type: 'text', required: true },
    {
      name: 'purpose',
      type: 'select',
      required: true,
      defaultValue: 'mnscr',
      options: ['mnscr', 'internal_tooling'],
    },
    { name: 'active', type: 'checkbox', defaultValue: false },
    {
      name: 'scopes',
      type: 'select',
      hasMany: true,
      // NAO e `required`. Lista vazia e um estado legitimo e util: e assim que
      // se REVOGA o acesso de uma conta tecnica sem apaga-la (e sem perder a
      // trilha de quem ela era). A trava nao esta no formulario e sim na
      // politica: `serviceHasScope` nega tudo para lista vazia. Exigir um
      // escopo aqui obrigaria a excluir a conta para tirar o poder dela.
      defaultValue: [],
      options: [...SERVICE_ACCOUNT_SCOPES],
      admin: {
        description:
          'Poderes EXPLICITOS. Um booleano generico de automacao daria ao MNScr o direito de consumir a outbox e ao worker de projecao o direito de criar drafts. Lista vazia = conta sem nenhum poder.',
      },
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: { description: 'Nunca registre a chave aqui. A API key vive so no Payload.' },
    },
  ],
}

/* ------------------------------------------------------------------ */
/* authors — autoria publica                                           */
/* ------------------------------------------------------------------ */

export const Authors: CollectionConfig = {
  slug: 'authors',
  admin: { useAsTitle: 'name', group: 'Editorial' },
  versions: true,
  access: {
    create: policy(editorialAssetAccess.create),
    read: policy(editorialAssetAccess.read),
    update: policy(editorialAssetAccess.update),
    delete: policy(editorialAssetAccess.delete),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'relationship', relationTo: 'media' },
    { name: 'roleLabel', type: 'text' },
    { name: 'publicEmail', type: 'email' },
    { name: 'sameAs', type: 'text', hasMany: true },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      admin: { description: 'Autor inativo nao pode ser associado a nova publicacao.' },
    },

    // ------------------------------------------------------------------
    // Politica de ASSINATURA AUTOMATICA (FASE 2F)
    //
    // A autorizacao e do AUTOR, nao do pipeline: quem decide como o proprio
    // nome e usado e ele. Uma redatora pode aceitar assinar `news` automatico e
    // recusar `review` — e essa decisao mora aqui, no documento dela.
    //
    // Todos nascem FECHADOS. Ausencia de decisao e proibicao.
    // ------------------------------------------------------------------
    {
      name: 'automationPublishingAllowed',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Este autor aceita assinar materia publicada AUTOMATICAMENTE pelo pipeline? Nasce desligado.',
      },
    },
    {
      name: 'allowedAutomationContentTypes',
      type: 'select',
      hasMany: true,
      defaultValue: [],
      options: ['news', 'feature', 'guide', 'list', 'interview', 'evergreen'],
      admin: {
        description:
          'Vazio = sem restricao de tipo. Preenchido = SOMENTE estes tipos podem ser assinados automaticamente.',
      },
    },
    {
      name: 'allowedAutomationSections',
      type: 'text',
      hasMany: true,
      defaultValue: [],
      admin: { description: 'Vazio = sem restricao de secao.' },
    },
    {
      name: 'automationDailyLimit',
      type: 'number',
      admin: {
        description:
          'Teto diario proprio deste autor. Vazio = sem teto proprio (o teto global continua valendo).',
      },
    },
    {
      name: 'automationAttributionModes',
      type: 'select',
      hasMany: true,
      defaultValue: [],
      options: ['byline', 'newsroom', 'assisted'],
      admin: {
        description:
          'Como este autor aceita ser creditado em publicacao automatica. Vazio = nenhum modo aceito.',
      },
    },
    {
      name: 'isOrganization',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Marque para entidades editoriais como "Redacao Cinerie".' },
    },
    { name: 'createdBy', type: 'relationship', relationTo: 'editorial-users' },
    { name: 'updatedBy', type: 'relationship', relationTo: 'editorial-users' },
  ],
}

/* ------------------------------------------------------------------ */
/* media — midia editorial licenciada                                  */
/* ------------------------------------------------------------------ */

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { useAsTitle: 'alt', group: 'Editorial' },
  upload: {
    // Filesystem local: DESENVOLVIMENTO apenas. `payload.config.ts` recusa este
    // arranjo em producao, onde disco efemero significaria perder a midia.
    //
    // Caminho ABSOLUTO, ancorado no diretorio da aplicacao. Um `'media'`
    // relativo resolve contra o `cwd` do PROCESSO: quem grava pela Local API a
    // partir de outro diretorio (um worker, um script, a suite de integracao)
    // deposita o arquivo num `media/` diferente do que o servidor le, e a midia
    // simplesmente "some" com 404 sem nenhum erro no meio do caminho.
    staticDir: MEDIA_STATIC_DIR,
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'],
  },
  access: {
    create: policy(editorialAssetAccess.create),
    read: policy(editorialAssetAccess.read),
    update: policy(editorialAssetAccess.update),
    delete: policy(editorialAssetAccess.delete),
  },
  fields: [
    { name: 'alt', type: 'text', required: true },
    { name: 'caption', type: 'text' },
    { name: 'credit', type: 'text' },
    { name: 'sourceName', type: 'text' },
    { name: 'sourceUrl', type: 'text' },
    { name: 'rightsHolder', type: 'text' },
    {
      name: 'licenseStatus',
      type: 'select',
      required: true,
      // Default seguro: midia recem-enviada NAO publica ate decisao humana.
      defaultValue: 'unknown',
      options: ['unknown', 'pending', 'approved', 'restricted', 'expired', 'prohibited'],
    },
    { name: 'licenseReference', type: 'text' },
    { name: 'licenseExpiresAt', type: 'date' },
    { name: 'requiresAttribution', type: 'checkbox', defaultValue: true },
    // As tres permissoes nascem FALSE. Ausencia de decisao = proibicao.
    { name: 'allowedForEditorial', type: 'checkbox', defaultValue: false },
    { name: 'allowedForHero', type: 'checkbox', defaultValue: false },
    { name: 'allowedForSocial', type: 'checkbox', defaultValue: false },
    { name: 'aspectRatio', type: 'text' },
    {
      name: 'focalPoint',
      type: 'group',
      fields: [
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
      ],
    },
    { name: 'contentHash', type: 'text' },
    {
      name: 'provenanceType',
      type: 'select',
      required: true,
      defaultValue: 'external_source',
      options: [
        'external_source',
        'cinerie_catalog',
        'cinerie_editorial',
        'licensed_media',
        'human_input',
      ],
    },
    { name: 'restrictions', type: 'text', hasMany: true },
  ],
}

/* ------------------------------------------------------------------ */
/* articles — a materia                                                */
/* ------------------------------------------------------------------ */

export const Articles: CollectionConfig = {
  slug: 'articles',
  admin: { useAsTitle: 'title', group: 'Editorial' },
  // Os hooks sao o UNICO caminho por onde uma mudanca de estado passa — venha
  // ela do painel, da REST API ou da Local API. Sem eles, `_status: published`
  // publicaria por fora do fluxo editorial.
  hooks: {
    beforeChange: [enforceEditorialGovernance],
    afterChange: [emitPublicationEvent],
  },
  versions: {
    drafts: { autosave: { interval: 2_000 } },
    maxPerDoc: 0,
  },
  access: {
    create: policy(articlesAccess.create),
    read: policy(articlesAccess.read),
    update: policy(articlesAccess.update),
    delete: policy(articlesAccess.delete),
  },
  fields: [
    // --- Identidade e idempotencia (preenchidos pelo endpoint) ---
    { name: 'automationDraftId', type: 'text', index: true },
    { name: 'idempotencyKey', type: 'text', index: true },
    { name: 'sourceClusterId', type: 'text', index: true },
    { name: 'sourceRevision', type: 'number' },
    { name: 'sourcePayloadHash', type: 'text' },
    { name: 'draftPayloadHash', type: 'text' },
    { name: 'pipelineVersion', type: 'text' },

    // --- Conteudo ---
    { name: 'title', type: 'text', required: true },
    { name: 'subtitle', type: 'text' },
    { name: 'slug', type: 'text', index: true },
    { name: 'summary', type: 'textarea' },
    {
      name: 'contentType',
      type: 'select',
      required: true,
      defaultValue: 'news',
      // FONTE UNICA. A lista literal duplicada aqui divergiu do contrato quando
      // `review` foi acrescentado la: o pedido passava na validacao e a
      // publicacao morria na persistencia, com 503 e sem materia.
      options: [...PUBLICATION_CONTENT_TYPES],
    },
    { name: 'language', type: 'text', required: true, defaultValue: 'pt-BR' },
    { name: 'body', type: 'blocks', blocks: editorialBlocks },
    { name: 'heroMedia', type: 'relationship', relationTo: 'media' },
    { name: 'gallery', type: 'relationship', relationTo: 'media', hasMany: true },

    // --- Autoria ---
    { name: 'authors', type: 'relationship', relationTo: 'authors', hasMany: true },
    { name: 'primaryAuthor', type: 'relationship', relationTo: 'authors' },

    // --- Organizacao PROVISORIA (a taxonomia publica nao vive aqui) ---
    { name: 'section', type: 'text' },
    { name: 'internalTags', type: 'text', hasMany: true },

    // --- Relacoes (sugeridas pela automacao, confirmadas por humano) ---
    {
      name: 'entityReferences',
      type: 'array',
      fields: [
        {
          name: 'entityKind',
          type: 'select',
          required: true,
          options: ['movie', 'tv', 'season', 'episode', 'person', 'character', 'franchise'],
        },
        { name: 'entityId', type: 'text', required: true },
        {
          name: 'relation',
          type: 'select',
          required: true,
          options: [
            'primary_subject',
            'secondary_subject',
            'mentioned',
            'reviewed',
            'recommended',
            'compared',
          ],
        },
        { name: 'confidence', type: 'number' },
        {
          name: 'verified',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'So um humano marca. A automacao envia sempre false.' },
        },
      ],
    },
    { name: 'relatedArticleReferences', type: 'relationship', relationTo: 'articles', hasMany: true },

    // --- Governanca ---
    // ------------------------------------------------------------------
    // PUBLICACAO AUTOMATICA (FASE 2F)
    //
    // Aqui mora o ATOR TECNICO — quem operou. O AUTOR PUBLICO continua sendo
    // `primaryAuthor`/`authors`, e e ele que aparece na ficha e no JSON-LD.
    // Manter os dois separados e o que impede a automacao de virar "autor" na
    // materia (falso) ou de sumir do registro (pior).
    // ------------------------------------------------------------------
    {
      name: 'autoPublished',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Publicada automaticamente pelo pipeline, sem revisao previa.' },
    },
    { name: 'automationActorId', type: 'text', admin: { readOnly: true } },
    {
      name: 'automationActorLabel',
      type: 'text',
      admin: { readOnly: true, description: 'Rotulo da conta tecnica no momento da operacao.' },
    },
    {
      name: 'automationScopesUsed',
      type: 'text',
      hasMany: true,
      defaultValue: [],
      admin: {
        readOnly: true,
        description:
          'Escopos EFETIVAMENTE usados, derivados da credencial. Nunca declarados pelo cliente.',
      },
    },
    {
      name: 'automationReceivedAt',
      type: 'date',
      admin: {
        readOnly: true,
        description:
          'Instante em que o SERVIDOR recebeu o pedido. Distinto de `generatedAt`, que e o relogio do produtor e nao e confiavel para auditoria.',
      },
    },
    {
      name: 'automationIdempotencyKey',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Chave do pedido. Reenvio identico nao duplica.' },
    },
    { name: 'automationSourceRevision', type: 'number', admin: { readOnly: true } },
    { name: 'automationPayloadHash', type: 'text', admin: { readOnly: true } },
    { name: 'automationPipelineVersion', type: 'text', admin: { readOnly: true } },
    { name: 'automationContractVersion', type: 'text', admin: { readOnly: true } },
    { name: 'automationContractName', type: 'text', admin: { readOnly: true } },
    { name: 'automationSchemaHash', type: 'text', admin: { readOnly: true } },
    {
      name: 'automationAttributionMode',
      type: 'select',
      options: ['byline', 'newsroom', 'assisted'],
      admin: { readOnly: true },
    },

    // SEO revalidado. Sao SUGESTOES do pipeline que o CMS aceitou — nunca
    // canonical, robots, datas ou JSON-LD, que pertencem ao lado publico.
    { name: 'focusKeyphrase', type: 'text' },
    { name: 'relatedKeyphrases', type: 'text', hasMany: true, defaultValue: [] },
    { name: 'editorialKeywords', type: 'text', hasMany: true, defaultValue: [] },
    {
      name: 'schemaTypeRecommendation',
      type: 'select',
      options: ['NewsArticle', 'Article', 'Review', 'ItemList', 'HowTo'],
      admin: { description: 'RECOMENDACAO. O JSON-LD final e montado pelo screen-app.' },
    },
    { name: 'articleSection', type: 'text' },

    {
      name: 'externalSources',
      type: 'array',
      fields: [
        { name: 'sourceId', type: 'text', required: true },
        { name: 'name', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
        {
          name: 'role',
          type: 'select',
          required: true,
          options: ['primary', 'secondary', 'press_release', 'catalog'],
        },
      ],
    },
    {
      name: 'claims',
      type: 'array',
      fields: [
        { name: 'claimId', type: 'text', required: true },
        { name: 'text', type: 'textarea', required: true },
        {
          name: 'origin',
          type: 'select',
          required: true,
          options: [
            'external_source',
            'cinerie_catalog',
            'cinerie_editorial',
            'licensed_media',
            'human_input',
            'inference',
          ],
        },
        { name: 'sourceRefs', type: 'text', hasMany: true },
        { name: 'conflictsWith', type: 'text', hasMany: true },
      ],
    },
    { name: 'provenanceJson', type: 'json' },
    { name: 'aiAssisted', type: 'checkbox', defaultValue: false },
    { name: 'assignedTo', type: 'relationship', relationTo: 'editorial-users' },
    {
      name: 'legalHold',
      type: 'checkbox',
      defaultValue: false,
      admin: { description: 'Retencao juridica: bloqueia publicacao ate liberacao.' },
    },
    { name: 'blockingErrors', type: 'text', hasMany: true },
    { name: 'warnings', type: 'text', hasMany: true },
    { name: 'qaVersion', type: 'text' },
    { name: 'qaPassedAt', type: 'date' },

    // --- Publicacao ---
    {
      name: 'workflowStatus',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      index: true,
      options: [...WORKFLOW_STATUSES],
      admin: {
        description:
          'Fonte da verdade do fluxo editorial. `_status` do Payload tem 2 valores; o fluxo real tem 12.',
      },
    },
    { name: 'scheduledFor', type: 'date' },
    { name: 'publishedAt', type: 'date' },
    { name: 'correctedAt', type: 'date' },
    { name: 'correctionNote', type: 'textarea' },
    { name: 'retractionReason', type: 'textarea' },

    // --- SEO ---
    { name: 'metaTitle', type: 'text' },
    { name: 'metaDescription', type: 'textarea' },
    { name: 'canonicalOverride', type: 'text' },
    { name: 'noindex', type: 'checkbox', defaultValue: false },
    { name: 'socialTitle', type: 'text' },
    { name: 'socialDescription', type: 'textarea' },
    { name: 'socialMedia', type: 'relationship', relationTo: 'media' },
  ],
}

/* ------------------------------------------------------------------ */
/* publication-outbox — canal para o lado publico                      */
/* ------------------------------------------------------------------ */

export const PublicationOutbox: CollectionConfig = {
  slug: 'publication-outbox',
  admin: {
    useAsTitle: 'idempotencyKey',
    group: 'Sistema',
    // Nao e superficie editorial: ninguem edita evento a mao.
    hidden: true,
  },
  access: {
    create: outboxAccess.create,
    read: policy(outboxAccess.read),
    update: outboxAccess.update,
    delete: outboxAccess.delete,
  },
  fields: [
    { name: 'eventId', type: 'text', required: true, unique: true },
    { name: 'idempotencyKey', type: 'text', required: true, unique: true, index: true },
    {
      name: 'eventType',
      type: 'select',
      required: true,
      options: [
        'article.published',
        'article.updated',
        'article.unpublished',
        'article.retracted',
      ],
    },
    { name: 'aggregateType', type: 'text', required: true, defaultValue: 'article' },
    { name: 'aggregateId', type: 'text', required: true, index: true },
    { name: 'aggregateVersion', type: 'text', required: true },
    { name: 'payload', type: 'json', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      index: true,
      options: [...OUTBOX_STATUSES],
    },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0 },
    { name: 'availableAt', type: 'date', required: true },
    // LEASE: o que impede dois workers de projetarem o mesmo evento. O token e
    // aleatorio por claim, entao um ack atrasado (lease ja expirada e evento
    // reclamado por outro) nao consegue confirmar trabalho alheio.
    { name: 'leaseToken', type: 'text', index: true },
    { name: 'lockedBy', type: 'text' },
    { name: 'lockedAt', type: 'date' },
    { name: 'leaseExpiresAt', type: 'date', index: true },
    { name: 'processedAt', type: 'date' },
    { name: 'errorCode', type: 'text' },
    { name: 'lastError', type: 'textarea' },
  ],
}

/**
 * Contadores de quota. INTERNOS.
 *
 * Ninguem cria, edita ou apaga pela UI: a linha nasce e cresce dentro da
 * transacao de publicacao. Um humano mexendo aqui mudaria o teto do dia sem
 * passar por nenhuma decisao editorial — e sem deixar rastro do porque.
 *
 * A UNIQUE composta e o que sustenta o algoritmo: sem ela, duas transacoes que
 * nao encontrassem a linha do dia criariam DUAS, e o teto valeria o dobro.
 */
const AutoPublishQuotaCounters: CollectionConfig = {
  // Slug CURTO de proposito: o Payload deriva nomes de enum e indice a partir
  // dele, e o Postgres corta identificadores em 63 caracteres. Um slug
  // descritivo demais estoura esse teto e a migration falha na criacao.
  slug: 'autopublish-quota-counters',
  admin: {
    useAsTitle: 'dimensionKey',
    group: 'Editorial',
    // Visivel para auditoria, nunca editavel.
    hidden: ({ user }) => resolveActor(user).kind !== 'human',
  },
  access: {
    create: () => false,
    read: policy(isAdministrator),
    update: () => false,
    delete: () => false,
  },
  indexes: [
    {
      // Identidade da janela. `timeZone` entra na chave junto com a data porque
      // mudar o fuso da operacao nao pode reaproveitar baldes do fuso antigo —
      // eles cobrem intervalos diferentes de tempo real.
      fields: ['timeZone', 'localDate', 'dimensionType', 'dimensionKey'],
      unique: true,
    },
  ],
  fields: [
    { name: 'timeZone', type: 'text', required: true },
    { name: 'localDate', type: 'text', required: true },
    {
      name: 'dimensionType',
      type: 'select',
      required: true,
      options: [...QUOTA_DIMENSIONS],
    },
    { name: 'dimensionKey', type: 'text', required: true },
    { name: 'currentCount', type: 'number', required: true, defaultValue: 0 },
    {
      name: 'limitSnapshot',
      type: 'number',
      required: true,
      admin: {
        description:
          'Teto vigente quando o contador subiu. Um dia auditado precisa saber contra QUE limite ele corria, nao o limite de hoje.',
      },
    },
    { name: 'windowStartUtc', type: 'date', required: true },
    { name: 'windowEndUtc', type: 'date', required: true },
  ],
}

/**
 * Registro de consumo. INTERNO.
 *
 * Os contadores dizem QUANTO foi usado; este registro diz POR QUE. Sem ele, um
 * numero divergente seria impossivel de reconstruir.
 *
 * A UNIQUE em `requestId` e a segunda linha de defesa da idempotencia: se a
 * resolucao anterior falhar em enxergar o pedido repetido, a colisao aqui aborta
 * a transacao inteira e nenhum contador sobrevive.
 */
const AutoPublishQuotaUsage: CollectionConfig = {
  slug: 'autopublish-quota-usage',
  admin: {
    useAsTitle: 'requestId',
    group: 'Editorial',
    hidden: ({ user }) => resolveActor(user).kind !== 'human',
  },
  access: {
    create: () => false,
    read: policy(isAdministrator),
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'idempotencyKey', type: 'text', required: true, index: true },
    { name: 'sourceClusterId', type: 'text', required: true },
    { name: 'sourceRevision', type: 'number', required: true },
    { name: 'articleId', type: 'text', index: true },
    { name: 'publicAuthorId', type: 'text', required: true },
    {
      name: 'publicationIntent',
      type: 'select',
      required: true,
      options: ['publish', 'update'],
    },
    { name: 'localDate', type: 'text', required: true },
    { name: 'timeZone', type: 'text', required: true },
    { name: 'dimensionsConsumed', type: 'text', hasMany: true, defaultValue: [] },
    { name: 'consumedAt', type: 'date', required: true },
    { name: 'serviceAccountId', type: 'text', required: true },
    { name: 'pipelineVersion', type: 'text' },
  ],
}

export const collections: CollectionConfig[] = [
  EditorialUsers,
  ServiceAccounts,
  Authors,
  Media,
  Articles,
  PublicationOutbox,
  AutoPublishQuotaCounters,
  AutoPublishQuotaUsage,
]
