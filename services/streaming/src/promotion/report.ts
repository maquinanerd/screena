/**
 * report.ts — Relatorio PURO da revisao/promocao. Sem IO, sem segredo.
 *
 * O relatorio nunca despeja a URL inteira: mostra so o HOST do deep link (via
 * `deepLinkHost`). Preco/validade/frescor aparecem em forma legivel; a decisao
 * (elegivel ou motivo) fica explicita por linha.
 */

import { deepLinkHost, PROMOTION_COUNTRY, PROMOTION_PROVIDER_API } from './guardrails.js'
import type { EvaluatedCandidate, PromotionResult, PromotionSummary, ReviewResult } from './run.js'
import type { PromotionCandidate } from './types.js'

/** Data em ISO curto (`YYYY-MM-DD`), ou `—` quando ausente. */
function isoDate(value: Date | null): string {
  if (value === null) return '—'
  const iso = value.toISOString()
  return iso.slice(0, 10)
}

/** Preco legivel: `9.9 BRL`, ou `—` quando sem preco/moeda. */
function priceLabel(candidate: PromotionCandidate): string {
  if (candidate.price === null || candidate.currency === null) return '—'
  return `${candidate.price} ${candidate.currency}`
}

/** Decisao textual de uma avaliacao. */
function decisionLabel(entry: EvaluatedCandidate): string {
  return entry.eligible ? 'elegivel' : `rejeitada: ${entry.reason ?? 'unknown'}`
}

/** Uma celula segura para tabela markdown (sem pipe cru). */
function cell(value: string | null): string {
  return (value ?? '—').replace(/\|/g, '\\|')
}

/** Linha-resumo de uma pagina de contagens (para o console). */
export function summaryLine(summary: PromotionSummary): string {
  const reasons =
    summary.byReason.length === 0
      ? '—'
      : summary.byReason.map((entry) => `${entry.reason}=${entry.count}`).join(', ')
  return `encontradas=${summary.found} · elegiveis=${summary.eligible} · rejeitadas=${summary.rejected} · motivos: ${reasons}`
}

/** Cabecalho comum de governanca (o mesmo em todo relatorio). */
function governanceLines(): string[] {
  return [
    '## Governanca',
    '',
    `- provider_api governado: \`${PROMOTION_PROVIDER_API}\` (nunca outro fornecedor).`,
    `- pais promovel: \`${PROMOTION_COUNTRY}\` apenas.`,
    '- Promocao vira `display_allowed` de `false` para `true`; nunca cria linha.',
    '- Modalidades promoveis: `subscription`, `free`, `rent`, `buy` (nunca `ads`/`cinema`/`addon`).',
    '- Deep link so `http(s)`; oferta vencida nao promove.',
    '- `screen_score`, `external_ratings` e outros providers NAO sao tocados.',
    '- Nenhuma chamada externa/RapidAPI: leitura e escrita so no PostgreSQL local.',
  ]
}

/** Renderiza o relatorio markdown da REVISAO. */
export function renderReviewReport(result: ReviewResult): string {
  const lines: string[] = []
  lines.push('# Watch Availability — revisao de candidatas')
  lines.push('')
  lines.push(
    `- tipo: \`${result.kind ?? 'movie+tv'}\` · pais: \`${result.country}\`` +
      (result.entityId === null ? '' : ` · entity_id: \`${result.entityId}\``),
  )
  lines.push(`- ${summaryLine(result.summary)}`)
  lines.push('')

  if (result.evaluated.length > 0) {
    lines.push('## Candidatas')
    lines.push('')
    lines.push(
      '| id | tipo | entity_id | titulo | provider_key | provider_name | offer_type | quality | preco | available_until | fetched_at | host | display_allowed | decisao |',
    )
    lines.push('| ---: | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const entry of result.evaluated) {
      const c = entry.candidate
      lines.push(
        `| ${c.id} | ${cell(c.entityType)} | ${c.entityId} | ${cell(c.title)} | ${cell(c.providerKey)} | ` +
          `${cell(c.providerName)} | ${cell(c.offerType)} | ${cell(c.quality)} | ${priceLabel(c)} | ` +
          `${isoDate(c.availableUntil)} | ${isoDate(c.fetchedAt)} | ${cell(deepLinkHost(c.deepLink))} | ` +
          `${c.displayAllowed ? 'sim' : 'nao'} | ${decisionLabel(entry)} |`,
      )
    }
    lines.push('')
  } else {
    lines.push('_Nenhuma candidata encontrada para este filtro._')
    lines.push('')
  }

  lines.push(...governanceLines())
  return lines.join('\n')
}

/** Renderiza o relatorio markdown da PROMOCAO/REVERSAO. */
export function renderPromotionReport(result: PromotionResult): string {
  const lines: string[] = []
  lines.push(`# Watch Availability — ${result.mode === 'revoke' ? 'reversao' : 'promocao'}`)
  lines.push('')
  lines.push(`- modo: **${result.mode}** · ${result.confirm ? '**--confirm** (mutacao real)' : 'dry-run (nada mutado)'}`)
  lines.push(`- pais: \`${result.country}\``)
  lines.push(`- ids pedidos: ${result.idsRequested.length} · encontrados: ${result.idsFound.length} · ausentes: ${result.idsMissing.length}`)
  lines.push(`- ${summaryLine(result.summary)}`)
  lines.push(`- linhas mutadas no banco: **${result.updated}**`)
  if (result.idsMissing.length > 0) {
    lines.push(`- ids ausentes (nao existem em watch_availability): ${result.idsMissing.join(', ')}`)
  }
  lines.push('')

  if (result.evaluated.length > 0) {
    lines.push('## Decisao por id')
    lines.push('')
    lines.push('| id | tipo | entity_id | titulo | provider_name | offer_type | host | display_allowed | decisao |')
    lines.push('| ---: | --- | ---: | --- | --- | --- | --- | --- | --- |')
    for (const entry of result.evaluated) {
      const c = entry.candidate
      lines.push(
        `| ${c.id} | ${cell(c.entityType)} | ${c.entityId} | ${cell(c.title)} | ${cell(c.providerName)} | ` +
          `${cell(c.offerType)} | ${cell(deepLinkHost(c.deepLink))} | ${c.displayAllowed ? 'sim' : 'nao'} | ` +
          `${decisionLabel(entry)} |`,
      )
    }
    lines.push('')
  }

  lines.push(...governanceLines())
  return lines.join('\n')
}
