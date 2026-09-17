/**
 * container-signals.test.ts — o SIGTERM do orquestrador chega ao processo que drena.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE TESTE TRAVA
 * ============================================================================
 * Medido em producao em 17/09/2026, de dentro dos containers (SigCgt de cada
 * processo em `/proc`), e reproduzido com `docker stop` na CI:
 *
 *   screen-cron            PID 1 `/bin/sh -c corepack pnpm ... scheduler:start`
 *                          (dash, NAO trata SIGTERM: o kernel descarta o sinal)
 *                          -> node(corepack/pnpm) -> sh -c "tsx bin/..." -> tsx -> agendador
 *   screen-catalog-worker  PID 1 node(pnpm) -> sh -c "tsx bin/..." -> tsx -> worker
 *   cinerie-publication-worker  comando no painel: `pnpm ... exec tsx bin/project-editorial.ts`
 *                          (o mesmo dash no PID 1 do screen-cron)
 *
 * Tres elos cortavam o sinal, e cada um tem a sua trava aqui:
 *
 *   1. O dash no PID 1 (o EasyPanel roda o "Comando" como `/bin/sh -c` no lugar
 *      do ENTRYPOINT). Conserto: o /bin/sh das imagens desses servicos,
 *      `scripts/container/pid1-shell.sh`, que vira um init. Resultado medido:
 *      `docker stop` terminava em 137 depois da carencia inteira.
 *   2. O `sh -c` com que o pnpm roda o script. O pnpm repassa o SIGTERM so a ele;
 *      o dash morre sem repassar, o pnpm sai, e o servico leva SIGKILL em ~100 ms.
 *      Conserto: o script faz `exec`.
 *   3. A CLI `tsx`. Ela repassa o sinal ao filho e o mata com SIGKILL se ele nao
 *      confirmar por IPC em 30 ms — medido: com o laco de eventos ocupado, 3 de 3
 *      mortos em ~170 ms sem ver o sinal. Conserto: `node --import tsx`, um
 *      processo so. (O comando do painel do worker de projecao ainda usa a CLI:
 *      esse elo so sai de la trocando o comando — ver docs/operations/sigterm-e-pid1.md.)
 *
 * A prova com a IMAGEM REAL (`docker stop` no formato do EasyPanel, com codigo
 * de saida e linha de drenagem) mora no job `docker-image` da CI: este arquivo
 * prova as regras, aquele prova a montagem.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readSourceRaw, readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

const PID1_SHELL = 'scripts/container/pid1-shell.sh'

// ---------------------------------------------------------------------------
// 1. O script de servico
// ---------------------------------------------------------------------------

/**
 * O script `*:start` de um servico de longa duracao, na UNICA forma que entrega o
 * SIGTERM: o shell do pnpm vira o `node` (exec), e o node carrega o tsx em
 * processo (sem a CLI que repassa sinal). Argumentos so em forma de flag.
 */
const SCRIPT_DE_SERVICO = /^exec node --import tsx (bin\/[A-Za-z0-9._-]+\.ts)((?: --[a-z][a-z0-9-]*)*)$/

/** PURA: o script cumpre a forma? Devolve o binario, ou `null`. */
export function binarioDoScriptDeServico(script: string): string | null {
  const match = SCRIPT_DE_SERVICO.exec(script)
  return match === null ? null : (match[1] as string)
}

interface ScriptStart {
  readonly pacote: string
  readonly diretorio: string
  readonly nome: string
  readonly comando: string
}

/** Todo script `*:start` de `services/*`. */
function scriptsStartDosServicos(): readonly ScriptStart[] {
  const encontrados: ScriptStart[] = []
  for (const entrada of readdirSync(path.join(REPO_ROOT, 'services'), { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue
    const manifesto = path.join('services', entrada.name, 'package.json')
    if (!existsSync(path.join(REPO_ROOT, manifesto))) continue
    const pkg = JSON.parse(readSourceWithoutComments(manifesto)) as {
      name: string
      scripts?: Record<string, string>
    }
    for (const [nome, comando] of Object.entries(pkg.scripts ?? {})) {
      if (!nome.endsWith(':start')) continue
      encontrados.push({ pacote: pkg.name, diretorio: path.join('services', entrada.name), nome, comando })
    }
  }
  return encontrados
}

describe('o script de servico entrega o SIGTERM ao processo que drena', () => {
  it('os tres servicos de longa duracao existem e nenhum some da varredura', () => {
    const nomes = scriptsStartDosServicos().map((s) => `${s.pacote} ${s.nome}`)
    expect(nomes).toEqual(
      expect.arrayContaining([
        '@screena/sync scheduler:start',
        '@screena/ingestion catalog-worker:start',
        '@screena/news-ingestion publication-worker:start',
      ]),
    )
  })

  it('todo `*:start` de services/* faz exec do node com o tsx em processo, e o binario existe', () => {
    for (const script of scriptsStartDosServicos()) {
      const binario = binarioDoScriptDeServico(script.comando)
      expect(binario, `${script.pacote} ${script.nome}: "${script.comando}"`).not.toBeNull()
      expect(existsSync(path.join(REPO_ROOT, script.diretorio, binario as string))).toBe(true)
    }
  })

  it('CONTROLE NEGATIVO: a regra reprova cada forma que cortava o sinal', () => {
    const cortam = [
      // o `sh -c` do pnpm fica entre o pnpm e o servico (a forma de antes)
      'tsx bin/cinerie-scheduler.ts',
      // exec, mas a CLI tsx: SIGKILL no filho que nao confirma em 30 ms
      'exec tsx bin/cinerie-scheduler.ts',
      // node certo, sem exec: o shell continua no meio
      'node --import tsx bin/cinerie-scheduler.ts',
      // exec sem o carregador: nao roda TypeScript
      'exec node bin/cinerie-scheduler.ts',
      // composto: o que vem antes do exec e shell, e o de depois nunca roda
      'cd . && exec node --import tsx bin/cinerie-scheduler.ts',
      'exec node --import tsx bin/cinerie-scheduler.ts; echo fim',
      'exec node --import tsx bin/project-editorial.ts $EXTRA',
    ]
    for (const comando of cortam) expect(binarioDoScriptDeServico(comando), comando).toBeNull()
    expect(binarioDoScriptDeServico('exec node --import tsx bin/project-editorial.ts --loop')).toBe(
      'bin/project-editorial.ts',
    )
  })
})

// ---------------------------------------------------------------------------
// 2. Os comandos de container apontam para esses scripts
// ---------------------------------------------------------------------------

/** `pnpm --filter <pacote> <script>` dentro de um comando. */
function filtroPnpm(comando: string): { pacote: string; script: string } | null {
  const match = /pnpm --filter (@[a-z0-9-]+\/[a-z0-9-]+) ([a-z0-9:-]+)/.exec(comando)
  return match === null ? null : { pacote: match[1] as string, script: match[2] as string }
}

/** O CMD em forma exec de um Dockerfile. */
function cmdDoDockerfile(arquivo: string): readonly string[] {
  const match = /^CMD\s+(\[.*\])\s*$/m.exec(readSourceWithoutComments(arquivo))
  if (match === null) throw new Error(`${arquivo} perdeu o CMD em forma exec`)
  return JSON.parse(match[1] as string) as string[]
}

/**
 * O comando que o painel do EasyPanel roda no `screen-cron`, MEDIDO no PID 1 em
 * 17/09/2026 (`tr '\0' ' ' < /proc/1/cmdline`). Ele nao mora no repositorio — mora
 * no painel —, e e justamente por isso que o conserto nao pode depender dele.
 */
const COMANDO_DO_PAINEL_SCREEN_CRON = 'corepack pnpm --filter @screena/sync scheduler:start'

describe('os comandos de container chamam scripts que cumprem a regra', () => {
  it('o CMD das imagens dos workers e o comando do painel do screen-cron', () => {
    const scripts = scriptsStartDosServicos()
    const comandos = [
      ...['Dockerfile.catalog-worker', 'Dockerfile.publication-worker'].map((arquivo) =>
        cmdDoDockerfile(arquivo).join(' '),
      ),
      COMANDO_DO_PAINEL_SCREEN_CRON,
    ]
    for (const comando of comandos) {
      const filtro = filtroPnpm(comando)
      expect(filtro, comando).not.toBeNull()
      const script = scripts.find((s) => s.pacote === filtro?.pacote && s.nome === filtro?.script)
      expect(script, comando).toBeDefined()
      expect(binarioDoScriptDeServico(script?.comando ?? ''), comando).not.toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 3. As imagens com comando no painel instalam o /bin/sh que vira init no PID 1
// ---------------------------------------------------------------------------

/**
 * As imagens cujo servico tem comando no PAINEL — lido na tela Avancado de cada
 * servico em 17/09/2026. So elas passam pelo `/bin/sh -c` que substitui o
 * ENTRYPOINT; o `screen-catalog-worker` tem o campo vazio e roda o CMD da imagem.
 * Um servico novo com comando no painel entra aqui, com a imagem dele.
 */
const IMAGENS_COM_COMANDO_NO_PAINEL: readonly { readonly arquivo: string; readonly servico: string }[] = [
  { arquivo: 'Dockerfile', servico: 'screen-cron' },
  { arquivo: 'Dockerfile.publication-worker', servico: 'cinerie-publication-worker' },
]

/** Instrucoes de um Dockerfile, com as continuacoes de linha juntadas. */
export function instrucoesDockerfile(texto: string): readonly { instrucao: string; argumentos: string }[] {
  return texto
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0)
    .map((linha) => {
      const espaco = linha.search(/\s/)
      return espaco < 0
        ? { instrucao: linha.toUpperCase(), argumentos: '' }
        : { instrucao: linha.slice(0, espaco).toUpperCase(), argumentos: linha.slice(espaco).trim() }
    })
}

/**
 * PURA: o que falta num Dockerfile para o /bin/sh virar init no PID 1. Lista
 * vazia = nada falta. Cada motivo e uma frase que o operador entende.
 */
export function faltasDoShellDoPid1(texto: string): readonly string[] {
  const instrucoes = instrucoesDockerfile(texto)
  const faltas: string[] = []

  const runs = instrucoes.filter((i) => i.instrucao === 'RUN')
  const ultimoRun = runs.at(-1)
  const instalaShell =
    ultimoRun !== undefined &&
    ultimoRun.argumentos.includes(PID1_SHELL) &&
    /ln -sf \S*pid1-shell\.sh \/usr\/bin\/sh(?:\s|$)/.test(ultimoRun.argumentos)
  if (!instalaShell) faltas.push('o ULTIMO RUN nao instala o pid1-shell como /usr/bin/sh')

  const usuarios = instrucoes.filter((i) => i.instrucao === 'USER')
  if (usuarios.at(-1)?.argumentos !== 'node') faltas.push('a imagem nao termina no usuario node')

  return faltas
}

describe('as imagens com comando no painel instalam o /bin/sh que vira init no PID 1', () => {
  for (const { arquivo, servico } of IMAGENS_COM_COMANDO_NO_PAINEL) {
    it(`${arquivo} (${servico}): pid1-shell como /usr/bin/sh no ULTIMO RUN, usuario final node`, () => {
      expect(faltasDoShellDoPid1(readSourceWithoutComments(arquivo))).toEqual([])
    })
  }

  it('CONTROLE NEGATIVO: o detector reprova RUN depois do shell, link ausente e root no fim', () => {
    const certo = [
      'FROM node',
      'RUN apt-get update \\',
      '  && apt-get install -y --no-install-recommends openssl \\',
      '  && rm -rf /var/lib/apt/lists/*',
      'USER root',
      `RUN install -D -m 0755 ${PID1_SHELL} /usr/local/lib/cinerie/pid1-shell.sh \\`,
      '  && ln -sf /usr/local/lib/cinerie/pid1-shell.sh /usr/bin/sh',
      'USER node',
      'CMD ["sh", "-c", "exec pnpm start"]',
    ]
    expect(faltasDoShellDoPid1(certo.join('\n'))).toEqual([])

    // Um RUN depois do shell passaria pelo shell novo: a instalacao tem de ser a ultima.
    const runDepois = [...certo.slice(0, 8), 'RUN echo depois', ...certo.slice(8)]
    expect(faltasDoShellDoPid1(runDepois.join('\n'))).toEqual([
      'o ULTIMO RUN nao instala o pid1-shell como /usr/bin/sh',
    ])

    const semLink = certo.map((l) => l.replace('/usr/bin/sh', '/usr/bin/sh-desligado'))
    expect(faltasDoShellDoPid1(semLink.join('\n'))).toEqual([
      'o ULTIMO RUN nao instala o pid1-shell como /usr/bin/sh',
    ])

    const rootNoFim = certo.filter((l) => l !== 'USER node')
    expect(faltasDoShellDoPid1(rootNoFim.join('\n'))).toEqual(['a imagem nao termina no usuario node'])
  })

  it('o shell e interpretado pelo dash, nao por si mesmo', () => {
    // A primeira linha e comentario para o leitor de fonte; aqui ela e o ponto.
    const texto = readSourceRaw(PID1_SHELL, 'o shebang e comentario na sintaxe hash, e ele e o que se mede')
    expect(texto.split(/\r?\n/, 1)[0]).toBe('#!/bin/dash')
    // Um /bin/sh que chamasse `sh` entraria em laco: todo exec usa o caminho do dash.
    const codigo = readSourceWithoutComments(PID1_SHELL)
    expect(codigo).not.toMatch(/\bexec\s+sh\b/)
    expect(codigo).toMatch(/exec \/bin\/dash "\$@"/)
  })
})

// ---------------------------------------------------------------------------
// 4. Fora do PID 1, o pid1-shell e o dash (so onde o dash existe)
// ---------------------------------------------------------------------------

const DASH = '/bin/dash'
const temDash = process.platform !== 'win32' && existsSync(DASH)

describe.skipIf(!temDash)('fora do PID 1, o pid1-shell responde exatamente como o dash', () => {
  let base = ''
  let comDash = ''
  let comShell = ''
  let scriptArquivo = ''

  beforeAll(() => {
    // Um `sh` em cada diretorio: um e o dash, o outro e o pid1-shell. Chamar `sh`
    // pelo PATH reproduz o chamador real — o pnpm faz `spawn('sh', ['-c', ...])`.
    base = mkdtempSync(path.join(tmpdir(), 'pid1-shell-'))
    comDash = path.join(base, 'dash')
    comShell = path.join(base, 'shell')
    mkdirSync(comDash)
    mkdirSync(comShell)
    symlinkSync(DASH, path.join(comDash, 'sh'))
    symlinkSync(path.join(REPO_ROOT, PID1_SHELL), path.join(comShell, 'sh'))
    scriptArquivo = path.join(base, 'script.sh')
    writeFileSync(scriptArquivo, 'echo arquivo-ok "$1"\n')
  })

  afterAll(() => {
    if (base !== '') rmSync(base, { recursive: true, force: true })
  })

  const rodar = (diretorio: string, args: readonly string[], input?: string) => {
    const resultado = spawnSync('sh', args, {
      env: { ...process.env, PATH: `${diretorio}${path.delimiter}${process.env.PATH ?? ''}` },
      input,
      encoding: 'utf8',
      timeout: 10_000,
    })
    return { status: resultado.status, stdout: resultado.stdout, stderr: resultado.stderr }
  }

  const casos: readonly { nome: string; args: () => readonly string[]; input?: string }[] = [
    { nome: '-c com $0 e $1 explicitos', args: () => ['-c', 'echo "$0|$1"', 'zero', 'um'] },
    { nome: '-c sem $0: o $0 e "sh"', args: () => ['-c', 'echo "$0"'] },
    { nome: 'comando simples fora do PID 1 fica com o dash', args: () => ['-c', 'echo simples'] },
    { nome: 'codigo de saida', args: () => ['-c', 'echo a; exit 3'] },
    { nome: '-e interrompe no primeiro erro', args: () => ['-e', '-c', 'false; echo nao-devia'] },
    { nome: 'comando inexistente: mensagem e 127', args: () => ['-c', 'comando-que-nao-existe-cinerie'] },
    { nome: 'script em arquivo com argumento', args: () => [scriptArquivo, 'arg'] },
    { nome: 'script pela entrada padrao', args: () => [], input: 'echo stdin-ok\n' },
  ]

  for (const caso of casos) {
    it(caso.nome, () => {
      const dash = rodar(comDash, caso.args(), caso.input)
      const shell = rodar(comShell, caso.args(), caso.input)
      expect(dash.status, 'o proprio dash respondeu').not.toBeNull()
      expect(shell).toEqual(dash)
    })
  }
})
