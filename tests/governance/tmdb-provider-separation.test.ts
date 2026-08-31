/**
 * Teste de governanca (Fase 2) — TMDB e provider_api, NUNCA rating_source.
 *
 * Reforca as invariantes 1 e 2 no codigo de ingestao:
 *  - TMDB e fornecedor tecnico (api_providers, kind=data), nao fonte editorial.
 *  - O importador TMDB NUNCA escreve em external_ratings nem trata
 *    `vote_average_tmdb` como nota editorial — o codigo de ingestao/TMDB nao
 *    referencia external_ratings/rating_source.
 *
 * Se este teste falhar, algo passou a misturar metadados TMDB com ratings
 * editoriais — corrija o codigo, nunca relaxe o teste.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RATING_SOURCES } from '@screena/config'
import { API_PROVIDER_SEED } from '@screena/db'
import { TMDB_PROVIDER_API } from '@screena/tmdb-client'

const SCAN_ROOTS = [
  resolve(process.cwd(), 'api-clients', 'tmdb', 'src'),
  resolve(process.cwd(), 'services', 'ingestion', 'src'),
]

/** Tokens que NAO podem aparecer no CODIGO de ingestao/TMDB (ratings sao outra fase). */
const FORBIDDEN: RegExp[] = [/external_ratings/i, /externalRating/, /rating_source/i, /ratingSource/]

/**
 * Excecao ESTREITA: arquivos que podem citar o NOME DA TABELA `external_ratings`,
 * e SO ele.
 *
 * O que a invariante 2 proibe e o importador TMDB tratar metadado tecnico como
 * nota editorial — escrever em `external_ratings`, ou confundir `provider_api`
 * com `rating_source`. Ela nao proibe que o catalogo SAIBA que a tabela existe.
 *
 * O recorte de idioma (2026-08-31) apaga titulos em massa. `external_ratings` e
 * uma das 24 tabelas POLIMORFICAS que nao cascateiam do titulo: se o apagamento
 * nao a nomear, a nota de um filme apagado fica orfa — e pior, a FK dela para
 * `entities` (ON DELETE RESTRICT) faz o `DELETE` do filme ABORTAR. Omitir o nome
 * para agradar um guard textual seria trocar uma invariante por um teste verde.
 *
 * A excecao e minima em duas direcoes:
 *  - vale SO para `/external_ratings/`. Os outros tres tokens
 *    (`externalRating`, `rating_source`, `ratingSource`) continuam PROIBIDOS
 *    nestes arquivos — e sao eles que carregam a semantica de nota editorial;
 *  - vale SO para estes dois caminhos, listados um a um.
 */
const TABLE_NAME_ONLY_EXCEPTIONS: readonly string[] = [
  join('services', 'ingestion', 'src', 'persistence', 'language-cutdown.ts'),
  join('services', 'ingestion', 'src', 'cli', 'help.ts'),
]

/** True quando o arquivo pode citar o nome da tabela (e nada alem disso). */
function podeCitarNomeDaTabela(relativePath: string): boolean {
  return TABLE_NAME_ONLY_EXCEPTIONS.some((allowed) => relativePath.endsWith(allowed))
}

/**
 * Remove comentarios (bloco e linha) para que a varredura mire CODIGO, nao a
 * prosa que justamente explica "nunca tratar TMDB como rating_source".
 */
function stripComments(source: string): string {
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//')
      // ignora '//' que faca parte de '://' (URLs em strings de codigo)
      if (idx > 0 && line[idx - 1] === ':') return line
      return idx >= 0 ? line.slice(0, idx) : line
    })
    .join('\n')
}

async function collectTs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue
      }
      files.push(...(await collectTs(join(dir, entry.name))))
    } else if (entry.name.endsWith('.ts')) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

describe('governanca: TMDB provider_api != rating_source (invariantes 1, 2)', () => {
  it('TMDB_PROVIDER_API e "tmdb" e existe como provider tecnico kind=data', () => {
    expect(TMDB_PROVIDER_API).toBe('tmdb')
    const provider = API_PROVIDER_SEED.find((entry) => entry.key === TMDB_PROVIDER_API)
    expect(provider?.kind).toBe('data')
  })

  it('"tmdb" nunca e uma fonte editorial (RATING_SOURCES)', () => {
    expect([...RATING_SOURCES]).not.toContain(TMDB_PROVIDER_API)
  })

  it(
    'o codigo de ingestao/TMDB nao referencia external_ratings/rating_source',
    async () => {
      const offenders: string[] = []
      for (const root of SCAN_ROOTS) {
        for (const file of await collectTs(root)) {
          const relativePath = relative(process.cwd(), file)
          const tabelaLiberada = podeCitarNomeDaTabela(relativePath)
          const content = stripComments(await readFile(file, 'utf8'))
          content.split(/\r?\n/).forEach((line, index) => {
            for (const pattern of FORBIDDEN) {
              // A excecao cobre APENAS o nome da tabela; os tokens de semantica
              // editorial seguem proibidos ate nos arquivos liberados.
              if (tabelaLiberada && pattern.source === 'external_ratings') continue
              if (pattern.test(line)) {
                offenders.push(`${relativePath}:${index + 1} -> ${line.trim()}`)
              }
            }
          })
        }
      }
      expect(offenders).toEqual([])
    },
    // TIMEOUT EXPLICITO. Este teste percorre duas arvores de fonte inteiras e le
    // cada `.ts` — dezenas de chamadas de filesystem em serie. Sozinho leva
    // ~180ms; dentro da suite completa, com centenas de arquivos de teste
    // disputando IO, ele estourava o default de 5s do vitest de forma
    // intermitente. O sintoma engana: "Test timed out in 5000ms" num teste de
    // governanca parece violacao de invariante, e nao fila de disco.
    //
    // O que muda e SO o orcamento de IO; a asercao continua identica. Mesma
    // correcao ja aplicada a `cms-isolation.test.ts` pelo mesmo motivo.
    30_000,
  )
})
