/**
 * gallery-indexing-floor.test.ts — O PISO chega ao `robots`, e não só ao view.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE, E O QUE ELE CORRIGE NA MINHA PRÓPRIA PROVA
 * ============================================================================
 * Abri as quatro páginas no navegador e li o `<meta name="robots">` das duas
 * galerias — a rica (44 imagens) e a pobre (3). **As DUAS diziam
 * `noindex, nofollow`.** Não porque o piso falhou: porque o ambiente de dev não
 * é a origem oficial, e `gatePublicRobots` colapsa TUDO para `noindex` fora
 * dela. Certo — e por isso a captura no dev **não prova o piso**.
 *
 * Uma medição que dá o mesmo resultado nos dois lados não separa nada. É a
 * mesma armadilha de "estado vazio não prova filtro": o `noindex` da página
 * pobre estava lá pelo motivo errado.
 *
 * Aqui o gate de origem é alimentado com um ambiente que PODE indexar, e então
 * a única variável que resta é o piso.
 */

import { describe, expect, it } from 'vitest'

import {
  IMAGES_INDEX_FLOOR,
  VIDEOS_INDEX_FLOOR,
  buildImagesGallery,
  buildVideosGallery,
  type GalleryImageRow,
  type GalleryVideoRow,
} from '../../apps/web/src/lib/gallery-presenter'
import { authorizeImageDisplay, type ImageLicenseRow } from '@screena/public-contracts'
import { gatePublicRobots } from '../../apps/web/src/lib/site'

const LICENCA: ImageLicenseRow = {
  sourceKey: 'tmdb',
  contentType: 'image',
  licenseStatus: 'official',
  displayAllowed: true,
  isCurrent: true,
}
const AUTORIZADA = authorizeImageDisplay([LICENCA])

/**
 * Um ambiente que PODE indexar.
 *
 * Sem ele, `gatePublicRobots` devolve `noindex` para tudo e o teste passaria
 * com o piso quebrado — exatamente o que aconteceu na captura do dev.
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

describe('o piso da galeria chega ao robots', () => {
  it('(1) CONTROLE DE AMBIENTE: com origem oficial, o gate NAO colapsa tudo', () => {
    // Sem este caso, todos os demais poderiam passar com `noindex` universal —
    // que foi o que a captura no dev mediu sem perceber.
    expect(gatePublicRobots({ index: true, follow: true }, AMBIENTE_INDEXAVEL)).toEqual({
      index: true,
      follow: true,
    })
    // E o inverso: fora da origem oficial, colapsa mesmo.
    expect(gatePublicRobots({ index: true, follow: true }, { NODE_ENV: 'development' })).toEqual({
      index: false,
      follow: false,
    })
  })

  it('(2) IMAGENS abaixo do piso => noindex; no piso => index', () => {
    const abaixo = buildImagesGallery(imagens(IMAGES_INDEX_FLOOR - 1), 'X', AUTORIZADA)
    expect(abaixo.indexable).toBe(false)
    expect(
      gatePublicRobots({ index: abaixo.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(false)

    const noPiso = buildImagesGallery(imagens(IMAGES_INDEX_FLOOR), 'X', AUTORIZADA)
    expect(noPiso.indexable).toBe(true)
    expect(
      gatePublicRobots({ index: noPiso.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(true)
  })

  it('(3) VIDEOS abaixo do piso => noindex; no piso => index', () => {
    const abaixo = buildVideosGallery(videos(VIDEOS_INDEX_FLOOR - 1), null, AUTORIZADA)
    expect(abaixo.indexable).toBe(false)
    expect(
      gatePublicRobots({ index: abaixo.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(false)

    const noPiso = buildVideosGallery(videos(VIDEOS_INDEX_FLOOR), null, AUTORIZADA)
    expect(noPiso.indexable).toBe(true)
    expect(
      gatePublicRobots({ index: noPiso.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(true)
  })

  it('(4) galeria VAZIA nunca indexa — nem com o gate de origem aberto', () => {
    // Zero imagens é o estado de produção HOJE (`tmdb_images` = 0 linhas). Se
    // esta página indexasse, cada título publicaria uma URL vazia.
    const vazia = buildImagesGallery([], 'X', AUTORIZADA)
    expect(vazia.total).toBe(0)
    expect(
      gatePublicRobots({ index: vazia.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(false)
  })

  it('(5) licenca negada => galeria vazia => noindex, mesmo com muitas linhas', () => {
    // Os dois gates compõem: sem licença não há imagem, sem imagem não há
    // página. Uma galeria que indexasse com licença negada publicaria uma URL
    // que existe para não mostrar nada.
    const semLicenca = buildImagesGallery(imagens(40), 'X', authorizeImageDisplay([]))
    expect(semLicenca.total).toBe(0)
    expect(
      gatePublicRobots({ index: semLicenca.indexable, follow: true }, AMBIENTE_INDEXAVEL).index,
    ).toBe(false)
  })
})
