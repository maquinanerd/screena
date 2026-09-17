/**
 * gallery-indexing-floor.test.ts — o PISO da galeria e o que ele NAO decide mais.
 *
 * ============================================================================
 * O QUE MUDOU EM 2026-09-11
 * ============================================================================
 * Ate essa data, este arquivo provava que "o piso chega ao `robots`": galeria
 * abaixo do piso de quantidade saia `noindex`, e no piso saia `index`.
 *
 * A decisao do dono D1 (`docs/seo/DECISOES-DO-DONO-2026-09-11.md`) tirou TODA
 * galeria do indice como pagina propria — 69.016 URLs, 42,7% do sitemap, com 0
 * palavras de conteudo principal. E a auditoria achou o defeito que o desenho
 * antigo permitia: a galeria de EPISODIO decidia so pelo piso, sem olhar o dono,
 * e saia `index, follow` com o episodio suspenso.
 *
 * O piso nao morreu: ele continua decidindo o AVISO da tela (`belowFloor`). O que
 * ele deixou de decidir e o indice. Manter as asserções antigas ("no piso =>
 * index") seria um teste verde afirmando uma politica que nao vale mais.
 *
 * ============================================================================
 * A ARMADILHA QUE ESTE ARQUIVO JA TINHA EVITADO, E CONTINUA EVITANDO
 * ============================================================================
 * Fora da origem oficial, `gatePublicRobots` colapsa TUDO para `noindex`. Uma
 * medicao que da o mesmo resultado nos dois lados nao separa nada: o `noindex`
 * poderia estar la pelo motivo errado. Por isso o gate de origem e alimentado com
 * um ambiente que PODE indexar — e a unica variavel que sobra e a regra.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { QUALITY_GATE_ROBOTS, evaluateGalleryGate } from '@screena/seo'
import { authorizeImageDisplay, type ImageLicenseRow } from '@screena/public-contracts'

import {
  IMAGES_INDEX_FLOOR,
  VIDEOS_INDEX_FLOOR,
  buildImagesGallery,
  buildVideosGallery,
  type GalleryImageRow,
  type GalleryVideoRow,
} from '../../apps/web/src/lib/gallery-presenter'
import { gatePublicRobots } from '../../apps/web/src/lib/site'
import { REPO_ROOT, readSourceWithoutComments } from '../support/source-text'

const LICENCA: ImageLicenseRow = {
  sourceKey: 'tmdb',
  contentType: 'image',
  licenseStatus: 'official',
  displayAllowed: true,
  isCurrent: true,
}
const AUTORIZADA = authorizeImageDisplay([LICENCA])

/**
 * Um ambiente que PODE indexar. Sem ele, `gatePublicRobots` devolve `noindex`
 * para tudo e os casos de D1 passariam mesmo com a galeria voltando a indexar.
 */
const AMBIENTE_INDEXAVEL: NodeJS.ProcessEnv = {
  CINERIE_PUBLIC_SITE_URL: 'https://cinerie.com',
  CINERIE_PUBLIC_INDEXING_ENABLED: '1',
  NODE_ENV: 'production',
}

function imagens(quantidade: number): GalleryImageRow[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    imageType: 'poster',
    filePath: `/p-${String(i)}.jpg`,
    languageCode: 'pt',
    width: 2000,
    height: 3000,
    voteAverage: 5,
  }))
}

function videos(quantidade: number): GalleryVideoRow[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    site: 'YouTube',
    videoKey: `qaVideo${String(i).padStart(4, '0')}`,
    name: `Video ${String(i)}`,
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt',
    size: 120,
    publishedAt: null,
  }))
}

describe('o piso da galeria decide o AVISO da tela', () => {
  it('(1) CONTROLE DE AMBIENTE: com origem oficial, o gate NAO colapsa tudo', () => {
    // A pagina que indexa sai com a previa grande de imagem (auditoria de SEO,
    // 2026-09-11) — e o sinal de que o gate deixou a decisao passar inteira.
    expect(gatePublicRobots({ index: true, follow: true }, AMBIENTE_INDEXAVEL)).toEqual({
      index: true,
      follow: true,
      'max-image-preview': 'large',
    })
    expect(gatePublicRobots({ index: true, follow: true }, { NODE_ENV: 'development' })).toEqual({
      index: false,
      follow: false,
    })
  })

  it('(2) IMAGENS: abaixo do piso a galeria e marcada fina; no piso, nao', () => {
    expect(buildImagesGallery(imagens(IMAGES_INDEX_FLOOR - 1), 'X', AUTORIZADA).indexable).toBe(false)
    expect(buildImagesGallery(imagens(IMAGES_INDEX_FLOOR), 'X', AUTORIZADA).indexable).toBe(true)
  })

  it('(3) VIDEOS: abaixo do piso a galeria e marcada fina; no piso, nao', () => {
    expect(buildVideosGallery(videos(VIDEOS_INDEX_FLOOR - 1), null, AUTORIZADA).indexable).toBe(false)
    expect(buildVideosGallery(videos(VIDEOS_INDEX_FLOOR), null, AUTORIZADA).indexable).toBe(true)
  })

  it('(4) galeria VAZIA e marcada fina', () => {
    const vazia = buildImagesGallery([], 'X', AUTORIZADA)
    expect(vazia.total).toBe(0)
    expect(vazia.indexable).toBe(false)
  })

  it('(5) licenca negada => galeria vazia, mesmo com muitas linhas', () => {
    const semLicenca = buildImagesGallery(imagens(40), 'X', authorizeImageDisplay([]))
    expect(semLicenca.total).toBe(0)
    expect(semLicenca.indexable).toBe(false)
  })
})

describe('D1 — galeria nunca indexa como pagina propria', () => {
  it('(6) mesmo MUITO acima do piso, e com a origem oficial aberta, a galeria sai noindex, follow', () => {
    const rica = buildImagesGallery(imagens(IMAGES_INDEX_FLOOR * 10), 'X', AUTORIZADA)
    expect(rica.indexable).toBe(true) // o piso diz "nao e fina"...
    // ...e mesmo assim o indice nao a recebe.
    expect(gatePublicRobots(QUALITY_GATE_ROBOTS, AMBIENTE_INDEXAVEL)).toEqual({
      index: false,
      follow: true,
    })
    expect(evaluateGalleryGate().passed).toBe(false)
  })

  it('(7) as QUATRO galerias emitem o portao D1 — e nenhuma passa o piso para o robots', () => {
    const paginas = readSourceWithoutComments(
      path.join(REPO_ROOT, 'apps', 'web', 'app', '_components', 'gallery-pages.tsx'),
    )
    const episodio = readSourceWithoutComments(
      path.join(
        REPO_ROOT,
        'apps',
        'web',
        'app',
        'pt',
        'series',
        '[slug]',
        'temporadas',
        '[season]',
        'episodios',
        '[episode]',
        'imagens',
        'page.tsx',
      ),
    )
    // Imagens, videos e fotos de pessoa em um arquivo; episodio no outro.
    expect(paginas.split('gatePublicRobots(QUALITY_GATE_ROBOTS)').length - 1).toBe(3)
    expect(episodio.split('gatePublicRobots(QUALITY_GATE_ROBOTS)').length - 1).toBe(1)
    // O defeito exato que a auditoria achou: o piso decidindo o indice.
    for (const fonte of [paginas, episodio]) {
      expect(fonte).not.toMatch(/index:\s*(data\.gallery|images)\.indexable/)
    }
  })
})
