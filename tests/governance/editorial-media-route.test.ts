/**
 * Teste de governanca — a rota que serve `editorial_media_assets.public_path`.
 *
 * O modo de falha que este teste existe para impedir ja aconteceu em producao:
 * o worker gravava `/media/editorial/<xx>/<sha256>.<ext>` no banco, o HTML
 * renderizava `<img src>` com esse caminho, e **ninguem servia o caminho**. O
 * resultado foi 404 na imagem de capa da primeira materia publicada, sem erro
 * em log nenhum — nem no worker, nem no site.
 *
 * Trava duas coisas que so quebram em conjunto e em silencio:
 *
 *  1. o prefixo publico do worker (`DEFAULT_PUBLIC_BASE_PATH` em
 *     `storage-config.ts`) e o caminho do arquivo de rota em `apps/web/app`
 *     precisam descrever a MESMA URL;
 *  2. a rota de bytes nao pode importar `@screena/db` direto — o acesso ao
 *     banco vive em `src/server/**`, como toda leitura do app publico.
 *
 * Nao ha como um teste de unidade pegar (1): os dois lados estao corretos
 * isoladamente. So a comparacao entre eles denuncia o buraco.
 */

import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/** Caminho do route handler, escrito como o Next o interpreta. */
const ROUTE_FILE = resolve(ROOT, 'apps', 'web', 'app', 'media', 'editorial', '[...key]', 'route.ts')

/** Fonte do prefixo publico no worker. */
const WORKER_STORAGE_CONFIG = resolve(
  ROOT,
  'services',
  'news-ingestion',
  'src',
  'media',
  'storage-config.ts',
)

/** Fonte do prefixo publico no site. */
const WEB_MEDIA_PATH = resolve(ROOT, 'apps', 'web', 'src', 'lib', 'editorial-media-path.ts')

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe('governanca: /media/editorial e servido pelo screen-app', () => {
  it('o route handler existe no caminho que o banco grava', async () => {
    expect(
      await exists(ROUTE_FILE),
      'sem esta rota, todo public_path projetado responde 404 silenciosamente',
    ).toBe(true)
  })

  it('o prefixo publico do worker e o da rota descrevem a mesma URL', async () => {
    const workerSource = await readFile(WORKER_STORAGE_CONFIG, 'utf-8')
    const webSource = await readFile(WEB_MEDIA_PATH, 'utf-8')

    const workerDefault = /DEFAULT_PUBLIC_BASE_PATH\s*=\s*'([^']+)'/.exec(workerSource)?.[1]
    const routePrefix = /EDITORIAL_MEDIA_ROUTE_PREFIX\s*=\s*"([^"]+)"/.exec(webSource)?.[1]

    expect(workerDefault, 'DEFAULT_PUBLIC_BASE_PATH nao encontrado no worker').toBeDefined()
    expect(routePrefix, 'EDITORIAL_MEDIA_ROUTE_PREFIX nao encontrado no site').toBeDefined()

    // O worker concatena `<basePath>/<storageKey>`, e toda chave editorial
    // comeca por `editorial/` (EDITORIAL_MEDIA_PREFIX). Logo o caminho servido
    // e sempre `<basePath>/editorial/...`.
    expect(
      routePrefix,
      `worker grava ${String(workerDefault)}/editorial/... mas a rota atende ${String(routePrefix)}/...`,
    ).toBe(`${String(workerDefault)}/editorial`)
  })

  it('a rota de bytes nao importa @screena/db direto', async () => {
    const source = await readFile(ROUTE_FILE, 'utf-8')
    expect(/from\s+["']@screena\/db/.test(source)).toBe(false)
  })
})
