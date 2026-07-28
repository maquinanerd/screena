import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const HOME_PAGE_REL = 'apps/web/app/pt/page.tsx'
const COMPONENTS_REL = 'apps/web/app/_components'
const PUBLIC_DEMO_SEED_REL = 'apps/admin/scripts/public-demo-seed.ts'

function readSource(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function withoutComments(source: string): string {
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

function componentFiles(): string[] {
  const absoluteDirectory = path.join(ROOT, COMPONENTS_REL)
  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => `${COMPONENTS_REL}/${entry.name}`)
}

const FAKE_STREAMING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bHOME_VISUAL_PLATFORMS\b/, 'HOME_VISUAL_PLATFORMS'],
  [/\bhomeVisualPlatform\b/, 'homeVisualPlatform'],
  [/\bhome-v4-series-platform\b/, 'home-v4-series-platform'],
  [/\b(?:NETFLIX|Netflix|Prime Video|Disney\+|Star\+|Apple TV\+|Max)\b/, 'platform literal'],
  [/Onde assistir/i, 'Onde assistir'],
]

const FAKE_RANKING_OR_ACTION_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bhome-v4-rank-badge\b/, 'home-v4-rank-badge'],
  [/\bhome-v4-compact-rank\b/, 'home-v4-compact-rank'],
  [/#\{rank\}/, '#{rank}'],
  [/#[1-9]\b/, 'literal de ranking (#1/#2/#3)'],
  [/Avaliar/i, 'Avaliar'],
  [/Marcar como assistido/i, 'Marcar como assistido'],
  [/\bhome-v4-muted-action\b/, 'home-v4-muted-action'],
  [/\bhome-v4-watch-action\b/, 'home-v4-watch-action'],
]

function findViolations(source: string, patterns: ReadonlyArray<[RegExp, string]>): string[] {
  return patterns.filter(([pattern]) => pattern.test(source)).map(([, label]) => label)
}

/**
 * Identificadores que provam contrato REAL de disponibilidade licenciada.
 *
 * Lista ATUALIZADA DELIBERADAMENTE: `WatchView` e `watch-presenter` nunca
 * existiram no repositorio (eram nomes planejados), entao o guard so podia ser
 * satisfeito pela string `watch_availability` — na pratica, era impossivel um
 * componente citar streaming AINDA QUE ligado ao contrato real. Os demais
 * tokens sao os identificadores de verdade hoje. Isto NAO relaxa a regra:
 * plataforma sem passar pelo gate de licenca continua proibida (ver o controle
 * negativo abaixo).
 */
function hasRealWatchContract(source: string): boolean {
  return /\bWatchView\b|watch-presenter|watch_availability|WatchAvailabilityView|watch-availability-presenter|\bTickerProvider\b/.test(
    source,
  )
}

describe('governança: UI pública não finge streaming, ranking ou nota', () => {
  it('home não inclui ticker de episódio nem gate capaz de reativar conteúdo mock', () => {
    const code = withoutComments(readSource(HOME_PAGE_REL))
    expect(code).not.toMatch(/EpisodesTicker/)
    expect(code).not.toMatch(/allowHomeVisualPlaceholders/)
  })

  it('home não contém streaming ou plataforma fake', () => {
    const code = withoutComments(readSource(HOME_PAGE_REL))
    expect(findViolations(code, FAKE_STREAMING_PATTERNS)).toEqual([])
  })

  it('home não contém pseudo-ranking nem affordance morta de usuário', () => {
    const code = withoutComments(readSource(HOME_PAGE_REL))
    expect(findViolations(code, FAKE_RANKING_OR_ACTION_PATTERNS)).toEqual([])
  })

  it('componentes compartilhados só citam streaming com contrato real de watch', () => {
    // Lista de tokens ATUALIZADA DELIBERADAMENTE. `WatchView` e
    // `watch-presenter` não existem em lugar nenhum do repositório (eram nomes
    // planejados que nunca nasceram), então o guard só podia ser satisfeito
    // pela string `watch_availability` — na prática, era impossível para um
    // componente citar streaming AINDA QUE ligado ao contrato real. Os tokens
    // abaixo são os identificadores REAIS do contrato licenciado hoje. Isto
    // não relaxa a regra: continua sendo proibido citar plataforma sem passar
    // pelo gate — só passou a ser verificável.
    const violations: string[] = []
    for (const file of componentFiles()) {
      const code = withoutComments(readSource(file))
      const matches = findViolations(code, FAKE_STREAMING_PATTERNS)
      if (matches.length > 0 && !hasRealWatchContract(code)) {
        violations.push(`${file}: ${matches.join(', ')}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('CONTROLE NEGATIVO: o guard ainda reprova quem cita streaming sem contrato', () => {
    // Sem este controle, afrouxar a lista de tokens passaria despercebido: o
    // teste acima ficaria verde por vacuidade. Aqui provamos os DOIS sentidos.
    const semContrato = `export function X() { return <a>Onde assistir Netflix</a> }`
    expect(findViolations(semContrato, FAKE_STREAMING_PATTERNS).length).toBeGreaterThan(0)
    expect(hasRealWatchContract(semContrato)).toBe(false)

    const comContrato = `import type { TickerProvider } from '../../src/server/home-ticker'
      export function X({ p }: { p: TickerProvider }) { return <a>Onde assistir {p.name}</a> }`
    expect(findViolations(comContrato, FAKE_STREAMING_PATTERNS).length).toBeGreaterThan(0)
    expect(hasRealWatchContract(comContrato)).toBe(true)

    // E o componente REAL da faixa precisa estar do lado permitido.
    const ticker = withoutComments(readSource(`${COMPONENTS_REL}/home-ticker.tsx`))
    expect(hasRealWatchContract(ticker)).toBe(true)
  })

  it('seed demo público não grava screen_score exibível', () => {
    const code = withoutComments(readSource(PUBLIC_DEMO_SEED_REL))
    expect(code).not.toMatch(/screenScore:\s*\w+\.screenScore/)
    expect(code).not.toMatch(/screenScoreDisplay:\s*true/)
  })
})
