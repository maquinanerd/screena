/**
 * license.test.ts — O CONTROLE NEGATIVO do gate de licenca.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO E O MAIS IMPORTANTE DO PACOTE
 * ============================================================================
 * `tmdb_videos` NAO TEM TRIGGER. Em `watch_availability`, uma promocao sem
 * licenca morre no Postgres mesmo que a CLI erre; aqui a unica coisa entre uma
 * linha apagada e uma linha publica e `authorizeMediaPromotion`.
 *
 * Um gate testado so pelo caminho feliz passa verde com o corpo inteiro
 * apagado. Por isso cada porta de recusa tem asserçao PROPRIA, e o controle
 * POSITIVO existe para provar que as negativas nao passam por vacuidade.
 */

import { describe, expect, it } from 'vitest'

import {
  authorizeMediaPromotion,
  MEDIA_PROMOTION_DENIED,
  type MediaLicenseRow,
} from '../license.js'

/** Uma licenca vigente valida de video. Base para as mutacoes de cada teste. */
function licencaVideo(overrides: Partial<MediaLicenseRow> = {}): MediaLicenseRow {
  return {
    sourceKey: 'tmdb',
    contentType: 'video',
    licenseStatus: 'official',
    displayAllowed: true,
    isCurrent: true,
    policyVersion: 'cinerie-source-auth/tmdb-video/2026-08-v2',
    ...overrides,
  }
}

function licencaImagem(overrides: Partial<MediaLicenseRow> = {}): MediaLicenseRow {
  return {
    sourceKey: 'tmdb',
    contentType: 'image',
    licenseStatus: 'official',
    displayAllowed: true,
    isCurrent: true,
    policyVersion: 'cinerie-source-auth/tmdb-image/2026-08-v3',
    ...overrides,
  }
}

describe('CONTROLE POSITIVO — sem ele, toda negativa abaixo passaria por vacuidade', () => {
  it('licenca vigente de tmdb/video autoriza e devolve o status a gravar', () => {
    const auth = authorizeMediaPromotion('video', [licencaVideo()])
    expect(auth.authorized).toBe(true)
    expect(auth.licenseStatus).toBe('official')
    expect(auth.policyVersion).toBe('cinerie-source-auth/tmdb-video/2026-08-v2')
  })

  it('licenca vigente de tmdb/image autoriza o alvo person-photo', () => {
    const auth = authorizeMediaPromotion('person-photo', [licencaImagem()])
    expect(auth.authorized).toBe(true)
    expect(auth.licenseStatus).toBe('official')
  })
})

describe('NEGATIVO — as portas de recusa, uma a uma', () => {
  it('LISTA VAZIA nao autoriza (fail-closed: ausencia != permissao)', () => {
    const auth = authorizeMediaPromotion('video', [])
    expect(auth.authorized).toBe(false)
    expect(auth.licenseStatus).toBeNull()
    expect(auth.reason).toContain('sem licenca vigente')
  })

  it('licenca SUPERADA (is_current=false) nao autoriza, mesmo permitindo tudo', () => {
    // O caso realista: a v1 foi superada pela v2. Ler a superada acenderia o
    // catalogo sob uma politica que ninguem mais mantem.
    const auth = authorizeMediaPromotion('video', [licencaVideo({ isCurrent: false })])
    expect(auth.authorized).toBe(false)
    expect(auth.reason).toContain('sem licenca vigente')
  })

  it('display_allowed = false na vigente nao autoriza', () => {
    const auth = authorizeMediaPromotion('video', [licencaVideo({ displayAllowed: false })])
    expect(auth.authorized).toBe(false)
    expect(auth.reason).toContain('display_allowed = false')
  })

  it.each(['unknown', 'blocked'])('license_status "%s" nao autoriza (invariante 6)', (status) => {
    const auth = authorizeMediaPromotion('video', [licencaVideo({ licenseStatus: status })])
    expect(auth.authorized).toBe(false)
    expect(auth.reason).toContain(status)
  })

  it('licenca de OUTRO content_type nao autoriza — imagem nao acende video', () => {
    // A porta mais silenciosa: existe licenca da mesma FONTE, vigente e
    // permissiva, so que de outro dominio. Sem o filtro por content_type o gate
    // diria "sim" lendo o registro errado.
    const auth = authorizeMediaPromotion('video', [licencaImagem()])
    expect(auth.authorized).toBe(false)
    expect(auth.reason).toContain('sem licenca vigente')
  })

  it('licenca de OUTRA fonte nao autoriza', () => {
    const auth = authorizeMediaPromotion('video', [licencaVideo({ sourceKey: 'omdb' })])
    expect(auth.authorized).toBe(false)
  })

  it('a marca nao e fabricavel por literal: MEDIA_PROMOTION_DENIED nega', () => {
    expect(MEDIA_PROMOTION_DENIED.authorized).toBe(false)
    expect(MEDIA_PROMOTION_DENIED.licenseStatus).toBeNull()
  })
})

/**
 * O estreitamento que so vale para foto de pessoa.
 *
 * `person-page.ts:375` consulta com `licenseStatus: { in: ['official','licensed'] }`
 * — `in`, nao `notIn`. `third_party` passa na invariante 6 e mesmo assim a tela
 * descarta. Promover nesse estado gravaria centenas de linhas acesas e uma
 * galeria vazia.
 */
describe('person-photo exige status que a GALERIA aceita, nao so o que a invariante 6 permite', () => {
  it('third_party NAO autoriza foto de pessoa (a galeria descartaria)', () => {
    const auth = authorizeMediaPromotion('person-photo', [
      licencaImagem({ licenseStatus: 'third_party' }),
    ])
    expect(auth.authorized).toBe(false)
    expect(auth.reason).toContain('person-page')
  })

  it('CONTRASTE: o MESMO third_party autoriza VIDEO (gate notIn, mais largo)', () => {
    // Sem este contraste, o teste acima poderia estar passando por um bug
    // generico que recusa `third_party` em todo lugar.
    const auth = authorizeMediaPromotion('video', [licencaVideo({ licenseStatus: 'third_party' })])
    expect(auth.authorized).toBe(true)
    expect(auth.licenseStatus).toBe('third_party')
  })

  it('licensed autoriza foto de pessoa', () => {
    const auth = authorizeMediaPromotion('person-photo', [
      licencaImagem({ licenseStatus: 'licensed' }),
    ])
    expect(auth.authorized).toBe(true)
  })
})

describe('o status gravado e DERIVADO da licenca, nunca um literal otimista', () => {
  it.each([
    ['official', 'official'],
    ['licensed', 'licensed'],
    ['third_party', 'third_party'],
  ])('licenca "%s" manda gravar "%s"', (licenca, esperado) => {
    const auth = authorizeMediaPromotion('video', [licencaVideo({ licenseStatus: licenca })])
    expect(auth.licenseStatus).toBe(esperado)
  })
})
