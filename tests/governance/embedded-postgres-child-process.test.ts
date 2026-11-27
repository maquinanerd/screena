/**
 * embedded-postgres-child-process.test.ts — Quem hospeda um PostgreSQL embarcado
 * nunca roda processo filho de forma sincrona.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * O `embedded-postgres` le o LOG do Postgres (o stderr do filho) pelo laco de
 * eventos. `execFileSync`, `spawnSync` e `execSync` congelam esse laco; o pipe
 * enche (~64 KB) e o backend que for logar trava dentro do `write()`, sem erro.
 * 16/09/2026: um validador ficou 6 h parado numa migration. O conserto e
 * `@screena/db/async-child-process` (no CMS, a copia local exigida pelo ADR 0015).
 * O experimento com controle negativo esta em `tests/unit/async-child-process.test.ts`.
 *
 * ============================================================================
 * POR QUE A REGRA E "NENHUMA CHAMADA", E NAO "NENHUMA CHAMADA DEPOIS DO start()"
 * ============================================================================
 * Posicao no ARQUIVO nao e ordem de EXECUCAO. O `runBin` do bootstrap de
 * evidencia, o `runCatalog` do validador de decisoes, o `servePublicPage` do
 * canario manual e o `applyCmsMigrations` do harness do CMS estao escritos ACIMA
 * do `start()` e rodam DEPOIS dele — e eram os casos de maior risco (workers de
 * ate 50 min, `next build` de minutos). Uma regra por posicao deixaria os quatro
 * passar. Por isso: arquivo que hospeda Postgres embarcado nao usa a API sincrona
 * em lugar nenhum. As poucas chamadas que rodavam sem cluster embarcado (o ramo de
 * `CINERIE_VALIDATOR_DATABASE_URL`) foram convertidas junto; custa um `await`.
 *
 * ============================================================================
 * QUEM E HOSPEDEIRO
 * ============================================================================
 * Quem importa `embedded-postgres` e, por FECHO, quem importa um hospedeiro por
 * caminho relativo ou por alias de `tsconfig.base.json`: o canario manual hospeda
 * DOIS clusters (harness do CMS + screen-db) sem citar o pacote. Import so de
 * tipo nao sobe cluster e nao conta; mencao em comentario tambem nao.
 *
 * LIMITE CONHECIDO: a regra olha o arquivo hospedeiro, nao os modulos que ele
 * importa. Um helper em outro arquivo que chame a API sincrona escaparia. Nao ha
 * nenhum hoje; se surgir, o caminho e o mesmo: `runChild`/`spawnChild` nele.
 *
 * ============================================================================
 * SEGUNDA REGRA: O PONTO DE ENTRADA REPROVA COM `process.exit`, NAO `exitCode`
 * ============================================================================
 * Ao ser IMPORTADO, o `embedded-postgres` chama `AsyncExitHook(gracefulShutdown)`.
 * O `async-exit-hook` liga o `beforeExit` a `process.exit(0)`, com o zero
 * ESCRITO, e esse zero vence qualquer `process.exitCode = 1` atribuido antes. Um
 * script que reprova so por `exitCode` imprime `[FAIL]` e sai 0. Medido em
 * 26/11/2026: `process.exitCode = 1` sozinho sai 1; com o pacote importado antes,
 * sai 0. Foi assim que `validate:synopsis-render` ficou verde na CI com
 * `RESUMO: 0/1` (main de 18/11 a 26/11), e o `validate:person-eligibility` ja
 * tinha caido no mesmo buraco em 21/08 (PR #212). Os outros doze scripts com o
 * mesmo final passavam de verdade, mas nada os impedia de esconder uma falha.
 *
 * Ponto de entrada = hospedeiro dentro de uma pasta `scripts/` (o que
 * `tsx scripts/x.ts` roda). Harness de teste nao entra: quem decide o codigo de
 * saida ali e o vitest/playwright, pelo relatorio, nao pelo `exit`.
 *
 * LIMITE CONHECIDO: a regra pede que a CHAMADA exista no arquivo, nao que todo
 * caminho de falha chegue a ela, e uma string com `process.exit(` tambem
 * satisfaria a regra. Ela pega o padrao que de fato se repetiu (`void main()` /
 * `await main()` com `exitCode` e nenhum `exit`), nao toda grafia possivel.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  commentSyntaxFor,
  readSourceRaw,
  readSourceWithoutComments,
  REPO_ROOT,
  stripComments,
} from '../support/source-text.js'

const MOTIVO_PREFILTRO =
  'prefiltro barato por substring; toda decisao e tomada sobre o texto SEM comentarios'

const RAIZES = ['apps', 'packages', 'services', 'tests', 'scripts', 'api-clients']
const IGNORADOS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo'])
const EXTENSOES = /\.(?:[cm]?ts|tsx|[cm]?js)$/

/**
 * O AUDITOR NAO SE AUDITA. Os controles negativos abaixo sao STRINGS com
 * `import ... from 'embedded-postgres'` e com os tres nomes proibidos — o
 * comentario sai, a string fica, e sem esta linha o arquivo se declararia
 * hospedeiro e ofensor ao mesmo tempo. Caminho em pedacos para nao casar consigo.
 */
const ESTE_GUARD = ['tests', 'governance', 'embedded-postgres-child-process.test.ts'].join('/')

/** Os tres nomes que congelam o laco. Casados como IDENTIFICADOR, em qualquer grafia de uso. */
const API_SINCRONA = /\b(execFileSync|spawnSync|execSync)\b/g

/** Especificadores que CARREGAM o modulo em runtime (import de valor, dinamico, require). */
export function especificadoresDeRuntime(codigoSemComentarios: string): string[] {
  const encontrados: string[] = []
  // A clausula so aceita o que uma clausula de import tem (identificador, `*`,
  // chaves, virgula, espaco): assim o casamento nao atravessa codigo. Com um
  // `[^;]*` qualquer, um `export type X = ...` acima do import virava "clausula
  // de tipo" e o import REAL logo abaixo era descartado.
  const estatico = /\b(?:import|export)\s+(type\s+)?[\w*${}\s,]*?\s*from\s*['"]([^'"]+)['"]/g
  for (const m of codigoSemComentarios.matchAll(estatico)) {
    if (m[1] !== undefined) continue
    encontrados.push(m[2] ?? '')
  }
  const padroes = [
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const padrao of padroes) {
    for (const m of codigoSemComentarios.matchAll(padrao)) encontrados.push(m[1] ?? '')
  }
  return encontrados
}

export function importaEmbeddedPostgres(codigoSemComentarios: string): boolean {
  return especificadoresDeRuntime(codigoSemComentarios).includes('embedded-postgres')
}

export function usosDaApiSincrona(
  codigoSemComentarios: string,
): Array<{ identificador: string; linha: number }> {
  const usos: Array<{ identificador: string; linha: number }> = []
  for (const m of codigoSemComentarios.matchAll(API_SINCRONA)) {
    const linha = codigoSemComentarios.slice(0, m.index).split('\n').length
    usos.push({ identificador: m[1] ?? '', linha })
  }
  return usos
}

/** Hospedeiro que e PONTO DE ENTRADA: mora numa pasta `scripts/` e nao e arquivo de teste. */
export function ehPontoDeEntrada(arquivo: string): boolean {
  return arquivo.split('/').includes('scripts') && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(arquivo)
}

/** Ha CHAMADA a `process.exit(...)`? `process.exitCode` nao conta: e ele que o gancho apaga. */
export function chamaProcessExit(codigoSemComentarios: string): boolean {
  return /\bprocess\s*\.\s*exit\s*\(/.test(codigoSemComentarios)
}

function relativo(absoluto: string): string {
  return path.relative(REPO_ROOT, absoluto).split(path.sep).join('/')
}

function listarCodigo(): string[] {
  const arquivos: string[] = []
  const andar = (dir: string): void => {
    let entradas
    try {
      entradas = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entrada of entradas) {
      const absoluto = path.join(dir, entrada.name)
      if (entrada.isDirectory()) {
        if (!IGNORADOS.has(entrada.name)) andar(absoluto)
        continue
      }
      if (!EXTENSOES.test(entrada.name)) continue
      const arquivo = relativo(absoluto)
      if (arquivo !== ESTE_GUARD) arquivos.push(arquivo)
    }
  }
  for (const raiz of RAIZES) andar(path.join(REPO_ROOT, raiz))
  return arquivos.sort()
}

/** Aliases EXATOS de `tsconfig.base.json` (`@cms-harness` -> arquivo). */
function aliasesDoTsconfig(): Map<string, string> {
  const jsonc = readSourceRaw('tsconfig.base.json', 'JSONC: os comentarios saem por stripComments abaixo')
  const config = JSON.parse(stripComments(jsonc, 'c-like')) as {
    compilerOptions?: { paths?: Record<string, string[]> }
  }
  const aliases = new Map<string, string>()
  for (const [chave, alvos] of Object.entries(config.compilerOptions?.paths ?? {})) {
    const alvo = alvos[0]
    if (alvo !== undefined && !chave.includes('*')) aliases.set(chave, alvo)
  }
  return aliases
}

function ehArquivo(absoluto: string): boolean {
  return existsSync(absoluto) && statSync(absoluto).isFile()
}

export function resolverImport(
  origem: string,
  especificador: string,
  aliases: ReadonlyMap<string, string>,
): string | null {
  const alias = aliases.get(especificador)
  if (alias !== undefined) return alias
  if (!especificador.startsWith('.')) return null
  const base = path.resolve(REPO_ROOT, path.dirname(origem), especificador)
  const candidatos = [
    base,
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    base.replace(/\.mjs$/, '.mts'),
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
  ]
  const achado = candidatos.find(ehArquivo)
  return achado === undefined ? null : relativo(achado)
}

interface Varredura {
  readonly hospedeiros: ReadonlySet<string>
  semComentarios(arquivo: string): string
}

let varreduraEmCache: Varredura | undefined

function varrer(): Varredura {
  if (varreduraEmCache !== undefined) return varreduraEmCache
  const arquivos = listarCodigo()
  const cru = new Map(arquivos.map((a) => [a, readSourceRaw(a, MOTIVO_PREFILTRO)] as const))
  const limpos = new Map<string, string>()
  const semComentarios = (arquivo: string): string => {
    let limpo = limpos.get(arquivo)
    if (limpo === undefined) {
      limpo = stripComments(cru.get(arquivo) ?? '', commentSyntaxFor(arquivo))
      limpos.set(arquivo, limpo)
    }
    return limpo
  }

  const hospedeiros = new Set<string>()
  for (const arquivo of arquivos) {
    if ((cru.get(arquivo) ?? '').includes('embedded-postgres') && importaEmbeddedPostgres(semComentarios(arquivo))) {
      hospedeiros.add(arquivo)
    }
  }

  // FECHO: quem importa um hospedeiro tambem hospeda. Repete ate estabilizar.
  const aliases = aliasesDoTsconfig()
  let cresceu = true
  while (cresceu) {
    cresceu = false
    const agulhas = [...hospedeiros].map((h) => path.posix.basename(h).replace(/\.[^.]+$/, ''))
    for (const [alias, alvo] of aliases) if (hospedeiros.has(alvo)) agulhas.push(alias)
    for (const arquivo of arquivos) {
      if (hospedeiros.has(arquivo)) continue
      const texto = cru.get(arquivo) ?? ''
      if (!agulhas.some((agulha) => texto.includes(agulha))) continue
      const importaHospedeiro = especificadoresDeRuntime(semComentarios(arquivo)).some((e) => {
        const alvo = resolverImport(arquivo, e, aliases)
        return alvo !== null && hospedeiros.has(alvo)
      })
      if (importaHospedeiro) {
        hospedeiros.add(arquivo)
        cresceu = true
      }
    }
  }

  varreduraEmCache = { hospedeiros, semComentarios }
  return varreduraEmCache
}

describe('hospedeiros de PostgreSQL embarcado nao congelam o laco de eventos', () => {
  it('a varredura enxerga os hospedeiros, diretos E por fecho (senao a regra passaria vazia)', () => {
    const { hospedeiros } = varrer()
    expect(hospedeiros.size).toBeGreaterThanOrEqual(50)
    for (const conhecido of [
      // diretos
      'packages/db/scripts/validate-real-postgres.ts',
      'apps/cms/src/__tests__/harness.ts',
      'apps/cms/scripts/ephemeral-postgres.ts',
      'services/news-ingestion/src/__tests__/screen-db-harness.ts',
      // SO por fecho: nenhum destes cita `embedded-postgres` em codigo
      'apps/web/scripts/canary-manual-editorial-real-postgres.ts',
      'apps/cms/e2e/global-setup.ts',
      'services/news-ingestion/src/__tests__/editorial-projection.integration.test.ts',
    ]) {
      expect(hospedeiros.has(conhecido), conhecido).toBe(true)
    }
    // Cita o pacote so em comentario e roda os validadores como FILHOS: nao hospeda.
    expect(hospedeiros.has('apps/web/scripts/validate-all-real-postgres.ts')).toBe(false)
  }, 60_000)

  it('nenhum hospedeiro usa execFileSync, spawnSync ou execSync', () => {
    const { hospedeiros, semComentarios } = varrer()
    const ofensas: string[] = []
    for (const arquivo of [...hospedeiros].sort()) {
      for (const uso of usosDaApiSincrona(semComentarios(arquivo))) {
        ofensas.push(`${arquivo}:${uso.linha} ${uso.identificador}`)
      }
    }
    expect(
      ofensas,
      [
        'Estes arquivos hospedam PostgreSQL embarcado e congelam o laco de eventos com um filho',
        'sincrono: o log do Postgres para de ser lido, o pipe enche e o backend trava no write().',
        "Use runChild/spawnChild de '@screena/db/async-child-process' (no CMS,",
        "'apps/cms/src/__tests__/async-child-process.ts').",
      ].join('\n'),
    ).toEqual([])
  }, 60_000)

  it('todo hospedeiro que e ponto de entrada reprova com process.exit, nunca so com exitCode', () => {
    const { hospedeiros, semComentarios } = varrer()
    const pontosDeEntrada = [...hospedeiros].filter(ehPontoDeEntrada).sort()
    // Nao vacuo: a regra precisa enxergar os scripts que ja cairam no buraco,
    // inclusive os que so hospedam POR FECHO (os canarios sobem o cluster pelos
    // harnesses do CMS e do screen-db, sem citar o pacote).
    expect(pontosDeEntrada.length).toBeGreaterThanOrEqual(40)
    for (const conhecido of [
      'apps/web/scripts/validate-synopsis-render-real-postgres.ts',
      'apps/web/scripts/validate-person-eligibility-real-postgres.ts',
      'services/ingestion/scripts/validate-text-recovery-real-postgres.ts',
      'apps/web/scripts/canary-editorial-entity-links-real-postgres.ts',
      'apps/web/scripts/canary-entity-link-auto-verification-real-postgres.ts',
    ]) {
      expect(pontosDeEntrada.includes(conhecido), conhecido).toBe(true)
    }
    const ofensores = pontosDeEntrada.filter((arquivo) => !chamaProcessExit(semComentarios(arquivo)))
    expect(
      ofensores,
      [
        'Estes scripts hospedam PostgreSQL embarcado e nao chamam process.exit: o embedded-postgres',
        'responde ao beforeExit com process.exit(0) e apaga qualquer process.exitCode = 1, entao uma',
        'falha sai com codigo 0 e o passo da CI fica verde. Termine com',
        'main().then(() => { if (Number(process.exitCode ?? 0) !== 0) process.exit(1) })',
        '      .catch((e) => { console.error(e); process.exit(1) })',
      ].join('\n'),
    ).toEqual([])
  }, 60_000)

  it('a copia do CMS tem o MESMO codigo do helper canonico', () => {
    // Linha a linha, sem comentarios e sem linhas vazias: o cabecalho de cada
    // copia e diferente de proposito, e o diff de uma divergencia aponta a linha.
    const codigo = (arquivo: string): string[] =>
      readSourceWithoutComments(arquivo)
        .split('\n')
        .map((linha) => linha.trim())
        .filter((linha) => linha.length > 0)
    expect(codigo('apps/cms/src/__tests__/async-child-process.ts')).toEqual(
      codigo('packages/db/src/async-child-process.ts'),
    )
  })
})

describe('detector (funcoes puras) — controles negativos', () => {
  it('acusa a API sincrona em qualquer grafia de import e de uso', () => {
    const grafias = [
      "import { execFileSync } from 'node:child_process'\nexecFileSync('node', [])",
      "import { spawnSync as rodar } from 'child_process'\nrodar('node', [])",
      "import * as cp from 'node:child_process'\ncp.execSync('ls')",
      "const { spawnSync } = require('node:child_process')",
      "const cp = await import('node:child_process')\ncp['execFileSync']('node', [])",
    ]
    for (const grafia of grafias) {
      expect(usosDaApiSincrona(stripComments(grafia, 'c-like')).length, grafia).toBeGreaterThan(0)
    }
  })

  it('nao acusa comentario nem a API assincrona', () => {
    const codigo = [
      '// execFileSync congelava o laco; spawnSync tambem',
      '/* execSync idem */',
      "import { execFile, spawn } from 'node:child_process'",
      "spawn('node', [])",
    ].join('\n')
    expect(usosDaApiSincrona(stripComments(codigo, 'c-like'))).toEqual([])
  })

  it('informa a linha do uso', () => {
    const codigo = "import { spawn } from 'node:child_process'\n\nconst r = spawnSync('node')"
    expect(usosDaApiSincrona(codigo)).toEqual([{ identificador: 'spawnSync', linha: 3 }])
  })

  it('hospedeiro: import de valor, dinamico e require contam; import de tipo e comentario nao', () => {
    const hospeda = (codigo: string): boolean =>
      importaEmbeddedPostgres(stripComments(codigo, 'c-like'))
    expect(hospeda("import EmbeddedPostgres from 'embedded-postgres'")).toBe(true)
    expect(hospeda('import EmbeddedPostgres from "embedded-postgres";')).toBe(true)
    expect(hospeda("const { default: Pg } = await import(\n  'embedded-postgres'\n)")).toBe(true)
    expect(hospeda("const Pg = require('embedded-postgres')")).toBe(true)
    // Um alias de TIPO acima do import nao pode "contaminar" o import real.
    expect(
      hospeda("export type Alvo = { a: number }\nimport EmbeddedPostgres from 'embedded-postgres'"),
    ).toBe(true)
    expect(hospeda("import type EmbeddedPostgres from 'embedded-postgres'")).toBe(false)
    expect(hospeda('// sobe um embedded-postgres por validador')).toBe(false)
    expect(hospeda("import { spawn } from 'node:child_process'")).toBe(false)
  })

  it('saida: so a CHAMADA a process.exit conta; exitCode e comentario nao', () => {
    const chama = (codigo: string): boolean => chamaProcessExit(stripComments(codigo, 'c-like'))
    expect(chama('if (falhou) process.exit(1)')).toBe(true)
    expect(chama('main().then((c) => process.exit(c))')).toBe(true)
    expect(chama('process . exit (1)')).toBe(true)
    // O final que se repetiu: placar em exitCode e saida natural.
    expect(chama("process.exitCode = passed === total ? 0 : 1\n\nvoid main()")).toBe(false)
    expect(chama('process.exitCode = 1\nawait main();')).toBe(false)
    expect(chama('// sem process.exit(1) aqui, o gancho zera o exitCode')).toBe(false)
    expect(chama('/* process.exit(1) */ void main()')).toBe(false)
  })

  it('ponto de entrada: pasta scripts/, nunca arquivo de teste nem harness', () => {
    expect(ehPontoDeEntrada('apps/web/scripts/validate-synopsis-render-real-postgres.ts')).toBe(true)
    expect(ehPontoDeEntrada('services/ingestion/scripts/validate-text-recovery-real-postgres.ts')).toBe(
      true,
    )
    expect(ehPontoDeEntrada('apps/cms/src/__tests__/harness.ts')).toBe(false)
    expect(ehPontoDeEntrada('apps/cms/e2e/global-setup.ts')).toBe(false)
    expect(ehPontoDeEntrada('apps/web/scripts/x.test.ts')).toBe(false)
    // Substring nao basta: o segmento tem de ser `scripts`.
    expect(ehPontoDeEntrada('apps/web/src/transcripts/x.ts')).toBe(false)
  })

  it('resolve import relativo com extensao .js e alias do tsconfig', () => {
    const aliases = new Map([['@cms-harness', 'apps/cms/src/__tests__/harness.ts']])
    expect(
      resolverImport(
        'services/news-ingestion/src/__tests__/gallery-projection.integration.test.ts',
        './screen-db-harness.js',
        aliases,
      ),
    ).toBe('services/news-ingestion/src/__tests__/screen-db-harness.ts')
    expect(resolverImport('apps/web/scripts/x.ts', '../../cms/src/__tests__/harness.ts', aliases)).toBe(
      'apps/cms/src/__tests__/harness.ts',
    )
    expect(resolverImport('qualquer.ts', '@cms-harness', aliases)).toBe(
      'apps/cms/src/__tests__/harness.ts',
    )
    expect(resolverImport('qualquer.ts', 'embedded-postgres', aliases)).toBeNull()
  })
})
