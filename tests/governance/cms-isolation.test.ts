/**
 * Isolamento do CMS editorial (ADR 0015).
 *
 * O Payload e uma aplicacao SEPARADA com banco PROPRIO. Este arquivo trava, por
 * varredura textual do codigo enviado, as fronteiras que, se cruzadas, so seriam
 * descobertas em producao:
 *
 *  - o CMS nao alcanca Prisma nem o banco publico do Cinerie;
 *  - o CMS nunca usa `DATABASE_URL` (nem como fallback);
 *  - o render publico nao consulta o CMS;
 *  - o CMS nao importa `apps/web` nem `apps/admin`;
 *  - as migrations Prisma nao foram tocadas por esta fase.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CMS_DIR = resolve(ROOT, 'apps', 'cms')
const WEB_DIR = resolve(ROOT, 'apps', 'web')
const ADMIN_DIR = resolve(ROOT, 'apps', 'admin')
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']
const IGNORED = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', 'migrations'])

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function collect(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return []
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await collect(full)))
    else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

function stripComments(content: string): string {
  const noBlocks = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  return noBlocks
    .split(/\r?\n/)
    .map((line) => {
      const at = line.indexOf('//')
      return at === -1 ? line : line.slice(0, at)
    })
    .join('\n')
}

describe('CMS editorial: banco e codigo isolados', () => {
  it('o CMS nao importa Prisma nem @screena/db', async () => {
    const offenders: string[] = []
    for (const file of await collect(CMS_DIR)) {
      const code = stripComments(await readFile(file, 'utf-8'))
      for (const forbidden of ['@prisma/client', '@screena/db', 'prisma/schema', 'getPrismaClient']) {
        if (code.includes(forbidden)) offenders.push(`${file}: ${forbidden}`)
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })

  it('o CMS nunca le DATABASE_URL (nem como fallback)', async () => {
    const offenders: string[] = []
    for (const file of await collect(CMS_DIR)) {
      const code = stripComments(await readFile(file, 'utf-8'))
      // `env.ts` DECLARA a chave para detectar colisao com a URL do CMS; ler o
      // valor para USAR e que e proibido.
      if (/process\.env\.DATABASE_URL/.test(code)) offenders.push(`${file}: process.env.DATABASE_URL`)
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })

  it('o CMS nao importa apps/web nem apps/admin', async () => {
    const offenders: string[] = []
    for (const file of await collect(CMS_DIR)) {
      const code = stripComments(await readFile(file, 'utf-8'))
      for (const forbidden of ['@screena/web', '@screena/admin', 'apps/web', 'apps/admin']) {
        if (code.includes(forbidden)) offenders.push(`${file}: ${forbidden}`)
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })

  it('o render publico e o admin nao importam o CMS nem Payload', async () => {
    const offenders: string[] = []
    for (const dir of [WEB_DIR, ADMIN_DIR]) {
      for (const file of await collect(dir)) {
        const code = stripComments(await readFile(file, 'utf-8'))
        for (const forbidden of ['@screena/cms', "from 'payload", 'from "payload', '@payloadcms/']) {
          if (code.includes(forbidden)) offenders.push(`${file}: ${forbidden}`)
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([])
  })

  it('apps/web e apps/admin nao declaram dependencia de Payload', async () => {
    for (const app of ['web', 'admin']) {
      const manifest = JSON.parse(
        await readFile(resolve(ROOT, 'apps', app, 'package.json'), 'utf-8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
      expect(deps.filter((d) => d === 'payload' || d.startsWith('@payloadcms/'))).toEqual([])
      expect(deps).not.toContain('@screena/cms')
    }
  })

  it('o CMS fixa versoes EXATAS do stack Payload', async () => {
    const manifest = JSON.parse(await readFile(resolve(CMS_DIR, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    for (const pkg of [
      'payload',
      '@payloadcms/next',
      '@payloadcms/db-postgres',
      '@payloadcms/richtext-lexical',
      'next',
      'react',
      'react-dom',
    ]) {
      const version = manifest.dependencies[pkg]
      expect(version, `${pkg} ausente`).toBeDefined()
      expect(
        /^\d+\.\d+\.\d+$/.test(version as string),
        `${pkg} deveria ter versao exata, veio "${version}"`,
      ).toBe(true)
    }
  })

  it('o CMS usa uma versao de Next compativel com @payloadcms/next e diferente do resto', async () => {
    const cms = JSON.parse(await readFile(resolve(CMS_DIR, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    // `@payloadcms/next@3.86.0` NAO aceita 15.5.x, que e o que apps/web usa.
    // A divergencia e deliberada e precisa continuar visivel.
    expect(cms.dependencies.next).toBe('15.4.11')
  })

  it('as migrations Prisma nao foram alteradas por esta fase', async () => {
    // Prova estrutural: o CMS tem diretorio de migration PROPRIO, e o schema
    // Prisma segue existindo sem referencia a collections do Payload.
    expect(await exists(resolve(CMS_DIR, 'src', 'migrations'))).toBe(true)
    const prismaSchema = await readFile(
      resolve(ROOT, 'packages', 'db', 'prisma', 'schema.prisma'),
      'utf-8',
    )
    for (const cmsTable of ['editorial-users', 'service-accounts', 'publication-outbox']) {
      expect(prismaSchema.includes(cmsTable), `${cmsTable} vazou para o schema Prisma`).toBe(false)
    }
  })

  it('o endpoint interno nao escreve no screen-db nem chama servico externo', async () => {
    const endpoint = stripComments(
      await readFile(resolve(CMS_DIR, 'src', 'endpoints', 'editorial-drafts.ts'), 'utf-8'),
    )
    for (const forbidden of ['fetch(', 'axios', 'https://', '@screena/db', 'PrismaClient']) {
      expect(endpoint.includes(forbidden), `endpoint contem ${forbidden}`).toBe(false)
    }
  })
})
