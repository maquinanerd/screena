/**
 * Da URL colada ao dado tipado.
 *
 * O que estes testes protegem e a ALLOWLIST. Um parser permissivo aqui nao
 * produz um embed feio: produz execucao de terceiro numa pagina indexavel, que e
 * a coisa que o contrato editorial recusa desde o inicio.
 */

import { describe, expect, it } from 'vitest'

import { embedPlayerUrl, parseEmbedUrl, stripTracking } from '../embed-url.js'

describe('parseEmbedUrl — YouTube', () => {
  it('reconhece /watch, youtu.be, /shorts e /embed como o MESMO video', () => {
    const esperado = { provider: 'youtube', externalId: 'dQw4w9WgXcQ' }
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    ]) {
      const parsed = parseEmbedUrl(url)
      expect(parsed, url).toMatchObject(esperado)
      // Canoniza para UMA forma: duas URLs do mesmo video nao viram dois embeds.
      expect(parsed?.canonicalUrl, url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    }
  })

  it('descarta o rastreador `si=` que o botao de compartilhar cola junto', () => {
    const parsed = parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ?si=AbC_123')
    expect(parsed?.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
})

describe('parseEmbedUrl — Instagram e X', () => {
  it('reconhece post, reel e tv do Instagram', () => {
    for (const kind of ['p', 'reel', 'tv']) {
      const parsed = parseEmbedUrl(`https://www.instagram.com/${kind}/CxYz_123/`)
      expect(parsed, kind).toMatchObject({ provider: 'instagram', externalId: 'CxYz_123' })
    }
  })

  it('reconhece x.com e twitter.com, e guarda o id numerico do post', () => {
    for (const host of ['x.com', 'twitter.com', 'mobile.twitter.com']) {
      const parsed = parseEmbedUrl(`https://${host}/cinerie/status/1234567890`)
      expect(parsed, host).toMatchObject({ provider: 'x', externalId: '1234567890' })
      expect(parsed?.canonicalUrl, host).toBe('https://x.com/cinerie/status/1234567890')
    }
  })
})

describe('ALLOWLIST — o que NAO vira embed', () => {
  it('recusa esquema perigoso', () => {
    // O caso que importa: `new URL()` aceita `javascript:` sem reclamar. Quem
    // recusa e a checagem de protocolo, e ela precisa vir ANTES do parsing.
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(parseEmbedUrl(url), url).toBeNull()
    }
  })

  it('recusa host fora da lista, por mais parecido que seja', () => {
    for (const url of [
      'https://youtube.com.evil.test/watch?v=abc',
      'https://notyoutube.com/watch?v=abc',
      'https://vimeo.com/12345',
      'https://example.com/p/CxYz_123/',
    ]) {
      expect(parseEmbedUrl(url), url).toBeNull()
    }
  })

  it('recusa URL do provedor certo sem recurso reconhecivel', () => {
    for (const url of [
      'https://www.youtube.com/',
      'https://www.youtube.com/@canal',
      'https://www.instagram.com/perfil/',
      'https://x.com/cinerie',
      'https://x.com/cinerie/status/nao-numerico',
    ]) {
      expect(parseEmbedUrl(url), url).toBeNull()
    }
  })

  it('recusa id com caractere fora do alfabeto seguro', () => {
    expect(parseEmbedUrl('https://youtu.be/../../etc')).toBeNull()
    expect(parseEmbedUrl('https://www.instagram.com/p/<script>/')).toBeNull()
  })

  it('CONTROLE NEGATIVO: o detector aceita o caso valido conhecido', () => {
    // Sem isto, um `parseEmbedUrl` que devolvesse `null` sempre passaria em
    // todos os testes de recusa acima.
    expect(parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).not.toBeNull()
  })
})

describe('embedPlayerUrl', () => {
  it('monta o player do YouTube em nocookie, a partir do id', () => {
    expect(embedPlayerUrl('youtube', 'dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    )
  })

  it('Instagram e X NAO tem player — o site desenha cartao', () => {
    // E aqui que a promessa "cartao, nao embed nativo" fica mecanica: sem URL de
    // player, nao ha iframe possivel para esses dois.
    expect(embedPlayerUrl('instagram', 'CxYz_123')).toBeNull()
    expect(embedPlayerUrl('x', '1234567890')).toBeNull()
  })

  it('id fora do alfabeto seguro nao vira player', () => {
    expect(embedPlayerUrl('youtube', '../evil')).toBeNull()
    expect(embedPlayerUrl('youtube', '')).toBeNull()
  })
})

describe('stripTracking', () => {
  it('remove utm_* e afins, preserva o resto', () => {
    expect(stripTracking('https://exemplo.test/a?x=1&utm_source=z&si=k')).toBe(
      'https://exemplo.test/a?x=1',
    )
  })

  it('devolve a entrada intacta quando nao e URL', () => {
    expect(stripTracking('  nao e url  ')).toBe('nao e url')
  })
})
