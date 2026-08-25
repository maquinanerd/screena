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
 * POR QUE EXPLICITO POR TIPO, e nao `{ ...block, blockType: type }`. Tres
 * razoes concretas, todas verificadas no schema real:
 *  - `heading.level` e NUMERO no contrato e a coluna e
 *    `enum_articles_blocks_heading_level AS ENUM('2','3','4')` — texto;
 *  - `image.mediaRef` e uma referencia de CONTRATO, e a coluna e `media_id`,
 *    uma relacao de verdade. Spread deixaria `mediaRef` passar e `media`
 *    vazio, e o gate de midia do corpo (que le `block.media`) nunca veria a
 *    imagem;
 *  - `video` do YouTube MUDA DE TIPO: entra como `video` e e persistido como
 *    `embed`, que e o unico bloco que o site sabe transformar em player. Um
 *    spread nao teria como fazer isso, porque a traducao aqui nao e de campo —
 *    e do bloco inteiro.
 * Um spread tambem faria qualquer campo novo do contrato atravessar para a
 * persistencia sem ninguem decidir que ele atravessa.
 */

import { EDITORIAL_BLOCK_TYPES } from '@screena/editorial-contracts'

import { parseEmbedUrl, type ParsedEmbed } from './embed-url.js'

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
/**
 * O `embed` equivalente a um bloco `video` do YouTube, ou `null`.
 *
 * A URL manda; `externalId` e o plano B, e a ordem nao e arbitraria. O contrato
 * deixa os dois opcionais e o MNScr OMITE `externalId` quando o id comeca por
 * `-` ou `_`: `stableId` exige primeiro caractere alfanumerico, e mandar um
 * desses reprovaria o pedido INTEIRO por causa de um campo opcional. Quando so
 * o id chega, a URL canonica que ele determina e a unica origem que existe — e
 * e ela que vai em `originalUrl`, porque nao houve endereco colado por ninguem.
 *
 * `parseEmbedUrl` e a MESMA funcao que o admin usa na colagem: id de 11
 * caracteres, allowlist fechada de host, sem rastreador na canonica. Reusa-la
 * aqui e o que impede a ingestao de aceitar uma URL que o editor recusaria.
 */
function youtubeEmbedOf(block: ContractBlock): (ParsedEmbed & { originalUrl: string }) | null {
  const url = text(block.url)
  if (url !== undefined) {
    const parsed = parseEmbedUrl(url)
    // URL presente e ilegivel NAO cai para o id: o emissor declarou um endereco,
    // e converter para outro video seria trocar o conteudo dele em silencio.
    return parsed !== null && parsed.provider === 'youtube' ? { ...parsed, originalUrl: url } : null
  }

  const externalId = text(block.externalId)
  if (externalId === undefined) return null
  const parsed = parseEmbedUrl(`https://www.youtube.com/watch?v=${externalId}`)
  return parsed !== null && parsed.provider === 'youtube'
    ? { ...parsed, originalUrl: parsed.canonicalUrl }
    : null
}

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
        mapped.push({
          ...base,
          text: String(block.text ?? ''),
          // `marks` chega ja validado contra o texto pelo Zod do contrato
          // (limites dentro do paragrafo, sem cortar caractere ao meio, sem
          // sobreposicao do mesmo tipo) e a coluna e `json`: nao ha traducao a
          // fazer, so repassar. Lista vazia NAO e gravada — gravar `[]` faria um
          // paragrafo sem enfase parecer um paragrafo cuja enfase foi apagada.
          ...(Array.isArray(block.marks) && block.marks.length > 0
            ? { marks: block.marks }
            : {}),
          ...provenanceOf(block),
        })
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

      case 'video': {
        /*
         * VIDEO DO YOUTUBE VIRA `embed`, E A TRADUCAO MORA AQUI.
         *
         * O contrato de ENTRADA nao tem `embed` — ele e de saida, pela mesma
         * regra que segurava `marks` e `list` (`blocks.ts`). O emissor so pode
         * pedir `video`, e o site desenha `video` como LINK, de proposito:
         * `<iframe>` carrega script de terceiro em pagina indexavel. O player
         * existe em `embed`, e ele NAO e um iframe solto — e `YouTubeFacade`,
         * cartao estatico que so contata o YouTube depois do clique.
         *
         * Por que no mapper e nao no render: o mapper E a fronteira onde o
         * vocabulario do contrato vira o vocabulario da collection. Traduzido no
         * render, o admin mostraria `video` e a pagina mostraria player — duas
         * verdades para o mesmo bloco, e a segunda invisivel para quem edita.
         *
         * So o YouTube converte. `vimeo` e `internal` nao estao na allowlist de
         * `embed`, e um endereco que `parseEmbedUrl` recusa renderia player
         * quebrado no lugar de um link que funciona. Nos dois casos o bloco
         * continua `video` e nao ha aviso: nada se perdeu.
         */
        const embed = block.provider === 'youtube' ? youtubeEmbedOf(block) : null
        if (embed !== null) {
          mapped.push({
            blockType: 'embed',
            blockId,
            provider: 'youtube',
            externalId: embed.externalId,
            canonicalUrl: embed.canonicalUrl,
            originalUrl: embed.originalUrl,
            // `title` do video e a legenda do embed: as duas sao a frase que
            // acompanha o player.
            ...optional('caption', block.title),
          })
          // `credit` nao tem par em `embed`. Sai NOMEADO em vez de sumir — a
          // regra da casa vale tambem quando a perda e de um campo so.
          if (text(block.credit) !== undefined) {
            lose({
              code: 'BLOCK_VIDEO_CREDIT_DROPPED',
              field: `blocks[${String(index)}].credit`,
              blockId,
              detail: `credito do video "${blockId}" nao persistido: o bloco de incorporacao do YouTube nao tem campo de credito`,
            })
          }
          break
        }
        mapped.push({
          ...base,
          provider: block.provider,
          ...optional('externalId', block.externalId),
          ...optional('url', block.url),
          ...optional('title', block.title),
          ...optional('credit', block.credit),
        })
        break
      }

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
