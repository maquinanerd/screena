/**
 * language-vocabulary-migration.test.ts — O DICIONARIO DE IDIOMAS CHEGA A
 * PRODUCAO POR MIGRATION, NAO SO PELO SEED.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO EM 16/09/2026
 * ============================================================================
 * `languages` tinha 3 linhas (en, es, pt-BR). O codigo ja trabalhava com as
 * 186 de `LANGUAGE_VOCABULARY`: `normalizeOriginalLanguage` deixa passar todo
 * codigo do vocabulario e presume que a tabela o tenha. Nao tinha — o
 * vocabulario so entrava por `db:seed`, e o release roda `migrate deploy`, nunca
 * o seed. Resultado: 648 `sync_details` falhados com P2003 em
 * `movies_original_language_fkey`/`tv_shows_original_language_fkey`, e `pt`,
 * `ja` e `ko` — tres dos cinco idiomas que o recorte MANTEM — sem ter onde
 * gravar.
 *
 * Todo teste do recorte passava, porque todo banco de teste roda o seed. Nenhum
 * deles tinha como ver a diferenca entre "o seed tem" e "o banco que ja existe
 * tem". Este arquivo e essa diferenca, escrita.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 *   1. todo codigo do vocabulario tem linha em ALGUMA migration — codigo novo
 *      no vocabulario reprova ate a migration nova existir;
 *   2. os nomes da migration sao os do vocabulario;
 *   3. nenhuma linha de migration nasce publicada ou indexavel;
 *   4. todo INSERT em `languages` e ON CONFLICT DO NOTHING — migration nunca
 *      reescreve a linha que producao ja tem (os flags de `pt-BR`);
 *   5. migration nao insere codigo FORA do vocabulario — locale de autoria
 *      (`pt-BR`) e decisao de publicacao, e continua no seed.
 */

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { LANGUAGE_VOCABULARY } from '@screena/db'

import { readSourceWithoutComments, REPO_ROOT, stripComments } from '../support/source-text.js'

const MIGRATIONS_DIR = join(REPO_ROOT, 'packages/db/prisma/migrations')

/** Uma linha de `languages` como a migration a grava. */
interface MigrationLanguageRow {
  readonly code: string
  readonly namePt: string
  readonly nameEn: string
  readonly isPublished: boolean
  readonly indexDefault: boolean
  readonly migration: string
}

/** Um `INSERT INTO "languages"` encontrado numa migration. */
interface LanguageInsert {
  readonly migration: string
  readonly doNothingOnConflict: boolean
  readonly rows: readonly MigrationLanguageRow[]
}

const INSERT_STATEMENT = /INSERT\s+INTO\s+"?languages"?\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi
const SQL_STRING = String.raw`'((?:[^']|'')*)'`
const ROW = new RegExp(
  String.raw`\(\s*${SQL_STRING}\s*,\s*${SQL_STRING}\s*,\s*${SQL_STRING}\s*,\s*(true|false)\s*,\s*(true|false)\s*\)`,
  'gi',
)

const EXPECTED_COLUMNS = ['code', 'name_pt', 'name_en', 'is_published', 'index_default'] as const

function unquote(value: string): string {
  return value.replace(/''/g, "'")
}

/**
 * Le os INSERTs em `languages` de UM texto de migration JA SEM COMENTARIOS. Puro.
 *
 * Sem comentario porque o cabecalho da migration cita `INSERT` e ON CONFLICT —
 * um parser que lesse o texto cru casaria com a explicacao.
 */
function parseLanguageInserts(migration: string, sqlWithoutComments: string): LanguageInsert[] {
  const inserts: LanguageInsert[] = []
  for (const statement of sqlWithoutComments.matchAll(INSERT_STATEMENT)) {
    const columns = statement[1]!
      .replace(/"/g, '')
      .split(',')
      .map((c) => c.trim())
    // A ordem das colunas e o contrato do parser de linha. Outra ordem nao e
    // "provavelmente certa": e uma linha lida errado.
    if (columns.join(',') !== EXPECTED_COLUMNS.join(',')) {
      throw new Error(
        `${migration}: colunas de languages fora da ordem lida: ${columns.join(', ')}`,
      )
    }
    const body = statement[2]!
    const rows = [...body.matchAll(ROW)].map(
      (row): MigrationLanguageRow => ({
        code: unquote(row[1]!),
        namePt: unquote(row[2]!),
        nameEn: unquote(row[3]!),
        isPublished: row[4]!.toLowerCase() === 'true',
        indexDefault: row[5]!.toLowerCase() === 'true',
        migration,
      }),
    )
    inserts.push({
      migration,
      doNothingOnConflict: /ON\s+CONFLICT\s*\(\s*"?code"?\s*\)\s*DO\s+NOTHING\s*$/i.test(
        body.trim(),
      ),
      rows,
    })
  }
  return inserts
}

/** Os codigos do vocabulario que nenhuma migration grava. Puro. */
function vocabularyCodesMissingFrom(inserts: readonly LanguageInsert[]): string[] {
  const covered = new Set(inserts.flatMap((insert) => insert.rows.map((row) => row.code)))
  return LANGUAGE_VOCABULARY.map((entry) => entry.code).filter((code) => !covered.has(code))
}

function readAllMigrationInserts(): LanguageInsert[] {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  return dirs.flatMap((dir) =>
    parseLanguageInserts(
      dir,
      readSourceWithoutComments(join(MIGRATIONS_DIR, dir, 'migration.sql')),
    ),
  )
}

const INSERTS = readAllMigrationInserts()
const ROWS = INSERTS.flatMap((insert) => insert.rows)

describe('o vocabulario de idiomas chega ao banco que ja existe', () => {
  it('(1) todo codigo de LANGUAGE_VOCABULARY tem linha numa migration', () => {
    // Se falhar: acrescente o codigo numa migration NOVA (as antigas ja rodaram
    // em producao e nao rodam de novo).
    expect(vocabularyCodesMissingFrom(INSERTS)).toEqual([])
  })

  it('(2) o nome gravado e o do vocabulario', () => {
    const byCode = new Map(ROWS.map((row) => [row.code, row]))
    const divergentes = LANGUAGE_VOCABULARY.filter((entry) => {
      const row = byCode.get(entry.code)
      return row !== undefined && (row.namePt !== entry.namePt || row.nameEn !== entry.nameEn)
    }).map((entry) => entry.code)
    expect(divergentes).toEqual([])
  })

  it('(3) nenhuma linha de migration nasce publicada ou indexavel', () => {
    const publicadas = ROWS.filter((row) => row.isPublished || row.indexDefault).map(
      (row) => `${row.migration}:${row.code}`,
    )
    expect(publicadas).toEqual([])
  })

  it('(4) todo INSERT em languages e ON CONFLICT DO NOTHING', () => {
    // Producao tem `pt-BR` publicado e indexavel. Um upsert aqui reescreveria o
    // flag — e isso e decisao humana de publicacao, nao de migration.
    expect(INSERTS.length).toBeGreaterThan(0)
    const semProtecao = INSERTS.filter((insert) => !insert.doNothingOnConflict).map(
      (insert) => insert.migration,
    )
    expect(semProtecao).toEqual([])
  })

  it('(5) migration nao insere codigo fora do vocabulario', () => {
    const vocabulario = new Set(LANGUAGE_VOCABULARY.map((entry) => entry.code))
    const estranhos = ROWS.filter((row) => !vocabulario.has(row.code)).map(
      (row) => `${row.migration}:${row.code}`,
    )
    expect(estranhos).toEqual([])
  })

  it('(6) o parser leu linha por linha, nao so o cabecalho', () => {
    // Um parser que nao casa nenhuma tupla passaria em (2), (3) e (5) sem ler
    // nada. A contagem prende o parser ao arquivo.
    expect(ROWS.length).toBeGreaterThanOrEqual(LANGUAGE_VOCABULARY.length)
  })
})

describe('CONTROLES NEGATIVOS — o guarda reprova o que deve reprovar', () => {
  const MIGRATION = '20260916120000_language_vocabulary'
  const REAL_SQL = readSourceWithoutComments(join(MIGRATIONS_DIR, MIGRATION, 'migration.sql'))

  it('sem a linha de `ja`, (1) acusa exatamente `ja`', () => {
    const semJapones = REAL_SQL.replace(/\s*\('ja', '[^']*', '[^']*', false, false\),/, '')
    expect(semJapones).not.toBe(REAL_SQL)
    expect(vocabularyCodesMissingFrom(parseLanguageInserts(MIGRATION, semJapones))).toEqual(['ja'])
  })

  it('sem a migration inteira, (1) acusa o vocabulario inteiro', () => {
    expect(vocabularyCodesMissingFrom([])).toHaveLength(LANGUAGE_VOCABULARY.length)
  })

  it('um upsert no lugar do DO NOTHING e acusado por (4)', () => {
    const upsert = REAL_SQL.replace(
      'ON CONFLICT ("code") DO NOTHING;',
      'ON CONFLICT ("code") DO UPDATE SET "is_published" = EXCLUDED."is_published";',
    )
    expect(upsert).not.toBe(REAL_SQL)
    const [insert] = parseLanguageInserts(MIGRATION, upsert)
    expect(insert?.doNothingOnConflict).toBe(false)
  })

  it('o INSERT citado num COMENTARIO nao conta como INSERT — e o mesmo texto fora dele conta', () => {
    const insert = `INSERT INTO "languages" ("code", "name_pt", "name_en", "is_published", "index_default") VALUES ('ja', 'Japones', 'Japanese', false, false) ON CONFLICT ("code") DO NOTHING;`
    expect(parseLanguageInserts(MIGRATION, stripComments(`-- ${insert}`, 'sql'))).toEqual([])
    expect(parseLanguageInserts(MIGRATION, stripComments(insert, 'sql'))).toHaveLength(1)
  })
})
