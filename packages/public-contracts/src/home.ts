/**
 * home.ts — Contratos de home e descoberta (Backend A, §13/§8).
 *
 * EntityCard e o cartao reutilizavel das listagens/home. `screenScore` e a nota
 * editorial PROPRIA do Screen (escala 5), NUNCA um AggregateRating de terceiro
 * (invariantes 1/2). DiscoveryPayload projeta um snapshot de descoberta
 * (trending/popular/etc) para exibicao — nunca chama API externa no render.
 */

import {
  isRecord,
  optionalString,
  requireArray,
  requireEnum,
  requireNumberOrNull,
  requireString,
  fail,
  ok,
  type ValidationResult,
} from './validation.js'
import {
  mediaAssetErrors,
  PUBLIC_ENTITY_KINDS,
  type PublicEntityKind,
  type PublicMediaAsset,
} from './primitives.js'

/** Cartao de entidade para home/listagens/descoberta. */
export interface EntityCard {
  readonly kind: PublicEntityKind
  readonly id: string
  readonly title: string
  readonly href: string
  readonly subtitle: string | null
  readonly year: number | null
  readonly image: PublicMediaAsset | null
  /** Nota editorial PROPRIA do Screen (escala 5) ou null. Nunca de terceiro. */
  readonly screenScore: number | null
}

/** Payload da home publica. */
export interface HomePayload {
  readonly locale: string
  readonly hero: readonly EntityCard[]
  readonly trending: readonly EntityCard[]
  readonly upcoming: readonly EntityCard[]
}

/** Payload de uma superficie de descoberta (projecao de snapshot). */
export interface DiscoveryPayload {
  readonly listType: string
  readonly entityType: PublicEntityKind
  readonly locale: string
  readonly country: string | null
  readonly capturedAt: string | null
  readonly items: readonly EntityCard[]
}

/** Erros de um EntityCard. */
export function entityCardErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label}: esperado objeto`]
  const errors = [
    ...requireEnum(value.kind, `${label}.kind`, PUBLIC_ENTITY_KINDS),
    ...requireString(value.id, `${label}.id`),
    ...requireString(value.title, `${label}.title`),
    ...requireString(value.href, `${label}.href`),
    ...optionalString(value.subtitle, `${label}.subtitle`),
    ...requireNumberOrNull(value.year, `${label}.year`),
    ...requireNumberOrNull(value.screenScore, `${label}.screenScore`),
  ]
  if (value.image !== null) errors.push(...mediaAssetErrors(value.image, `${label}.image`))
  return errors
}

/** Valida um HomePayload. */
export function validateHomePayload(input: unknown): ValidationResult<HomePayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...requireString(input.locale, 'locale'),
    ...requireArray(input.hero, 'hero', (i, n) => entityCardErrors(i, `hero[${n}]`)),
    ...requireArray(input.trending, 'trending', (i, n) => entityCardErrors(i, `trending[${n}]`)),
    ...requireArray(input.upcoming, 'upcoming', (i, n) => entityCardErrors(i, `upcoming[${n}]`)),
  ]
  return errors.length === 0 ? ok(input as unknown as HomePayload) : fail(errors)
}

/** Valida um DiscoveryPayload. */
export function validateDiscoveryPayload(input: unknown): ValidationResult<DiscoveryPayload> {
  if (!isRecord(input)) return fail(['esperado objeto'])
  const errors = [
    ...requireString(input.listType, 'listType'),
    ...requireEnum(input.entityType, 'entityType', PUBLIC_ENTITY_KINDS),
    ...requireString(input.locale, 'locale'),
    ...optionalString(input.country, 'country'),
    ...optionalString(input.capturedAt, 'capturedAt'),
    ...requireArray(input.items, 'items', (i, n) => entityCardErrors(i, `items[${n}]`)),
  ]
  return errors.length === 0 ? ok(input as unknown as DiscoveryPayload) : fail(errors)
}
