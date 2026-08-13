/**
 * awards-store.ts — Adapter de `entity_awards` (Prisma).
 * EXCLUIDO do typecheck (toca Prisma).
 *
 * DOIS PASSOS, SEMPRE NESSA ORDEM — o mesmo desenho de
 * `external-ratings-store.ts`:
 *
 *   1. a linha NASCE fail-closed: `display_allowed=false`,
 *      `license_status='unknown'`, sem fonte, sem credito, sem hash aprovado.
 *      Se tudo parar aqui, o fato fica guardado para auditoria e nada aparece.
 *   2. so entao, com a linha ja persistida, a POLITICA decide se acende — e o
 *      hash aprovado sai de `entity_award_payload_fingerprint_v1`, uma funcao
 *      DO BANCO. Reimplementa-la em TypeScript produziria uma aprovacao que nao
 *      corresponde ao dado guardado.
 *
 * MUDANCA REVOGA: quando a frase muda, o UPDATE derruba a exibicao e limpa o
 * hash antes de reavaliar. Uma frase nova nunca herda a aprovacao da velha.
 *
 * IDEMPOTENTE: unique `(entity_type, entity_id, provider_api)`. Linha identica
 * nao e reescrita e `updated_at` nao e bumpado.
 */

import type { PrismaClient } from '@screena/db/server'

import type { EntityAwardsPort } from '../awards/ports.js'
import type { EntityAwardRow, EntityAwardUpsertOutcome } from '../awards/types.js'

/**
 * O que grava `entity_awards` quando a exibicao e ligada pela POLITICA (a
 * licenca registrada), e nao por alguem olhando a linha.
 *
 * Este worker NAO tem revisor por linha, e isso e deliberado: o credito de um
 * fato publico e propriedade da LICENCA, conhecida no momento da gravacao. Uma
 * revisao humana linha a linha de 41 frases identicas em forma seria teatro —
 * a decisao humana de verdade e a licenca, tomada uma vez e registrada em
 * `services/legal`.
 */
export const AWARDS_AUTO_POLICY = 'automation:awards-promotion/display-policy-v1'

/** Cria um `EntityAwardsPort` apoiado em `entity_awards` via Prisma. */
export function createPrismaEntityAwards(
  prisma: PrismaClient,
  options: { readonly log?: (message: string) => void } = {},
): EntityAwardsPort {
  /**
   * Passo 2. Devolve `true` quando a linha ficou exibivel.
   *
   * ATENCAO ao que e `$n` e o que e `a."..."` dentro do fingerprint: os campos
   * de licenca estao sendo ESCRITOS neste mesmo UPDATE, e em Postgres um
   * `a."license_status"` na clausula SET le o valor ANTIGO. Passar `a."..."` ali
   * gravaria o hash do payload PRE-atualizacao, o trigger recomputaria com os
   * valores novos e o UPDATE inteiro abortaria.
   */
  async function applyDisplay(row: EntityAwardRow): Promise<boolean> {
    if (!row.displayAllowed) return false

    await prisma.$executeRawUnsafe(
      `UPDATE "entity_awards" a
          SET "source_key" = $1,
              "license_status" = $2::"LicenseStatus",
              "requires_attribution" = $3,
              "requires_linkback" = $4,
              "attribution_text" = $5,
              "attribution_url" = $6,
              "data_usage_decision_id" = $7,
              "display_allowed" = true,
              "approved_payload_hash" = entity_award_payload_fingerprint_v1(
                a."entity_type", a."entity_id", a."provider_api", a."awards_raw",
                a."outcome", a."highlight_count", a."award_name",
                a."wins", a."nominations",
                $1, $2::"LicenseStatus", $3, $4, $5, $6),
              "updated_at" = now()
        WHERE a."entity_type" = $8::"EntityType"
          AND a."entity_id" = $9
          AND a."provider_api" = $10`,
      row.sourceKey,
      row.licenseStatus,
      row.requiresAttribution,
      row.requiresLinkback,
      row.attributionText,
      row.attributionUrl,
      row.dataUsageDecisionId === null ? null : BigInt(row.dataUsageDecisionId),
      row.entityType,
      BigInt(row.entityId),
      row.providerApi,
    )
    options.log?.(
      `[awards] exibicao ligada para ${row.entityType}:${row.entityId} — fonte "${row.sourceKey}"`,
    )
    return true
  }

  return {
    async upsert(row: EntityAwardRow): Promise<EntityAwardUpsertOutcome> {
      const where = {
        entityType_entityId_providerApi: {
          entityType: row.entityType,
          entityId: BigInt(row.entityId),
          providerApi: row.providerApi,
        },
      }

      const existing = await prisma.entityAward.findUnique({ where })

      // Os campos do FATO. Credito e exibicao NAO entram aqui: passo 2.
      const fact = {
        awardsRaw: row.awardsRaw,
        outcome: row.outcome,
        highlightCount: row.highlightCount,
        awardName: row.awardName,
        wins: row.wins,
        nominations: row.nominations,
        providerPayloadHash: row.providerPayloadHash,
        fetchedAt: row.fetchedAt,
      }

      if (existing !== null) {
        // Compara o FATO, nunca o `providerPayloadHash`: aquele e o hash do
        // payload inteiro da OMDb e muda quando qualquer campo do titulo muda
        // (nota, sinopse...), inclusive quando a frase de premios nao mudou.
        const unchanged =
          existing.awardsRaw === row.awardsRaw &&
          existing.outcome === row.outcome &&
          existing.highlightCount === row.highlightCount &&
          existing.awardName === row.awardName &&
          existing.wins === row.wins &&
          existing.nominations === row.nominations

        if (unchanged) {
          // Sem mudanca de conteudo: nao reescreve, nao bumpa `updated_at`. Mas
          // a POLITICA pode ter mudado — uma licenca cadastrada depois desta
          // linha so acende aqui, no ciclo seguinte.
          const displayed = await applyDisplay(row)
          return {
            created: false,
            changed: false,
            displayAllowed: displayed || existing.displayAllowed,
          }
        }

        await prisma.entityAward.update({
          where,
          data: {
            ...fact,
            // MUDANCA REVOGA: a frase nova nunca herda a aprovacao da velha.
            // Limpar o hash junto e necessario — com o display ja em false o
            // trigger nem checa, e a revogacao sai limpa.
            displayAllowed: false,
            licenseStatus: 'unknown',
            sourceKey: null,
            attributionText: null,
            attributionUrl: null,
            approvedPayloadHash: null,
            dataUsageDecisionId: null,
          },
        })
        const displayed = await applyDisplay(row)
        return { created: false, changed: true, displayAllowed: displayed }
      }

      await prisma.entityAward.create({
        data: {
          entityType: row.entityType,
          entityId: BigInt(row.entityId),
          ...fact,
          providerApi: row.providerApi,
          // Nasce fail-closed. Sem fonte nomeada nao ha credito possivel, e sem
          // credito nao ha faixa (invariante 6).
          sourceKey: null,
          attributionText: null,
          attributionUrl: null,
          requiresAttribution: true,
          requiresLinkback: true,
          licenseStatus: 'unknown',
          displayAllowed: false,
          approvedPayloadHash: null,
          dataUsageDecisionId: null,
        },
      })
      const displayed = await applyDisplay(row)
      return { created: true, changed: true, displayAllowed: displayed }
    },
  }
}
