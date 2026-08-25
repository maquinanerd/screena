/**
 * A causa de uma falha de import tem que chegar INTEIRA em `last_error_safe`.
 *
 * Este arquivo reproduz o incidente de 25/08/2026: 7.076 jobs `sync_details` em
 * `retry_wait` gravaram
 *
 *     last_error_code = "failed"
 *     last_error_safe = "importMovie(614934) falhou (failed): "
 *
 * — prefixo, dois-pontos, nada depois; e `error_class: "unknown"` na metrica. A
 * causa nao morreu em nenhum `catch`: ela foi decapitada por
 * `message.split('\n')[0]`, porque a mensagem do Prisma COMECA com `\n`.
 *
 * Cada teste aqui e um controle negativo do codigo anterior: com a
 * implementacao antiga, todos falham.
 */

import { describe, expect, it } from 'vitest'
import { assertImportOk, isUpstreamNotFound } from '../import/assert-ok.js'
import { describeError } from '../import/errors.js'
import { toSafeError } from '../catalog-jobs/worker.js'
import { classifySafeError } from '../catalog-jobs/handlers/support.js'
import { isPermanentJobError } from '../catalog-jobs/handler.js'
import { clampSafeText, errorMessageWithCauses, flattenErrorText } from '../utils/error-text.js'
import { emptyDetailWatchReport } from '../watch-providers/from-detail.js'
import type { ImportResult } from '../import/types.js'

/**
 * Erro no formato do Prisma: `name`/`code` proprios e a mensagem comecando com
 * `\n`, com o MOTIVO so na terceira linha. E essa forma que quebrava o gate.
 */
function prismaError(reason: string, code = 'P2003'): Error {
  const error = new Error(
    `\nInvalid \`prisma.movie.upsert()\` invocation:\n\n\n  ${reason}`,
  ) as Error & { code: string }
  error.name = 'PrismaClientKnownRequestError'
  error.code = code
  return error
}

/** Erro no formato do `TmdbHttpError` (mensagem de uma linha + `status`). */
function httpError(status: number): Error {
  const error = new Error(`TMDB HTTP ${status}`) as Error & { status: number }
  error.name = 'TmdbHttpError'
  error.status = status
  return error
}

/** `ImportResult` de falha montado a partir de um erro, como o import monta. */
function failedImport(error: unknown): ImportResult {
  const info = describeError(error)
  return {
    entityType: 'movie',
    tmdbId: 614934,
    status: 'failed',
    changed: false,
    created: false,
    id: null,
    quotaCost: 0,
    watch: emptyDetailWatchReport('unrecognized'),
    error: info.message,
    errorCode: info.code,
    ...(info.status === null ? {} : { errorStatus: info.status }),
  }
}

describe('utils/error-text', () => {
  it('achata quebras de linha em vez de cortar na primeira', () => {
    expect(flattenErrorText('\nInvalid invocation:\n\n\n  Foreign key violated')).toBe(
      'Invalid invocation: Foreign key violated',
    )
  })

  it('trunca pelas duas pontas: o motivo do Prisma vive no FIM', () => {
    const text = `${'C'.repeat(400)} Foreign key constraint violated on: movies_x_fkey`
    const clamped = clampSafeText(text)
    expect(clamped.length).toBeLessThanOrEqual(200)
    expect(clamped.startsWith('CCC')).toBe(true)
    expect(clamped).toContain('movies_x_fkey')
  })

  it('percorre a cadeia de cause e nao trava em ciclo', () => {
    const root = prismaError('Foreign key constraint violated')
    const wrapper = new Error('upsert do filme falhou', { cause: root })
    expect(errorMessageWithCauses(wrapper)).toBe(
      'upsert do filme falhou <- Invalid `prisma.movie.upsert()` invocation: Foreign key constraint violated',
    )

    const cyclic = new Error('a')
    cyclic.cause = cyclic
    expect(errorMessageWithCauses(cyclic)).toBe('a')
  })

  it('erro sem mensagem entra pelo nome, nunca como string vazia', () => {
    const nameless = new Error('')
    nameless.name = 'AbortError'
    expect(errorMessageWithCauses(nameless)).toBe('AbortError')
  })
})

describe('toSafeError (ultimo gate antes do banco)', () => {
  it('erro Prisma CRU nao vira mais string vazia', () => {
    const safe = toSafeError(prismaError('Foreign key constraint violated on: title_genres'))
    expect(safe.safe).not.toBe('')
    expect(safe.safe).toContain('Foreign key constraint violated')
    expect(safe.code).toBe('P2003')
  })

  it('mensagem embrulhada nao termina mais em dois-pontos vazios', () => {
    const wrapped = new Error(
      `importMovie(614934) falhou (failed): ${prismaError('Unique constraint failed on: (tmdb_id)').message}`,
    )
    const safe = toSafeError(wrapped)
    // A mensagem EXATA que 7.076 linhas gravaram.
    expect(safe.safe).not.toBe('importMovie(614934) falhou (failed): ')
    expect(safe.safe.trimEnd().endsWith(':')).toBe(false)
    expect(safe.safe).toContain('Unique constraint failed')
  })

  it('respeita o teto de 200 caracteres', () => {
    const safe = toSafeError(new Error('x'.repeat(5000)))
    expect(safe.safe.length).toBeLessThanOrEqual(200)
  })
})

describe('assertImportOk (fronteira pipeline-safe -> fila)', () => {
  it('nao troca mais o codigo do erro pelo status do import', () => {
    const result = failedImport(prismaError('Foreign key constraint violated on: title_genres'))
    let thrown: unknown
    try {
      assertImportOk(result, 'importMovie(614934)')
    } catch (error) {
      thrown = error
    }

    const safe = toSafeError(thrown)
    // Era 'failed' (o STATUS do import) nas 7.076 linhas medidas.
    expect(safe.code).toBe('P2003')
    // Era 'unknown' na metrica pelo mesmo motivo.
    expect(classifySafeError(thrown)).toBe('database')
    expect(safe.safe).toContain('Foreign key constraint violated')
    expect(safe.safe).toContain('importMovie(614934)')
  })

  it('classifica 429 do TMDB por status, nao como unknown', () => {
    const result = failedImport(httpError(429))
    let thrown: unknown
    try {
      assertImportOk(result, 'importMovie(1)')
    } catch (error) {
      thrown = error
    }
    expect(classifySafeError(thrown)).toBe('rate_limited')
    expect(toSafeError(thrown).safe).toContain('TMDB HTTP 429')
  })

  it('404 do upstream continua sendo falha PERMANENTE', () => {
    const result = failedImport(httpError(404))
    let thrown: unknown
    try {
      assertImportOk(result, 'importMovie(1754699)')
    } catch (error) {
      thrown = error
    }
    expect(isPermanentJobError(thrown)).toBe(true)
  })

  it('falha de BANCO cujo texto contem "404" nao vira dead-letter permanente', () => {
    // A mensagem do Prisma cita os argumentos da query: um titulo como
    // "Hotel 404" caia na varredura de texto e o job era condenado a
    // dead-letter como "entidade nao existe no upstream".
    const result = failedImport(
      prismaError('Unique constraint failed on the fields: title = "Hotel 404"', 'P2002'),
    )
    expect(isUpstreamNotFound(result)).toBe(false)
    let thrown: unknown
    try {
      assertImportOk(result, 'importMovie(7)')
    } catch (error) {
      thrown = error
    }
    expect(isPermanentJobError(thrown)).toBe(false)
    expect(classifySafeError(thrown)).toBe('database')
  })

  it('sucesso passa direto', () => {
    const ok: ImportResult = {
      entityType: 'movie',
      tmdbId: 1,
      status: 'success',
      changed: true,
      created: true,
      id: 'abc',
      quotaCost: 1,
      watch: emptyDetailWatchReport('empty'),
    }
    expect(assertImportOk(ok, 'importMovie(1)')).toBe(ok)
  })
})
