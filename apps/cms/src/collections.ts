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
 * ve APENAS o proprio documento, e SOMENTE na collection a que ele pertence.
 *
 * Sem a parte do "proprio documento", `/api/<slug>/me` devolve um documento
 * vazio — o Payload autentica, mas o access control filtra todos os campos.
 *
 * O parametro `ownerKind` nao e cerimonia. O filtro devolvido e
 * `{ id: { equals: <id do ator> } }`, e `editorial_users` e `service_accounts`
 * sao tabelas SEPARADAS, cada uma com autoincrement proprio: o id 2 existe nas
 * duas e nao aponta para a mesma pessoa nem para a mesma coisa. Aplicar o filtro
 * sem checar a collection de origem fazia um editor-chefe de id 2 ler a conta
 * tecnica de id 2 (label, purpose, scopes, notes) e uma conta tecnica de id 1
 * ler o `editorial-users` de id 1 (e-mail, nome, papel do administrador).
 *
 * Isso estava mascarado por `admin.hidden: true`: o item nao aparecia no menu, e
 * a REST API continuava respondendo. Esconder nao e negar.
 */
function readOwnIdentity(ownerKind: 'human' | 'service'): Access {
  return ({ req }) => {
    const actor = resolveActor(req.user)
    if (identityAccess.read(actor)) return true
    // Anonimo primeiro, e separado: e o unico membro de `Actor` sem `id`, e
    // descarta-lo aqui e o que deixa `actor.id` bem tipado abaixo.
    if (actor.kind === 'anonymous') return false
    // Principal de OUTRA natureza nao tem "proprio documento" nesta collection.
    if (actor.kind !== ownerKind) return false
    return { id: { equals: actor.id } }
  }
}

/**
 * A collection de contas tecnicas aparece no menu SO para administrador.
 *
 * Espelha exatamente `identityAccess` (as quatro operacoes exigem
 * `isAdministrator`): mostrar no menu o que a politica recusa produziria uma
 * tela de erro em vez de uma navegacao honesta.
 *
 * `hidden` e apenas INTERFACE — a negacao real esta em `access`. As duas
 * caminham juntas de proposito; nenhuma substitui a outra.
 */
const hiddenFromNonAdministrators = ({ user }: { user?: unknown }): boolean =>
  !isAdministrator(resolveActor(user))

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
  admin: {
    // NASCE SOZINHO. Era digitado a mao em todo bloco — quinze identificadores
    // inventados por pessoa numa materia de quinze blocos. O componente gera na
    // criacao e mostra em leitura; a ancora continua existindo e continua
    // estavel a reordenacao (ver `block-id.ts`).
    components: { Field: '/src/admin/BlockIdField' },
    description: 'Âncora deste trecho. Gerada automaticamente.',
  },
}

/**
 * Rotulo da linha recolhida, para TODO bloco.
 *
 * Sem isto o painel mostra "01 Paragraph Untitled" quinze vezes numa materia de
 * quinze blocos, e achar um paragrafo exige abrir um por um.
 *
 * A chave e `Label`, nao `RowLabel`: em bloco o Payload chama o componente de
 * `admin.components.Label` (`fields/Blocks/BlockRow.js:142-143`); `RowLabel` e a
 * chave do campo `array`. O contexto de linha, esse, e o mesmo dos dois — o
 * `RowLabelProvider` deriva `data` do caminho da linha, entao `useRowLabel`
 * enxerga o bloco inteiro.
 */
const blockRowLabel = { components: { Label: '/src/admin/BlockRowLabel' } }

/**
 * Blocos do corpo. NAO existe bloco de HTML livre — o corpo e estruturado, e a
 * ausencia desse bloco e a defesa contra injecao vinda do writer.
 */
export const editorialBlocks = [
  {
    slug: 'paragraph',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      {
        name: 'text',
        type: 'textarea' as const,
        required: true,
        // Editor Lexical com negrito/italico/link. Colar de fora vira N blocos
        // PRESERVANDO formatacao; Enter no fim cria o proximo; bloco vazio avisa
        // DURANTE a escrita, e nao so na recusa da publicacao.
        admin: { components: { Field: '/src/admin/ParagraphTextField' } },
      },
      {
        name: 'marks',
        type: 'json' as const,
        // Intervalos `{ start, end, type }` sobre `text`. Escrito SO pelo editor
        // acima — nao ha campo proprio na tela porque um humano editando offset
        // a mao produziria marcacao desalinhada do texto, que e o unico jeito de
        // quebrar isto. O texto continua limpo: a formatacao viaja ao lado, e
        // nenhuma tag entra em `text` (contrato: `common.ts:58`).
        admin: { hidden: true },
      },
      provenanceField,
    ],
  },
  {
    slug: 'heading',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      {
        name: 'level',
        type: 'select' as const,
        required: true,
        label: 'Nível',
        // NASCE em h2: o corpo comeca em h2 porque h1 pertence ao titulo da
        // pagina. Antes nascia VAZIO e oferecia "2 / 3 / 4" cru.
        defaultValue: '2',
        options: [
          { label: 'H2 — seção principal', value: '2' },
          { label: 'H3 — subseção', value: '3' },
          { label: 'H4 — detalhe', value: '4' },
        ],
      },
      { name: 'text', type: 'text' as const, required: true, label: 'Texto' },
    ],
  },
  {
    slug: 'image',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      { name: 'media', type: 'relationship' as const, relationTo: 'media' as const, required: true },
      { name: 'alt', type: 'text' as const, required: true, label: 'Texto alternativo' },
      { name: 'caption', type: 'text' as const, label: 'Legenda' },
      { name: 'credit', type: 'text' as const, label: 'Crédito' },
    ],
  },
  {
    slug: 'video',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      {
        name: 'provider',
        type: 'select' as const,
        required: true,
        label: 'Origem do vídeo',
        // `internal` e legal no contrato e MORRE no renderizador publico:
        // `article-body-presenter.ts` devolve null para tudo que nao seja
        // youtube/vimeo, e o bloco some da pagina sem deixar rastro. O valor
        // continua aqui (removê-lo mudaria o contrato, que nao e desta
        // entrega); o rotulo passa a dizer a verdade antes da publicacao.
        options: [
          { label: 'YouTube', value: 'youtube' },
          { label: 'Vimeo', value: 'vimeo' },
          { label: 'Interno — ainda não aparece no site', value: 'internal' },
        ],
        admin: {
          description:
            'O site publica o vídeo como link para o provedor, nunca como player incorporado.',
        },
      },
      { name: 'externalId', type: 'text' as const },
      { name: 'url', type: 'text' as const },
      { name: 'title', type: 'text' as const },
      { name: 'credit', type: 'text' as const },
    ],
  },
  {
    slug: 'quote',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      { name: 'text', type: 'textarea' as const, required: true },
      { name: 'attribution', type: 'text' as const },
      { name: 'sourceRef', type: 'text' as const },
    ],
  },
  {
    slug: 'entityCard',
    admin: blockRowLabel,
    fields: [
      blockIdField,
      {
        name: 'entityKind',
        type: 'select' as const,
        required: true,
        label: 'Tipo de entidade',
        // So `movie` e `tv` sao hidratados no lado publico
        // (`news-pages.ts`); os outros cinco fazem o cartao inteiro sumir da
        // materia publicada, silenciosamente. Sao legais no contrato, entao
        // continuam selecionaveis — mas quem escolhe precisa saber.
        options: [
          { label: 'Filme', value: 'movie' },
          { label: 'Série', value: 'tv' },
          { label: 'Temporada — ainda não aparece no site', value: 'season' },
          { label: 'Episódio — ainda não aparece no site', value: 'episode' },
          { label: 'Pessoa — ainda não aparece no site', value: 'person' },
          { label: 'Personagem — ainda não aparece no site', value: 'character' },
          { label: 'Franquia — ainda não aparece no site', value: 'franchise' },
        ],
        admin: {
          description:
            'Hoje o site só monta o cartão para filme e série. Os demais tipos são aceitos, mas o cartão não é exibido na matéria publicada.',
        },
      },
      { name: 'entityId', type: 'text' as const, required: true },
      { name: 'note', type: 'text' as const },
    ],
  },
  {
    slug: 'factBox',
    admin: blockRowLabel,
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
    admin: blockRowLabel,
    fields: [
      blockIdField,
      { name: 'articleRefs', type: 'text' as const, hasMany: true, required: true },
    ],
  },
  {
    slug: 'sourceList',
    admin: blockRowLabel,
    fields: [blockIdField, { name: 'sourceRefs', type: 'text' as const, hasMany: true, required: true }],
  },
  { slug: 'divider', admin: blockRowLabel, fields: [blockIdField] },
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
    read: readOwnIdentity('human'),
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
    // Visivel SO para administrador. Nao e superficie de trabalho editorial —
    // mas e superficie de ADMINISTRACAO, e escondê-la de quem tem a politica
    // para usá-la obrigava a criar conta tecnica fora do painel.
    hidden: hiddenFromNonAdministrators,
  },
  access: {
    create: policy(identityAccess.create),
    read: readOwnIdentity('service'),
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
  admin: {
    useAsTitle: 'alt',
    group: 'Editorial',
    defaultColumns: ['alt', 'licenseStatus', 'credit', 'updatedAt'],
    components: {
      edit: {
        // O estado de liberacao passa a ser a PRIMEIRA coisa visivel do
        // documento — e a liberacao acontece aqui, onde estao o credito, a
        // fonte e o detentor dos direitos, nao no meio do fluxo de publicacao.
        beforeDocumentControls: ['/src/admin/MediaReleaseControl'],
      },
    },
  },
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
  admin: {
    useAsTitle: 'title',
    group: 'Editorial',
    // Colunas da lista: o que uma redacao pergunta ao abrir a tela — em que pe
    // esta, de onde veio, quem assina, quando foi ao ar.
    defaultColumns: ['title', 'workflowStatus', 'autoPublished', 'section', 'publishedAt'],
    components: {
      edit: {
        // SUBSTITUI o botao nativo "Publish changes", que manda `_status`
        // solto e leva 403 do hook de governanca (corretamente). A trava do
        // servidor NAO muda; o que muda e a interface parar de oferecer um
        // caminho inexistente e passar a oferecer as transicoes reais.
        PublishButton: '/src/admin/WorkflowTransitionBar',
        // A midia sem licenca se anuncia ANTES da tentativa de publicar, em vez
        // de virar um `unauthorized_media` depois do texto pronto.
        beforeDocumentControls: ['/src/admin/MediaLicenseNotice'],
      },
    },
  },
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
    // ABAS SEM NOME.
    //
    // Aba NOMEADA no Payload aninha o caminho de armazenamento
    // (`seo.metaTitle` em vez de `metaTitle`). Isso exigiria migration,
    // quebraria a projecao para o screen-db e invalidaria o contrato ja
    // congelado em f4c49c4. Aba SEM nome reorganiza somente a interface: o
    // schema do banco fica identico.
    //
    // A ordem das abas e a ordem em que uma redacao humana trabalha. Antes
    // desta mudanca os SETE primeiros campos do formulario eram internos de
    // automacao, editaveis, e o titulo aparecia em oitavo lugar.
      /* ================================================================
       * CANVAS DE ESCRITA — campos de TOPO, fora do `tabs`.
       *
       * Estao aqui por uma razao mecanica, nao estetica: `admin.position:
       * 'sidebar'` so e lido pelo particionador de `DocumentFields`, que
       * percorre APENAS `collection.fields[]`. Dentro de `tabs` a propriedade
       * typecheca e e ignorada em silencio (`fieldIsSidebar` tem um unico
       * consumidor em todo o @payloadcms/ui). Enquanto tudo vivia dentro do
       * `tabs`, a sidebar do painel era vazia por CONSTRUCAO.
       *
       * A ordem do array E o mecanismo de ordenacao: titulo, apoio, resumo e
       * corpo aparecem antes das abas, que e o que faz a tela abrir escrevendo
       * em vez de abrir num formulario.
       * ================================================================ */
      { name: 'title', type: 'text', required: true, label: 'Título' },
      { name: 'subtitle', type: 'text', label: 'Linha de apoio' },
      { name: 'summary', type: 'textarea', label: 'Resumo' },
      { name: 'body', type: 'blocks', blocks: editorialBlocks, label: 'Corpo' },

      /* ----------------------------------------------------------------
       * SIDEBAR — o que a redacao consulta ENQUANTO escreve.
       *
       * Tambem de topo, e pelo mesmo motivo mecanico do canvas: `position:
       * 'sidebar'` so e lido pelo particionador de `DocumentFields`, que
       * percorre apenas `collection.fields[]`. Dentro do `tabs` a propriedade
       * typecheca e e ignorada em silencio.
       * ---------------------------------------------------------------- */
      {
        name: 'slug',
        type: 'text',
        label: 'Endereço da matéria (slug)',
        index: true,
        // Mesma coluna, mesma validacao, mesmo tipo: o componente so gera o
        // valor a partir do titulo com a MESMA `canonicalizeSlug` que a
        // autopublicacao ja usa, e para de gerar quando alguem edita a mao.
        admin: {
          position: 'sidebar',
          components: { Field: '/src/admin/SlugField' },
        },
      },

    {
      type: 'tabs',
      tabs: [
      {
        label: 'Conteudo',
        description:
          'O texto da materia. E por aqui que uma redacao humana comeca.',
        fields: [
        // --- Conteudo ---
        {
        name: 'contentType',
        type: 'select',
        label: 'Tipo editorial',
        required: true,
        defaultValue: 'news',
        // FONTE UNICA. A lista literal duplicada aqui divergiu do contrato quando
        // `review` foi acrescentado la: o pedido passava na validacao e a
        // publicacao morria na persistencia, com 503 e sem materia.
        options: [...PUBLICATION_CONTENT_TYPES],
      },
        {
          name: 'language',
          type: 'select',
          required: true,
          defaultValue: 'pt-BR',
          label: 'Idioma',
          // Era caixa de texto LIVRE com "pt-BR" digitado: um `pt_BR` ou `PT-BR`
          // atravessava e so quebrava na projecao. A coluna continua a mesma.
          options: [
            { label: 'Português (Brasil)', value: 'pt-BR' },
            { label: 'Inglês', value: 'en' },
            { label: 'Espanhol', value: 'es' },
          ],
          admin: {
            description:
              'Só pt-BR é publicado hoje. Inglês e espanhol ficam em rascunho até revisão humana.',
          },
        },
        ],
      },
      {
        label: 'Midia',
        description:
          'Capa e galeria. Midia sem licenca aprovada NAO publica.',
        fields: [
        {
          name: 'heroMedia',
          type: 'relationship',
          relationTo: 'media',
          label: 'Capa',
          // O gate NAO exige capa — `heroMedia` nao aparece em `workflow.ts`.
          // A interface dizia isso por omissao, e dava para chegar em "pronta
          // para publicar" sem capa sem entender por que. Agora esta escrito.
          admin: {
            description:
              'Não bloqueia a publicação, mas matéria sem capa perde espaço nas listas e no compartilhamento.',
          },
        },
        {
          name: 'gallery',
          type: 'relationship',
          relationTo: 'media',
          hasMany: true,
          label: 'Imagens de apoio',
          admin: {
            // HONESTIDADE DE ESCOPO. Nao existe bloco `gallery` em lugar nenhum
            // da pilha: nem no contrato (`publishedEditorialBlock` tem 10 tipos
            // e nenhum e galeria), nem no renderizador publico. Estas imagens
            // viajam com a materia e ficam disponiveis para reuso, mas NAO
            // viram uma galeria na pagina. Quem quiser a foto no meio do texto
            // usa o bloco "image" no corpo.
            description:
              'Ficam vinculadas à matéria para reuso e crédito. Não viram galeria na página: para exibir uma imagem no texto, use o bloco de imagem no corpo.',
          },
        },
        ],
      },
      {
        label: 'Autoria',
        description:
          'Autor PUBLICO da materia. Diferente do usuario do CMS que a editou.',
        fields: [
        // --- Autoria ---
      {
        name: 'authors',
        type: 'relationship',
        relationTo: 'authors',
        hasMany: true,
        label: 'Autores',
        // O gate EXIGE ao menos um autor ativo (`missing_active_author`,
        // `workflow.ts:214-215`), mas o campo nao pode ser `required`: rascunho
        // legitimamente nasce sem autor. A exigencia e dita por escrito.
        admin: {
          description:
            'Obrigatório para publicar: ao menos um autor ativo. Um rascunho pode ficar sem autor.',
        },
      },
        // AUTORIA TEM TRES PAPEIS DIFERENTES, e um `select` sem rotulo nao os
        // distingue. `authors` assina publicamente; `primaryAuthor` e quem
        // encabeca a assinatura; `assignedTo` e responsabilidade INTERNA e
        // nunca aparece no site.
        {
          name: 'primaryAuthor',
          type: 'relationship',
          relationTo: 'authors',
          label: 'Autor principal',
          admin: {
            description:
              'Entre os autores acima, quem encabeça a assinatura pública da matéria.',
          },
        },
        {
          name: 'assignedTo',
          type: 'relationship',
          relationTo: 'editorial-users',
          label: 'Responsável na redação',
          admin: {
            description: 'Controle interno de quem toca a matéria. Não aparece no site.',
          },
        },
        // --- Organizacao PROVISORIA (a taxonomia publica nao vive aqui) ---
      {
          name: 'section',
          type: 'text',
          label: 'Editoria',
          admin: { description: 'Ex.: Filmes, Séries, Streaming. Campo livre — não há taxonomia fechada ainda.' },
        },
        {
          name: 'internalTags',
          type: 'text',
          hasMany: true,
          label: 'Marcadores internos',
          admin: { description: 'Organização da redação. Não são as tags públicas da matéria.' },
        },
        ],
      },
      {
        label: 'SEO',
        description:
          'SINAIS editoriais. Canonical, robots e JSON-LD sao derivados no site.',
        fields: [
        // --- SEO ---
      {
          name: 'metaTitle',
          type: 'text',
          label: 'Título para busca',
          admin: {
            description:
              'O que aparece como título no Google. Cerca de 60 caracteres — acima disso, corta.',
          },
        },
        {
          name: 'metaDescription',
          type: 'textarea',
          label: 'Descrição para busca',
          admin: {
            description:
              'O trecho abaixo do título no resultado. Cerca de 155 caracteres — acima disso, corta.',
          },
        },
        {
          // BASICO vs AVANCADO. Eram 12 campos planos, sem hierarquia: quem
          // escreve precisa de dois, e via doze. Os dez restantes seguem
          // acessiveis, recolhidos.
          //
          // `collapsible` SEM `name` nao aninha armazenamento — o schema do banco
          // fica identico e a projecao continua lendo `metaTitle` na raiz.
          type: 'collapsible',
          label: 'Sinais avançados',
          admin: { initCollapsed: true },
          fields: [
        // SEO revalidado. Sao SUGESTOES do pipeline que o CMS aceitou — nunca
      // canonical, robots, datas ou JSON-LD, que pertencem ao lado publico.
      {
          name: 'focusKeyphrase',
          type: 'text',
          label: 'Termo principal',
          admin: {
            description:
              'Ferramenta interna de foco. Não vira meta keywords nem sai no HTML da página.',
          },
        },
        {
          name: 'relatedKeyphrases',
          type: 'text',
          hasMany: true,
          defaultValue: [],
          label: 'Termos relacionados',
          admin: { description: 'Apoio de pauta. Também não sai no HTML.' },
        },
        {
          name: 'editorialKeywords',
          type: 'text',
          hasMany: true,
          defaultValue: [],
          label: 'Palavras-chave editoriais',
          admin: { description: 'Vocabulário da redação para busca interna.' },
        },
        {
        name: 'schemaTypeRecommendation',
        type: 'select',
        label: 'Tipo de dado estruturado (sugestão)',
        options: ['NewsArticle', 'Article', 'Review', 'ItemList', 'HowTo'],
        admin: {
          // MEDIDO no lado publico: so `NewsArticle` e `Article` sao aceitos ao
          // montar o JSON-LD. Os outros tres continuam selecionaveis e caem
          // fora sem aviso. Dizer isso aqui e mais barato que descobrir depois
          // que o dado estruturado nao saiu.
          description:
            'Sugestão. O JSON-LD final é montado pelo site, que hoje só aceita NewsArticle e Article — Review, ItemList e HowTo são ignorados.',
        },
      },
        {
          name: 'articleSection',
          type: 'text',
          label: 'Seção declarada ao buscador',
          admin: { description: 'Vai no articleSection do JSON-LD. Costuma repetir a editoria.' },
        },
        // CADEIA DE HERANCA REAL, nao suposta. Medida no renderizador publico:
        // social -> meta -> linha de apoio. Escrever "deriva do titulo" sem
        // conferir seria inventar comportamento; abaixo esta o que o codigo faz.
        {
          name: 'socialTitle',
          type: 'text',
          label: 'Título para redes sociais',
          admin: { description: 'Vazio, herda o título para busca; se este também estiver vazio, o título da matéria.' },
        },
        {
          name: 'socialDescription',
          type: 'textarea',
          label: 'Descrição para redes sociais',
          admin: { description: 'Vazio, herda a descrição para busca; se esta também estiver vazia, a linha de apoio.' },
        },
        {
          name: 'socialMedia',
          type: 'relationship',
          relationTo: 'media',
          label: 'Imagem para redes sociais',
          admin: { description: 'Vazio, usa a capa. A imagem precisa estar liberada para uso social.' },
        },
        {
          name: 'canonicalOverride',
          type: 'text',
          label: 'Canônica manual',
          admin: {
            description:
              'Só para matéria republicada de outra origem. Precisa ser https absoluta, e é ignorada quando a página não indexa.',
          },
        },
        {
          name: 'noindex',
          type: 'checkbox',
          defaultValue: false,
          label: 'Pedir para não indexar',
          admin: { description: 'Marca a matéria como noindex e a mantém fora do sitemap.' },
        },
          ],
        },
        ],
      },
      {
        label: 'Entidades',
        description:
          'Filmes, series e pessoas citados. So entidade VERIFICADA atravessa para o site.',
        fields: [
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
        ],
      },
      {
        label: 'Fontes e QA',
        description:
          'Lastro documental. Materia assistida por IA sem fonte nao publica.',
        fields: [
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
        { name: 'blockingErrors', type: 'text', hasMany: true },
        { name: 'warnings', type: 'text', hasMany: true },
        { name: 'qaVersion', type: 'text' },
        {
          name: 'qaPassedAt',
          type: 'date',
          // Continua sendo a MESMA data que o gate exige. O componente troca o
          // seletor cru por um ato explicito ("Marcar QA como aprovado"), que
          // carimba o instante do clique e mostra ao lado o que ja da para
          // conferir no proprio documento.
          admin: { components: { Field: '/src/admin/QaApprovalField' } },
        },
        ],
      },
      {
        label: 'Publicacao',
        description:
          'Estado editorial e datas. O servidor carimba publishedAt.',
        fields: [
        // --- Publicacao ---
      {
        name: 'workflowStatus',
        type: 'select',
        required: true,
        defaultValue: 'draft',
        index: true,
        options: [...WORKFLOW_STATUSES],
        admin: {
          // FORA DO ALCANCE, nao fora do documento. A barra do topo era para ter
          // substituido este seletor e apenas conviveu com ele: havia DOIS
          // caminhos de mudar estado, e o cru nao passa pelas transicoes
          // permitidas. `readOnly` e interface — a recusa real continua no hook
          // de governanca, que nao muda aqui. O valor persistido e o mesmo.
          //
          // FASE 1: `readOnly` deixava o select cru na tela, ocupando espaco e
          // parecendo um controle. O estado ja e anunciado pela barra do topo,
          // com rotulo por extenso e cor de apoio — repeti-lo como enum tecnico
          // so oferecia um segundo caminho, pior, para a mesma decisao. A
          // ESCRITA continua permitida a humanos (a barra escreve por aqui);
          // `hidden` e sobre a tela, nao sobre a permissao.
          hidden: true,
          readOnly: true,
          description:
            'Em que pé está a matéria. Para avançar ou voltar, use os botões no topo da tela.',
        },
      },
        { name: 'scheduledFor', type: 'date', label: 'Agendada para' },
        {
          name: 'publishedAt',
          type: 'date',
          label: 'Publicada em',
          admin: { description: 'Carimbada pelo servidor no momento em que a matéria vai ao ar.' },
        },
        { name: 'correctedAt', type: 'date', label: 'Corrigida em' },
        {
          name: 'correctionNote',
          type: 'textarea',
          label: 'Nota de correção',
          admin: { description: 'O que mudou depois de publicada. Fica no registro editorial.' },
        },
        {
          name: 'retractionReason',
          type: 'textarea',
          label: 'Motivo da retratação',
          admin: { description: 'Obrigatório em retratação: explica por que a matéria saiu do ar.' },
        },
        {
        name: 'legalHold',
        type: 'checkbox',
        defaultValue: false,
        admin: { description: 'Retencao juridica: bloqueia publicacao ate liberacao.' },
      },
        {
          // RASTRO HUMANO. Tres perguntas distintas que a auditoria precisa
          // responder separadamente: quem CRIOU, quem alterou por ULTIMO e
          // quem PUBLICOU. Colapsar em "ultimo editor" perderia justamente a
          // informacao que importa quando uma materia sai errada — quem
          // apertou o botao de publicar.
          //
          // Sao relacoes com `editorial-users`, nao com `service-accounts`:
          // conta tecnica NAO e usuario humano, e forcar as duas na mesma
          // coluna faria a automacao aparecer como pessoa na auditoria.
          // Publicacao automatica deixa os tres VAZIOS e preenche
          // `automationActorId` — a ausencia aqui e o sinal.
          name: 'createdBy',
          type: 'relationship',
          relationTo: 'editorial-users',
          admin: {
            readOnly: true,
            description: 'Usuario do CMS que criou. Vazio em materia da automacao.',
          },
        },
        {
          name: 'updatedBy',
          type: 'relationship',
          relationTo: 'editorial-users',
          admin: { readOnly: true, description: 'Ultimo usuario do CMS que alterou.' },
        },
        {
          name: 'publishedBy',
          type: 'relationship',
          relationTo: 'editorial-users',
          admin: {
            readOnly: true,
            description: 'Usuario do CMS que PUBLICOU. Vazio em autopublicacao.',
          },
        },
        ],
      },
      {
        // O ROTULO NAO MUDA. Ele e a chave do vinculo em
        // `editorial-vocabulary.ts:219`, que alimenta o deep-link do painel de
        // bloqueios. Acentua-lo quebraria a navegacao — a melhoria de item 3 e
        // nos rotulos de CAMPO, nao no identificador da aba.
        label: 'Automacao (auditoria)',
        description:
          'Rastro da publicação automática. Em matéria escrita por uma pessoa, esta aba fica vazia.',
        fields: [
        {
          // 22 campos de auditoria, VAZIOS em toda materia escrita por pessoa.
          // Recolhidos por padrao: quem precisa do rastro abre; quem escreve
          // nao rola por 22 campos em branco.
          //
          // `collapsible` SEM `name` nao aninha armazenamento — o schema do
          // banco fica identico, igual as abas ja existentes. Um `condition` por
          // campo esconderia melhor, mas exigiria repetir a regra 22 vezes e
          // faria a aba parecer vazia quando o rastro EXISTE porem ainda nao
          // carregou.
          type: 'collapsible' as const,
          label: 'Rastro da automação',
          admin: { initCollapsed: true },
          fields: [
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
        admin: {
          readOnly: true,
          description: 'Publicada automaticamente pelo pipeline, sem revisao previa.',
          // Na LISTA, uma caixa marcada nao distingue automacao de qualquer
          // outro checkbox nem diz qual conta operou. A celula le a propria
          // linha e responde as duas coisas.
          components: { Cell: '/src/admin/OriginCell' },
        },
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
        // --- Identidade e idempotencia (preenchidos pelo endpoint) ---
      { name: 'automationDraftId', admin: { readOnly: true }, type: 'text', index: true },
        { name: 'idempotencyKey', admin: { readOnly: true }, type: 'text', index: true },
        { name: 'sourceClusterId', admin: { readOnly: true }, type: 'text', index: true },
        { name: 'sourceRevision', admin: { readOnly: true }, type: 'number' },
        { name: 'sourcePayloadHash', admin: { readOnly: true }, type: 'text' },
        { name: 'draftPayloadHash', admin: { readOnly: true }, type: 'text' },
        { name: 'pipelineVersion', admin: { readOnly: true }, type: 'text' },
          ],
        },
        ],
      },
      ],
    },
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
