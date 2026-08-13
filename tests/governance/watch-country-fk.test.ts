/**
 * watch-country-fk.test.ts — A FK de pais de `watch_availability` NAO pode ser
 * afrouxada.
 *
 * Em 2026-08-13 o reprocessamento de `watch/providers` falhou em 100 de 100
 * titulos com `23503` / `watch_availability_country_code_fkey`: o payload real
 * traz 138 paises e `countries` e um dicionario com 13. A saida obvia — tornar
 * `country_code` texto livre — teria feito o incidente sumir e deixado entrar
 * codigo de pais inventado, sem nenhum sinal.
 *
 * A cura foi ESCOPO (ingerir so territorio declarado, com o descarte contado) +
 * PREFLIGHT (recusar territorio ausente do dicionario ANTES do primeiro
 * INSERT). Este arquivo trava as duas pontas: a relacao continua existindo no
 * schema, e o default de ingestao continua sendo um territorio que existe.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { COUNTRY_SEED } from '../../packages/db/src/seed-data.js'
import { DEFAULT_WATCH_TERRITORIES } from '../../services/ingestion/src/watch-providers/territories.js'

const SCHEMA = readFileSync(
  fileURLToPath(new URL('../../packages/db/prisma/schema.prisma', import.meta.url)),
  'utf8',
)

/** Corpo do `model WatchAvailability { ... }`. */
function watchAvailabilityModel(): string {
  const start = SCHEMA.indexOf('model WatchAvailability {')
  expect(start).toBeGreaterThan(-1)
  const end = SCHEMA.indexOf('\nmodel ', start + 1)
  return SCHEMA.slice(start, end === -1 ? undefined : end)
}

describe('watch_availability.country_code continua sendo FK', () => {
  it('a relacao para countries.code existe no schema', () => {
    const model = watchAvailabilityModel()
    expect(model).toContain('countryCode')
    // Se esta linha sumir, codigo de pais inventado passa a entrar em silencio.
    expect(model).toMatch(/Country\s+@relation\(fields:\s*\[countryCode\],\s*references:\s*\[code\]\)/)
  })

  it('countryCode nao virou opcional (FK opcional aceita a ausencia)', () => {
    expect(watchAvailabilityModel()).toMatch(/countryCode\s+String\s+@map\("country_code"\)/)
  })
})

describe('o territorio ingerido por default existe no dicionario', () => {
  it('DEFAULT_WATCH_TERRITORIES e subconjunto de COUNTRY_SEED', () => {
    const semeados = new Set(COUNTRY_SEED.map((c) => c.code))
    const ausentes = DEFAULT_WATCH_TERRITORIES.filter((code) => !semeados.has(code))
    // Um default fora do dicionario reproduziria o incidente na primeira
    // execucao, e a mensagem seria de driver, nao de produto.
    expect(ausentes).toEqual([])
  })

  it('CONTROLE POSITIVO: BR e o territorio que o render le', () => {
    const entityWatch = readFileSync(
      fileURLToPath(new URL('../../apps/web/src/server/entity-watch.ts', import.meta.url)),
      'utf8',
    )
    expect(entityWatch).toContain('const WATCH_COUNTRY = "BR"')
    expect(DEFAULT_WATCH_TERRITORIES).toContain('BR')
  })
})
