/**
 * watch-consumers-wiring.test.ts — Os QUATRO leitores de `licensedWatchWhere`.
 *
 * A clausula de licenca e compartilhada de proposito: a regra critica vive num
 * lugar so. O efeito colateral e que abrir o portao abre para TODOS ao mesmo
 * tempo — e foi o que aconteceu quando a oferta passou a poder vir tambem do
 * TMDB/JustWatch: dois consumidores foram atualizados, dois nao.
 *
 * Este teste enumera os quatro e exige, de cada um, o que ele precisa para
 * lidar com DUAS origens. Um consumidor novo que use a clausula sem entrar na
 * lista e o defeito seguinte — por isso o teste tambem falha se o numero de
 * consumidores mudar sem alguem olhar.
 *
 * VARREDURA, nao lista escrita a mao: os consumidores sao descobertos do codigo.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SERVER_DIR = path.join(ROOT, 'apps/web/src/server')

/** Remove comentarios: um consumidor nao pode "cumprir a regra" num comentario. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readServer(file: string): string {
  return withoutComments(readFileSync(path.join(SERVER_DIR, file), 'utf8'))
}

/** Quem CHAMA `licensedWatchWhere(...)` (a definicao nao conta). */
function consumers(): string[] {
  const found: string[] = []
  for (const entry of readdirSync(SERVER_DIR)) {
    if (!entry.endsWith('.ts')) continue
    const code = readServer(entry)
    if (!/licensedWatchWhere\(/.test(code)) continue
    // `entity-watch.ts` define E consome; so conta como consumidor pelo uso.
    if (entry === 'entity-watch.ts' && !/where: \{ entityType, entityId, \.\.\.licensedWatchWhere/.test(code)) {
      continue
    }
    found.push(entry)
  }
  return found.sort()
}

describe('os quatro leitores da clausula de licenca de streaming', () => {
  const found = consumers()

  it('CONTROLE POSITIVO: a varredura encontra exatamente os quatro conhecidos', () => {
    expect(found).toEqual([
      'discover.ts',
      'entity-watch.ts',
      'home-ticker.ts',
      'watch-browse.ts',
    ])
  })

  /**
   * Todo consumidor tem de saber DE QUAL PLATAFORMA a oferta e — e a plataforma
   * e o `watch_providers.slug`, nunca `provider_key` (que e do FORNECEDOR:
   * "netflix" na RapidAPI, "8" no TMDB). Sem o slug, a mesma plataforma aparece
   * duas vezes.
   */
  it('todos leem o slug canonico da plataforma', () => {
    for (const file of found) {
      expect(readServer(file), `${file} nao seleciona watchProvider.slug`).toContain(
        'watchProvider: { select: { slug: true',
      )
    }
  })

  /**
   * Quem monta LINK precisa do destino que a origem TMDB tem (`web_url`); quem
   * so lista NOME nao. A distincao e por consumidor, entao esta escrita aqui em
   * vez de ser exigida de todos.
   */
  it('quem monta link le tambem o destino do agregador (web_url)', () => {
    for (const file of ['entity-watch.ts', 'home-ticker.ts']) {
      expect(readServer(file), `${file} nao seleciona webUrl`).toContain('webUrl: true')
    }
  })

  it('quem agrupa plataforma usa o modulo compartilhado de identidade', () => {
    for (const file of ['discover.ts', 'watch-browse.ts']) {
      expect(readServer(file), `${file} reimplementa a identidade`).toMatch(
        /from '\.\.\/lib\/watch-platform-identity'/,
      )
    }
  })

  /**
   * O NEGATIVO que importa: agrupar/deduplicar por `provider_key` e exatamente
   * o defeito. Nenhum consumidor pode usa-lo como chave de plataforma.
   */
  it('NEGATIVO: ninguem usa provider_key como identidade de plataforma', () => {
    for (const file of found) {
      const code = readServer(file)
      expect(code, `${file} agrupa por providerKey`).not.toMatch(
        /byProvider\.(get|set)\(providerKey/,
      )
      expect(code, `${file} deduplica por providerName`).not.toMatch(
        /new Set\([^)]*providerName/,
      )
    }
  })

  it('o gate continua sem filtrar por fornecedor tecnico (a autoridade e a licenca)', () => {
    const gate = readServer('entity-watch.ts')
    expect(gate).not.toContain('providerApi:')
    expect(gate).not.toContain('"streaming_availability"')
    expect(gate).toContain('dataUsageDecision')
    expect(gate).toContain('sourceLicense')
  })
})
