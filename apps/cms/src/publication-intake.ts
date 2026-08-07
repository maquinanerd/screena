/**
 * publication-intake.ts — O que o pedido do MNScr vira, e o que ele PERDE. PURO.
 *
 * O endpoint de autopublicacao coletava fatos, decidia e persistia — e no meio
 * disso descartava, em silencio, campos que o contrato aceita. Um `2xx` saia
 * dizendo "publicado" enquanto a capa, os vinculos de entidade e metade do SEO
 * ficavam pelo caminho. Este arquivo e a parte DECIDIVEL desse trajeto,
 * separada do IO para poder ser provada sem servidor.
 *
 * A regra que organiza tudo aqui: **nada some calado**. Toda vez que um campo
 * do pedido nao atravessa, sai um {@link EditorialWarning} com codigo e campo,
 * e o endpoint o devolve ao emissor. Descartar sem registrar e o defeito que
 * este arquivo existe para nao repetir.
 */

import type { EditorialWarning } from './editorial-body-mapper.js'

export type { EditorialWarning }

/* ------------------------------------------------------------------ */
/* Capa (hero)                                                         */
/* ------------------------------------------------------------------ */

/** O que o CMS sabe sobre uma linha de `media` referenciada pelo pedido. */
export interface MediaAuthorizationFacts {
  /** A linha existe no CMS. Referencia perdida NAO vira relacao. */
  readonly exists: boolean
  /** `licenseStatus === 'approved'` E `allowedForEditorial`. */
  readonly licenseApproved: boolean
  /** Liberada especificamente para capa (invariante 6 aplicada por finalidade). */
  readonly allowedForHero: boolean
}

/** Midia referenciada, na forma minima que a decisao precisa. */
export interface MediaReference {
  readonly mediaId: string
  readonly intendedUse: string
}

export interface HeroResolution {
  /** Id da linha de `media` que vira capa, ou `null` quando nao ha capa a gravar. */
  readonly heroMediaId: string | null
  readonly warnings: readonly EditorialWarning[]
}

/**
 * Qual midia do pedido vira a CAPA da materia.
 *
 * Ate agora `intendedUse: 'hero'` so era lido pela autorizacao de licenca e
 * nunca virava relacionamento: `heroMedia` nao aparecia em lugar nenhum da
 * persistencia. A materia publicava sem capa e o pedido nao ficava sabendo.
 *
 * Tres decisoes que precisam ficar explicitas:
 *
 *  1. **Sem permissao, nao grava.** Uma capa exige `allowedForHero`, nao apenas
 *     licenca editorial: capa e a imagem que representa a materia no
 *     compartilhamento e nas listas, e o direito de uso costuma ser distinto.
 *  2. **A primeira vence.** Duas capas e ambiguidade do emissor, nao escolha
 *     nossa; escolher a "melhor" seria julgamento editorial de um mapeador.
 *  3. **Primeira recusada NAO promove a segunda.** Promover seria decidir qual
 *     imagem representa a materia — exatamente o que o pedido nao autorizou.
 *
 * Devolver `heroMediaId: null` significa "nao ha capa a GRAVAR", nunca "apague
 * a capa": quem chama nao inclui a chave, e o hero que um humano escolheu
 * sobrevive ao update. Ver `persistPublication`.
 */
export function resolveHeroMedia(
  media: readonly MediaReference[],
  authorizations: ReadonlyMap<string, MediaAuthorizationFacts>,
): HeroResolution {
  const warnings: EditorialWarning[] = []
  let heroMediaId: string | null = null
  let chosen = false

  for (const [index, item] of media.entries()) {
    if (item.intendedUse !== 'hero') continue

    if (chosen) {
      warnings.push({
        code: 'HERO_MEDIA_EXTRA_IGNORED',
        field: `media[${String(index)}].intendedUse`,
        detail: `midia "${item.mediaId}" tambem pedia capa: o pedido so pode ter uma, e a primeira ja foi decidida`,
      })
      continue
    }
    chosen = true

    const facts = authorizations.get(item.mediaId)
    const authorized =
      facts !== undefined && facts.exists && facts.licenseApproved && facts.allowedForHero
    if (!authorized) {
      // Fail-closed e NOMEADO. A alternativa — gravar mesmo assim — colocaria
      // no compartilhamento publico uma imagem sem direito de uso confirmado.
      warnings.push({
        code: 'HERO_MEDIA_NOT_AUTHORIZED',
        field: `media[${String(index)}].mediaId`,
        detail: `capa recusada: a midia "${item.mediaId}" ${
          facts === undefined || !facts.exists
            ? 'nao existe no CMS'
            : !facts.licenseApproved
              ? 'nao tem licenca editorial aprovada'
              : 'nao tem allowedForHero'
        }`,
      })
      continue
    }
    heroMediaId = item.mediaId
  }

  return { heroMediaId, warnings }
}

/* ------------------------------------------------------------------ */
/* Vinculos de entidade                                                */
/* ------------------------------------------------------------------ */

export interface EntityLinkInput {
  readonly entityKind: string
  readonly entityId: string
  readonly relation: string
  readonly confidence: number
}

/** Linha de `entityReferences` pronta para a collection `articles`. */
export interface EntityReferenceRow {
  readonly entityKind: string
  readonly entityId: string
  readonly relation: string
  readonly confidence: number
  /** SEMPRE `false` vindo de maquina. Ver ADR 0018. */
  readonly verified: false
}

export interface EntityReferenceResolution {
  readonly rows: readonly EntityReferenceRow[]
  readonly warnings: readonly EditorialWarning[]
}

/**
 * Forma de um id INTERNO do catalogo publico da Cinerie.
 *
 * A coluna la e `BigInt` e a sequencia comeca em 1 — por isso `0` e um id com
 * zero a esquerda (`007`) sao recusados: nenhum dos dois pode ter saido do
 * catalogo, e aceita-los abriria espaco para um numero "parecido com id" que
 * na verdade veio de outro lugar.
 *
 * `stableId` do contrato e bem mais largo (`[A-Za-z0-9][A-Za-z0-9._:-]*`), o que
 * deixa passar `tt0111161`, `tmdb:550` e slugs sem nenhum erro.
 */
const INTERNAL_ENTITY_ID = /^[1-9][0-9]*$/

/**
 * `entityLinks` do pedido -> `entityReferences` da collection.
 *
 * O contrato aceita `entityLinks` desde sempre, e ate agora a whitelist de
 * persistencia simplesmente nao copiava o campo: o vinculo morria no salto para
 * o CMS, mesmo com o id certo.
 *
 * DUAS GUARDAS, e vale entender por que sao so duas:
 *
 *  - **Forma do id.** Um id do TMDB nao falha em lugar nenhum — ele e um inteiro
 *    valido. Se aquele numero existir como id INTERNO, o vinculo aponta para a
 *    entidade errada com toda a aparencia de estar certo. A unica coisa
 *    checavel aqui e a forma; e ela ja recusa `tt0111161` e `tmdb:550`.
 *  - **`verified: false`, sempre.** O CMS **nao consegue** confirmar que a
 *    entidade existe nem que o tipo declarado bate com a linha: ele tem banco
 *    proprio e nao alcanca o catalogo publico (ADR 0015, travado por
 *    `tests/governance/cms-isolation.test.ts`). Marcar `verified: true` daqui
 *    seria afirmar uma verificacao que ninguem fez.
 *
 * Quem confere existencia e tipo e o worker de projecao, que le o catalogo
 * publico (`reconcileEntityLinks`), e o vinculo so chega ate la depois de um
 * humano confirmar no admin. Ver ADR 0018.
 */
export function resolveEntityReferences(
  links: readonly EntityLinkInput[],
): EntityReferenceResolution {
  const rows: EntityReferenceRow[] = []
  const warnings: EditorialWarning[] = []

  for (const [index, link] of links.entries()) {
    if (!INTERNAL_ENTITY_ID.test(link.entityId)) {
      warnings.push({
        code: 'ENTITY_LINK_ID_NOT_INTERNAL',
        field: `entityLinks[${String(index)}].entityId`,
        detail: `vinculo recusado: "${link.entityId}" nao tem a forma de um id interno do catalogo Cinerie (id externo, como o do TMDB, apontaria para outra entidade)`,
      })
      continue
    }
    rows.push({
      entityKind: link.entityKind,
      entityId: link.entityId,
      relation: link.relation,
      confidence: link.confidence,
      verified: false,
    })
  }

  if (rows.length > 0) {
    warnings.push({
      code: 'ENTITY_LINK_UNVERIFIED',
      field: 'entityLinks',
      detail: `${String(rows.length)} vinculo(s) gravado(s) como NAO verificados: so aparecem no site depois de confirmacao humana no admin`,
    })
  }

  return { rows, warnings }
}

/* ------------------------------------------------------------------ */
/* SEO                                                                 */
/* ------------------------------------------------------------------ */

/** Subconjunto de `editorialSeoProposal` que esta funcao decide. */
export interface SeoProposalFacts {
  readonly relatedKeyphrases: readonly string[]
  readonly editorialKeywords: readonly string[]
  readonly imageAltSuggestions: readonly unknown[]
  readonly internalLinkSuggestions: readonly unknown[]
  readonly openGraphTitleSuggestion?: string
  readonly openGraphDescriptionSuggestion?: string
  readonly twitterTitleSuggestion?: string
  readonly twitterDescriptionSuggestion?: string
}

export interface SeoPersistencePlan {
  /** Campos a mesclar no documento de `articles`. */
  readonly fields: Readonly<Record<string, unknown>>
  readonly warnings: readonly EditorialWarning[]
}

/**
 * Sinais de SEO aceitos pelo contrato -> colunas da collection.
 *
 * A whitelist persistia cinco campos e o contrato aceita bem mais. O resto era
 * validado, transportado e jogado fora sem uma linha de log.
 *
 * O QUE NAO TEM CAMPO NAO GANHA SCHEMA AQUI. Criar coluna e migration, e
 * migration e revisao propria. O que falta sai como lacuna nomeada — que e
 * melhor do que a alternativa atual (sumir) e melhor do que a tentacao
 * (inventar coluna numa PR que nao e sobre banco).
 *
 * `undefined` NAO vira chave: gravar `socialTitle: undefined` num update
 * apagaria o que a redacao escreveu a mao.
 */
export function planSeoPersistence(seo: SeoProposalFacts): SeoPersistencePlan {
  const fields: Record<string, unknown> = {}
  const warnings: EditorialWarning[] = []

  // LISTA VAZIA NAO GRAVA. Os dois campos tem `.default([])` no contrato, entao
  // um pipeline que simplesmente nao os preenche manda `[]` a cada revisao — e
  // gravar isso num `update` apagaria o vocabulario que a redacao digitou a
  // mao. Vazio da maquina significa "nao tenho o que dizer", nunca "apague".
  if (seo.relatedKeyphrases.length > 0) fields.relatedKeyphrases = [...seo.relatedKeyphrases]
  if (seo.editorialKeywords.length > 0) fields.editorialKeywords = [...seo.editorialKeywords]

  const gap = (field: string, detail: string): void => {
    warnings.push({ code: 'SEO_FIELD_NOT_PERSISTED', field, detail })
  }

  if (seo.openGraphTitleSuggestion !== undefined) {
    fields.socialTitle = seo.openGraphTitleSuggestion
  }
  if (seo.openGraphDescriptionSuggestion !== undefined) {
    fields.socialDescription = seo.openGraphDescriptionSuggestion
  }

  // A collection tem UM par social, consumido tanto por Open Graph quanto por
  // Twitter no lado publico. Um valor proprio do Twitter so se perde quando
  // DIFERE do que foi gravado — repetir o mesmo texto nao perde nada, e avisar
  // ali seria ruido que o emissor aprende a ignorar.
  if (
    seo.twitterTitleSuggestion !== undefined &&
    seo.twitterTitleSuggestion !== fields.socialTitle
  ) {
    gap(
      'seo.twitterTitleSuggestion',
      'a collection tem um unico titulo social (usado por Open Graph e Twitter): um titulo proprio de Twitter nao foi gravado',
    )
  }
  if (
    seo.twitterDescriptionSuggestion !== undefined &&
    seo.twitterDescriptionSuggestion !== fields.socialDescription
  ) {
    gap(
      'seo.twitterDescriptionSuggestion',
      'a collection tem uma unica descricao social (usada por Open Graph e Twitter): uma descricao propria de Twitter nao foi gravada',
    )
  }

  if (seo.imageAltSuggestions.length > 0) {
    gap(
      'seo.imageAltSuggestions',
      `${String(seo.imageAltSuggestions.length)} sugestao(oes) de alt nao persistida(s): o alt definitivo vive na linha de midia e no bloco de imagem, e nao ha campo para a sugestao`,
    )
  }
  if (seo.internalLinkSuggestions.length > 0) {
    gap(
      'seo.internalLinkSuggestions',
      `${String(seo.internalLinkSuggestions.length)} sugestao(oes) de link interno nao persistida(s): nao ha campo correspondente na collection`,
    )
  }

  return { fields, warnings }
}

/* ------------------------------------------------------------------ */
/* `marks` removido pelo contrato                                      */
/* ------------------------------------------------------------------ */

/**
 * Procura `marks` no corpo CRU, antes do Zod.
 *
 * `marks` (negrito, italico, link) so existe no bloco PUBLICADO. No contrato de
 * ENTRADA o `z.object` do paragrafo nao e `.strict()`, entao a chave e removida
 * em SILENCIO — e por isso a varredura precisa acontecer no JSON cru: quando o
 * pedido chega ao mapeador, `marks` ja nao existe mais e nao ha o que reportar.
 *
 * Aceitar `marks` na entrada nao e opcao desta PR: os contratos de entrada sao
 * comparados por hash com igualdade estrita e o MNScr declara esse hash a cada
 * pedido, entao acrescentar o campo faria todo pedido em voo virar
 * `hash_mismatch`. Ate la, o minimo honesto e dizer ao emissor que ele mandou e
 * perdeu.
 */
export function findStrippedBlockMarks(rawBody: unknown): readonly EditorialWarning[] {
  if (rawBody === null || typeof rawBody !== 'object') return []
  const blocks = (rawBody as Record<string, unknown>).blocks
  if (!Array.isArray(blocks)) return []

  const warnings: EditorialWarning[] = []
  for (const [index, raw] of blocks.entries()) {
    if (raw === null || typeof raw !== 'object') continue
    const block = raw as Record<string, unknown>
    if (!('marks' in block)) continue
    const blockId = typeof block.id === 'string' && block.id !== '' ? block.id : undefined
    warnings.push({
      code: 'BLOCK_MARKS_STRIPPED',
      field: `blocks[${String(index)}].marks`,
      ...(blockId === undefined ? {} : { blockId }),
      detail:
        'marcacao inline (marks) removida pelo contrato de ENTRADA, que ainda nao a aceita: o texto foi persistido sem formatacao',
    })
  }
  return warnings
}
