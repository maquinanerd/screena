/**
 * birth.test.ts — A politica de NASCIMENTO da midia.
 *
 * O que estes testes existem para impedir e um caso concreto e ja pago: a
 * ingestao gravava `display_allowed=false` por DEFAULT do DDL, sem consultar
 * licenca nenhuma, enquanto a licenca de imagem e a de video do TMDB diziam
 * `official` + `display_allowed=true`. Cada ciclo acrescentava linhas invisiveis
 * e a unica saida era uma operacao manual em massa — repetida para sempre.
 *
 * O CONTROLE NEGATIVO vem primeiro em cada bloco. Sem ele, uma politica que
 * simplesmente sempre acendesse passaria em todos os testes positivos.
 */

import { describe, expect, it } from 'vitest'

import { createMediaBirthPolicy, DARK_MEDIA_BIRTH_POLICY, MEDIA_BIRTH_DARK } from '../birth.js'
import type { MediaLicenseRow } from '../license.js'

function licenca(overrides: Partial<MediaLicenseRow> = {}): MediaLicenseRow {
  return {
    sourceKey: 'tmdb',
    contentType: 'video',
    licenseStatus: 'official',
    displayAllowed: true,
    isCurrent: true,
    policyVersion: 'teste/v1',
    ...overrides,
  }
}

const IMAGEM_OK = licenca({ contentType: 'image' })
const VIDEO_OK = licenca({ contentType: 'video' })

/** Um id do YouTube tem 11 caracteres do alfabeto do YouTube. */
const VIDEO_KEY_VALIDO = 'dQw4w9WgXcQ'

describe('politica de nascimento da midia — o lado NEGATIVO', () => {
  it('sem NENHUMA licenca, video e imagem nascem apagados', () => {
    const policy = createMediaBirthPolicy({ image: [], video: [] })
    expect(policy.forImage({ filePath: '/abc.jpg' })).toEqual(MEDIA_BIRTH_DARK)
    expect(policy.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO })).toEqual(
      MEDIA_BIRTH_DARK,
    )
  })

  it('licenca NAO vigente nao autoriza (is_current=false)', () => {
    const policy = createMediaBirthPolicy({
      image: [licenca({ contentType: 'image', isCurrent: false })],
      video: [licenca({ isCurrent: false })],
    })
    expect(policy.forImage({ filePath: '/abc.jpg' }).displayAllowed).toBe(false)
    expect(policy.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).displayAllowed).toBe(
      false,
    )
  })

  it('licenca com status bloqueante nao autoriza (invariante 6)', () => {
    for (const status of ['unknown', 'blocked']) {
      const policy = createMediaBirthPolicy({
        image: [licenca({ contentType: 'image', licenseStatus: status })],
        video: [licenca({ licenseStatus: status })],
      })
      expect(policy.forImage({ filePath: '/abc.jpg' }).displayAllowed, status).toBe(false)
      expect(
        policy.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).displayAllowed,
        status,
      ).toBe(false)
    }
  })

  it('licenca vigente com display_allowed=false nao autoriza', () => {
    const policy = createMediaBirthPolicy({
      image: [licenca({ contentType: 'image', displayAllowed: false })],
      video: [licenca({ displayAllowed: false })],
    })
    expect(policy.forImage({ filePath: '/abc.jpg' }).displayAllowed).toBe(false)
    expect(policy.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).displayAllowed).toBe(
      false,
    )
  })

  it('a licenca de VIDEO nao acende IMAGEM, e vice-versa', () => {
    const soVideo = createMediaBirthPolicy({ image: [], video: [VIDEO_OK] })
    expect(soVideo.forImage({ filePath: '/abc.jpg' }).displayAllowed).toBe(false)
    expect(soVideo.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).displayAllowed).toBe(
      true,
    )

    const soImagem = createMediaBirthPolicy({ image: [IMAGEM_OK], video: [] })
    expect(soImagem.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).displayAllowed).toBe(
      false,
    )
    expect(soImagem.forImage({ filePath: '/abc.jpg' }).displayAllowed).toBe(true)
  })

  it('a politica APAGADA nunca acende, sejam quais forem os dados', () => {
    expect(DARK_MEDIA_BIRTH_POLICY.forImage({ filePath: '/abc.jpg' })).toEqual(MEDIA_BIRTH_DARK)
    expect(
      DARK_MEDIA_BIRTH_POLICY.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }),
    ).toEqual(MEDIA_BIRTH_DARK)
  })
})

describe('politica de nascimento da midia — o lado POSITIVO', () => {
  const policy = createMediaBirthPolicy({ image: [IMAGEM_OK], video: [VIDEO_OK] })

  it('com licenca vigente, a linha nasce ACESA', () => {
    expect(policy.forImage({ filePath: '/abc.jpg' })).toEqual({
      displayAllowed: true,
      licenseStatus: 'official',
    })
    expect(policy.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO })).toEqual({
      displayAllowed: true,
      licenseStatus: 'official',
    })
  })

  it('o license_status gravado e o DA LICENCA, nunca um literal otimista', () => {
    const licenciada = createMediaBirthPolicy({
      image: [licenca({ contentType: 'image', licenseStatus: 'licensed' })],
      video: [licenca({ licenseStatus: 'licensed' })],
    })
    expect(licenciada.forImage({ filePath: '/abc.jpg' }).licenseStatus).toBe('licensed')
    expect(licenciada.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO }).licenseStatus).toBe(
      'licensed',
    )
  })

  it('third_party nao acende imagem: a galeria de pessoa so aceita official/licensed', () => {
    // Direcao SEGURA de errar. Ver o cabecalho de `birth.ts`: a leitura de
    // imagem usa o gate mais estrito, e uma linha de titulo nascer apagada nao
    // muda nada na tela (a galeria de titulo e gated pela FONTE).
    const terceiro = createMediaBirthPolicy({
      image: [licenca({ contentType: 'image', licenseStatus: 'third_party' })],
      video: [licenca({ licenseStatus: 'third_party' })],
    })
    expect(terceiro.forImage({ filePath: '/abc.jpg' }).displayAllowed).toBe(false)
    // Video NAO tem esse estreitamento: `third_party` passa a invariante 6.
    expect(terceiro.forVideo({ site: 'YouTube', videoKey: VIDEO_KEY_VALIDO })).toEqual({
      displayAllowed: true,
      licenseStatus: 'third_party',
    })
  })
})

describe('o GUARDRAIL por linha sobrevive a licenca', () => {
  const policy = createMediaBirthPolicy({ image: [IMAGEM_OK], video: [VIDEO_OK] })

  it('site que nao e YouTube nasce apagado, mesmo licenciado', () => {
    for (const site of ['Vimeo', 'YouTube Kids', 'MyYouTube', '']) {
      expect(policy.forVideo({ site, videoKey: VIDEO_KEY_VALIDO }).displayAllowed, site).toBe(false)
    }
  })

  it('video_key fora do formato nasce apagado, mesmo licenciado', () => {
    for (const key of ['', 'curto', 'x'.repeat(12), 'com espaco']) {
      expect(policy.forVideo({ site: 'YouTube', videoKey: key }).displayAllowed, key).toBe(false)
    }
  })

  it('file_path que nao vira URL nasce apagado, mesmo licenciado', () => {
    for (const filePath of ['', 'sem-barra.jpg', '/media/local.jpg', 'C:/arquivo.jpg']) {
      expect(policy.forImage({ filePath }).displayAllowed, filePath).toBe(false)
    }
  })
})
