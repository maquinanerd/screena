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

import type { Access, CollectionConfig } from 'payload'

import {
  articlesAccess,
  editorialAssetAccess,
  identityAccess,
  outboxAccess,
  type Actor,
} from './access.js'
import { EDITORIAL_ROLES, WORKFLOW_STATUSES } from './workflow.js'
import { OUTBOX_STATUSES } from './outbox.js'

/* ------------------------------------------------------------------ */
/* Ponte entre o `req.user` do Payload e o `Actor` puro                */
/* ------------------------------------------------------------------ */

interface PayloadUserLike {
  readonly id?: unknown
  readonly collection?: unknown
  readonly role?: unknown
}

/**
 * Converte o usuario autenticado pelo Payload no `Actor` das regras puras.
 *
 * Fail-closed: qualquer coisa que nao seja um usuario reconhecido vira
 * `anonymous`, e `anonymous` nao passa em nenhuma politica.
 */
export function toActor(user: unknown): Actor {
  if (user === null || typeof user !== 'object') return { kind: 'anonymous' }
  const candidate = user as PayloadUserLike
  const id = typeof candidate.id === 'string' ? candidate.id : String(candidate.id ?? '')
  if (id === '') return { kind: 'anonymous' }

  if (candidate.collection === 'service-accounts') return { kind: 'service', id }
  if (candidate.collection === 'editorial-users') {
    const role = candidate.role
    if (typeof role === 'string' && (EDITORIAL_ROLES as readonly string[]).includes(role)) {
      return { kind: 'human', id, role: role as Actor extends { role: infer R } ? R : never }
    }
  }
  return { kind: 'anonymous' }
}

/** Adapta uma politica pura para a assinatura de `access` do Payload. */
function policy(decide: (actor: Actor) => boolean): Access {
  return ({ req }) => decide(toActor(req.user))
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
    read: policy(identityAccess.read),
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
    read: policy(identityAccess.read),
    update: policy(identityAccess.update),
    delete: policy(identityAccess.delete),
  },
  fields: [
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
    staticDir: 'media',
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
      options: ['news', 'feature', 'guide', 'list', 'interview', 'evergreen'],
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
    { name: 'lockedAt', type: 'date' },
    { name: 'processedAt', type: 'date' },
    { name: 'lastError', type: 'textarea' },
  ],
}

export const collections: CollectionConfig[] = [
  EditorialUsers,
  ServiceAccounts,
  Authors,
  Media,
  Articles,
  PublicationOutbox,
]
