import { readFile } from 'node:fs/promises'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { validateCmsConfig } from '../env.js'

const SECRET = 'a'.repeat(40)

describe('configuracao EasyPanel do CMS', () => {
  it('aceita banco isolado quando o hostname carrega o prefixo do projeto', () => {
    const result = validateCmsConfig({
      PAYLOAD_DATABASE_URL:
        'postgresql://cinerie_cms:senha@rss_prime_cinerie-cms-db:5432/cinerie_cms',
      PAYLOAD_SECRET: SECRET,
    })

    expect(result.ok).toBe(true)
  })

  it('continua recusando o screen-db mesmo com o mesmo prefixo do projeto', () => {
    const result = validateCmsConfig({
      PAYLOAD_DATABASE_URL:
        'postgresql://worker:senha@rss_prime_screen-db:5432/cinerie_cms',
      PAYLOAD_SECRET: SECRET,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain(
        'payload_database_url_looks_public',
      )
    }
  })

  it('Dockerfile nao aceita credencial real como build arg e suporta segredo por arquivo', async () => {
    const testDir = dirname(fileURLToPath(import.meta.url))
    const repoRoot = resolvePath(testDir, '..', '..', '..', '..')
    const dockerfile = await readFile(resolvePath(repoRoot, 'Dockerfile.cms'), 'utf-8')

    expect(dockerfile).not.toMatch(/^ARG PAYLOAD_SECRET=/m)
    expect(dockerfile).not.toMatch(/^ARG PAYLOAD_DATABASE_URL=/m)
    expect(dockerfile).toContain('/run/secrets/payload_database_url')
    expect(dockerfile).toContain('/run/secrets/payload_secret')
    expect(dockerfile).toContain('build-only-secret-nao-usar-em-runtime')
  })
})
