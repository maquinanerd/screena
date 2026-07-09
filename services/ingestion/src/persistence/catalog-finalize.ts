/**
 * catalog-finalize.ts — Finalizacao editorial de catalogo (Prisma). EXCLUIDO do
 * typecheck.
 *
 * Concentra a logica IDEMPOTENTE de slug canonico pt-BR (+ Redirect 301 em troca
 * de canonico) e de traducao pt-BR (title/summary) — a MESMA que o backfill
 * (`bin/ingest-public-catalog.ts`) e a promocao de `tmdb_raw`
 * (`bin/promote-tmdb-raw.ts`) precisam. Extraida para ca (P0-00f #7) para os dois
 * bins REUSAREM em vez de DUPLICAR a regra de 301 (sutil e facil de divergir).
 *
 * Puro-de-decisao (slugify/sufixo/rota) fica em `public-catalog-slug.ts`; aqui
 * mora so o que exige o banco (colisao real, transacao, 301).
 */

import type { PrismaClient } from '@screena/db/server'
import { entityRoutePath, withTmdbSuffix, type CatalogEntityType } from '../public-catalog-slug.js'
import type { CatalogFinalizePort } from '../raw-promote/types.js'

/** Idioma default do catalogo (invariante 7: pt-BR primeiro). */
const DEFAULT_LANGUAGE = 'pt-BR'

/**
 * Upsert IDEMPOTENTE do slug canonico de UMA entidade + Redirect 301 quando o
 * canonico muda. Fecha o loop do P0-10: re-sync/re-promocao nao duplica canonico
 * nem quebra URL.
 *
 * Passos:
 *  1. Colisao: se o slug desejado ja pertence a OUTRA entidade, desambigua com
 *     sufixo `-tmdb-{id}` (deterministico — estavel entre execucoes).
 *  2. Se o canonico atual desta entidade ja e esse slug -> no-op (idempotente).
 *  3. Senao, em transacao: despromove o canonico antigo, promove o novo e grava
 *     Redirect 301 do path antigo para o novo (colapsando cadeias e sem
 *     transformar o novo canonico em origem de redirect — evita loop/self-redirect).
 *
 * Devolve o slug efetivamente persistido (com sufixo, se houve colisao).
 */
export async function upsertCanonicalSlug(
  prisma: PrismaClient,
  entityType: CatalogEntityType,
  entityId: bigint,
  desiredSlug: string,
  tmdbId: number,
  language: string = DEFAULT_LANGUAGE,
): Promise<string> {
  // (1) Colisao: o slug base ja e de OUTRA entidade? Entao sufixa por tmdbId.
  const taken = await prisma.slug.findUnique({
    where: {
      entityType_languageCode_slug: { entityType, languageCode: language, slug: desiredSlug },
    },
    select: { entityId: true },
  })
  const slug =
    taken !== null && taken.entityId !== entityId ? withTmdbSuffix(desiredSlug, tmdbId) : desiredSlug

  // (2) Canonico atual desta entidade (pode divergir do slug alvo).
  const current = await prisma.slug.findFirst({
    where: { entityType, entityId, languageCode: language, isCanonical: true },
    select: { slug: true },
  })
  if (current?.slug === slug) return slug // idempotente: nada muda

  // (3) Troca de canonico em transacao: despromove antigo, promove novo, grava 301.
  await prisma.$transaction(async (tx) => {
    if (current !== null) {
      await tx.slug.updateMany({
        where: { entityType, entityId, languageCode: language, isCanonical: true },
        data: { isCanonical: false },
      })
    }
    await tx.slug.upsert({
      where: { entityType_languageCode_slug: { entityType, languageCode: language, slug } },
      update: { entityId, isCanonical: true },
      create: { entityType, entityId, languageCode: language, slug, isCanonical: true },
    })

    if (current !== null && current.slug !== slug) {
      const fromPath = entityRoutePath(entityType, current.slug)
      const toPath = entityRoutePath(entityType, slug)
      if (fromPath !== toPath) {
        // O novo canonico nao pode continuar sendo origem de redirect (evita loop).
        await tx.redirect.deleteMany({ where: { fromPath: toPath } })
        // Colapsa cadeias: quem apontava para o path antigo passa a apontar ao novo.
        await tx.redirect.updateMany({ where: { toPath: fromPath }, data: { toPath } })
        await tx.redirect.upsert({
          where: { fromPath },
          update: { toPath, statusCode: 301, languageCode: language, reason: 'slug_change' },
          create: { fromPath, toPath, statusCode: 301, languageCode: language, reason: 'slug_change' },
        })
      }
    }
  })
  return slug
}

/** Upsert IDEMPOTENTE da traducao (title/summary) de uma entidade, por idioma. */
export async function upsertEntityTranslation(
  prisma: PrismaClient,
  entityType: CatalogEntityType,
  entityId: bigint,
  title: string,
  summary: string | null,
  language: string = DEFAULT_LANGUAGE,
): Promise<void> {
  await prisma.entityTranslation.upsert({
    where: {
      entityType_entityId_languageCode: { entityType, entityId, languageCode: language },
    },
    update: { title, summary },
    create: { entityType, entityId, languageCode: language, title, summary },
  })
}

/**
 * Adapter do `CatalogFinalizePort` (para a orquestracao pura de promocao). Aceita
 * o `entityId` como string (BigInt serializado do `EntityStorePort`) e converte
 * para bigint na fronteira do Prisma.
 */
export function createPrismaCatalogFinalize(
  prisma: PrismaClient,
  language: string = DEFAULT_LANGUAGE,
): CatalogFinalizePort {
  return {
    upsertCanonicalSlug(entityType, entityId, desiredSlug, tmdbId) {
      return upsertCanonicalSlug(prisma, entityType, BigInt(entityId), desiredSlug, tmdbId, language)
    },
    async upsertTranslation(entityType, entityId, title, summary) {
      await upsertEntityTranslation(prisma, entityType, BigInt(entityId), title, summary, language)
    },
  }
}
