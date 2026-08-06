/**
 * embed-url.ts — Da URL colada ao DADO TIPADO. PURO: sem rede, sem DOM.
 *
 * O redator cola uma URL. Daqui sai `{ provider, externalId, canonicalUrl }` —
 * e so isso atravessa. Nunca HTML, nunca `<iframe>` pronto, nunca oEmbed
 * guardado como markup: o site MONTA o player a partir do id, e por isso nada
 * que o editor receba pode virar execucao.
 *
 * ALLOWLIST FECHADA, nao "validacao de URL". Host que nao esta na lista nao vira
 * embed — vira link, que e o desfecho seguro e honesto. Uma lista aberta com
 * regex de "parece um video" e como se aceita `javascript:` por engano.
 *
 * PURO e num `.ts` de proposito: o vitest deste app nao coleta `.tsx`, e esta e
 * a logica que decide o que sera incorporado. Dentro do componente, ela nunca
 * teria teste.
 */

/** Provedores aceitos. Espelha `EMBED_PROVIDERS` do contrato. */
export type EmbedProvider = 'youtube' | 'instagram' | 'x'

export interface ParsedEmbed {
  readonly provider: EmbedProvider
  /** Id do recurso no provedor — o que o site usa para montar o player. */
  readonly externalId: string
  /** Forma canonica: sem rastreador, sem `si=`, sem barra final supérflua. */
  readonly canonicalUrl: string
}

/** Parametros de rastreamento que nunca entram na URL canonica. */
const TRACKING = new Set([
  'si',
  'feature',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'igshid',
  'igsh',
  's',
  't',
  'ref',
  'ref_src',
  'ref_url',
])

/** `^[A-Za-z0-9_-]+$` — o alfabeto de id que os tres provedores usam. */
function isSafeId(value: string): boolean {
  return value !== '' && /^[A-Za-z0-9_-]+$/.test(value)
}

/**
 * Id de video do YouTube: EXATAMENTE 11 caracteres do alfabeto seguro.
 *
 * O comprimento nao e preciosismo. `new URL()` NORMALIZA o caminho, entao
 * `https://youtu.be/../../etc` chega aqui como `/etc` — e `etc` passa no
 * alfabeto. Sem o comprimento, uma URL lixo virava um embed com id inventado,
 * que rende um player quebrado na materia publicada em vez de degradar para
 * link, que e o desfecho correto.
 */
function isYoutubeId(value: string): boolean {
  return value.length === 11 && isSafeId(value)
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, '').toLowerCase()
}

/**
 * Interpreta uma URL colada.
 *
 * Devolve `null` para tudo que nao for um recurso reconhecido de um provedor da
 * allowlist — incluindo `javascript:`, `data:`, host desconhecido e URL
 * malformada. `null` NAO e erro: e o sinal de "isto continua sendo um link".
 */
export function parseEmbedUrl(raw: string): ParsedEmbed | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  // So http(s). `javascript:` e `data:` morrem aqui, antes de qualquer parsing.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = hostOf(url)
  const segments = url.pathname.split('/').filter((part) => part !== '')

  /* --- YouTube ---------------------------------------------------- */
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    // `/watch?v=<id>`
    const v = url.searchParams.get('v')
    if (v !== null && isYoutubeId(v)) {
      return { provider: 'youtube', externalId: v, canonicalUrl: `https://www.youtube.com/watch?v=${v}` }
    }
    // `/shorts/<id>` e `/embed/<id>` sao o MESMO video: canonizam para /watch.
    if ((segments[0] === 'shorts' || segments[0] === 'embed') && isYoutubeId(segments[1] ?? '')) {
      const id = segments[1] as string
      return { provider: 'youtube', externalId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` }
    }
    return null
  }
  if (host === 'youtu.be' && isYoutubeId(segments[0] ?? '')) {
    const id = segments[0] as string
    return { provider: 'youtube', externalId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` }
  }

  /* --- Instagram --------------------------------------------------- */
  if (host === 'instagram.com') {
    // `/p/<id>`, `/reel/<id>`, `/tv/<id>` — o id e o mesmo shortcode.
    const kind = segments[0]
    if ((kind === 'p' || kind === 'reel' || kind === 'tv') && isSafeId(segments[1] ?? '')) {
      const id = segments[1] as string
      return {
        provider: 'instagram',
        externalId: id,
        canonicalUrl: `https://www.instagram.com/${kind}/${id}/`,
      }
    }
    return null
  }

  /* --- X / Twitter -------------------------------------------------- */
  if (host === 'x.com' || host === 'twitter.com' || host === 'mobile.twitter.com') {
    // `/<perfil>/status/<id>` — o id do post e numerico.
    const statusAt = segments.indexOf('status')
    const id = segments[statusAt + 1]
    if (statusAt > 0 && id !== undefined && /^\d+$/.test(id)) {
      const handle = segments[0] as string
      return { provider: 'x', externalId: id, canonicalUrl: `https://x.com/${handle}/status/${id}` }
    }
    return null
  }

  return null
}

/**
 * Limpa rastreadores de uma URL, preservando o resto.
 *
 * Usada na URL ORIGINAL que fica guardada para auditoria: guardar o `utm_*` de
 * quem colou nao ajuda ninguem e vaza a origem do clique.
 */
export function stripTracking(raw: string): string {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return raw.trim()
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return raw.trim()
  }
}

/**
 * A URL do player, montada POR NOS a partir do id ja validado.
 *
 * `youtube-nocookie` porque o player padrao grava antes de qualquer clique, e o
 * embed so carrega apos acao do usuario — as duas coisas juntas sao o que
 * mantem a promessa de "nenhum script de terceiro sem acao".
 *
 * So YouTube tem player: Instagram e X exigiriam o script deles, entao ali o
 * site desenha CARTAO PROPRIO e o `null` daqui e o que diz isso.
 */
export function embedPlayerUrl(provider: EmbedProvider, externalId: string): string | null {
  if (provider !== 'youtube') return null
  if (!isYoutubeId(externalId)) return null
  return `https://www.youtube-nocookie.com/embed/${externalId}`
}
