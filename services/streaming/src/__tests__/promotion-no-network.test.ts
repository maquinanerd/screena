/**
 * promotion-no-network.test.ts — Nenhum comando de revisao/promocao toca a rede.
 *
 * A ferramenta e SO banco: le/atualiza `watch_availability`. Este teste le o
 * fonte dos dois bins e do adapter Prisma e prova que NENHUM chama RapidAPI, o
 * client de streaming (`createStreamingAvailabilityClient`), o endpoint
 * `/shows/{id}` (`getShow`) nem `fetch(`. Importar a CONSTANTE
 * `STREAMING_AVAILABILITY_PROVIDER_API` (texto) e permitido.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url)) // services/streaming/src/__tests__
const serviceRoot = path.resolve(here, '..', '..') // services/streaming

/**
 * Remove comentarios de bloco/linha para varrer SO codigo vivo — os cabecalhos
 * dos bins prometem, em prosa, "nunca chamar RapidAPI"; isso e documentacao, nao
 * chamada. Preserva `://` para nao mutilar URLs.
 */
function stripComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      for (let i = 0; i < line.length - 1; i += 1) {
        if (line[i] === '/' && line[i + 1] === '/') {
          if (i > 0 && line[i - 1] === ':') continue
          return line.slice(0, i)
        }
      }
      return line
    })
    .join('\n')
}

const FILES = [
  path.join(serviceRoot, 'bin', 'review-watch-availability.ts'),
  path.join(serviceRoot, 'bin', 'promote-watch-availability.ts'),
  path.join(serviceRoot, 'src', 'persistence', 'watch-review-store.ts'),
]

/** Identificadores que denunciam uma chamada externa/RapidAPI no caminho. */
const NETWORK_MARKERS: readonly RegExp[] = [
  /createStreamingAvailabilityClient/,
  /loadStreamingAvailabilityConfig/,
  /\.getShow\b/,
  /buildShowRequest/,
  /\bfetch\s*\(/,
  /RapidApi/i,
  /RAPIDAPI_STREAMING_AVAILABILITY_KEY/,
]

describe('promocao/revisao — zero rede', () => {
  it.each(FILES)('%s nao chama RapidAPI/rede nem o client de streaming', (file) => {
    const source = stripComments(readFileSync(file, 'utf8'))
    for (const marker of NETWORK_MARKERS) {
      expect(source, `${path.basename(file)} contem marcador de rede ${marker}`).not.toMatch(marker)
    }
  })

  it('os bins so importam a CONSTANTE do provider (nunca o client de rede)', () => {
    for (const file of FILES.filter((candidate) => candidate.includes(`${path.sep}bin${path.sep}`))) {
      const source = stripComments(readFileSync(file, 'utf8'))
      // A unica ligacao permitida ao pacote de client e a constante de texto.
      const clientImports = source.match(/from '@screena\/streaming-availability-client'/g) ?? []
      for (const line of source.split(/\r?\n/)) {
        if (line.includes("@screena/streaming-availability-client")) {
          expect(line).toContain('STREAMING_AVAILABILITY_PROVIDER_API')
        }
      }
      expect(clientImports.length).toBeLessThanOrEqual(1)
    }
  })
})
