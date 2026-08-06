/**
 * `embed` e `gallery`, do contrato ate o que o site desenha.
 *
 * O ponto sensivel aqui nao e layout, e SEGURANCA: um embed e a unica coisa no
 * corpo que pode virar execucao de terceiro. Estes testes travam as duas
 * promessas do contrato editorial — nenhum HTML atravessa o editor, e nenhum
 * script de terceiro carrega sem acao do usuario.
 */

import { describe, expect, it } from 'vitest'

import { buildArticleBodyBlocks } from '../../apps/web/src/lib/article-body-presenter.js'
import { embedBlock, galleryBlock } from '../../packages/editorial-contracts/src/blocks.js'

const hydration = { entityCards: new Map(), articles: new Map(), media: new Map(), sources: new Map() }
const render = (raw: unknown): ReturnType<typeof buildArticleBodyBlocks> =>
  buildArticleBodyBlocks([raw], hydration as never)

const YT = {
  id: 'b1',
  type: 'embed',
  provider: 'youtube',
  externalId: 'dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  originalUrl: 'https://youtu.be/dQw4w9WgXcQ',
}

describe('embed: contrato', () => {
  it('aceita os tres provedores da allowlist', () => {
    for (const provider of ['youtube', 'instagram', 'x']) {
      expect(embedBlock.safeParse({ ...YT, provider }).success, provider).toBe(true)
    }
  })

  it('recusa provedor fora da allowlist', () => {
    expect(embedBlock.safeParse({ ...YT, provider: 'tiktok' }).success).toBe(false)
  })

  it('NAO existe campo de HTML — o markup nunca atravessa', () => {
    // A garantia estrutural: `z.object` remove chave desconhecida em silencio,
    // entao um `html` colado simplesmente nao sobrevive ao parse.
    const parsed = embedBlock.safeParse({ ...YT, html: '<script>alert(1)</script>' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'html' in parsed.data).toBe(false)
  })

  it('recusa URL que nao seja http(s)', () => {
    expect(embedBlock.safeParse({ ...YT, canonicalUrl: 'javascript:alert(1)' }).success).toBe(false)
  })
})

describe('embed: o renderer DESENHA', () => {
  it('YouTube ganha player montado por NOS, em nocookie', () => {
    const block = render(YT)[0]
    expect(block?.kind).toBe('embed')
    if (block?.kind !== 'embed') return
    expect(block.playerUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('Instagram e X NAO ganham player — viram cartao com link', () => {
    // A promessa "cartao, nao embed nativo", travada mecanicamente: sem
    // `playerUrl` nao ha iframe possivel para esses dois.
    for (const provider of ['instagram', 'x']) {
      const block = render({ ...YT, provider, externalId: 'abc123' })[0]
      if (block?.kind !== 'embed') throw new Error(`${provider} nao foi desenhado`)
      expect(block.playerUrl, provider).toBeNull()
      expect(block.href, provider).not.toBe('')
    }
  })

  it('id do YouTube fora do formato NAO vira player', () => {
    // Sem isto, um id invatado montaria uma URL de player quebrada em vez de
    // degradar para link.
    const block = render({ ...YT, externalId: 'curto' })[0]
    if (block?.kind !== 'embed') throw new Error('bloco nao desenhado')
    expect(block.playerUrl).toBeNull()
  })

  it('sem endereco utilizavel, o bloco SOME em vez de virar buraco', () => {
    expect(render({ ...YT, canonicalUrl: 'javascript:alert(1)', originalUrl: '  ' })).toEqual([])
  })

  it('CONTROLE NEGATIVO: o detector aceita o caso valido', () => {
    expect(render(YT)).toHaveLength(1)
  })
})

describe('gallery', () => {
  const imagem = (n: number) => ({
    publicPath: `/media/editorial/foto-${String(n)}.jpg`,
    alt: `foto ${String(n)}`,
    credit: `Fotografo ${String(n)}`,
  })

  it('contrato exige ao menos uma imagem', () => {
    expect(galleryBlock.safeParse({ id: 'g1', type: 'gallery', items: [] }).success).toBe(false)
  })

  it('desenha as imagens na ordem, com credito POR imagem', () => {
    const block = render({ id: 'g1', type: 'gallery', items: [imagem(1), imagem(2)] })[0]
    expect(block?.kind).toBe('gallery')
    if (block?.kind !== 'gallery') return
    expect(block.items).toHaveLength(2)
    // Credito e por foto: uma galeria com um credito so mentiria sobre as demais.
    expect(block.items[0]?.credit).toBe('Fotografo 1')
    expect(block.items[1]?.credit).toBe('Fotografo 2')
  })

  it('FALLBACK: imagem sem caminho nao derruba a galeria inteira', () => {
    const block = render({
      id: 'g1',
      type: 'gallery',
      items: [imagem(1), { alt: 'sem caminho' }, imagem(3)],
    })[0]
    if (block?.kind !== 'gallery') throw new Error('galeria nao desenhada')
    expect(block.items).toHaveLength(2)
  })

  it('indice de abertura fora da faixa cai para a primeira', () => {
    const block = render({ id: 'g1', type: 'gallery', items: [imagem(1)], initialIndex: 9 })[0]
    if (block?.kind !== 'gallery') throw new Error('galeria nao desenhada')
    expect(block.initialIndex).toBe(0)
  })

  it('CONTROLE NEGATIVO: galeria sem imagem utilizavel SOME', () => {
    expect(render({ id: 'g1', type: 'gallery', items: [{ alt: 'so alt' }] })).toEqual([])
  })
})
