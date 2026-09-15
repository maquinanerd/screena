/**
 * deploy-reference.test.ts — A leitura do `main` diz a verdade e custa pouco.
 *
 * Tres coisas precisam ser verdade para o painel poder afirmar "este servico
 * roda o commit X, N commits atras do main":
 *
 *   1. a impressao da arvore e a MESMA funcao usada no disco (fonte unica);
 *   2. a distancia e medida contra a cabeca ATUAL, e refeita quando ela anda;
 *   3. um ciclo sem novidade custa UMA requisicao — o limite sem token e 60/h.
 */

import { describe, expect, it } from 'vitest'

import { fingerprintFromGitTree, type GitTreeEntry } from '@screena/db/source-fingerprint'

import {
  backoffMs,
  createGithubClient,
  GithubRequestError,
  parseCommitList,
  parseCompare,
  parseTree,
  syncDeployReference,
  type DeployReferenceStore,
  type GithubPort,
} from '../runtime/deploy-reference.js'

const REPO = 'maquinanerd/screena'
const sha = (ch: string): string => ch.repeat(40)

function commitJson(commitSha: string, treeSha: string, date: string, message: string): unknown {
  return { sha: commitSha, commit: { tree: { sha: treeSha }, committer: { date }, message } }
}

function treeEntries(files: ReadonlyArray<readonly [string, string]>): GitTreeEntry[] {
  return files.map(([path, blob]) => ({ path, mode: '100644', type: 'blob', sha: blob }))
}

function treeJson(files: ReadonlyArray<readonly [string, string]>, truncated = false): unknown {
  return { tree: treeEntries(files), truncated }
}

const ARQUIVOS_A = [
  ['services/sync/src/a.ts', '1'.repeat(40)],
  ['apps/web/app/page.tsx', '2'.repeat(40)],
] as const
const ARQUIVOS_B = [
  ['services/sync/src/a.ts', '3'.repeat(40)],
  ['apps/web/app/page.tsx', '2'.repeat(40)],
] as const

const listPath = `/repos/${REPO}/commits?sha=main&per_page=30`
const treePath = (tree: string): string => `/repos/${REPO}/git/trees/${tree}?recursive=1`
const comparePath = (base: string, head: string): string => `/repos/${REPO}/compare/${base}...${head}`

function fakeGithub(routes: Record<string, unknown>): GithubPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    requestCount: () => calls.length,
    async get(pathAndQuery: string) {
      calls.push(pathAndQuery)
      const route = routes[pathAndQuery]
      if (route instanceof GithubRequestError) throw route
      if (route === undefined) throw new GithubRequestError('github_http_404', 'rota ausente no teste', false)
      return { status: 200, body: route }
    },
  }
}

interface LinhaMemoria {
  position: number | null
  digest: string | null
  truncated: boolean
  behindBy: number | null
  behindHeadSha: string | null
}

function memoryStore(liveDigests: string[]): { store: DeployReferenceStore; rows: Map<string, LinhaMemoria> } {
  const rows = new Map<string, LinhaMemoria>()
  const store: DeployReferenceStore = {
    async recordMainWindow(commits) {
      const janela = new Set(commits.map((c) => c.sha))
      commits.forEach((commit, position) => {
        const atual = rows.get(commit.sha)
        rows.set(commit.sha, {
          position,
          digest: atual?.digest ?? null,
          truncated: atual?.truncated ?? false,
          behindBy: atual?.behindBy ?? null,
          behindHeadSha: atual?.behindHeadSha ?? null,
        })
      })
      for (const [key, row] of rows) if (!janela.has(key)) row.position = null
    },
    async commitsWithoutDigest(shas) {
      return new Set(shas.filter((s) => rows.get(s)?.digest === null && rows.get(s)?.truncated === false))
    },
    async saveDigest(commitSha, fingerprint, truncated) {
      const row = rows.get(commitSha)
      if (row === undefined) throw new Error('commit desconhecido')
      row.digest = fingerprint?.digest ?? null
      row.truncated = truncated
    },
    async liveServiceDigests() {
      return liveDigests
    },
    async newestCommitsForDigests(digests) {
      const out: Array<{ sha: string; behindHeadSha: string | null }> = []
      for (const digest of digests) {
        const candidatos = [...rows.entries()]
          .filter(([, row]) => row.digest === digest)
          .sort(([, a], [, b]) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER))
        const primeiro = candidatos[0]
        if (primeiro !== undefined) out.push({ sha: primeiro[0], behindHeadSha: primeiro[1].behindHeadSha })
      }
      return out
    },
    async saveBehind(commitSha, behindBy, headSha) {
      const row = rows.get(commitSha)
      if (row === undefined) throw new Error('commit desconhecido')
      row.behindBy = behindBy
      row.behindHeadSha = headSha
    },
  }
  return { store, rows }
}

const agora = (): Date => new Date('2026-09-15T12:00:00.000Z')

describe('decodificacao', () => {
  it('lista de commits: sha, arvore, data e so a PRIMEIRA linha da mensagem', () => {
    const commits = parseCommitList([commitJson(sha('a'), sha('1'), '2026-09-15T10:00:00Z', 'feat: x\n\ncorpo longo')])
    expect(commits).toEqual([
      { sha: sha('a'), treeSha: sha('1'), committedAt: new Date('2026-09-15T10:00:00Z'), title: 'feat: x' },
    ])
  })

  it('forma inesperada LANCA — um ciclo nao grava lixo como se fosse commit', () => {
    expect(() => parseCommitList({ message: 'Not Found' })).toThrow(GithubRequestError)
    expect(() => parseCommitList([{ sha: 'curto' }])).toThrow(/sha valido/)
    expect(() => parseCompare({})).toThrow(/ahead_by/)
  })

  it('arvore: marca truncada e descarta entradas mal formadas', () => {
    const tree = parseTree({ tree: [{ path: 'apps/web/app/x.tsx', mode: '100644', type: 'blob', sha: sha('9') }, { path: 1 }], truncated: true })
    expect(tree.truncated).toBe(true)
    expect(tree.entries).toHaveLength(1)
  })
})

describe('syncDeployReference — a verdade e o custo', () => {
  const digestA = fingerprintFromGitTree(treeEntries(ARQUIVOS_A)).digest
  const digestB = fingerprintFromGitTree(treeEntries(ARQUIVOS_B)).digest

  function rotasBase(): Record<string, unknown> {
    return {
      [listPath]: [
        commitJson(sha('a'), sha('1'), '2026-09-15T11:00:00Z', 'commit A (cabeca)'),
        commitJson(sha('b'), sha('2'), '2026-09-15T10:00:00Z', 'commit B'),
        // C so mudou documentacao: arvore de codigo IGUAL a de B.
        commitJson(sha('c'), sha('3'), '2026-09-15T09:00:00Z', 'docs: C'),
      ],
      [treePath(sha('1'))]: treeJson(ARQUIVOS_A),
      [treePath(sha('2'))]: treeJson(ARQUIVOS_B),
      [treePath(sha('3'))]: treeJson(ARQUIVOS_B),
      [comparePath(sha('b'), sha('a'))]: { ahead_by: 1 },
    }
  }

  it('primeiro ciclo: impressao de cada commit e a distancia do commit que o servico roda', async () => {
    const github = fakeGithub(rotasBase())
    const { store, rows } = memoryStore([digestB])
    const report = await syncDeployReference({ github, store, repository: REPO, now: agora })

    expect(report.errors).toEqual([])
    expect(report.head).toBe(sha('a'))
    expect(rows.get(sha('a'))?.digest).toBe(digestA)
    expect(rows.get(sha('b'))?.digest).toBe(digestB)
    // Dois commits com a mesma arvore: a distancia e medida a partir do MAIS NOVO.
    expect(rows.get(sha('b'))).toMatchObject({ behindBy: 1, behindHeadSha: sha('a') })
    expect(rows.get(sha('c'))?.behindBy).toBeNull()
    expect(github.calls).toHaveLength(5)
  })

  it('ciclo sem novidade custa UMA requisicao', async () => {
    const github = fakeGithub(rotasBase())
    const { store } = memoryStore([digestB])
    await syncDeployReference({ github, store, repository: REPO, now: agora })
    github.calls.length = 0
    await syncDeployReference({ github, store, repository: REPO, now: agora })
    expect(github.calls).toEqual([listPath])
  })

  it('a cabeca andou: arvore nova e distancia REFEITA contra a cabeca nova', async () => {
    const rotas = rotasBase()
    const github = fakeGithub(rotas)
    const { store, rows } = memoryStore([digestB])
    await syncDeployReference({ github, store, repository: REPO, now: agora })

    rotas[listPath] = [
      commitJson(sha('d'), sha('4'), '2026-09-15T11:30:00Z', 'commit D'),
      ...(rotasBase()[listPath] as unknown[]),
    ]
    rotas[treePath(sha('4'))] = treeJson(ARQUIVOS_A)
    rotas[comparePath(sha('b'), sha('d'))] = { ahead_by: 2 }
    github.calls.length = 0
    const report = await syncDeployReference({ github, store, repository: REPO, now: agora })

    expect(report.head).toBe(sha('d'))
    expect(github.calls).toEqual([listPath, treePath(sha('4')), comparePath(sha('b'), sha('d'))])
    expect(rows.get(sha('b'))).toMatchObject({ behindBy: 2, behindHeadSha: sha('d') })
    expect(rows.get(sha('a'))?.position).toBe(1)
  })

  it('servico na CABECA: distancia zero sem gastar requisicao de comparacao', async () => {
    const github = fakeGithub(rotasBase())
    const { store, rows } = memoryStore([digestA])
    await syncDeployReference({ github, store, repository: REPO, now: agora })
    expect(rows.get(sha('a'))).toMatchObject({ behindBy: 0, behindHeadSha: sha('a') })
    expect(github.calls.some((c) => c.includes('/compare/'))).toBe(false)
  })

  it('arvore TRUNCADA fica sem digest (nunca um digest de arvore incompleta) e nao e buscada de novo', async () => {
    const rotas = rotasBase()
    rotas[treePath(sha('1'))] = treeJson(ARQUIVOS_A, true)
    const github = fakeGithub(rotas)
    const { store, rows } = memoryStore([])
    await syncDeployReference({ github, store, repository: REPO, now: agora })
    expect(rows.get(sha('a'))).toMatchObject({ digest: null, truncated: true })
    github.calls.length = 0
    await syncDeployReference({ github, store, repository: REPO, now: agora })
    expect(github.calls).toEqual([listPath])
  })

  it('limite do GitHub PARA o ciclo: nenhuma arvore a mais, nenhuma comparacao', async () => {
    const rotas = rotasBase()
    rotas[treePath(sha('1'))] = new GithubRequestError('github_rate_limited', 'limite', true)
    const github = fakeGithub(rotas)
    const { store } = memoryStore([digestB])
    const report = await syncDeployReference({ github, store, repository: REPO, now: agora })
    expect(report.errors.map((e) => e.code)).toEqual(['github_rate_limited'])
    expect(github.calls).toEqual([listPath, treePath(sha('1'))])
    expect(report.comparesPlanned).toBe(0)
  })

  it('repositorio fora do formato: zero requisicao', async () => {
    const github = fakeGithub({})
    const { store } = memoryStore([])
    const report = await syncDeployReference({ github, store, repository: 'https://evil/x', now: agora })
    expect(report.errors[0]?.code).toBe('github_invalid_repository')
    expect(github.calls).toHaveLength(0)
  })
})

function fakeFetch(respostas: Array<Response | Error>): { fn: typeof fetch; vistos: Array<{ url: string; headers: Record<string, string> }> } {
  const vistos: Array<{ url: string; headers: Record<string, string> }> = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    vistos.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } })
    const proxima = respostas.shift()
    if (proxima === undefined) throw new Error('teste sem resposta')
    if (proxima instanceof Error) throw proxima
    return proxima
  }) as typeof fetch
  return { fn, vistos }
}

const semEspera = async (): Promise<void> => undefined

describe('createGithubClient — resiliencia sem vazar credencial', () => {
  it('5xx e retentado com backoff; o custo conta as DUAS requisicoes', async () => {
    const { fn } = fakeFetch([new Response('x', { status: 503 }), new Response('[]', { status: 200 })])
    const client = createGithubClient({ fetchImpl: fn, sleep: semEspera })
    await expect(client.get('/repos/x/y/commits')).resolves.toMatchObject({ status: 200, body: [] })
    expect(client.requestCount()).toBe(2)
  })

  it('429 e 403 com limite zerado PARAM o ciclo, sem insistir', async () => {
    for (const resposta of [
      new Response('{}', { status: 429 }),
      new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    ]) {
      const { fn } = fakeFetch([resposta])
      const client = createGithubClient({ fetchImpl: fn, sleep: semEspera })
      const erro = await client.get('/x').catch((e: unknown) => e)
      expect(erro).toBeInstanceOf(GithubRequestError)
      expect((erro as GithubRequestError).code).toBe('github_rate_limited')
      expect((erro as GithubRequestError).stopsCycle).toBe(true)
      expect(client.requestCount()).toBe(1)
    }
  })

  it('404 nao e retentado', async () => {
    const { fn } = fakeFetch([new Response('{}', { status: 404 })])
    const client = createGithubClient({ fetchImpl: fn, sleep: semEspera })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'github_http_404' })
    expect(client.requestCount()).toBe(1)
  })

  it('falha de rede esgota as tentativas e sai como github_network', async () => {
    const { fn } = fakeFetch([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')])
    const client = createGithubClient({ fetchImpl: fn, sleep: semEspera, maxAttempts: 3 })
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'github_network' })
    expect(client.requestCount()).toBe(3)
  })

  it('token vai no cabecalho so quando existe, e nunca aparece em mensagem de erro', async () => {
    const TOKEN = 'ghp_SEGREDO_QUE_NAO_PODE_VAZAR_123'
    const comToken = fakeFetch([new Response('{}', { status: 500 }), new Response('{}', { status: 500 }), new Response('{}', { status: 500 })])
    const client = createGithubClient({ fetchImpl: comToken.fn, sleep: semEspera, token: TOKEN })
    const erro = (await client.get('/x').catch((e: unknown) => e)) as Error
    expect(comToken.vistos[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(erro.message).not.toContain(TOKEN)
    expect(JSON.stringify(erro)).not.toContain(TOKEN)

    const semToken = fakeFetch([new Response('[]', { status: 200 })])
    await createGithubClient({ fetchImpl: semToken.fn }).get('/x')
    expect(semToken.vistos[0]?.headers.Authorization).toBeUndefined()
  })

  it('disjuntor abre apos falhas seguidas e nao chama mais a rede', async () => {
    const { fn, vistos } = fakeFetch([
      new Response('{}', { status: 404 }),
      new Response('{}', { status: 404 }),
      new Response('{}', { status: 404 }),
    ])
    const client = createGithubClient({ fetchImpl: fn, sleep: semEspera, failuresToOpen: 3 })
    for (let i = 0; i < 3; i += 1) await client.get('/x').catch(() => undefined)
    await expect(client.get('/x')).rejects.toMatchObject({ code: 'github_circuit_open' })
    expect(vistos).toHaveLength(3)
  })

  it('backoff exponencial com jitter dentro da faixa', () => {
    expect(backoffMs(1, () => 0)).toBe(250)
    expect(backoffMs(1, () => 1)).toBe(750)
    expect(backoffMs(3, () => 0.5)).toBe(2000)
  })
})
