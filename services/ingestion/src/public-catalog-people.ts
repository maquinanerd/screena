/**
 * public-catalog-people.ts — Planejamento PURO dos slugs de pessoa a criar no
 * backfill de catalogo publico, a partir dos creditos (cast/crew) do TMDB.
 *
 * Motivo (P0-10): a ingestao persiste `cast_members`/`crew_members` (pessoas),
 * mas nunca criava slug de pessoa — entao `/pt/pessoas/{slug}` e os links de
 * elenco morriam na base real. Este modulo decide, de forma deterministica e
 * testavel sem banco, QUAIS pessoas creditadas ganham slug canonico pt-BR e
 * qual e o slug base de cada uma.
 *
 * Governanca: espelha `normalizeCredits` — so entra pessoa com `id` numerico
 * (nunca inventamos pessoas). Toda pessoa creditada recebe um slug NAO-vazio
 * (fallback `tmdb-{id}` quando o nome slugifica vazio), garantindo que nenhum
 * `cast_member` fique sem slug de pessoa. O bin resolve colisao (`-tmdb-{id}`)
 * contra o banco e persiste o upsert idempotente + traducao pt-BR.
 */

import type { TmdbCredits } from '@screena/tmdb-client'

import { slugify } from './public-catalog-slug.js'

/** Pessoa creditada a ganhar slug canonico pt-BR + traducao no backfill. */
export interface CreditedPersonPlan {
  /** TMDB id da pessoa (chave natural de `people`). */
  readonly tmdbId: number
  /** Nome exibivel (do credito); string vazia quando ausente. */
  readonly name: string
  /** slug base pt-BR NAO-vazio (colisao resolvida depois, contra o banco). */
  readonly baseSlug: string
}

/**
 * Deriva o plano de slugs de pessoa a partir dos creditos de um filme/serie.
 *
 * - Une cast + crew e deduplica por TMDB id (preservando a 1a aparicao).
 * - Descarta entradas sem `id` numerico (nunca inventa pessoas).
 * - Garante `baseSlug` NAO-vazio: usa o nome slugificado ou `tmdb-{id}`.
 */
export function planCreditedPeople(
  credits: TmdbCredits | null | undefined,
): CreditedPersonPlan[] {
  const seen = new Set<number>()
  const plans: CreditedPersonPlan[] = []

  const entries = [...(credits?.cast ?? []), ...(credits?.crew ?? [])]
  for (const entry of entries) {
    const tmdbId = entry?.id
    if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId)) continue
    if (seen.has(tmdbId)) continue
    seen.add(tmdbId)

    const name = (entry?.name ?? '').trim()
    const baseSlug = slugify(name) || `tmdb-${tmdbId}`
    plans.push({ tmdbId, name, baseSlug })
  }

  return plans
}
