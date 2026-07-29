/**
 * editorial-worker-boundary.test.ts — A fronteira do worker de projecao, PROVADA.
 *
 * A frase que este teste existe para tornar verdadeira:
 *
 *   "O worker acessa a API do Payload e o banco publico do Screen-App."
 *
 * E NAO:
 *
 *   "O worker acessa os dois bancos."
 *
 * A diferenca nao e de redacao. Se o worker abrisse conexao com o banco do
 * Payload, o isolamento do ADR 0015 teria acabado — a outbox deixaria de ser
 * uma fronteira e viraria uma tabela compartilhada, e qualquer mudanca de
 * schema interno do CMS quebraria o pipeline publico.
 *
 * O teste percorre o FECHO DE IMPORTS do worker (transitivo, dentro do repo) e
 * verifica o que aquele codigo pode alcancar. Nao e um grep num arquivo so:
 * bastaria um modulo intermediario para escapar de uma checagem assim.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const WORKER_ENTRY = 'services/news-ingestion/bin/project-editorial.ts'

/**
 * Pacotes que dao acesso ao banco EDITORIAL. Qualquer um deles no fecho do
 * worker significa que ele pode falar com o Postgres do CMS sem passar pela
 * API — exatamente o que a fronteira proibe.
 */
const FORBIDDEN_PACKAGES: readonly string[] = [
  'payload',
  '@payloadcms/db-postgres',
  '@payloadcms/next',
  '@payloadcms/richtext-lexical',
  'drizzle-orm',
  'drizzle-kit',
  '@screena/cms',
]

/** Unico modulo autorizado a MENCIONAR a variavel do banco do CMS. */
const CONFIG_MODULE = 'services/news-ingestion/src/projection-worker-config.ts'

/* ------------------------------------------------------------------ */
/* Detector (puro, para poder ter controle negativo)                   */
/* ------------------------------------------------------------------ */

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_PATTERN = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

/** Especificadores importados por um arquivo (estaticos, dinamicos e require). */
export function importedSpecifiers(source: string): string[] {
  const found: string[] = []
  for (const pattern of [IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null = pattern.exec(source)
    while (match !== null) {
      if (match[1] !== undefined) found.push(match[1])
      match = pattern.exec(source)
    }
  }
  return found
}

/**
 * Um especificador da acesso ao banco editorial?
 *
 * Compara pelo NOME DO PACOTE (ate o segundo segmento em escopos), nunca por
 * `includes`: um `startsWith('payload')` acusaria `payload-utils` e um
 * `includes('payload')` acusaria `./publication-payload.js`. Falso positivo em
 * guarda de governanca custa caro — o time desliga a guarda.
 */
export function isForbiddenPackage(specifier: string): boolean {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return false
  }
  const segments = specifier.split('/')
  const name = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  return FORBIDDEN_PACKAGES.includes(name ?? '')
}

function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(fromFile), specifier)
  // ESM no repo importa com `.js`; o arquivo real e `.ts`.
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    base,
    path.join(base, 'index.ts'),
  ]
  for (const candidate of candidates) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      /* tenta o proximo */
    }
  }
  return null
}

interface Closure {
  readonly files: string[]
  readonly packages: string[]
}

/** Fecho transitivo de imports LOCAIS a partir de um arquivo do repo. */
function closureOf(entryRelative: string): Closure {
  const entry = path.join(repoRoot, entryRelative)
  const seen = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)

    let source = ''
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const specifier of importedSpecifiers(source)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveLocal(file, specifier)
        if (resolved !== null) queue.push(resolved)
        continue
      }
      packages.add(specifier)
      // Aliases internos do monorepo tambem sao codigo NOSSO: precisam entrar
      // no fecho, senao um import proibido escondido atras de `@screena/x`
      // passaria despercebido.
      if (specifier.startsWith('@screena/')) {
        const aliased = ALIAS_TARGETS[specifier]
        if (aliased !== undefined) queue.push(path.join(repoRoot, aliased))
      }
    }
  }

  return {
    files: [...seen].map((file) => path.relative(repoRoot, file).replace(/\\/g, '/')),
    packages: [...packages],
  }
}

/** Alvos dos aliases que o worker realmente usa. */
const ALIAS_TARGETS: Record<string, string> = {
  '@screena/config': 'packages/config/src/index.ts',
  '@screena/seo': 'packages/seo/src/index.ts',
  '@screena/db': 'packages/db/src/index.ts',
  '@screena/db/server': 'packages/db/src/server.ts',
  '@screena/editorial-contracts': 'packages/editorial-contracts/src/index.ts',
}

/* ------------------------------------------------------------------ */
/* O detector precisa funcionar — controles antes das asercoes reais   */
/* ------------------------------------------------------------------ */

describe('o detector de fronteira funciona', () => {
  it('CONTROLE NEGATIVO: acusa import proibido em codigo sintetico', () => {
    // Sem isto, um detector quebrado devolveria "nenhuma violacao" para sempre
    // e o teste inteiro seria decorativo.
    const fake = `
      import { getPayload } from 'payload'
      import { postgresAdapter } from '@payloadcms/db-postgres'
      import { drizzle } from 'drizzle-orm/node-postgres'
    `
    const forbidden = importedSpecifiers(fake).filter(isForbiddenPackage)
    expect(forbidden.sort()).toEqual(
      ['@payloadcms/db-postgres', 'drizzle-orm/node-postgres', 'payload'].sort(),
    )
  })

  it('CONTROLE POSITIVO: nao acusa import legitimo parecido', () => {
    const fake = `
      import { x } from './publication-payload.js'
      import { y } from 'payload-ish-utils'
      import { z } from '@screena/db/server'
      import process from 'node:process'
    `
    expect(importedSpecifiers(fake).filter(isForbiddenPackage)).toEqual([])
  })

  it('o fecho do worker nao esta vazio (a varredura realmente andou)', () => {
    const closure = closureOf(WORKER_ENTRY)
    // Um fecho vazio faria todas as asercoes abaixo passarem por vacuidade.
    expect(closure.files.length).toBeGreaterThan(3)
    expect(closure.files).toContain(CONFIG_MODULE)
    expect(closure.files).toContain(
      'services/news-ingestion/src/persistence/editorial-projection-store.ts',
    )
  })
})

/* ------------------------------------------------------------------ */
/* A fronteira                                                         */
/* ------------------------------------------------------------------ */

describe('fronteira do worker de projecao editorial', () => {
  const closure = closureOf(WORKER_ENTRY)

  it('NAO alcanca o Payload, o adapter Postgres do CMS nem Drizzle', () => {
    const violations = closure.packages.filter(isForbiddenPackage)
    expect(
      violations,
      `o worker importa ${violations.join(', ')} — isso lhe daria acesso ao banco do CMS`,
    ).toEqual([])
  })

  it('alcanca o banco PUBLICO e a API do Payload — e so isso', () => {
    // Controle positivo da tese: o worker precisa mesmo destas duas pontes.
    expect(closure.packages).toContain('@screena/db/server')
    const workerSource = readFileSync(path.join(repoRoot, WORKER_ENTRY), 'utf8')
    expect(workerSource).toContain('fetch(')
    expect(workerSource).toContain('payloadInternalServiceUrl')
  })

  it('so o modulo de configuracao MENCIONA PAYLOAD_DATABASE_URL', () => {
    const mentions = closure.files.filter((file) => {
      if (file === CONFIG_MODULE) return false
      try {
        return readFileSync(path.join(repoRoot, file), 'utf8').includes('PAYLOAD_DATABASE_URL')
      } catch {
        return false
      }
    })
    expect(mentions).toEqual([])
  })

  it('e a mencao e apenas COMPARACAO — a URL do CMS nunca entra na config', () => {
    const source = readFileSync(path.join(repoRoot, CONFIG_MODULE), 'utf8')
    // Ela e lida para recusar a subida quando os dois bancos coincidem, e
    // descartada em seguida. Se algum dia virar campo do objeto devolvido,
    // alguem conseguiria conecta-la.
    expect(source).toContain('payloadDatabaseUrl === screenDatabaseUrl')
    expect(source).not.toMatch(/payloadDatabaseUrl\s*,/)
    expect(source).not.toMatch(/payloadDatabaseUrl\s*:/)
  })

  it('o cliente Prisma do worker e criado SO com SCREEN_DATABASE_URL', () => {
    const source = readFileSync(path.join(repoRoot, WORKER_ENTRY), 'utf8')
    const clientCalls = source.match(/new PrismaClient\([^)]*\)/g) ?? []
    expect(clientCalls.length).toBeGreaterThan(0)
    for (const call of clientCalls) {
      expect(call).toContain('screenDatabaseUrl')
      expect(call).not.toContain('payload')
    }
  })
})
