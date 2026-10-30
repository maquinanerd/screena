/**
 * watch-display-policy.test.ts — A politica que acende oferta sozinha
 * (decisao do dono de 2026-10-29) nao pode ser mais frouxa que a CLI humana.
 *
 * Trava:
 *  - as modalidades que acendem sao EXATAMENTE as que a CLI promove
 *    (`cinema` fora); duas listas que divergem acenderiam pelo sync o que a
 *    revisao humana recusaria;
 *  - o carimbo de revisao e `automation:`, separavel de nome de pessoa;
 *  - o caminho de PRODUCAO (o import de detalhe em `catalog-services.ts`) liga a
 *    politica, e o reprocessamento do bruto NAO liga (ele promete nascer apagado).
 *
 * O comportamento contra o banco (trigger, snapshot, idade) e provado em
 * `services/ingestion/scripts/validate-watch-display-policy-real-postgres.ts`.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  AUTO_DISPLAY_COUNTRY,
  AUTO_DISPLAY_OFFER_TYPES,
  WATCH_AUTO_REVIEWER,
} from '../../services/ingestion/src/persistence/watch-display-policy.js'
import { PROMOTABLE_OFFER_TYPES } from '../../services/streaming/src/promotion/types.js'
import { PROMOTION_COUNTRY } from '../../services/streaming/src/promotion/guardrails.js'
import { readSourceWithoutComments, REPO_ROOT } from '../support/source-text.js'

describe('politica de exibicao de ofertas', () => {
  it('acende so as modalidades que a CLI humana promove', () => {
    expect([...AUTO_DISPLAY_OFFER_TYPES].sort()).toEqual([...PROMOTABLE_OFFER_TYPES].sort())
    expect(AUTO_DISPLAY_OFFER_TYPES).not.toContain('cinema')
  })

  it('acende so no pais que a CLI promove', () => {
    expect(AUTO_DISPLAY_COUNTRY).toBe(PROMOTION_COUNTRY)
  })

  it('carimba a revisao como automacao, nunca como pessoa', () => {
    expect(WATCH_AUTO_REVIEWER.startsWith('automation:')).toBe(true)
  })

  it('o import de detalhe liga a politica; o reprocessamento do bruto nao', () => {
    const services = readSourceWithoutComments(
      path.join(REPO_ROOT, 'services/ingestion/src/persistence/catalog-services.ts'),
    )
    expect(services).toMatch(/createPrismaTmdbWatchOfferStore\(prisma,\s*\{\s*autoDisplay:\s*true/)

    const reprocess = readSourceWithoutComments(
      path.join(REPO_ROOT, 'services/ingestion/bin/reprocess-watch-providers.ts'),
    )
    expect(reprocess).not.toMatch(/autoDisplay/)
  })
})
