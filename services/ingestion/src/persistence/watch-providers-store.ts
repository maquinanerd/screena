/**
 * watch-providers-store.ts — Adapters Prisma do reprocessamento de
 * `watch/providers` (leitura do bruto, resolucao de entidade, escrita da oferta).
 *
 * EXCLUIDO DO TYPECHECK padrao (toca Prisma); coberto por
 * `tsconfig.runtime.json`, que inclui `services/ingestion/src/persistence/**`.
 *
 * A escrita ESPELHA `services/streaming/src/persistence/watch-store.ts`, e a
 * semelhanca e proposital: aquele adapter ja resolveu, com custo, o problema de
 * reconciliar oferta sem apagar revisao/atribuicao/historico. As unicas
 * diferencas sao o `provider_api` (`tmdb`, nao a API de streaming) e o fato de
 * o TMDB nao publicar preco, qualidade nem validade — esses campos ficam NULL,
 * nunca inventados.
 *
 * GOVERNANCA (invariante 6): toda linha nasce `display_allowed = false`. Este
 * adapter NUNCA liga exibicao e NUNCA escreve revisao (`reviewed_at`/
 * `reviewed_by`/`approved_payload_hash`). Acender continua sendo decisao humana,
 * por outro caminho (`promote-watch-availability`).
 *
 * `watch_provider_id` sai do ALIAS (`watch_provider_aliases`), nunca adivinhado
 * pelo nome exibido. Sem alias para `(provider_api='tmdb', external_key=<id>)`
 * ele fica NULL: a oferta e ingerida e auditavel, e o trigger de governanca a
 * mantem invisivel. Semear esses aliases e uma decisao de dados separada — o
 * relatorio do CLI lista os provedores vistos exatamente para embasa-la.
 *
 * ============ CREDITO: HIDRATADO NA ESCRITA, NAO NA PROMOCAO ============
 *
 * Este adapter passou a gravar tambem `license_status`, `requires_attribution`,
 * `requires_linkback`, `attribution_text`, `attribution_url` e
 * `data_usage_decision_id` — todos DERIVADOS da licenca vigente daquele provedor
 * canonico PARA ESTA ORIGEM (`source_licenses.provider_key = 'tmdb'`).
 *
 * Por que aqui e nao na promocao: o credito nao e uma decisao do revisor, e um
 * FATO da licenca, conhecido no momento da escrita. Deixa-lo para depois criava
 * um estado impossivel — a oferta chegava a CLI de promocao sem credito, era
 * recusada por `missing-attribution`, e nao havia comando algum capaz de
 * preencher o campo. Gravando aqui, o revisor ve a linha ja creditada e decide
 * so o que lhe cabe: exibir ou nao.
 *
 * O credito e o do **JustWatch**, nunca o do agregador da RapidAPI: o TMDB
 * revende dado do JustWatch e seus termos exigem essa atribuicao nominalmente.
 * O `attribution_url` vem da constante do client (fonte do dado), e NAO do
 * `web_url` — aquele e o DESTINO da oferta, outro campo, outro proposito.
 *
 * Sem licenca vigente para esta origem, os campos ficam NULL: a oferta e
 * ingerida e auditavel, e tanto o trigger quanto a CLI a recusam com um motivo
 * nomeado ("rode `pnpm legal sources apply`"). Nunca um credito inventado.
 */

import type { PrismaClient } from '@screena/db/server'
import { TMDB_PROVIDER_API, TMDB_WATCH_ATTRIBUTION_URL } from '@screena/tmdb-client'

import type { CountryRegistry } from '../watch-providers/territories.js'
import type {
  RawWatchSource,
  RawWatchSourceRow,
  ResolvedWatchEntity,
  WatchEntityResolver,
  WatchOfferStore,
  WatchProvidersEntityType,
  WatchSnapshotOutcome,
} from '../watch-providers/types.js'

/** `entityType` do reprocessamento -> `TmdbEntityKind` de `tmdb_raw`. */
const RAW_KIND_BY_ENTITY: Readonly<Record<WatchProvidersEntityType, 'movie' | 'tv'>> = {
  movie: 'movie',
  tv: 'tv',
}

/** Le o bruto ja arquivado. ZERO chamada ao TMDB. */
export function createPrismaRawWatchSource(prisma: PrismaClient): RawWatchSource {
  return {
    async count(entityType): Promise<number> {
      return prisma.tmdbRaw.count({ where: { entityType: RAW_KIND_BY_ENTITY[entityType] } })
    },
    async list(entityType, limit): Promise<readonly RawWatchSourceRow[]> {
      const rows = await prisma.tmdbRaw.findMany({
        where: { entityType: RAW_KIND_BY_ENTITY[entityType] },
        // Ordem estavel para que o `--limit` seja retomavel e reproduzivel.
        orderBy: { tmdbId: 'asc' },
        take: limit,
        select: { tmdbId: true, baseLanguage: true, payload: true },
      })
      return rows.map((row) => ({
        tmdbId: row.tmdbId,
        baseLanguage: row.baseLanguage,
        payload: row.payload,
      }))
    },
  }
}

/**
 * Preflight do dicionario `countries` — a FK que derrubou 100 de 100 titulos em
 * producao (23503 / `watch_availability_country_code_fkey`).
 *
 * O ponto NAO e afrouxar a FK: ela existe para recusar codigo de pais
 * inventado, e continua intacta. O ponto e descobrir a ausencia ANTES do
 * primeiro INSERT, com o codigo faltante NOMEADO, em vez de como excecao de
 * driver no meio do lote e com snapshot ja parcialmente escrito.
 */
export function createPrismaCountryRegistry(prisma: PrismaClient): CountryRegistry {
  return {
    async missing(codes): Promise<readonly string[]> {
      if (codes.length === 0) return []
      const rows = await prisma.country.findMany({
        where: { code: { in: [...codes] } },
        select: { code: true },
      })
      const known = new Set(rows.map((row) => row.code))
      return codes.filter((code) => !known.has(code))
    },
  }
}

/** Resolve tmdbId -> id interno. Entidade nao promovida simplesmente nao volta. */
export function createPrismaWatchEntityResolver(prisma: PrismaClient): WatchEntityResolver {
  return {
    async resolve(entityType, tmdbIds): Promise<readonly ResolvedWatchEntity[]> {
      if (tmdbIds.length === 0) return []
      const ids = [...new Set(tmdbIds)]
      if (entityType === 'movie') {
        const rows = await prisma.movie.findMany({
          where: { tmdbId: { in: ids } },
          select: { id: true, tmdbId: true },
        })
        return rows.map((row) => ({ tmdbId: row.tmdbId, entityId: row.id.toString() }))
      }
      const rows = await prisma.tvShow.findMany({
        where: { tmdbId: { in: ids } },
        select: { id: true, tmdbId: true },
      })
      return rows.map((row) => ({ tmdbId: row.tmdbId, entityId: row.id.toString() }))
    },
  }
}

/**
 * Escreve o snapshot de ofertas de (entidade, pais) para `provider_api='tmdb'`.
 *
 * Escopo reafirmado em TODO `WHERE`: linhas de outro `provider_api` (RapidAPI,
 * seed demo, curadoria) ficam intactas.
 */
export function createPrismaTmdbWatchOfferStore(prisma: PrismaClient): WatchOfferStore {
  return {
    async replaceSnapshot(input): Promise<WatchSnapshotOutcome> {
      const entityId = BigInt(input.entityId)

      return prisma.$transaction(async (tx) => {
        let upserted = 0
        for (const offer of input.offers) {
          const affected = await tx.$executeRaw`
            -- RESOLUCAO EM UMA PASSADA. O LEFT JOIN a partir de uma linha
            -- sintetica (SELECT 1) e o que garante que a CTE devolva SEMPRE
            -- exatamente uma linha: com JOIN comum, uma oferta cujo provedor nao
            -- tem alias produziria zero linhas e o INSERT nao gravaria NADA — a
            -- oferta desapareceria em silencio, o oposto da regra ("ingerida e
            -- auditavel, so nao exibivel").
            WITH resolved AS (
              SELECT
                a."provider_id"                                          AS watch_provider_id,
                l."id"                                                   AS license_id,
                COALESCE(l."license_status", 'unknown'::"LicenseStatus") AS license_status,
                COALESCE(l."requires_attribution", true)                 AS requires_attribution,
                COALESCE(l."requires_linkback", true)                    AS requires_linkback,
                l."attribution_text"                                     AS attribution_text,
                -- Linkback do CREDITO (a fonte do dado: JustWatch), nunca o
                -- destino da oferta (web_url). So acompanha um credito real.
                CASE WHEN l."id" IS NULL THEN NULL ELSE ${TMDB_WATCH_ATTRIBUTION_URL} END
                                                                         AS attribution_url,
                (
                  SELECT d."id"
                    FROM "data_usage_decisions" d
                   WHERE d."source_license_id" = l."id"
                     AND d."use_case" = 'watch_offer_display'
                     AND d."is_current"
                     AND d."stage" = 'approved_for_display'
                     AND d."display_allowed"
                     AND d."valid_from" <= now()
                     AND (d."valid_until" IS NULL OR d."valid_until" > now())
                     AND (d."territory" IS NULL OR d."territory" = ${offer.countryCode})
                   ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
                   LIMIT 1
                )                                                        AS data_usage_decision_id
              FROM (SELECT 1) AS one
              LEFT JOIN "watch_provider_aliases" a
                ON a."provider_api" = ${TMDB_PROVIDER_API}
               AND a."external_key" = ${offer.providerKey}
              LEFT JOIN "watch_providers" p ON p."id" = a."provider_id"
              -- provider_key = 'tmdb' e o filtro de PROVENIENCIA: o mesmo slug
              -- tem uma licenca por fornecedor tecnico, e sem isto a oferta do
              -- TMDB seria creditada ao agregador da RapidAPI (ou vice-versa).
              LEFT JOIN "source_licenses" l
                ON l."source_key" = p."slug"
               AND l."content_type" = 'watch_availability'
               AND l."provider_key" = ${TMDB_PROVIDER_API}
               AND l."is_current"
              ORDER BY l."id" DESC
              LIMIT 1
            )
            INSERT INTO "watch_availability" (
              "entity_type", "entity_id", "country_code", "provider_key", "provider_name",
              "external_offer_id", "package", "offer_type", "deep_link", "web_url",
              "price", "currency", "quality", "available_from", "available_until",
              "fetched_at", "stale_after", "provider_api", "display_allowed", "updated_at",
              "watch_provider_id", "license_status", "requires_attribution",
              "requires_linkback", "attribution_text", "attribution_url",
              "data_usage_decision_id"
            )
            SELECT
              ${offer.entityType}::"EntityType", ${entityId}, ${offer.countryCode},
              ${offer.providerKey}, ${offer.providerName},
              -- O TMDB nao publica id de oferta, pacote, preco, moeda, qualidade
              -- nem validade. NULL e a verdade; inventar seria pior que omitir.
              NULL, NULL, ${offer.offerType}::"OfferType",
              -- Sem deep link por oferta: o TMDB publica um link por PAIS, que
              -- vai em web_url. Derivar um deep link dele afirmaria um destino
              -- que o upstream nunca prometeu.
              NULL, ${offer.webUrl},
              NULL, NULL, NULL, NULL, NULL,
              ${input.fetchedAt}, ${input.staleAfter}, ${TMDB_PROVIDER_API},
              -- INVARIANTE 6: nasce invisivel, SEMPRE. Este adapter hidrata o
              -- credito; acender continua sendo decisao humana, por outro comando.
              false, now(),
              r.watch_provider_id, r.license_status, r.requires_attribution,
              r.requires_linkback, r.attribution_text, r.attribution_url,
              r.data_usage_decision_id
            FROM resolved r
            ON CONFLICT (watch_offer_identity_key_v1(
              "provider_api", "external_offer_id", "entity_type", "entity_id", "country_code",
              "offer_type", "provider_key", "provider_name", "package"))
            DO UPDATE SET
              "provider_name" = EXCLUDED."provider_name",
              "web_url" = EXCLUDED."web_url",
              "fetched_at" = EXCLUDED."fetched_at",
              "stale_after" = EXCLUDED."stale_after",
              "watch_provider_id" = EXCLUDED."watch_provider_id",
              -- O credito acompanha a licenca VIGENTE a cada passada: licenca
              -- revogada ou texto alterado chega aqui no ciclo seguinte.
              "license_status" = EXCLUDED."license_status",
              "requires_attribution" = EXCLUDED."requires_attribution",
              "requires_linkback" = EXCLUDED."requires_linkback",
              "attribution_text" = EXCLUDED."attribution_text",
              "attribution_url" = EXCLUDED."attribution_url",
              "data_usage_decision_id" = EXCLUDED."data_usage_decision_id",
              "updated_at" = now(),
              -- Aprovacao NUNCA e carregada para um payload diferente: se o
              -- fingerprint dos campos novos deixar de bater com o hash aprovado,
              -- a exibicao e REVOGADA nesta linha. Sem esta clausula o trigger
              -- derrubaria o sync inteiro com excecao em vez de revogar so a
              -- oferta afetada.
              --
              -- Os cinco campos de licenca entram como EXCLUDED (valor NOVO), nao
              -- como "watch_availability"."..." (valor ANTIGO): eles estao sendo
              -- escritos NESTA mesma statement. Comparar contra o valor antigo
              -- faria uma mudanca de credito passar despercebida e manteria
              -- exibivel uma oferta cuja atribuicao mudou — exatamente o que a
              -- revogacao por hash existe para impedir.
              "display_allowed" = (
                "watch_availability"."display_allowed"
                AND EXCLUDED."watch_provider_id" IS NOT NULL
                AND "watch_availability"."approved_payload_hash" IS NOT DISTINCT FROM watch_offer_payload_fingerprint_v1(
                  EXCLUDED."provider_api", EXCLUDED."external_offer_id", EXCLUDED."entity_type",
                  EXCLUDED."entity_id", EXCLUDED."country_code", EXCLUDED."offer_type",
                  EXCLUDED."provider_key", EXCLUDED."provider_name", EXCLUDED."package",
                  EXCLUDED."quality", EXCLUDED."price", EXCLUDED."currency", EXCLUDED."deep_link",
                  EXCLUDED."web_url", EXCLUDED."available_from", EXCLUDED."available_until",
                  EXCLUDED."license_status", EXCLUDED."requires_attribution",
                  EXCLUDED."requires_linkback", EXCLUDED."attribution_text",
                  EXCLUDED."attribution_url"))
          `
          upserted += Number(affected)
        }

        // Oferta que sumiu do snapshot: REVOGADA e marcada stale, nunca apagada
        // (revisao e historico preservados). Detectada pelo fetched_at do run.
        const revoked = await tx.$executeRaw`
          UPDATE "watch_availability"
          SET "display_allowed" = false, "stale_after" = now(), "updated_at" = now()
          WHERE "entity_type" = ${input.entityType}::"EntityType"
            AND "entity_id" = ${entityId}
            AND "country_code" = ${input.countryCode}
            AND "provider_api" = ${TMDB_PROVIDER_API}
            AND ("fetched_at" IS NULL OR "fetched_at" <> ${input.fetchedAt})
        `

        return { upserted, revoked: Number(revoked) }
      })
    },
  }
}
