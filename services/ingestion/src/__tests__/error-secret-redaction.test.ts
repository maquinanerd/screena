/**
 * O que chega a `last_error_safe` nao pode trazer segredo junto.
 *
 * ESTE ARQUIVO E A CONTRAPARTIDA DA #226.
 * Enquanto `toSafeError` decapitava a mensagem na primeira quebra de linha,
 * quase nada chegava ao banco — e a redacao era um problema teorico. Depois que
 * a decapitacao foi consertada, a cadeia de `cause` INTEIRA passa a ser gravada,
 * e nela cabe:
 *
 *  - a connection string que o Prisma ecoa em erro de conexao (a #218 ja tinha
 *    documentado esse comportamento ao redigir o `stderr` de processo filho);
 *  - token de API vindo de um erro de client HTTP.
 *
 * Uma coluna chamada `last_error_safe` que guarda a senha do banco nao e
 * "quase segura". Consertar o silencio sem redigir teria trocado um defeito de
 * observabilidade por um de seguranca.
 *
 * Todos os casos abaixo sao controles negativos: reprovam sem a redacao.
 */

import { describe, expect, it } from 'vitest'
import { toSafeError } from '../catalog-jobs/worker.js'
import { redactSecrets } from '../cli/exit.js'

/** Forma real de um erro do Prisma que ecoa a URL de conexao. */
const PRISMA_COM_URL =
  "\nInvalid `prisma.movie.upsert()` invocation:\n\n\n" +
  'Error validating datasource `db`: the URL ' +
  'postgresql://cinerie:s3nh4Sup3rSecreta@db.interno:5432/cinerie is unreachable'

describe('last_error_safe nao vaza segredo', () => {
  it('mascara a senha embutida na URL que o Prisma ecoa', () => {
    const { safe } = toSafeError(new Error(PRISMA_COM_URL))

    expect(safe).not.toContain('s3nh4Sup3rSecreta')
    // O diagnostico sobrevive: quem le ainda sabe QUAL operacao e QUAL banco.
    expect(safe).toContain('prisma.movie.upsert()')
    expect(safe).toContain('postgresql://')
  })

  it('mascara token de API, preservando o NOME da variavel', () => {
    const { safe } = toSafeError(
      new Error('falha ao autenticar: TMDB_READ_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiJ9.payload'),
    )

    expect(safe).not.toContain('eyJhbGciOiJIUzI1NiJ9.payload')
    expect(safe).toContain('TMDB_READ_ACCESS_TOKEN')
  })

  it('mascara o TOKEN depois de Bearer, nao so a palavra', () => {
    const { safe } = toSafeError(new Error('recusado: authorization: Bearer abc.def.ghi'))

    expect(safe).not.toContain('abc.def.ghi')
  })

  it('redige tambem a cadeia de `cause`, nao so a casca', () => {
    const causa = new Error('conexao recusada em postgresql://user:senhaDaCausa@host:5432/db')
    const { safe } = toSafeError(new Error('sync_details falhou', { cause: causa }))

    expect(safe).not.toContain('senhaDaCausa')
    expect(safe).toContain('sync_details falhou')
  })

  it('redige valor lancado que NAO e Error', () => {
    const { safe } = toSafeError('caiu com API_KEY=chaveNoThrowCru')

    expect(safe).not.toContain('chaveNoThrowCru')
  })

  /**
   * A ordem importa e este e o teste que a prova. O segredo fica no COMECO,
   * dentro da janela que o truncamento preserva; se `redactSecrets` rodasse
   * depois de `clampSafeText`, um segredo cortado ao meio pelo corte escaparia
   * do padrao e sobreviveria em pedacos.
   */
  it('redige ANTES de truncar', () => {
    const { safe } = toSafeError(new Error(`API_KEY=segredoNoComeco\n${'x'.repeat(1_000)}`))

    expect(safe).not.toContain('segredoNoComeco')
    expect(safe).toContain('API_KEY=<redacted>')
  })

  /**
   * CONTROLE POSITIVO: sem ele, uma funcao que devolvesse string vazia passaria
   * em todos os `not.toContain` acima.
   */
  it('CONTROLE POSITIVO: erro sem segredo atravessa intacto', () => {
    const { safe } = toSafeError(new Error('Foreign key constraint failed on `slugs_entity_id_fkey`'))

    expect(safe).toBe('Foreign key constraint failed on `slugs_entity_id_fkey`')
  })
})

describe('redactSecrets', () => {
  it('e idempotente: aplicar duas vezes nao muda o resultado', () => {
    const uma = redactSecrets(PRISMA_COM_URL)

    expect(redactSecrets(uma)).toBe(uma)
  })

  it('nao mascara texto inocente que apenas MENCIONA a palavra chave', () => {
    // Sem `=` ou `:` nao ha valor a mascarar — falso positivo aqui apagaria
    // diagnostico legitimo.
    expect(redactSecrets('a API_KEY expirou ontem')).toBe('a API_KEY expirou ontem')
  })
})
