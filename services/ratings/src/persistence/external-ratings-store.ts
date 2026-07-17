/**
 * external-ratings-store.ts — Adapter de `external_ratings` (Prisma).
 * EXCLUIDO do typecheck (toca Prisma).
 *
 * INVARIANTE 6 (fail-closed, estrutural): `displayAllowed` e `licenseStatus` NAO
 * sao parametros. Toda linha escrita por este worker nasce
 * `display_allowed = false` e `license_status = 'unknown'`. Liberar exibicao e
 * decisao HUMANA de licenca, registrada fora daqui.
 *
 * INVARIANTE 2: `providerApi` (fornecedor tecnico) e `ratingSource` (fonte
 * editorial) sao colunas distintas, com FK para tabelas distintas. O core ja
 * passou por `validateRating` antes de chegar aqui.
 *
 * Idempotencia: unique `(entity_type, entity_id, rating_source, metric)`. Se a
 * linha existente for identica, NAO reescreve (nao bumpa `updated_at`) — apenas
 * reporta `changed: false`, conforme a regra de hash de payload.
 */

import type { PrismaClient } from '@screena/db/server'
import type { ExternalRatingUpsertOutcome, ExternalRatingsPort } from '../ports.js'
import type { ExternalRatingRow } from '../film-show-ratings/types.js'

/** `Decimal` do Prisma vira `number` para comparacao (escalas pequenas, seguras). */
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Cria um `ExternalRatingsPort` apoiado em `external_ratings` via Prisma. */
export function createPrismaExternalRatings(prisma: PrismaClient): ExternalRatingsPort {
  return {
    async upsert(row: ExternalRatingRow): Promise<ExternalRatingUpsertOutcome> {
      const where = {
        entityType_entityId_ratingSource_metric: {
          entityType: row.entityType,
          entityId: BigInt(row.entityId),
          ratingSource: row.ratingSource,
          metric: row.metric,
        },
      }

      const existing = await prisma.externalRating.findUnique({ where })

      if (existing !== null) {
        // A comparacao olha o CONTEUDO DA NOTA, nao o `providerPayloadHash`.
        //
        // Por que: `providerPayloadHash` e o hash do payload BRUTO inteiro de
        // `/popular/` (rastreabilidade). Esse hash muda sempre que QUALQUER item
        // da lista muda — inclusive itens de outros filmes. Inclui-lo aqui faria
        // toda linha parecer "mudada" a cada ciclo, bumpando `updated_at` sem
        // que a nota tenha mudado — exatamente o que a regra de hash de payload
        // manda evitar ("sem mudanca, nao reescreve").
        const unchanged =
          decimalToNumber(existing.ratingValue) === row.ratingValue &&
          existing.ratingScale === row.ratingScale &&
          existing.ratingLabel === row.ratingLabel &&
          existing.ratingCount === row.ratingCount &&
          existing.ratingUrl === row.ratingUrl &&
          existing.providerApi === row.providerApi &&
          existing.scoreType === row.scoreType

        if (unchanged) {
          // Sem mudanca: nao reescreve, nao bumpa `updated_at`. O
          // `providerPayloadHash` preservado aponta para o payload que de fato
          // produziu o valor atual.
          return { created: false, changed: false }
        }

        await prisma.externalRating.update({
          where,
          data: {
            ratingLabel: row.ratingLabel,
            ratingValue: row.ratingValue,
            ratingScale: row.ratingScale,
            ratingCount: row.ratingCount,
            ratingUrl: row.ratingUrl,
            scoreType: row.scoreType,
            providerApi: row.providerApi,
            providerPayloadHash: row.providerPayloadHash,
            fetchedAt: row.fetchedAt,
            staleAfter: row.staleAfter,
            // Fail-closed: uma atualizacao NUNCA promove exibicao.
            //
            // "Mudanca revoga" (Backend B): chegamos aqui porque a nota mudou.
            // Alem de nao promover, DERRUBAMOS a exibicao e limpamos a
            // aprovacao — a nota nova nunca herda a revisao da nota velha. Sem
            // limpar `approvedPayloadHash`, o trigger recusaria este proprio
            // UPDATE (hash != fingerprint novo) e o sync quebraria; com o
            // display ja em false, o trigger nem checa, e a revogacao e limpa.
            displayAllowed: false,
            licenseStatus: 'unknown',
            approvedPayloadHash: null,
            reviewedAt: null,
            reviewedBy: null,
            dataUsageDecisionId: null,
          },
        })
        return { created: false, changed: true }
      }

      await prisma.externalRating.create({
        data: {
          entityType: row.entityType,
          entityId: BigInt(row.entityId),
          ratingSource: row.ratingSource,
          ratingLabel: row.ratingLabel,
          metric: row.metric,
          ratingValue: row.ratingValue,
          ratingScale: row.ratingScale,
          ratingCount: row.ratingCount,
          ratingUrl: row.ratingUrl,
          scoreType: row.scoreType,
          providerApi: row.providerApi,
          providerPayloadHash: row.providerPayloadHash,
          fetchedAt: row.fetchedAt,
          staleAfter: row.staleAfter,
          // Sem atribuicao confirmada, nao inventamos texto/link de credito.
          attributionText: null,
          attributionUrl: null,
          licenseStatus: 'unknown',
          displayAllowed: false,
          // A cadeia de exibicao comeca vazia. Preenche-la e ato humano
          // registrado (`pnpm ratings promote`), nunca efeito colateral de sync.
          approvedPayloadHash: null,
          reviewedAt: null,
          reviewedBy: null,
          dataUsageDecisionId: null,
        },
      })
      return { created: true, changed: true }
    },
  }
}
