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
  STATIC_AUTHORIZATION,
  STREAMING_ORIGIN_CREDITS,
  type LicenseLogoAsset,
} from '@screena/legal'

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
  return out
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
    for (const { origem, asset } of todosOsAssets()) {
      const arquivo = path.join(publicDir, asset.path.replace(/^\//, ''))
      if (!existsSync(arquivo)) continue
      const real = formatoReal(arquivo)
      if (real !== asset.format) {
        divergentes.push(
          `${origem}: ${asset.path} declara "${asset.format}" e os bytes dizem "${String(real)}"`,
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
    for (const { origem, asset } of todosOsAssets()) {
      const ext = path.extname(asset.path).replace('.', '').toLowerCase()
      if (ext !== asset.format) {
        errados.push(`${origem}: ${asset.path} declara "${asset.format}"`)
      }
    }
    expect(errados).toEqual([])
  })

  it('(5) asset `present` TEM de ter arquivo no repositorio', () => {
    // `present` significa "o arquivo oficial esta aqui e pode ir ao ar". Se ele
    // nao estiver, o render pediria uma imagem que 404 — e a ausencia deixaria
    // de ser registrada, que e o oposto do desenho.
    const faltando: string[] = []
    for (const { origem, asset } of todosOsAssets()) {
      if (asset.status !== 'present') continue
      if (!existsSync(path.join(publicDir, asset.path.replace(/^\//, '')))) {
        faltando.push(`${origem}: ${asset.path}`)
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
})
