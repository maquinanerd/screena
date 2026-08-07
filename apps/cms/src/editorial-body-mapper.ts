/**
 * editorial-body-mapper.ts — Blocos do CONTRATO -> blocos do PAYLOAD. PURO.
 *
 * Existe porque as duas pontas falam vocabularios diferentes de proposito: o
 * contrato e publico e discrimina por `type`/`id`; o Payload persiste
 * `blockType`/`blockId` e uma tabela por tipo de bloco. A traducao inversa
 * (Payload -> contrato) ja vivia em `publication.ts::toContractBlocks`; esta e
 * a ida, e ate agora ela existia SO no caminho de publicacao automatica —
 * duplicada como um spread cego, e ausente por completo no caminho de ingestao
 * de rascunho.
 *
 * O QUE ACONTECE SEM ESTA TRADUCAO. O Payload nao reclama: em
 * `payload/dist/fields/hooks/beforeChange/promise.js` a linha de bloco e
 * casada por `row.blockType`, e quando nenhum bloco casa o codigo simplesmente
 * nao percorre a linha — sem erro, sem log, sem campo invalido. O artigo e
 * criado com `body: []` e o endpoint responde 201. Um corpo inteiro some e
 * todo mundo ve sucesso.
 *
 * POR QUE EXPLICITO POR TIPO, e nao `{ ...block, blockType: type }`. Duas
 * razoes concretas, ambas verificadas no schema real:
 *  - `heading.level` e NUMERO no contrato e a coluna e
 *    `enum_articles_blocks_heading_level AS ENUM('2','3','4')` — texto;
 *  - `image.mediaRef` e uma referencia de CONTRATO, e a coluna e `media_id`,
 *    uma relacao de verdade. Spread deixaria `mediaRef` passar e `media`
 *    vazio, e o gate de midia do corpo (que le `block.media`) nunca veria a
 *    imagem.
 * Um spread tambem faria qualquer campo novo do contrato atravessar para a
 * persistencia sem ninguem decidir que ele atravessa.
 */

import { EDITORIAL_BLOCK_TYPES } from '@screena/editorial-contracts'

/** Id de uma linha de `media` no CMS, ou `null` quando nao ha o que apontar. */
export type ResolvedMediaId = string | number | null

export interface BodyMapperOptions {
  /**
   * Traduz o `mediaRef` do bloco para uma linha REAL de `media`.
   *
   * A cadeia e diferente em cada fluxo, e por isso ela e injetada em vez de
   * embutida:
   *  - ingestao de rascunho: `block.mediaRef` -> `mediaCandidates[].id` ->
   *    `mediaCandidates[].mediaRef` -> linha em `media` (quando ja existe);
   *  - publicacao automatica: `block.mediaRef` -> `media[].mediaId`, que o
   *    contrato ja define como midia APROVADA no CMS.
   *
   * Devolver `null` e um desfecho legitimo e esperado: no rascunho, a imagem
   * costuma ser uma candidata cuja aprovacao ainda e humana.
   */
  readonly resolveMedia: (mediaRef: string) => ResolvedMediaId
}

/**
 * Uma perda, em forma de DADO — nao de frase.
 *
 * A string de `warnings` serve ao revisor humano no admin, que le portugues. O
 * codigo serve ao PIPELINE que enviou o pedido, que precisa decidir se corrige
 * o emissor ou se aquilo era esperado — e nao pode fazer isso casando substring
 * de uma mensagem que muda quando alguem melhora a redacao.
 *
 * Os dois convivem de proposito: `warnings` continua sendo a lista de strings
 * que a collection ja guarda, com o mesmo formato de sempre.
 */
export interface EditorialWarning {
  /** Codigo estavel, em UPPER_SNAKE. E o que o emissor compara. */
  readonly code: string
  /** Caminho do campo no PEDIDO (ex.: `blocks[3].mediaRef`). */
  readonly field: string
  /** Id do bloco, quando o descarte pertence a um bloco identificavel. */
  readonly blockId?: string
  /** Frase humana. Mesmo texto do `warnings` correspondente. */
  readonly detail: string
}

export interface MappedBody {
  /** Blocos prontos para o campo `body` da collection `articles`. */
  readonly blocks: readonly Record<string, unknown>[]
  /**
   * O que NAO atravessou, nomeando o bloco.
   *
   * Existe para que nenhuma perda seja silenciosa: o chamador anexa isto aos
   * `warnings` do artigo, que e onde o revisor humano ja procura pendencia de
   * midia. Descartar sem registrar seria repetir, com outra roupa, exatamente
   * o defeito que este arquivo corrige.
   */
  readonly warnings: readonly string[]
  /**
   * As MESMAS perdas, com codigo e campo.
   *
   * Uma por entrada de `warnings`, na mesma ordem. E isto que atravessa a
   * resposta HTTP do endpoint de publicacao: ate agora a lista de strings
   * morria no registro do artigo e o emissor recebia `2xx` sem saber que metade
   * do que mandou nao chegou.
   */
  readonly details: readonly EditorialWarning[]
}

/** Bloco em forma de contrato, ainda nao validado por este modulo. */
type ContractBlock = Record<string, unknown>

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Inclui a chave so quando ha valor — nunca grava `undefined`. */
function optional(key: string, value: unknown): Record<string, unknown> {
  const resolved = text(value)
  return resolved === undefined ? {} : { [key]: resolved }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

/**
 * `provenance` so existe na collection do bloco `paragraph`.
 *
 * Nao e descuido deste mapper: e o schema atual (ver `editorialBlocks` em
 * `collections.ts`). O contrato permite proveniencia em QUALQUER bloco, entao
 * ha uma assimetria real — e ela e reportada em `warnings` em vez de sumir,
 * porque corrigi-la exigiria migration, que esta fora do escopo desta correcao.
 */
function provenanceOf(block: ContractBlock): Record<string, unknown> {
  if (!Array.isArray(block.provenance) || block.provenance.length === 0) return {}
  const entries = block.provenance.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object') return []
    const entry = raw as Record<string, unknown>
    const origin = text(entry.origin)
    if (origin === undefined) return []
    return [{ origin, ...optional('ref', entry.ref) }]
  })
  return entries.length === 0 ? {} : { provenance: entries }
}

/**
 * Blocos do contrato -> blocos do Payload, na ORDEM recebida.
 *
 * Bloco de tipo desconhecido nao e descartado em silencio nem derruba a
 * ingestao inteira: ele sai do corpo e entra em `warnings` nomeado. Derrubar
 * tudo faria uma versao nova do contrato parar a redacao; calar faria o texto
 * sumir — que e o defeito de origem.
 */
export function toPayloadBlocks(
  blocks: readonly unknown[],
  options: BodyMapperOptions,
): MappedBody {
  const mapped: Record<string, unknown>[] = []
  const warnings: string[] = []
  const details: EditorialWarning[] = []
  const provenanceDropped: string[] = []

  /** Uma perda entra nas DUAS listas, sempre, e sempre em par. */
  const lose = (warning: EditorialWarning): void => {
    warnings.push(warning.detail)
    details.push(warning)
  }

  for (const [index, raw] of blocks.entries()) {
    if (raw === null || typeof raw !== 'object') {
      // Era o unico descarte MUDO que sobrava aqui: um `continue` seco. Um
      // corpo que chegasse com uma entrada malformada perdia o bloco e ninguem
      // ficava sabendo — nem o revisor, nem o emissor.
      lose({
        code: 'BLOCK_NOT_AN_OBJECT',
        field: `blocks[${String(index)}]`,
        detail: `entrada ${String(index)} do corpo nao e um bloco (${
          raw === null ? 'null' : typeof raw
        }): descartada`,
      })
      continue
    }
    const block = raw as ContractBlock

    const type = String(block.type ?? '')
    const blockId = String(block.id ?? '')

    if (!(EDITORIAL_BLOCK_TYPES as readonly string[]).includes(type)) {
      lose({
        code: 'BLOCK_TYPE_UNKNOWN',
        field: `blocks[${String(index)}].type`,
        ...(blockId === '' ? {} : { blockId }),
        detail: `bloco de tipo desconhecido descartado: "${type || '(sem tipo)'}"`,
      })
      continue
    }
    if (blockId === '') {
      lose({
        code: 'BLOCK_ID_MISSING',
        field: `blocks[${String(index)}].id`,
        detail: `bloco "${type}" sem id descartado: id estavel e obrigatorio`,
      })
      continue
    }

    // `provenance` existe no contrato para todo bloco e na collection so em
    // `paragraph`. A STRING sai agregada uma vez no fim (formato de sempre); o
    // detail sai por bloco, porque um codigo que nomeia tres blocos de uma vez
    // nao serve para o emissor localizar nada.
    if (type !== 'paragraph' && Array.isArray(block.provenance) && block.provenance.length > 0) {
      provenanceDropped.push(blockId)
      details.push({
        code: 'BLOCK_PROVENANCE_DROPPED',
        field: `blocks[${String(index)}].provenance`,
        blockId,
        detail: `proveniencia do bloco "${blockId}" (${type}) nao persistida: a collection so a guarda em paragrafo`,
      })
    }

    const base = { blockType: type, blockId }

    switch (type) {
      case 'paragraph':
        mapped.push({ ...base, text: String(block.text ?? ''), ...provenanceOf(block) })
        break

      case 'heading':
        mapped.push({
          ...base,
          // A coluna e um ENUM de TEXTO ('2','3','4'); o contrato manda numero.
          level: String(block.level ?? 2),
          text: String(block.text ?? ''),
        })
        break

      case 'image': {
        const mediaRef = String(block.mediaRef ?? '')
        const media = mediaRef === '' ? null : options.resolveMedia(mediaRef)
        if (media === null) {
          // A relacao NAO e fabricada. Sem linha de midia o bloco nao pode ser
          // persistido (`media` e obrigatorio na collection), entao ele sai do
          // corpo — mas sai NOMEADO, para o revisor saber que havia uma imagem
          // ali e qual candidata ela esperava.
          lose({
            code: 'BLOCK_IMAGE_MEDIA_UNRESOLVED',
            field: `blocks[${String(index)}].mediaRef`,
            blockId,
            detail: `imagem do bloco "${blockId}" aguarda midia aprovada no CMS (referencia "${mediaRef}"): bloco nao persistido`,
          })
          break
        }
        mapped.push({
          ...base,
          media,
          alt: String(block.alt ?? ''),
          ...optional('caption', block.caption),
          ...optional('credit', block.credit),
        })
        break
      }

      case 'video':
        mapped.push({
          ...base,
          provider: block.provider,
          ...optional('externalId', block.externalId),
          ...optional('url', block.url),
          ...optional('title', block.title),
          ...optional('credit', block.credit),
        })
        break

      case 'quote':
        mapped.push({
          ...base,
          text: String(block.text ?? ''),
          ...optional('attribution', block.attribution),
          ...optional('sourceRef', block.sourceRef),
        })
        break

      case 'entityCard':
        mapped.push({
          ...base,
          entityKind: block.entityKind,
          entityId: String(block.entityId ?? ''),
          ...optional('note', block.note),
        })
        break

      case 'factBox':
        mapped.push({
          ...base,
          title: String(block.title ?? ''),
          items: (Array.isArray(block.items) ? block.items : []).flatMap((rawItem) => {
            if (rawItem === null || typeof rawItem !== 'object') return []
            const item = rawItem as Record<string, unknown>
            return [{ label: String(item.label ?? ''), value: String(item.value ?? '') }]
          }),
        })
        break

      case 'relatedContent':
        mapped.push({ ...base, articleRefs: stringList(block.articleRefs) })
        break

      case 'sourceList':
        mapped.push({ ...base, sourceRefs: stringList(block.sourceRefs) })
        break

      case 'divider':
        mapped.push({ ...base })
        break

      default:
        // Inalcancavel: a allowlist acima ja filtrou. Fica como rede para o dia
        // em que um tipo novo entrar no contrato sem passar por aqui.
        lose({
          code: 'BLOCK_WITHOUT_MAPPING',
          field: `blocks[${String(index)}].type`,
          blockId,
          detail: `bloco "${type}" sem traducao para a collection: descartado`,
        })
    }
  }

  if (provenanceDropped.length > 0) {
    // So a STRING e agregada — os details ja sairam por bloco, acima.
    warnings.push(
      `proveniencia nao persistida (a collection so a guarda em paragrafo) nos blocos: ${provenanceDropped.join(', ')}`,
    )
  }

  return { blocks: mapped, warnings, details }
}
