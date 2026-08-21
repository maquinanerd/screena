/**
 * Teste de governanca — TODO `provider_api` que uma fila do agendador escreve
 * PRECISA existir em `api_providers`.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE TESTE EXISTE PARA IMPEDIR
 * ============================================================================
 * `api_sync_logs.provider_api` e `api_cache.provider_api` tem FK para
 * `api_providers.key`. A fila `discovery` grava com o literal 'tmdb-exports'
 * (services/sync/src/scheduler/rhythms.ts) e essa chave NUNCA esteve no
 * registro de fornecedores: em producao, todo INSERT de registro de execucao da
 * descoberta morria em `api_sync_logs_provider_api_fkey` — desde que o
 * agendador nasceu.
 *
 * O sintoma nao pareceu erro de banco. Pareceu fila ociosa: como `readLastRuns`
 * deriva o ultimo sucesso de `api_sync_logs`, a linha perdida fazia a fila
 * reportar NUNCA RODOU no painel e vencer de novo em todo tick, enquanto o
 * trabalho de fato rodava. Uma FK quebrada disfarcada de fila parada.
 *
 * ============================================================================
 * POR QUE DUAS ASSERCOES, E NAO UMA
 * ============================================================================
 * A invariante tem DOIS portadores, e conferir so um foi exatamente como o
 * defeito chegou em producao:
 *
 *   1. `API_PROVIDER_SEED` — entrega a linha em banco NOVO (`db:seed`).
 *   2. as migrations        — entregam a linha no banco que JA EXISTE.
 *
 * O release de producao roda `prisma migrate deploy` e NAO roda `db:seed`
 * (Dockerfile). Um teste que olhasse so a semente ficaria verde para banco novo
 * com producao continuando quebrada.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { API_PROVIDER_SEED } from '@screena/db'

import { readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

import { RHYTHMS } from '../../services/sync/src/scheduler/rhythms.js'

const migrationsDir = path.join(REPO_ROOT, 'packages', 'db', 'prisma', 'migrations')

/**
 * Os fornecedores que ja estavam na semente ANTES de esta regra existir, e que
 * portanto o banco de producao recebeu pelo `db:seed` do bootstrap.
 *
 * Esta lista e CONGELADA: ela nao cresce. Fornecedor novo referenciado pelo
 * agendador tem de chegar por migration — a pressao aponta para o lado certo.
 * Acrescentar chave aqui e conceder a si mesmo a excecao que criou o defeito.
 */
const BOOTSTRAPPED_BEFORE_THIS_RULE: readonly string[] = [
  'tmdb',
  'gemini',
  'imdb236',
  'rapidapi_film_show_ratings',
  'omdb',
  'streaming_availability',
]

/** As chaves que o agendador escreve. `null` = fila derivada, que nao grava. */
const SCHEDULER_PROVIDER_KEYS: readonly string[] = [
  ...new Set(
    RHYTHMS.map((rhythm) => rhythm.providerApi).filter((key): key is string => key !== null),
  ),
]

/**
 * As chaves que as migrations realmente INSEREM em `api_providers`.
 *
 * COMENTARIO NAO CONTA. A primeira versao deste teste procurava o literal no
 * texto inteiro do arquivo e ficou VERDE com a migration mutada, porque o
 * proprio comentario da migration cita a chave em prosa. Um guard que casa com
 * a EXPLICACAO do conserto em vez do conserto certifica o defeito.
 *
 * A remocao de comentario vem da PORTA UNICA (`tests/support/source-text.ts`),
 * nao de um `replace` local. A versao artesanal que morava aqui apagava todo
 * `--` da linha — inclusive um `--` DENTRO de string SQL, que nao e comentario.
 * Nenhuma migration tem esse caso hoje; a primeira que tivesse perderia o valor
 * em silencio, e o guard passaria a nao casar com nada (que tambem fica verde).
 */
function providerKeysInsertedByMigrations(): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let code: string
    try {
      code = readSourceWithoutComments(path.join(migrationsDir, entry.name, 'migration.sql'))
    } catch {
      continue
    }
    for (const statement of code.matchAll(/INSERT\s+INTO\s+"?api_providers"?[\s\S]*?;/gi)) {
      for (const literal of statement[0].matchAll(/'([^']*)'/g)) {
        const value = literal[1]
        if (value !== undefined) keys.add(value)
      }
    }
  }
  return keys
}

describe('agendador x api_providers: nenhuma fila escreve fornecedor inexistente', () => {
  it('a tabela de ritmos declara pelo menos um fornecedor (o teste nao pode medir o vazio)', () => {
    // Sem isto, esvaziar RHYTHMS deixaria as asercoes abaixo verdes sobre
    // conjunto vazio — um guard que passa por nao ter o que conferir.
    expect(SCHEDULER_PROVIDER_KEYS.length).toBeGreaterThan(0)
  })

  it('todo provider_api de fila do agendador tem linha em API_PROVIDER_SEED', () => {
    const seeded = new Set(API_PROVIDER_SEED.map((provider) => provider.key))
    const orphans = SCHEDULER_PROVIDER_KEYS.filter((key) => !seeded.has(key))
    // A mensagem nomeia o ofensor: quem quebrar isto ve a chave, nao um booleano.
    expect(orphans, `provider_api sem linha em api_providers: ${orphans.join(', ')}`).toEqual([])
  })

  it('fornecedor fora do bootstrap chega ao banco EXISTENTE por migration, nao so por seed', () => {
    // `prisma migrate deploy` e o unico comando do release. Chave que so vive na
    // semente conserta banco novo e deixa producao exatamente como esta.
    const bootstrapped = new Set(BOOTSTRAPPED_BEFORE_THIS_RULE)
    const inserted = providerKeysInsertedByMigrations()
    const undelivered = SCHEDULER_PROVIDER_KEYS.filter(
      (key) => !bootstrapped.has(key) && !inserted.has(key),
    )
    expect(
      undelivered,
      `sem INSERT em migration (producao continuaria quebrada): ${undelivered.join(', ')}`,
    ).toEqual([])
  })

  it("a linha de 'tmdb-exports' carrega os valores que o codigo espera", () => {
    // O caso concreto que originou a regra, conferido campo a campo: um nome ou
    // um `kind` trocado passaria na asercao de conjunto acima e ainda assim
    // descreveria errado o fornecedor.
    const provider = API_PROVIDER_SEED.find((entry) => entry.key === 'tmdb-exports')
    expect(provider).toBeDefined()
    expect(provider?.kind).toBe('data')
    expect(provider?.name).toBe('TMDB Daily ID Exports')
    expect(provider?.homepageUrl).toBe('https://files.tmdb.org/p/exports')
  })

  it("'tmdb-exports' e um fornecedor SEPARADO de 'tmdb' (cota propria, sem token)", () => {
    // Colapsar os dois faria a descoberta debitar de um teto que ela nao consome:
    // os exports sao arquivos publicos em files.tmdb.org, fora da API.
    const keys = API_PROVIDER_SEED.map((entry) => entry.key)
    expect(keys).toContain('tmdb')
    expect(keys).toContain('tmdb-exports')
  })
})
