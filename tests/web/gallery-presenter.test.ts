/**
 * gallery-presenter.test.ts — As duas galerias, decididas sem banco.
 *
 * O piso de página fina, o gate de licença, a ordenação e a política de
 * "nada de terceiro antes do clique" são todos decisões PURAS — e é aqui que
 * elas têm de reprovar, não numa captura de tela.
 */

import { describe, expect, it } from 'vitest'

import {
  authorizeImageDisplay,
  IMAGE_DISPLAY_DENIED,
  type ImageLicenseRow,
} from '@screena/public-contracts'
import {
  buildImagesGallery,
  buildVideosGallery,
  IMAGES_INDEX_FLOOR,
  VIDEOS_INDEX_FLOOR,
  type GalleryImageRow,
  type GalleryVideoRow,
} from '../../apps/web/src/lib/gallery-presenter'

const LICENCA_OK: ImageLicenseRow = {
  sourceKey: 'tmdb',
  contentType: 'image',
  licenseStatus: 'official',
  displayAllowed: true,
  isCurrent: true,
}
const AUTORIZADA = authorizeImageDisplay([LICENCA_OK])

function imagem(over: Partial<GalleryImageRow> = {}): GalleryImageRow {
  return {
    imageType: 'poster',
    filePath: '/a.jpg',
    languageCode: 'en',
    width: 2000,
    height: 3000,
    voteAverage: 5,
    ...over,
  }
}

function video(over: Partial<GalleryVideoRow> = {}): GalleryVideoRow {
  return {
    site: 'YouTube',
    // 11 caracteres exatos: o padrao que `youtube-embed.ts` exige.
    videoKey: 'aaaaaaaaaaa',
    name: 'Trailer oficial',
    videoType: 'Trailer',
    official: true,
    languageCode: 'pt',
    size: 134,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  }
}

describe('galeria de imagens', () => {
  it('(1) CONTROLE NEGATIVO: licenca negada => galeria VAZIA, contagem zero', () => {
    // O gate esta no MESMO lugar em que a URL nasce. Se a galeria devolvesse
    // as linhas sem URL, a contagem mentiria "12 imagens" numa grade vazia.
    const galeria = buildImagesGallery(
      [imagem(), imagem({ filePath: '/b.jpg' }), imagem({ filePath: '/c.jpg' })],
      'Gladiador',
      IMAGE_DISPLAY_DENIED,
    )
    expect(galeria.images).toEqual([])
    expect(galeria.total).toBe(0)
    expect(galeria.indexable).toBe(false)
  })

  it('(2) CONTROLE POSITIVO: com licenca, monta miniatura e tamanho grande', () => {
    const galeria = buildImagesGallery([imagem()], 'Gladiador', AUTORIZADA)
    expect(galeria.total).toBe(1)
    expect(galeria.images[0]?.thumbUrl).toBe('https://image.tmdb.org/t/p/w300/a.jpg')
    expect(galeria.images[0]?.fullUrl).toBe('https://image.tmdb.org/t/p/original/a.jpg')
  })

  it('(3) o piso de indexacao e 4: com 3 nao indexa, com 4 indexa', () => {
    const caminhos = ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg']
    const tres = buildImagesGallery(
      caminhos.slice(0, 3).map((filePath) => imagem({ filePath })),
      'X',
      AUTORIZADA,
    )
    expect(tres.total).toBe(3)
    expect(tres.indexable).toBe(false)

    const quatro = buildImagesGallery(
      caminhos.map((filePath) => imagem({ filePath })),
      'X',
      AUTORIZADA,
    )
    expect(quatro.total).toBe(IMAGES_INDEX_FLOOR)
    expect(quatro.indexable).toBe(true)
  })

  it('(4) TODOS os idiomas entram; pt-BR so vem PRIMEIRO', () => {
    // A galeria mostra o conjunto. Filtrar por idioma aqui reproduziria, dentro
    // do produto, o estreitamento que o `language=pt-BR` do TMDB ja causa na
    // coleta — o defeito que `sync_media` evita chamando o endpoint proprio.
    const galeria = buildImagesGallery(
      [
        imagem({ filePath: '/en.jpg', languageCode: 'en' }),
        imagem({ filePath: '/nula.jpg', languageCode: null }),
        imagem({ filePath: '/pt.jpg', languageCode: 'pt' }),
      ],
      'X',
      AUTORIZADA,
    )
    expect(galeria.total).toBe(3)
    expect(galeria.images.map((i) => i.languageCode)).toEqual(['pt', null, 'en'])
    // "Sem texto" NAO e "desconhecido": e uma categoria real.
    expect(galeria.images[1]?.languageLabel).toBe('Sem texto')
  })

  it('(5) o alt descreve o PAPEL da arte, nunca a arte', () => {
    // Descrever a imagem exigiria olhar para ela, e nada aqui olha.
    const galeria = buildImagesGallery([imagem()], 'Gladiador', AUTORIZADA)
    expect(galeria.images[0]?.alt).toBe('Pôster de Gladiador')
  })

  it('(6) tipo de imagem fora do dominio de TITULO e descartado', () => {
    // `profile` e imagem de PESSOA. Deixa-la entrar poria o rosto de um ator na
    // galeria do filme, com o rotulo errado.
    const galeria = buildImagesGallery(
      [imagem({ imageType: 'profile' }), imagem({ filePath: '/ok.jpg' })],
      'X',
      AUTORIZADA,
    )
    expect(galeria.total).toBe(1)
    expect(galeria.images[0]?.kind).toBe('poster')
  })

  it('(7) filtro com UMA opcao nao vira faixa de filtro', () => {
    // Um filtro com uma opcao so sugere escolha onde nao ha.
    const um = buildImagesGallery([imagem()], 'X', AUTORIZADA)
    expect(um.kindFacets).toEqual([])

    const dois = buildImagesGallery(
      [imagem(), imagem({ filePath: '/b.jpg', imageType: 'backdrop' })],
      'X',
      AUTORIZADA,
    )
    expect(dois.kindFacets.map((f) => [f.value, f.count])).toEqual([
      ['poster', 1],
      ['backdrop', 1],
    ])
  })

  it('(8) a ordem e TOTAL: mesma entrada, mesma saida', () => {
    // Sem desempate final por `file_path`, duas artes com o mesmo tipo, idioma
    // e voto sairiam em ordem instavel entre renders.
    const linhas = [
      imagem({ filePath: '/b.jpg', voteAverage: 5 }),
      imagem({ filePath: '/a.jpg', voteAverage: 5 }),
    ]
    const uma = buildImagesGallery(linhas, 'X', AUTORIZADA)
    const outra = buildImagesGallery([...linhas].reverse(), 'X', AUTORIZADA)
    expect(uma.images.map((i) => i.fullUrl)).toEqual(outra.images.map((i) => i.fullUrl))
  })
})

describe('galeria de videos', () => {
  it('(1) o piso e 2: com 1 nao indexa, com 2 indexa', () => {
    const um = buildVideosGallery([video()], null, AUTORIZADA)
    expect(um.total).toBe(1)
    expect(um.indexable).toBe(false)

    const dois = buildVideosGallery(
      [video(), video({ videoKey: 'bbbbbbbbbbb' })],
      null,
      AUTORIZADA,
    )
    expect(dois.total).toBe(VIDEOS_INDEX_FLOOR)
    expect(dois.indexable).toBe(true)
  })

  it('(2) o player sai do helper GOVERNADO: nocookie e sem query', () => {
    const galeria = buildVideosGallery([video()], null, AUTORIZADA)
    const player = galeria.videos[0]?.player
    expect(player?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/aaaaaaaaaaa')
    // Nenhum parametro: e o que `youtube-embed.ts` garante e o que o teste dele
    // ja afirma. Repetido aqui porque a galeria e um consumidor NOVO.
    expect(player?.embedUrl).not.toContain('?')
  })

  it('(3) CONTROLE NEGATIVO: NENHUMA URL de terceiro fora do player', () => {
    // A regra do produto e "nada de terceiro carrega antes do clique". Uma
    // miniatura do YouTube na lista quebraria isso em toda visita — e foi
    // exatamente o que a primeira escrita deste presenter fazia.
    const galeria = buildVideosGallery([video()], '/backdrop.jpg', AUTORIZADA)
    const serializado = JSON.stringify(galeria)
    expect(serializado).not.toContain('ytimg')
    expect(serializado).not.toContain('i.ytimg.com')
    // O fundo do cartao e do TMDB, host que o produto ja declara.
    expect(galeria.videos[0]?.backdropUrl).toBe('https://image.tmdb.org/t/p/w780/backdrop.jpg')
  })

  it('(4) o fundo do cartao TAMBEM passa pelo gate de imagem', () => {
    const galeria = buildVideosGallery([video()], '/backdrop.jpg', IMAGE_DISPLAY_DENIED)
    expect(galeria.videos[0]?.backdropUrl).toBeNull()
    // O video continua listado: o gate e de IMAGEM, nao de video.
    expect(galeria.total).toBe(1)
  })

  it('(5) video de site nao suportado FICA na lista, sem player', () => {
    // Sumir com ele esconderia conteudo real e faria a contagem mentir;
    // desenhar um play que nao abre nada mentiria para o leitor.
    const galeria = buildVideosGallery([video({ site: 'Vimeo' })], null, AUTORIZADA)
    expect(galeria.total).toBe(1)
    expect(galeria.videos[0]?.player).toBeNull()
  })

  it('(6) id fora do padrao de 11 caracteres nao vira player', () => {
    const galeria = buildVideosGallery([video({ videoKey: 'curto' })], null, AUTORIZADA)
    expect(galeria.videos[0]?.player).toBeNull()
  })

  it('(7) `size` do TMDB e RESOLUCAO, e NUNCA vira duracao', () => {
    // O DEFEITO QUE ESTE CASO FECHA: a primeira escrita formatava `size` como
    // `MM:SS`, e um video em 1080p saia na tela como "18:00". `size` em
    // `/videos` do TMDB e a ALTURA (360, 480, 720, 1080, 2160) — o comentario
    // do bloco de midia do detalhe ja dizia "a API do TMDB nao entrega
    // duracao", e mesmo assim passou: o nome do campo nao sugere resolucao, e
    // a fixture do harness semeou 134/151/62, numeros que passam por segundos.
    const mil = buildVideosGallery([video({ size: 1080 })], null, AUTORIZADA)
    expect(mil.videos[0]?.resolutionLabel).toBe('1080p')

    // CONTROLE NEGATIVO: nenhum rotulo pode ter a FORMA de duracao.
    for (const size of [360, 480, 720, 1080, 2160]) {
      const rotulo = buildVideosGallery([video({ size })], null, AUTORIZADA).videos[0]
        ?.resolutionLabel
      expect(rotulo).not.toMatch(/^\d{2}:\d{2}$/)
    }

    // Ausente ou implausivel omite, nunca inventa.
    expect(buildVideosGallery([video({ size: null })], null, AUTORIZADA).videos[0]?.resolutionLabel).toBeNull()
    expect(buildVideosGallery([video({ size: 0 })], null, AUTORIZADA).videos[0]?.resolutionLabel).toBeNull()
    expect(buildVideosGallery([video({ size: 3 })], null, AUTORIZADA).videos[0]?.resolutionLabel).toBeNull()
  })

  it('(8) tipo desconhecido do TMDB aparece com o proprio nome', () => {
    // Nem "Outro" (que esconderia um tipo novo do fornecedor) nem sumico.
    const galeria = buildVideosGallery(
      [video({ videoType: 'Interview' })],
      null,
      AUTORIZADA,
    )
    expect(galeria.videos[0]?.typeLabel).toBe('Interview')
  })

  it('(9) oficial vem antes; pt-BR antes do resto', () => {
    const galeria = buildVideosGallery(
      [
        video({ videoKey: 'ccccccccccc', official: false, languageCode: 'pt' }),
        video({ videoKey: 'ddddddddddd', official: true, languageCode: 'en' }),
      ],
      null,
      AUTORIZADA,
    )
    expect(galeria.videos.map((v) => v.videoKey)).toEqual(['ddddddddddd', 'ccccccccccc'])
  })
})
