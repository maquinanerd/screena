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
import { resolveDisplayAllowed } from '@screena/schemas'

import type { ExternalRatingUpsertOutcome, ExternalRatingsPort } from '../ports.js'
import type { ExternalRatingRow } from '../film-show-ratings/types.js'
import type { RatingCreditLookup } from './rating-credit-lookup.js'

/**
 * Identidade gravada em `reviewed_by` quando a exibicao e ligada pela POLITICA,
 * e nao por uma pessoa olhando a linha.
 *
 * Decisao do proprietario (2026-08-11): a exibicao passa a ser automatica desde
 * que o credito exigido pela licenca esteja satisfeito. A autoridade continua
 * sendo humana — e a licenca de `services/legal/src/authorization-spec.ts`,
 * decidida por `DECIDED_BY` — mas quem CARIMBA cada linha e o worker.
 *
 * O prefixo `automation:` e deliberado e nunca deve ser removido: `reviewed_by`
 * antes afirmava "uma pessoa revisou ESTA linha". Agora afirma "esta linha
 * passou pela politica X". Uma auditoria precisa conseguir separar os dois com
 * um `LIKE 'automation:%'`, sem adivinhar por formato de nome.
 */
export const RATINGS_AUTO_REVIEWER = 'automation:ratings-sync/display-policy-v1'

/** `Decimal` do Prisma vira `number` para comparacao (escalas pequenas, seguras). */
function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Opcoes do store. Sem `credits`, o comportamento e o fail-closed historico. */
export interface ExternalRatingsStoreOptions {
  /**
   * Resolve o credito da fonte. AUSENTE => nenhuma linha e promovida (o store
   * se comporta exatamente como antes desta feature). Fail-closed por omissao.
   */
  readonly credits?: RatingCreditLookup
  /**
   * Para onde vai o diagnostico. Nenhum caminho de falha desta feature retorna
   * vazio em silencio: ou promove, ou diz por que nao promoveu.
   */
  readonly log?: (message: string) => void
}

/**
 * Liga a exibicao de UMA nota, se e somente se a politica permitir.
 *
 * Roda DEPOIS do upsert fail-closed, nunca no lugar dele: a linha sempre nasce
 * `display_allowed=false` e so entao e considerada para exibicao. Se este passo
 * falhar por qualquer motivo, a linha continua exatamente como nasceu — nao ha
 * estado parcial possivel.
 */
async function applyDisplayDecision(
  prisma: PrismaClient,
  row: ExternalRatingRow,
  options: ExternalRatingsStoreOptions,
): Promise<void> {
  const { credits, log } = options
  if (credits === undefined) return

  const license = await credits.find(row.ratingSource)
  const decision = resolveDisplayAllowed(
    {
      sourceKey: row.ratingSource,
      // Exibir uma NOTA e exibir o numero: a licenca precisa de `score_allowed`.
      needsScorePermission: true,
      // `score_type` null = critics/audience nao classificados (invariante 1).
      classified: row.scoreType !== null,
    },
    license === null
      ? null
      : {
          ...license,
          // O linkback de uma nota e a URL DAQUELA nota na fonte. A licenca nao
          // tem essa coluna — ela e por linha.
          attributionUrl: row.ratingUrl,
        },
  )

  if (!decision.displayAllowed) {
    // B9: nada de descarte silencioso. Uma nota que nao acende TEM de dizer
    // por que — senao "a pagina esta vazia" vira investigacao as cegas.
    log?.(
      `[ratings] nao exibida ${row.ratingSource}/${row.metric} entidade ${row.entityType}:${row.entityId} — ${decision.reason}: ${decision.detail}`,
    )
    return
  }

  // O hash sai de uma funcao DO BANCO, nunca reimplementada em TS.
  //
  // ATENCAO ao que e `$n` e o que e `r."..."` dentro do fingerprint: os campos
  // de licenca estao sendo ESCRITOS neste mesmo UPDATE, e em Postgres um
  // `r."license_status"` na clausula SET le o valor ANTIGO. Passar `r."..."`
  // ali gravaria um hash do payload PRE-atualizacao; o trigger recomputa com os
  // valores novos, os dois nao bateriam e o UPDATE inteiro abortaria. Por isso
  // licenca/atribuicao entram como parametro ($1..$5) e so os campos NAO
  // tocados aqui (nota, escala, provider...) vem de `r."..."`.
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "external_ratings" r
          SET "license_status" = $1::"LicenseStatus",
              "requires_attribution" = $2,
              "requires_linkback" = $3,
              "attribution_text" = $4,
              "attribution_url" = $5,
              "data_usage_decision_id" = $6,
              "reviewed_at" = now(),
              "reviewed_by" = $7,
              "display_allowed" = true,
              "approved_payload_hash" = external_rating_payload_fingerprint_v1(
                r."entity_type", r."entity_id", r."rating_source", r."metric",
                r."score_type", r."rating_label", r."rating_value", r."rating_scale",
                r."rating_count", r."rating_url", r."provider_api",
                $1::"LicenseStatus", $2, $3, $4, $5),
              "updated_at" = now()
        WHERE r."entity_type" = $8::"EntityType"
          AND r."entity_id" = $9
          AND r."rating_source" = $10
          AND r."metric" = $11`,
      license!.licenseStatus,
      license!.requiresAttribution,
      license!.requiresLinkback,
      license!.attributionText,
      row.ratingUrl,
      BigInt(license!.usageDecisionId as string),
      RATINGS_AUTO_REVIEWER,
      row.entityType,
      BigInt(row.entityId),
      row.ratingSource,
      row.metric,
    )
  } catch (error) {
    // O trigger e a autoridade: se ele recusou, a politica pura e o banco
    // discordam e a linha fica NAO exibida (fail-closed). Levantar aqui mataria
    // o sync inteiro por causa de uma nota; engolir sem log esconderia uma
    // divergencia real entre as duas camadas. Logamos, alto.
    log?.(
      `[ratings] TRIGGER RECUSOU exibicao de ${row.ratingSource}/${row.metric} entidade ${row.entityType}:${row.entityId} — politica e banco divergem: ${String(error)}`,
    )
  }
}

/** Cria um `ExternalRatingsPort` apoiado em `external_ratings` via Prisma. */
export function createPrismaExternalRatings(
  prisma: PrismaClient,
  options: ExternalRatingsStoreOptions = {},
): ExternalRatingsPort {
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
          // Sem mudanca de CONTEUDO: nao reescreve a nota, nao bumpa
          // `updated_at`. Mas o relogio de frescor PRECISA andar: `fetchedAt` e
          // o "ultimo sync confiavel" que RATING_STALE_POLICY le — congela-lo
          // faria a nota expirar da vitrine (expireAfterHours) mesmo
          // re-confirmada toda semana (achado A3 da revisao adversarial).
          // SQL bruto de proposito: prisma.update bumparia `updated_at`
          // (@updatedAt e client-side). `fetched_at`/`stale_after` nao entram no
          // fingerprint, entao o display guard nao e afetado numa linha exibida.
          //
          // Datas como ISO + `::timestamptz AT TIME ZONE 'UTC'`: as colunas sao
          // timestamp SEM tz que armazenam UTC (convencao Prisma). Bindar Date
          // direto num raw grava o horario LOCAL da sessao — em servidor fora de
          // UTC o carimbo deslocaria pelo offset (o check 51 do validator pegou
          // exatamente isso rodando em -03; o CI em UTC nunca veria).
          await prisma.$executeRaw`
            UPDATE "external_ratings"
               SET "fetched_at" = ${row.fetchedAt.toISOString()}::timestamptz AT TIME ZONE 'UTC',
                   "stale_after" = ${row.staleAfter === null ? null : row.staleAfter.toISOString()}::timestamptz AT TIME ZONE 'UTC'
             WHERE "id" = ${existing.id}
          `
          // Sem mudanca de conteudo, mas a POLITICA pode ter mudado: uma
          // licenca cadastrada depois desta linha so acende aqui. Reavaliar e o
          // que faz o proximo ciclo do worker recuperar notas antigas.
          await applyDisplayDecision(prisma, row, options)
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
        // A nota MUDOU: o update acima revogou a exibicao e limpou a aprovacao.
        // Reavaliar aqui reaprova o valor NOVO — a aprovacao nunca e herdada,
        // e sempre recomputada sobre o payload atual.
        await applyDisplayDecision(prisma, row, options)
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
      // A linha NASCEU fail-closed (display=false, licenca unknown). So agora,
      // com ela ja persistida e auditavel, a politica decide se acende.
      await applyDisplayDecision(prisma, row, options)
      return { created: true, changed: true }
    },
  }
}
