/**
 * Nucleo puro da ingestao de midia editorial.
 *
 * A foto era o ULTIMO dado que ainda exigia um humano no painel. A decisao do
 * operador que molda este modulo: imagem de robo e publica sempre, e a
 * proveniencia serve para ATENDER RECLAMACAO, nao para bloquear.
 *
 * Dessa decisao decorre a regra que a maior parte destes testes cobre: se a
 * proveniencia nao barra na SAIDA, ela precisa ser obrigatoria na ENTRADA — o
 * unico momento em que existe um emissor escutando a recusa. Uma foto que entra
 * sem credito passa no acervo e morre calada na entrega, com
 * `attribution_missing`, e ninguem fica sabendo.
 */

import { describe, expect, it } from 'vitest'

import type { MediaIngestAuth } from '../media-intake.js'
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_REQUEST_BYTES,
  decideMediaIngestOutcome,
  decodeBase64,
  detectDangerousFormat,
  intakeEditorialMedia,
  sniffIngestibleMime,
} from '../media-intake.js'

/* ------------------------------------------------------------------ */
/* Fixtures — bytes REAIS, decodificaveis                              */
/* ------------------------------------------------------------------ */

/**
 * PNG 1x1 valido de verdade.
 *
 * Fixture so-cabecalho ja quebrou este repositorio antes: passa em quem olha a
 * assinatura e falha em quem DECODIFICA. Como o Payload gera miniatura
 * (`imageSizes`), os bytes precisam ser decodificaveis de fato.
 */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const PNG_BYTES = Buffer.from(PNG_1X1_BASE64, 'base64')

/** JPEG minimo com assinatura real (FF D8 FF) — basta para o sniff. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

function base64(bytes: Buffer): string {
  return bytes.toString('base64')
}

const AUTH: MediaIngestAuth = {
  authenticated: true,
  hasMediaIngestScope: true,
  accountId: 'svc-1',
}

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    articleId: '42',
    sourceUrl: 'https://exemplo.com/foto.png',
    sourceName: 'Estudio Exemplo',
    rightsHolder: 'Estudio Exemplo',
    credit: 'Divulgacao/Estudio Exemplo',
    alt: 'Cena do filme',
    contentType: 'image/png',
    contentBase64: PNG_1X1_BASE64,
    ...overrides,
  }
}

function intake(overrides: Record<string, unknown> = {}, auth: MediaIngestAuth = AUTH) {
  const payload = body(overrides)
  const raw = JSON.stringify(payload)
  return intakeEditorialMedia({
    auth,
    rawBodyBytes: Buffer.byteLength(raw, 'utf8'),
    body: payload,
  })
}

/* ------------------------------------------------------------------ */

describe('ingestao de midia — controle positivo', () => {
  it('pedido completo e aceito, e o comando carrega a proveniencia inteira', () => {
    const result = intake()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.command.articleId).toBe('42')
    expect(result.command.sourceUrl).toBe('https://exemplo.com/foto.png')
    expect(result.command.sourceName).toBe('Estudio Exemplo')
    expect(result.command.rightsHolder).toBe('Estudio Exemplo')
    expect(result.command.credit).toBe('Divulgacao/Estudio Exemplo')
    expect(result.command.alt).toBe('Cena do filme')
    expect(result.command.contentType).toBe('image/png')
    expect(result.command.bytes.length).toBe(PNG_BYTES.length)
  })


  it('caption e opcional e vira null quando ausente', () => {
    const result = intake()
    expect(result.ok && result.command.caption).toBeNull()
  })
})

describe('identidade — 401 e 403 dizem coisas diferentes', () => {
  it('sem credencial: 401', () => {
    const result = intake({}, { authenticated: false, hasMediaIngestScope: false, accountId: null })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('unauthenticated')
    expect(result.rejection.status).toBe(401)
  })

  it('credencial reconhecida SEM o escopo: 403, nao 401', () => {
    // A distincao importa em operacao: 401 manda o emissor conferir a chave;
    // 403 manda conferir o ESCOPO da conta. Colapsar os dois faria alguem
    // regerar uma chave que estava certa o tempo todo.
    const result = intake({}, { authenticated: true, hasMediaIngestScope: false, accountId: 'svc-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('forbidden_scope')
    expect(result.rejection.status).toBe(403)
  })

  it('a identidade e checada ANTES de qualquer decodificacao', () => {
    // Sem esta ordem, um anonimo conseguiria fazer o processo decodificar 15 MB
    // de base64 antes de levar 401.
    const result = intakeEditorialMedia({
      auth: { authenticated: false, hasMediaIngestScope: false, accountId: null },
      rawBodyBytes: MAX_MEDIA_REQUEST_BYTES + 1,
      body: { contentBase64: 'lixo' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('unauthenticated')
  })
})

describe('proveniencia OBRIGATORIA na entrada', () => {
  const REQUIRED = ['sourceUrl', 'sourceName', 'rightsHolder', 'credit', 'alt'] as const

  for (const field of REQUIRED) {
    it(`${field} ausente e recusado com 422 nomeando o campo`, () => {
      const result = intake({ [field]: undefined })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.rejection.code).toBe('validation_failed')
      expect(result.rejection.status).toBe(422)
      expect(result.rejection.issues.join(' ')).toContain(`${field} ausente`)
    })

    it(`${field} so com espacos conta como ausente`, () => {
      const result = intake({ [field]: '   ' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.rejection.issues.join(' ')).toContain(`${field} ausente`)
    })
  }

  it('TODOS os campos faltando saem numa lista, nao um por vez', () => {
    // Um emissor que descobre um campo faltando por requisicao levaria cinco
    // rodadas para acertar o corpo.
    const result = intake({
      sourceUrl: undefined,
      sourceName: undefined,
      rightsHolder: undefined,
      credit: undefined,
      alt: undefined,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.issues.length).toBeGreaterThanOrEqual(5)
  })

  it('credito ausente e barrado AQUI, e nao na entrega', () => {
    // `requiresAttribution` nasce `true` e `authorizeMediaDelivery` recusa com
    // `attribution_missing`. Se esta validacao sumir, a foto entra no acervo e
    // desaparece na hora de servir, sem ninguem ser avisado.
    const result = intake({ credit: undefined })
    expect(result.ok).toBe(false)
  })
})

describe('sourceUrl — prova de origem, nao endereco de download', () => {
  it('aceita http e https absolutas', () => {
    expect(intake({ sourceUrl: 'https://a.com/x.png' }).ok).toBe(true)
    expect(intake({ sourceUrl: 'http://a.com/x.png' }).ok).toBe(true)
  })

  it('recusa esquema que nao seja http(s)', () => {
    for (const url of ['file:///etc/passwd', 'ftp://a.com/x.png', 'javascript:alert(1)']) {
      const result = intake({ sourceUrl: url })
      expect(result.ok, url).toBe(false)
      if (!result.ok) {
        expect(result.rejection.issues.join(' ')).toContain('sourceUrl precisa ser http(s) absoluta')
      }
    }
  })

  it('recusa caminho relativo', () => {
    expect(intake({ sourceUrl: '/media/foto.png' }).ok).toBe(false)
  })
})

describe('bytes — a assinatura decide, o contentType so pega mentira', () => {
  it('MIME fora da lista e recusado com 415', () => {
    const result = intake({ contentType: 'image/gif' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('mime_not_allowed')
    expect(result.rejection.status).toBe(415)
  })

  it('AVIF e recusado DE PROPOSITO na ingestao por maquina', () => {
    // A entrega aceita AVIF (um humano escolheu aquele arquivo). Aqui nao: as
    // dimensoes vivem numa caixa de deslocamento variavel que este modulo nao
    // le, e aceitar seria abrir mao do gate de pixels em silencio.
    const result = intake({ contentType: 'image/avif' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.code).toBe('mime_not_allowed')
  })

  it('contentType MENTINDO sobre os bytes e recusado', () => {
    const result = intake({ contentType: 'image/jpeg', contentBase64: PNG_1X1_BASE64 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('bytes_mismatch')
    expect(result.rejection.issues.join(' ')).toContain('assinatura diz image/png')
  })

  it('JPEG declarado como JPEG passa', () => {
    const result = intake({ contentType: 'image/jpeg', contentBase64: base64(JPEG_BYTES) })
    expect(result.ok).toBe(true)
  })

  it('SVG e recusado com motivo NOMEADO, nao "formato desconhecido"', () => {
    // "SVG recusado" ensina o emissor a corrigir. "Formato desconhecido" faz
    // ele reenviar o mesmo arquivo.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8')
    const result = intake({ contentType: 'image/png', contentBase64: base64(svg) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('dangerous_format')
    expect(result.rejection.issues.join(' ')).toContain('svg_or_xml')
  })

  it('HTML, PDF, executavel e ZIP tambem sao nomeados', () => {
    const cases: ReadonlyArray<readonly [string, Buffer, string]> = [
      ['html', Buffer.from('<!doctype html><html></html>', 'utf8'), 'html'],
      ['pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]), 'pdf'],
      ['exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'executable'],
      ['elf', Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'executable'],
      ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'archive'],
    ]
    for (const [label, bytes, expected] of cases) {
      const result = intake({ contentType: 'image/png', contentBase64: base64(bytes) })
      expect(result.ok, label).toBe(false)
      if (!result.ok) expect(result.rejection.issues.join(' '), label).toContain(expected)
    }
  })

  it('base64 malformado nao passa por decodificacao permissiva', () => {
    for (const raw of ['nao-e-base64!!', 'iVBORw0KGgo', '====']) {
      const result = intake({ contentBase64: raw })
      expect(result.ok, raw).toBe(false)
    }
  })

  it('CONTROLE NEGATIVO: o PNG da fixture decodifica de verdade', () => {
    // Fixture so-cabecalho ja quebrou este repositorio: passa no sniff e falha
    // em quem DECODIFICA (o Payload gera miniatura).
    const bytes = decodeBase64(PNG_1X1_BASE64)
    expect(bytes).not.toBeNull()
    expect(bytes?.length).toBeGreaterThan(60)
    expect(sniffIngestibleMime(bytes as Uint8Array)).toBe('image/png')
    expect(detectDangerousFormat(bytes as Uint8Array)).toBeNull()
  })
})

describe('tetos', () => {
  it('corpo acima do teto e 413 antes de qualquer parse', () => {
    const result = intakeEditorialMedia({
      auth: AUTH,
      rawBodyBytes: MAX_MEDIA_REQUEST_BYTES + 1,
      body: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('payload_too_large')
    expect(result.rejection.status).toBe(413)
  })

  it('imagem decodificada acima do teto e 413', () => {
    // PNG valido seguido de enchimento: a assinatura passa, o tamanho nao.
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_MEDIA_BYTES + 1)])
    const result = intakeEditorialMedia({
      auth: AUTH,
      rawBodyBytes: 1024,
      body: body({ contentBase64: base64(big) }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.rejection.code).toBe('image_too_large')
  })

  it('o teto do CORPO e maior que o da imagem — base64 infla 4/3', () => {
    expect(MAX_MEDIA_REQUEST_BYTES).toBeGreaterThan(MAX_MEDIA_BYTES)
  })
})

describe('idempotencia por (materia, sourceUrl)', () => {
  it('sem entrada anterior: created', () => {
    expect(decideMediaIngestOutcome(null, 'sha256:aa')).toBe('created')
  })

  it('mesma url, mesmo conteudo: unchanged — reenvio nao duplica', () => {
    // E o caso NORMAL: o MNScr reprocessa a materia a cada revisao e reenvia a
    // mesma foto.
    expect(
      decideMediaIngestOutcome({ mediaId: '7', contentHash: 'sha256:aa' }, 'sha256:aa'),
    ).toBe('unchanged')
  })

  it('mesma url, conteudo DIFERENTE: replaced — a fonte trocou a foto', () => {
    // Sobrescrever o arquivo em silencio apagaria a imagem que ja pode estar
    // publicada e servida por caminho derivado do conteudo.
    expect(
      decideMediaIngestOutcome({ mediaId: '7', contentHash: 'sha256:aa' }, 'sha256:bb'),
    ).toBe('replaced')
  })

  it('entrada anterior SEM hash conhecido nao e tratada como igual', () => {
    // `null` significa "nao sei", e nao "igual". Assumir igualdade deixaria uma
    // foto trocada na fonte sem nunca ser atualizada.
    expect(decideMediaIngestOutcome({ mediaId: '7', contentHash: null }, 'sha256:aa')).toBe(
      'replaced',
    )
  })
})

describe('articleId', () => {
  it('AUSENTE e aceito: a foto pode preceder a materia', () => {
    // Este teste afirmava o contrario, e a obrigacao criava um ovo-e-galinha: o
    // bloco `image` referencia `media[].mediaId` do MESMO pedido, mas o
    // `mediaId` so podia nascer depois de a materia existir. Medido: em toda
    // primeira publicacao o `media[]` saia vazio e nenhuma imagem entrava no
    // corpo.
    const result = intake({ articleId: undefined })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.command.articleId).toBeNull()
  })

  it('vazio e recusado — string em branco nao e "sem materia"', () => {
    // `''` e o sintoma classico de emissor que TENTOU mandar o id e falhou.
    // Trata-lo como ausente esconderia o defeito e deixaria a foto orfa.
    const result = intake({ articleId: '   ' })
    expect(result.ok).toBe(false)
  })

  it('nao-numerico e recusado ANTES de virar consulta', () => {
    // A PK de `articles` e inteira no PostgreSQL; mandar texto para `findByID`
    // levanta erro de driver, e erro de driver carrega detalhe de banco.
    const result = intake({ articleId: 'materia-do-homem-aranha' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.issues.join(' ')).toContain('articleId precisa ser numerico')
  })
})
