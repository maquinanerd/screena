/**
 * person-photos-presenter.test.ts — A tira e a galeria de fotos de pessoa.
 *
 * O que precisa reprovar AQUI, e nao numa captura de tela:
 *
 *  - o gate da FONTE (`source_licenses` tmdb/image) apagando a superficie
 *    inteira, e nao so o poster da ficha;
 *  - a tira sendo o PREFIXO exato da galeria — porque o `+N` promete
 *    "as outras", e nao "outras quaisquer";
 *  - o piso derivado da tira, e nao escrito a mao;
 *  - o motivo de ausencia derivando do ESTADO do catalogo, e nao fixo.
 */

import { describe, expect, it } from 'vitest'

import {
  authorizeImageDisplay,
  IMAGE_DISPLAY_DENIED,
  type ImageLicenseRow,
} from '@screena/public-contracts'
import {
  buildPersonPhotosGallery,
  PERSON_PHOTOS_INDEX_FLOOR,
  PERSON_PHOTOS_STRIP_LIMIT,
  type PersonPhotoRow,
} from '../../apps/web/src/lib/gallery-presenter'
import { personPhotoAbsenceReasonFor } from '../../apps/web/src/server/entity-gallery'
import { personPhotosPath } from '../../apps/web/src/lib/routes'
import { buildSectionAbsence } from '../../apps/web/src/lib/section-absence'

const LICENCA_OK: ImageLicenseRow = {
  sourceKey: 'tmdb',
  contentType: 'image',
  licenseStatus: 'official',
  displayAllowed: true,
  isCurrent: true,
}
const AUTORIZADA = authorizeImageDisplay([LICENCA_OK])

function foto(over: Partial<PersonPhotoRow> = {}): PersonPhotoRow {
  return {
    filePath: '/a.jpg',
    languageCode: null,
    width: 1000,
    height: 1500,
    voteAverage: 5,
    ...over,
  }
}

/** N fotos distintas, votos DECRESCENTES (a primeira e a melhor). */
function fotos(n: number): PersonPhotoRow[] {
  return Array.from({ length: n }, (_, i) =>
    foto({ filePath: `/f${String(i)}.jpg`, voteAverage: n - i }),
  )
}

describe('gate de licenca da FONTE', () => {
  it('licenca negada apaga a galeria INTEIRA, nao so uma foto', () => {
    const galeria = buildPersonPhotosGallery(fotos(10), 'Pedro Pascal', IMAGE_DISPLAY_DENIED)

    expect(galeria.photos).toEqual([])
    expect(galeria.strip).toEqual([])
    expect(galeria.total).toBe(0)
    // O `+N` nao pode sobreviver a uma galeria vazia: ele prometeria fotos que
    // o gate acabou de recusar.
    expect(galeria.stripRest).toBe(0)
    expect(galeria.indexable).toBe(false)
  })

  it('licenca vigente acende, e a URL sai do host governado', () => {
    const galeria = buildPersonPhotosGallery([foto()], 'Pedro Pascal', AUTORIZADA)

    expect(galeria.total).toBe(1)
    expect(galeria.photos[0]?.thumbUrl).toContain('/a.jpg')
    expect(galeria.photos[0]?.fullUrl).toContain('/a.jpg')
  })

  it('CONTROLE NEGATIVO: linha com file_path invalido nao vira quadro vazio', () => {
    const galeria = buildPersonPhotosGallery(
      [foto({ filePath: '' }), foto({ filePath: '/ok.jpg' })],
      'Pedro Pascal',
      AUTORIZADA,
    )

    expect(galeria.total).toBe(1)
    expect(galeria.photos[0]?.thumbUrl).toContain('/ok.jpg')
  })
})

describe('a tira e o PREFIXO da galeria', () => {
  it('mostra no maximo o limite, e stripRest conta o resto', () => {
    const galeria = buildPersonPhotosGallery(fotos(9), 'Pedro Pascal', AUTORIZADA)

    expect(galeria.strip).toHaveLength(PERSON_PHOTOS_STRIP_LIMIT)
    expect(galeria.total).toBe(9)
    expect(galeria.stripRest).toBe(9 - PERSON_PHOTOS_STRIP_LIMIT)
  })

  it('a tira e EXATAMENTE o inicio da galeria — nunca outras fotos', () => {
    const galeria = buildPersonPhotosGallery(fotos(9), 'Pedro Pascal', AUTORIZADA)

    // Este e o defeito que a consulta antiga produzia: o banco ordenava so por
    // voto e o presenter ordena por idioma primeiro, entao as "4 primeiras" da
    // ficha nao eram as 4 primeiras da galeria.
    expect(galeria.strip).toEqual(galeria.photos.slice(0, PERSON_PHOTOS_STRIP_LIMIT))
  })

  it('com menos que o limite, a tira e a galeria inteira e nao ha resto', () => {
    const galeria = buildPersonPhotosGallery(fotos(2), 'Pedro Pascal', AUTORIZADA)

    expect(galeria.strip).toHaveLength(2)
    expect(galeria.stripRest).toBe(0)
  })

  it('stripRest sai da lista EXIBIVEL, nao da contagem crua de linhas', () => {
    // 6 linhas, 2 recusadas pelo path: o `+N` tem de dizer 0, nao 2.
    const linhas = [...fotos(4), foto({ filePath: '' }), foto({ filePath: '' })]
    const galeria = buildPersonPhotosGallery(linhas, 'Pedro Pascal', AUTORIZADA)

    expect(galeria.total).toBe(4)
    expect(galeria.stripRest).toBe(0)
  })
})

describe('ordenacao', () => {
  it('pt-BR primeiro, depois sem texto, depois o resto', () => {
    const galeria = buildPersonPhotosGallery(
      [
        foto({ filePath: '/en.jpg', languageCode: 'en', voteAverage: 9 }),
        foto({ filePath: '/nulo.jpg', languageCode: null, voteAverage: 1 }),
        foto({ filePath: '/pt.jpg', languageCode: 'pt', voteAverage: 0 }),
      ],
      'Pedro Pascal',
      AUTORIZADA,
    )

    // O voto NAO inverte a ordem de idioma: ele so desempata dentro dele.
    expect(galeria.photos.map((p) => p.fullUrl.split('/').pop())).toEqual([
      'pt.jpg',
      'nulo.jpg',
      'en.jpg',
    ])
  })

  it('empate total resolve por file_path — ordem estavel entre renders', () => {
    const entrada = [
      foto({ filePath: '/b.jpg', voteAverage: 7 }),
      foto({ filePath: '/a.jpg', voteAverage: 7 }),
    ]
    const uma = buildPersonPhotosGallery(entrada, 'X', AUTORIZADA)
    const outra = buildPersonPhotosGallery([...entrada].reverse(), 'X', AUTORIZADA)

    expect(uma.photos.map((p) => p.fullUrl)).toEqual(outra.photos.map((p) => p.fullUrl))
  })
})

describe('piso de indexacao', () => {
  it('e DERIVADO da tira: a galeria so indexa quando a tira nao a exibe inteira', () => {
    expect(PERSON_PHOTOS_INDEX_FLOOR).toBe(PERSON_PHOTOS_STRIP_LIMIT + 1)
  })

  it('exatamente o tamanho da tira NAO indexa — a pagina nao acrescenta nada', () => {
    const galeria = buildPersonPhotosGallery(
      fotos(PERSON_PHOTOS_STRIP_LIMIT),
      'Pedro Pascal',
      AUTORIZADA,
    )

    expect(galeria.stripRest).toBe(0)
    expect(galeria.indexable).toBe(false)
  })

  it('uma foto acima do piso indexa', () => {
    const galeria = buildPersonPhotosGallery(
      fotos(PERSON_PHOTOS_INDEX_FLOOR),
      'Pedro Pascal',
      AUTORIZADA,
    )

    expect(galeria.indexable).toBe(true)
  })
})

describe('facetas de idioma', () => {
  it('um idioma so nao vira filtro', () => {
    const galeria = buildPersonPhotosGallery(fotos(3), 'Pedro Pascal', AUTORIZADA)
    expect(galeria.languageFacets).toEqual([])
  })

  it('dois idiomas viram filtro com contagem real', () => {
    const galeria = buildPersonPhotosGallery(
      [foto({ filePath: '/pt.jpg', languageCode: 'pt' }), foto({ filePath: '/x.jpg' })],
      'Pedro Pascal',
      AUTORIZADA,
    )

    expect(galeria.languageFacets).toHaveLength(2)
    expect(galeria.languageFacets.reduce((soma, f) => soma + f.count, 0)).toBe(2)
  })
})

describe('alt', () => {
  it('descreve o PAPEL e cita a pessoa, nunca a arte', () => {
    const galeria = buildPersonPhotosGallery([foto()], 'Pedro Pascal', AUTORIZADA)
    expect(galeria.photos[0]?.alt).toBe('Foto de Pedro Pascal')
  })
})

describe('motivo da ausencia', () => {
  it('catalogo SEM nenhuma foto promovida e passo de operacao (actionable)', () => {
    const motivo = personPhotoAbsenceReasonFor(false)
    expect(motivo).toBe('no_licensed_person_photo')

    const evento = buildSectionAbsence({
      section: 'fotos',
      reason: motivo,
      entityType: 'person',
      entityId: '1',
    })
    expect(evento.actionable).toBe(true)
  })

  it('catalogo COM foto e esta pessoa sem: fato sobre a pessoa (nao actionable)', () => {
    const motivo = personPhotoAbsenceReasonFor(true)
    expect(motivo).toBe('no_photo_for_person')

    const evento = buildSectionAbsence({
      section: 'fotos',
      reason: motivo,
      entityType: 'person',
      entityId: '1',
    })
    // Sem esta distincao, todo figurante sem retrato emitiria `actionable:true`
    // e afogaria o unico evento que importa.
    expect(evento.actionable).toBe(false)
  })
})

describe('rota da galeria', () => {
  it('monta o caminho canonico com barra final', () => {
    expect(personPhotosPath('pedro-pascal')).toBe('/pt/pessoas/pedro-pascal/fotos/')
  })

  it('recusa slug que quebraria o path', () => {
    expect(personPhotosPath('')).toBeNull()
    expect(personPhotosPath('a/b')).toBeNull()
    expect(personPhotosPath('..')).toBeNull()
    expect(personPhotosPath('a?b')).toBeNull()
  })
})
