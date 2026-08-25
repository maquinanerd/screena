/**
 * Testes do parser da CLI (PURO: sem IO).
 *
 * O parser e fail-loud de proposito: o bug que ele existe para evitar e o
 * `--flag valor` aceito como "flag sem valor", que fez um piloto rodar contra a
 * fila errada sem avisar ninguem.
 */

import { describe, expect, it } from 'vitest'
import {
  CATALOG_COMMANDS,
  isValidIsoDate,
  parseCatalogArgs,
  requiresDryRunOrApply,
} from '../args.js'
import { EXIT_CODES, evaluateCatalogGate, redactSecrets } from '../exit.js'
import { renderHelp } from '../help.js'

/** Extrai a invocacao de um parse que deve ter dado certo. */
function ok(argv: string[]) {
  const result = parseCatalogArgs(argv)
  if (!result.ok) throw new Error(`esperava sucesso, veio erro: ${result.error}`)
  if (result.help) throw new Error('esperava invocacao, veio help')
  return result.invocation
}

/** Extrai a mensagem de um parse que deve ter falhado. */
function err(argv: string[]): string {
  const result = parseCatalogArgs(argv)
  if (result.ok) throw new Error('esperava erro, veio sucesso')
  return result.error
}

describe('parseCatalogArgs — comandos', () => {
  it('sem argumentos pede ajuda geral', () => {
    const result = parseCatalogArgs([])
    expect(result).toEqual({ ok: true, help: true, command: null })
  })

  it('--help pede ajuda geral', () => {
    expect(parseCatalogArgs(['--help'])).toEqual({ ok: true, help: true, command: null })
  })

  it('comando --help pede ajuda do comando', () => {
    expect(parseCatalogArgs(['worker', '--help'])).toEqual({
      ok: true,
      help: true,
      command: 'worker',
    })
  })

  it('recusa comando desconhecido citando os validos', () => {
    const message = err(['bootstrapp'])
    expect(message).toMatch(/comando desconhecido: "bootstrapp"/)
    expect(message).toMatch(/bootstrap/)
  })

  it('aceita todos os comandos declarados', () => {
    for (const command of CATALOG_COMMANDS) {
      const result = parseCatalogArgs([command, '--help'])
      expect(result.ok, `comando ${command} rejeitado`).toBe(true)
    }
  })
})

describe('parseCatalogArgs — flags', () => {
  it('aceita --flag=valor e --flag valor', () => {
    expect(ok(['sync', '--entity=movie', '--id=603', '--apply']).flags.id).toBe(603)
    expect(ok(['sync', '--entity', 'movie', '--id', '603', '--apply']).flags.entity).toBe('movie')
  })

  it('recusa flag desconhecida', () => {
    expect(err(['worker', '--turbo'])).toMatch(/flag desconhecida: --turbo/)
  })

  it('recusa valor faltante em vez de cair em default silencioso', () => {
    // O bug original: `--entity` sem valor virava "entity=null" e o comando
    // seguia com o default. Aqui falha alto.
    expect(err(['sync', '--id', '1', '--entity'])).toMatch(/--entity exige valor/)
    expect(err(['sync', '--entity', '--id', '1'])).toMatch(/--entity exige valor/)
  })

  it('recusa inteiro invalido', () => {
    expect(err(['worker', '--concurrency', 'muitos'])).toMatch(/--concurrency exige inteiro/)
    expect(err(['worker', '--concurrency', '-1'])).toMatch(/--concurrency exige inteiro/)
    expect(err(['worker', '--concurrency', '1.5'])).toMatch(/--concurrency exige inteiro/)
  })

  it('recusa data invalida e data inexistente', () => {
    expect(err(['changes', '--entity', 'movie', '--from', '16-07-2026'])).toMatch(/data YYYY-MM-DD/)
    expect(err(['changes', '--entity', 'movie', '--from', '2026-02-31'])).toMatch(/data YYYY-MM-DD/)
  })

  it('recusa valor em flag booleana (--apply=false seria armadilha)', () => {
    expect(err(['sync', '--entity', 'movie', '--id', '1', '--apply=false'])).toMatch(
      /booleana --apply nao aceita valor/,
    )
  })

  it('recusa valor vazio', () => {
    expect(err(['sync', '--entity=', '--id', '1'])).toMatch(/valor vazio/)
  })
})

describe('parseCatalogArgs — validacao cruzada', () => {
  it('recusa --dry-run junto com --apply', () => {
    expect(err(['sync', '--entity', 'movie', '--id', '1', '--dry-run', '--apply'])).toMatch(
      /mutuamente exclusivos/,
    )
  })

  it('comando que muta exige --dry-run ou --apply', () => {
    expect(err(['sync', '--entity', 'movie', '--id', '603'])).toMatch(/--dry-run.*--apply/s)
    expect(err(['bootstrap'])).toMatch(/muta estado/)
  })

  it('comando somente-leitura recusa --apply', () => {
    expect(err(['status', '--apply'])).toMatch(/somente-leitura/)
    expect(err(['audit-database', '--apply'])).toMatch(/somente-leitura/)
  })

  it('worker nao exige --apply (sua acao E processar)', () => {
    expect(requiresDryRunOrApply('worker', null)).toBe(false)
    expect(ok(['worker', '--concurrency', '4']).command).toBe('worker')
  })

  it('recusa janela invertida', () => {
    expect(
      err(['changes', '--entity', 'movie', '--from', '2026-07-16', '--to', '2026-07-15', '--apply']),
    ).toMatch(/janela invalida/)
  })

  it('exige as flags obrigatorias por comando', () => {
    expect(err(['changes', '--apply'])).toMatch(/exige --entity/)
    expect(err(['discovery', '--entity', 'movie', '--apply'])).toMatch(/exige --list/)
    expect(err(['discovery', '--list', 'popular', '--apply'])).toMatch(/exige --entity/)
    expect(err(['episodes', '--apply'])).toMatch(/exige --id/)
    expect(err(['media', '--entity', 'movie', '--apply'])).toMatch(/exige --id/)
    expect(err(['sync', '--entity', 'movie', '--apply'])).toMatch(/--id.*--ids-file/s)
    expect(err(['enqueue', '--apply'])).toMatch(/exige o tipo de job/)
  })

  it('recusa --json com --human', () => {
    expect(err(['status', '--json', '--human'])).toMatch(/mutuamente exclusivos/)
  })

  it('recusa concurrency 0 no worker', () => {
    expect(err(['worker', '--concurrency', '0'])).toMatch(/>= 1/)
  })
})

describe('parseCatalogArgs — dead-letter', () => {
  it('exige subcomando valido', () => {
    expect(err(['dead-letter', 'nuke'])).toMatch(/subcomando desconhecido/)
    expect(parseCatalogArgs(['dead-letter'])).toEqual({
      ok: true,
      help: true,
      command: 'dead-letter',
    })
  })

  it('list e leitura; replay muta e exige --apply', () => {
    expect(ok(['dead-letter', 'list', '--limit', '20']).subcommand).toBe('list')
    expect(err(['dead-letter', 'replay'])).toMatch(/muta estado/)
    expect(ok(['dead-letter', 'replay', '--apply']).subcommand).toBe('replay')
  })

  it('recusa --limit=0 no replay (nao reprocessaria nada)', () => {
    expect(err(['dead-letter', 'replay', '--limit', '0', '--apply'])).toMatch(/nao reprocessaria/)
  })
})

describe('isValidIsoDate', () => {
  it('aceita data real e recusa data impossivel', () => {
    expect(isValidIsoDate('2026-07-16')).toBe(true)
    expect(isValidIsoDate('2024-02-29')).toBe(true) // bissexto real
    expect(isValidIsoDate('2026-02-29')).toBe(false) // 2026 nao e bissexto
    expect(isValidIsoDate('2026-13-01')).toBe(false)
    expect(isValidIsoDate('2026-7-1')).toBe(false)
  })
})

describe('evaluateCatalogGate', () => {
  const url = 'postgres://u:p@h/db'

  it('bloqueia sem DATABASE_URL', () => {
    const result = evaluateCatalogGate({
      env: {},
      mutates: false,
      confirmProductionRead: true,
      force: true,
    })
    expect(result).toMatchObject({ ok: false, reason: 'no-database-url' })
  })

  it('libera fora de producao', () => {
    expect(
      evaluateCatalogGate({
        env: { NODE_ENV: 'development', DATABASE_URL: url },
        mutates: true,
        confirmProductionRead: false,
        force: false,
      }),
    ).toEqual({ ok: true })
  })

  it('escrita em producao exige --force', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: url }
    expect(
      evaluateCatalogGate({ env, mutates: true, confirmProductionRead: false, force: false }),
    ).toMatchObject({ ok: false, reason: 'production-write' })
    expect(
      evaluateCatalogGate({ env, mutates: true, confirmProductionRead: false, force: true }),
    ).toEqual({ ok: true })
  })

  it('leitura em producao exige --confirm-production-read', () => {
    const env = { NODE_ENV: 'production', DATABASE_URL: url }
    expect(
      evaluateCatalogGate({ env, mutates: false, confirmProductionRead: false, force: false }),
    ).toMatchObject({ ok: false, reason: 'production-read' })
    expect(
      evaluateCatalogGate({ env, mutates: false, confirmProductionRead: true, force: false }),
    ).toEqual({ ok: true })
  })
})

describe('redactSecrets', () => {
  it('remove a DATABASE_URL inteira', () => {
    const env = { DATABASE_URL: 'postgres://user:s3cr3t@host:5432/db' }
    const text = `falhou ao conectar em ${env.DATABASE_URL} (timeout)`
    const out = redactSecrets(text, env)

    expect(out).not.toContain('s3cr3t')
    expect(out).not.toContain('postgres://user')
    expect(out).toContain('<DATABASE_URL:redacted>')
  })

  it('remove a senha de connection string mesmo sem env (erro de driver ecoa a URL)', () => {
    const out = redactSecrets('P1001: cannot reach postgres://admin:hunter2@db:5432/screena', {})

    expect(out).not.toContain('hunter2')
    expect(out).toContain('<redacted>')
  })
})

describe('renderHelp', () => {
  it('a ajuda geral lista todos os comandos', () => {
    const help = renderHelp(null)
    for (const command of CATALOG_COMMANDS) {
      expect(help, `ajuda nao cita ${command}`).toContain(command)
    }
  })

  it('todo comando tem ajuda com exemplo real', () => {
    for (const command of CATALOG_COMMANDS) {
      const help = renderHelp(command)
      expect(help.length, `${command} sem ajuda`).toBeGreaterThan(50)
      // Ajuda sem exemplo copiavel obriga a adivinhar a combinacao valida.
      expect(help, `${command} sem exemplo`).toContain('pnpm catalog')
    }
  })
})

describe('EXIT_CODES', () => {
  it('sao estaveis (script de operacao decide por eles)', () => {
    expect(EXIT_CODES).toEqual({
      ok: 0,
      usage: 2,
      blocked: 3,
      failed: 4,
      // O freio de mudanca em massa do `index-decisions`. Code PROPRIO porque o
      // ciclo horario precisa distinguir "o produtor quebrou" de "o produtor se
      // recusou de proposito"; ver tests/governance/catalog-mass-change-brake.
      massChangeBlocked: 5,
      error: 1,
    })
  })
})

describe('parseCatalogArgs — freio de mudanca em massa (index-decisions)', () => {
  it('--confirm-mass-change e booleana e vem desligada por default', () => {
    expect(ok(['index-decisions', '--apply']).flags.confirmMassChange).toBe(false)
    expect(ok(['index-decisions', '--apply', '--confirm-mass-change']).flags.confirmMassChange).toBe(
      true,
    )
  })

  it('--confirm-mass-change=false nao existe (booleana nao aceita valor)', () => {
    // Aceitar `=false` como presenca seria a pior armadilha possivel numa flag
    // cujo unico proposito e autorizar.
    expect(err(['index-decisions', '--apply', '--confirm-mass-change=false'])).toContain(
      'nao aceita valor',
    )
  })

  it('os tetos entram como inteiros', () => {
    const flags = ok([
      'index-decisions',
      '--dry-run',
      '--max-flips',
      '25',
      '--max-flip-percent=2',
    ]).flags
    expect(flags.maxFlips).toBe(25)
    expect(flags.maxFlipPercent).toBe(2)
  })

  it('--max-flip-percent acima de 100 e erro (e porcentagem, nao fracao)', () => {
    // Sem isto, `--max-flip-percent 0.05` viraria erro de inteiro e
    // `--max-flip-percent 500` viraria um teto que nunca dispara.
    expect(err(['index-decisions', '--dry-run', '--max-flip-percent=101'])).toContain(
      'porcentagem de 0 a 100',
    )
  })

  it('as flags do freio sao RECUSADAS em outro comando', () => {
    // Aceitar calado faria o operador acreditar que aplicou um teto onde nao ha
    // freio nenhum.
    expect(err(['search-reindex', '--apply', '--confirm-mass-change'])).toContain(
      'so vale em "index-decisions"',
    )
    expect(err(['worker', '--max-flips=10'])).toContain('so valem em "index-decisions"')
  })

  it('index-decisions continua exigindo --dry-run ou --apply', () => {
    expect(err(['index-decisions', '--confirm-mass-change'])).toContain('muta estado')
  })
})
