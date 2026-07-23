/**
 * Governanca ESTRUTURAL da finalizacao de detalhe (`sync_details`).
 *
 * `catalog-services.ts` e um adapter Prisma: nao da para exercita-lo em teste
 * unitario sem banco. Mas as tres guardas da finalizacao sao regras que, se
 * caírem, quebram em PRODUCAO e em silencio — entao ficam travadas por leitura
 * do arquivo, que e barato e nao precisa de Postgres.
 *
 * As guardas, e o que cada uma evita:
 *
 *  1. `entityId === null` -> nao finaliza. No short-circuit de cache nao houve
 *     upsert; nao existe id para receber slug.
 *  2. titulo vazio -> nao finaliza. Slug vazio vira URL invalida que o sitemap
 *     publica e o render nao resolve.
 *  3. idioma nao registrado em `languages` -> nao finaliza. `slugs.language_code`
 *     e `entity_translations.language_code` tem FK para `languages`, que so tem
 *     os idiomas do seed (pt-BR/en/es). O `--locale` do TMDB e BCP-47 completo
 *     (`en-US`, `es-ES`). Sem a guarda, `catalog sync --locale en-US` estoura FK
 *     e derruba o job inteiro — um comando que funcionava antes da finalizacao
 *     existir. Esta e a guarda ANTI-REGRESSAO.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  path.join(here, '..', 'persistence', 'catalog-services.ts'),
  'utf8',
)

/** Corpo da funcao `finalizeDetail`, do cabecalho ate a chave de fechamento. */
function finalizeDetailBody(): string {
  const start = source.indexOf('async function finalizeDetail(')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n  }', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('finalizeDetail — guardas da finalizacao de detalhe', () => {
  it('(1) nao finaliza sem entityId (short-circuit de cache nao tem id)', () => {
    expect(finalizeDetailBody()).toContain('entityId === null')
  })

  it('(2) nao finaliza com titulo vazio (slug vazio = URL invalida)', () => {
    expect(finalizeDetailBody()).toMatch(/display\.title\.trim\(\) === ''/)
  })

  it('(3) ANTI-REGRESSAO: checa o idioma antes de escrever slug/traducao', () => {
    // Casar o ESTADO DE CONTROLE, nao o identificador: o comentario logo acima
    // da guarda tambem cita `isRegisteredLanguage`, entao um `indexOf` do nome
    // continuaria verde mesmo com o `if` deletado — teste que nao falha nao
    // protege nada. Exigimos o early-return de verdade.
    const body = finalizeDetailBody()
    const guardPattern = /if \(!\(await isRegisteredLanguage\([A-Za-z]+\)\)\) return/
    expect(body).toMatch(guardPattern)

    const guard = body.search(guardPattern)
    const slugWrite = body.indexOf('await finalize.upsertCanonicalSlug')
    const translationWrite = body.indexOf('await finalize.upsertTranslation')
    expect(slugWrite).toBeGreaterThan(-1)
    expect(translationWrite).toBeGreaterThan(-1)
    // A checagem precisa vir ANTES das duas escritas, senao a FK ja estourou.
    expect(guard).toBeLessThan(slugWrite)
    expect(guard).toBeLessThan(translationWrite)
  })

  it('(4) a checagem de idioma consulta `languages` e memoiza', () => {
    expect(source).toContain('async function isRegisteredLanguage(')
    expect(source).toMatch(/prisma\.language\.findUnique/)
    expect(source).toContain('knownLanguages')
  })

  it('(5) as tres entidades publicaveis finalizam (movie, tv, person)', () => {
    for (const kind of ['movie', 'tv', 'person']) {
      expect(source).toContain(`await finalizeDetail('${kind}'`)
    }
  })

  it('(6) a finalizacao usa o adapter que ja existia, sem reimplementar slug', () => {
    // Reimplementar a regra de slug/301 aqui seria duplicacao da parte mais
    // sutil do catalogo. `finalizeDetail` DEVE delegar ao adapter compartilhado.
    expect(finalizeDetailBody()).toContain('createPrismaCatalogFinalize')
    expect(finalizeDetailBody()).toContain('desiredCatalogSlug')
  })
})
