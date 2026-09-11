/**
 * brand-asset-format.test.ts — O ARQUIVO tem de ser o que o registro AFIRMA.
 *
 * ============================================================================
 * OS DOIS DEFEITOS QUE ESTE ARQUIVO FECHA
 * ============================================================================
 *
 * 1. RASTER DECLARADO COMO VETOR. Três arquivos de marca baixados em
 *    21/08/2026 tinham extensão `.svg` e cabeçalho `RIFF....WEBPVP8L`: eram
 *    WEBP raster renomeados. Um `<img>` os renderiza assim mesmo, então nada
 *    quebra — o defeito é SILENCIOSO, e o registro passa a afirmar "vetor"
 *    sobre um raster que pixeliza a 2x. É a família do `COLOR_TOKENS`: campo
 *    que mente porque nada o confere. Aqui alguém confere: o teste lê o
 *    CABEÇALHO dos bytes e compara com o `format` declarado.
 *
 * 2. ÍCONE DE ESTADO OCUPANDO O SLOT DE LOGOTIPO. O arquivo baixado como
 *    "rottentomatoes.svg" era o ícone do **tomate fresco** — o indicador de
 *    estado *Fresh* do Tomatometer, não a palavra-marca.
 *
 *    Isso viola a invariante 1. O tomate fresco não é marca neutra: ele AFIRMA
 *    que o título é Fresh. Ao lado de um Tomatometer de 40%, diz ao leitor o
 *    contrário do número que está do lado — a mesma família de "nota IMDb virar
 *    tomates", com a marca carregando um juízo que o dado não sustenta.
 *
 *    Fresh, Rotten, Certified Fresh e Popcornmeter são indicadores de
 *    RESULTADO. Se um dia forem exibidos, é derivado do valor real da nota,
 *    nunca fixo, nunca como logotipo.
 *
 * ============================================================================
 * O QUE ESTE TESTE NÃO FAZ
 * ============================================================================
 * Não confere se o arquivo é a marca CERTA (que o `imdb.webp` é mesmo o IMDb).
 * Isso é leitura humana. Ele fecha o caso caro — o registro afirmar uma coisa
 * e os bytes serem outra — e o proibido — indicador de resultado como marca.
 */

import { existsSync, openSync, readSync, closeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  PROVIDER_LOGO_FILES,
  RATING_STATE_ICONS,
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  streamingProviderEntries,
  type LicenseLogoAsset,
} from '@screena/legal'

import { WATCH_PROVIDER_REGISTRY } from '../../services/streaming/src/provider-registry'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const publicDir = path.join(repoRoot, 'apps', 'web', 'public')

/** Todos os assets de marca declarados, de qualquer origem. */
function todosOsAssets(): readonly { origem: string; asset: LicenseLogoAsset }[] {
  const out: { origem: string; asset: LicenseLogoAsset }[] = []
  for (const entrada of STATIC_AUTHORIZATION) {
    if (entrada.license.logoAsset !== null) {
      out.push({ origem: entrada.label, asset: entrada.license.logoAsset })
    }
  }
  for (const credito of STREAMING_ORIGIN_CREDITS) {
    if (credito.logoAsset !== null) {
      out.push({ origem: credito.attributionText, asset: credito.logoAsset })
    }
  }
  // Os provedores de streaming: a licenca nasce por provedor REGISTRADO, e o
  // registro real (`WATCH_PROVIDER_REGISTRY`) e a lista que vale aqui.
  for (const entrada of streamingProviderEntries(
    WATCH_PROVIDER_REGISTRY.map((p) => ({ slug: p.slug, canonicalName: p.canonicalName })),
  )) {
    if (entrada.license.logoAsset !== null) {
      out.push({ origem: entrada.label, asset: entrada.license.logoAsset })
    }
  }
  return out
}

/**
 * Todo ARQUIVO de marca declarado — logotipos e icones de estado — com o que o
 * registro afirma sobre os bytes. Os icones de estado ficam FORA de
 * `todosOsAssets` de proposito: la eles seriam exatamente o defeito do teste (2).
 */
function todosOsArquivos(): readonly {
  origem: string
  path: string
  format: string
  status: string
  intrinsicSize: { readonly width: number; readonly height: number } | null
}[] {
  return [
    ...todosOsAssets().map(({ origem, asset }) => ({
      origem,
      path: asset.path,
      format: asset.format,
      status: asset.status,
      intrinsicSize: asset.intrinsicSize,
    })),
    ...RATING_STATE_ICONS.map((icon) => ({
      origem: `icone de estado ${icon.ratingSource}/${icon.state}`,
      path: icon.path,
      format: icon.format,
      status: icon.status,
      intrinsicSize: icon.intrinsicSize,
    })),
  ]
}

/**
 * As dimensoes REAIS do arquivo, lidas do cabecalho. `null` = cabecalho que este
 * leitor nao conhece (achado, nao default).
 *   PNG   IHDR: largura/altura big-endian nos bytes 16..23
 *   WEBP  VP8L (sem perda): 14 bits de largura-1 e 14 de altura-1 a partir do byte 21
 *         VP8X (estendido): 24 bits de largura-1 no byte 24 e de altura-1 no 27
 *         VP8  (com perda): largura/altura (14 bits) nos bytes 26 e 28
 *   SVG   o `viewBox` (vetor nao tem pixel: a proporcao e o que conta)
 */
function dimensoesReais(arquivo: string): { width: number; height: number } | null {
  const fd = openSync(arquivo, 'r')
  try {
    const buf = Buffer.alloc(512)
    const lidos = readSync(fd, buf, 0, 512, 0)
    const head = buf.subarray(0, lidos)
    if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') {
      return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
    }
    if (
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
      const chunk = head.subarray(12, 16).toString('latin1')
      if (chunk === 'VP8L') {
        const bits = head.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      }
      if (chunk === 'VP8X') {
        return { width: head.readUIntLE(24, 3) + 1, height: head.readUIntLE(27, 3) + 1 }
      }
      if (chunk === 'VP8 ') {
        return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff }
      }
      return null
    }
    const viewBox = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(
      head.toString('utf8'),
    )
    if (viewBox !== null) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
    return null
  } finally {
    closeSync(fd)
  }
}

/**
 * O formato REAL dos bytes, lido do cabeçalho.
 *
 * Assinaturas, na ordem em que são testadas:
 *   PNG   `89 50 4E 47`
 *   WEBP  `52 49 46 46` (RIFF) … `57 45 42 50` (WEBP) nos bytes 8..11
 *   SVG   texto, começa (após espaço em branco/BOM) com `<svg` ou `<?xml`
 *
 * `null` = não reconhecido. Não chutamos: um formato desconhecido é achado, não
 * default.
 */
function formatoReal(arquivo: string): 'svg' | 'webp' | 'png' | null {
  const fd = openSync(arquivo, 'r')
  try {
    const buf = Buffer.alloc(64)
    const lidos = readSync(fd, buf, 0, 64, 0)
    const head = buf.subarray(0, lidos)

    if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return 'png'
    }
    if (
      head.length >= 12 &&
      head.subarray(0, 4).toString('latin1') === 'RIFF' &&
      head.subarray(8, 12).toString('latin1') === 'WEBP'
    ) {
      return 'webp'
    }
    const texto = head.toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase()
    if (texto.startsWith('<svg') || texto.startsWith('<?xml')) return 'svg'
    return null
  } finally {
    closeSync(fd)
  }
}

describe('assets de marca: o arquivo e o que o registro afirma', () => {
  it('(1) CONTROLE POSITIVO: ha assets declarados (a varredura nao e vacua)', () => {
    // Sem isto, um `STATIC_AUTHORIZATION` vazio faria todo o resto passar.
    const assets = todosOsAssets()
    expect(assets.length).toBeGreaterThan(3)
    expect(assets.some((a) => a.asset.path.includes('tmdb'))).toBe(true)
  })

  it('(2) ICONE DE ESTADO nunca ocupa o slot de logotipo', () => {
    // O caso que a decisao de 21/08/2026 fechou. Fresh/Rotten/Certified
    // Fresh/Popcornmeter afirmam um resultado; logotipo nao afirma nada.
    const estados = todosOsAssets().filter((a) => a.asset.kind === 'state_icon')
    expect(
      estados.map((a) => `${a.origem} -> ${a.asset.path}`),
      'Indicador de RESULTADO no slot de logotipo. O tomate fresco ao lado de um ' +
        'Tomatometer de 40% diz ao leitor o contrario do numero. Se um dia for ' +
        'exibido, e DERIVADO do valor real da nota, nunca fixo, nunca como marca.',
    ).toEqual([])
  })

  it('(3) o `format` declarado bate com o CABECALHO do arquivo, quando ele existe', () => {
    // Asset ainda `pending_official_file` normalmente NAO tem arquivo — e isso
    // e legitimo. Quando o arquivo EXISTE, os bytes mandam.
    const divergentes: string[] = []
    for (const item of todosOsArquivos()) {
      const arquivo = path.join(publicDir, item.path.replace(/^\//, ''))
      if (!existsSync(arquivo)) continue
      const real = formatoReal(arquivo)
      if (real !== item.format) {
        divergentes.push(
          `${item.origem}: ${item.path} declara "${item.format}" e os bytes dizem "${String(real)}"`,
        )
      }
    }
    expect(
      divergentes,
      'Arquivo de marca cujo cabecalho NAO bate com o `format` declarado. ' +
        'Extensao e palpite do sistema de arquivos; os bytes sao o fato. Um WEBP ' +
        'renomeado para .svg renderiza igual e pixeliza a 2x — o defeito e ' +
        'SILENCIOSO, e e a familia do COLOR_TOKENS.',
    ).toEqual([])
  })

  it('(4) a EXTENSAO do caminho concorda com o `format` declarado', () => {
    // Antes de o arquivo existir, a extensao e o unico sinal — e um
    // `imdb.svg` com `format: "webp"` ja seria contraditorio no registro.
    const errados: string[] = []
    for (const item of todosOsArquivos()) {
      const ext = path.extname(item.path).replace('.', '').toLowerCase()
      if (ext !== item.format) {
        errados.push(`${item.origem}: ${item.path} declara "${item.format}"`)
      }
    }
    expect(errados).toEqual([])
  })

  it('(5) asset `present` TEM de ter arquivo no repositorio', () => {
    // `present` significa "o arquivo oficial esta aqui e pode ir ao ar". Se ele
    // nao estiver, o render pediria uma imagem que 404 — e a ausencia deixaria
    // de ser registrada, que e o oposto do desenho.
    const faltando: string[] = []
    for (const item of todosOsArquivos()) {
      if (item.status !== 'present') continue
      if (!existsSync(path.join(publicDir, item.path.replace(/^\//, '')))) {
        faltando.push(`${item.origem}: ${item.path}`)
      }
    }
    expect(faltando).toEqual([])
  })

  it('(6) o IMDb carrega a declaracao de marca registrada como CONDICAO', () => {
    // Condicao da FONTE, nao cortesia: o IMDb exige a declaracao em QUALQUER
    // material que exiba a marca. Condicao nao satisfeita = logo nao acende.
    const imdb = todosOsAssets().find((a) => a.asset.path.includes('imdb'))
    expect(imdb, 'nao ha asset declarado para o IMDb').toBeDefined()
    expect(imdb?.asset.displayConditions.join(' ')).toContain('trademarks of IMDb.com')
  })

  it('(7) as dimensoes DECLARADAS batem com as do arquivo (senao o width do <img> mente)', () => {
    // `intrinsicSize` vira o atributo `width` na tela. Declarado errado, o
    // navegador reserva o espaco errado e o logo salta ao chegar (CLS).
    const divergentes: string[] = []
    let conferidos = 0
    for (const item of todosOsArquivos()) {
      if (item.intrinsicSize === null) continue
      const arquivo = path.join(publicDir, item.path.replace(/^\//, ''))
      if (!existsSync(arquivo)) continue
      const real = dimensoesReais(arquivo)
      conferidos += 1
      if (
        real === null ||
        real.width !== item.intrinsicSize.width ||
        real.height !== item.intrinsicSize.height
      ) {
        divergentes.push(
          `${item.origem}: declara ${item.intrinsicSize.width}x${item.intrinsicSize.height}, ` +
            `arquivo tem ${real === null ? '?' : `${real.width}x${real.height}`}`,
        )
      }
    }
    expect(conferidos, 'controle positivo: ha arquivos com dimensao declarada').toBeGreaterThan(30)
    expect(divergentes).toEqual([])
  })

  it('(8) TODO provedor registrado tem logo NO AR (ordem do proprietario, 2026-09-11)', () => {
    // "inclua OBRIGATORIAMENTE AS LOGOS dos servicos de stream". Provedor novo
    // no registro sem arquivo reprova AQUI — e nao em producao, com a
    // palavra-marca no lugar e ninguem percebendo.
    const semArquivo = WATCH_PROVIDER_REGISTRY.map((p) => p.slug).filter(
      (slug) => PROVIDER_LOGO_FILES[slug] === undefined,
    )
    expect(semArquivo).toEqual([])
    // E o inverso: arquivo declarado para slug fora do registro e lixo.
    const orfaos = Object.keys(PROVIDER_LOGO_FILES).filter(
      (slug) => !WATCH_PROVIDER_REGISTRY.some((p) => p.slug === slug),
    )
    expect(orfaos).toEqual([])
  })

  it('(9) o logo do provedor e o do PRIMEIRO alias TMDB do registro', () => {
    // O `provider_id` do arquivo tem de ser a identidade que o registro usa. Um
    // id trocado poria o logo de uma plataforma na oferta de outra.
    for (const entry of WATCH_PROVIDER_REGISTRY) {
      const primeiroTmdb = entry.aliases.find((a) => a.providerApi === 'tmdb')
      expect(primeiroTmdb, `${entry.slug} sem alias tmdb`).toBeDefined()
      expect(PROVIDER_LOGO_FILES[entry.slug]?.tmdbProviderId, entry.slug).toBe(
        Number(primeiroTmdb!.externalKey),
      )
    }
  })

  it('(10) icone de estado: faixas da mesma fonte e metrica nunca se sobrepoem', () => {
    // Duas faixas sobrepostas dariam dois icones para o mesmo numero — um deles
    // necessariamente errado.
    for (const a of RATING_STATE_ICONS) {
      expect(a.kind).toBe('state_icon')
      for (const b of RATING_STATE_ICONS) {
        if (a === b || a.ratingSource !== b.ratingSource || a.scoreType !== b.scoreType) continue
        const sobrepoe = a.band.min < b.band.maxExclusive && b.band.min < a.band.maxExclusive
        expect(sobrepoe, `${a.state} x ${b.state}`).toBe(false)
      }
    }
  })
})
