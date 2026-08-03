/**
 * AutomationPanel — a janela para o MNScr. SO LEITURA.
 *
 * O MNScr e o motor externo de automacao: ele publica pelo endpoint interno
 * `/api/internal/editorial-publications`, sob o escopo `editorial_auto_publish`.
 * A integracao dele nao mora aqui e nao e mexida aqui. O que faltava era
 * enxerga-lo: ate agora, saber se a autopublicacao estava consumindo teto ou se
 * o worker de projecao tinha morrido exigia abrir o banco.
 *
 * O SINAL QUE IMPORTA e o evento mais antigo ainda nao processado. Contagem de
 * pendentes sozinha nao distingue "fila saudavel com movimento" de "worker
 * morto ha seis horas" — a IDADE do mais antigo distingue.
 *
 * ACESSO: `publication-outbox` e as duas colecoes de quota sao legiveis somente
 * por administrador (`access.ts`). Este componente roda no servidor com a Local
 * API, que IGNORA access control por padrao — entao a checagem de papel e feita
 * aqui, explicitamente, e o painel inteiro some para os demais papeis. Sem isto,
 * um redator veria a fila do lado publico.
 */

import type { Payload } from 'payload'
import React from 'react'

import { isAdministrator } from '../access.js'
import { toActor } from '../actor.js'
import {
  editorialDayWindowUtc,
  resolveAutoPublishConfig,
  type AutoPublishConfig,
} from '../env-auto-publish.js'
import { localDateForWindow } from '../quota-store.js'
import { OUTBOX_STATUSES, type OutboxStatus } from '../outbox.js'
import { QUOTA_DIMENSIONS, type QuotaDimension } from '../quota.js'

interface AutomationPanelProps {
  readonly payload: Payload
  readonly user?: unknown
}

/** Rotulo humano de cada dimensao de teto. */
const DIMENSION_LABELS: Readonly<Record<QuotaDimension, string>> = {
  global: 'Total do dia',
  content_type: 'Por tipo de conteúdo',
  section: 'Por editoria',
  author: 'Por autor',
  article_update: 'Atualizações da mesma matéria',
}

/** Rotulo humano de cada estado da fila. */
const OUTBOX_LABELS: Readonly<Record<OutboxStatus, string>> = {
  pending: 'Na fila',
  processing: 'Em projeção',
  processed: 'Projetados',
  failed: 'Falharam',
  dead_letter: 'Descartados',
}

/** O teto configurado para a dimensao, ou `null` quando nao ha teto. */
function limitFor(config: AutoPublishConfig, dimension: QuotaDimension): number | null {
  switch (dimension) {
    case 'global':
      return config.dailyLimit
    case 'content_type':
      return config.perContentTypeLimit
    case 'section':
      return config.perSectionLimit
    case 'author':
      return config.perAuthorLimit
    case 'article_update':
      return config.perArticleUpdateLimit
  }
}

async function countOutbox(payload: Payload, status: OutboxStatus): Promise<number> {
  try {
    const result = await payload.count({
      collection: 'publication-outbox',
      where: { status: { equals: status } },
    })
    return result.totalDocs
  } catch {
    return 0
  }
}

/** Instante do evento mais antigo que ainda nao foi projetado. */
async function oldestUnprocessed(payload: Payload): Promise<string | null> {
  try {
    const result = await payload.find({
      collection: 'publication-outbox',
      where: { status: { in: ['pending', 'failed'] } },
      sort: 'availableAt',
      limit: 1,
      depth: 0,
    })
    const first = result.docs[0] as { availableAt?: unknown } | undefined
    return typeof first?.availableAt === 'string' ? first.availableAt : null
  } catch {
    return null
  }
}

/** Quanto tempo faz, em palavras. */
function ageLabel(fromIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(fromIso)) / 60_000))
  if (minutes < 1) return 'agora há pouco'
  if (minutes < 60) return `há ${String(minutes)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `há ${String(hours)} h`
  return `há ${String(Math.round(hours / 24))} dias`
}

export default async function AutomationPanel({
  payload,
  user,
}: AutomationPanelProps): Promise<React.ReactElement | null> {
  // A Local API nao aplica access control: a barreira e esta linha.
  if (!isAdministrator(toActor(user))) return null

  const resolved = resolveAutoPublishConfig(process.env)
  // Configuracao invalida NAO vira painel vazio fingindo normalidade.
  if (!resolved.ok) {
    return (
      <article className="cinerie-automation is-misconfigured">
        <h2>Automação</h2>
        <p role="alert">
          A configuração da autopublicação está inválida e o painel não pode ser lido:{' '}
          {resolved.errors.join('; ')}
        </p>
      </article>
    )
  }

  const config = resolved.config
  const nowIso = new Date().toISOString()
  const nowMs = Date.parse(nowIso)
  const window = editorialDayWindowUtc(nowIso, config.timeZone)
  const localDate = localDateForWindow(nowIso, config.timeZone)

  const [counters, outboxCounts, oldest, autoPublished] = await Promise.all([
    payload
      .find({
        collection: 'autopublish-quota-counters',
        where: {
          and: [{ localDate: { equals: localDate } }, { timeZone: { equals: config.timeZone } }],
        },
        limit: 200,
        depth: 0,
      })
      .then((result) => result.docs as unknown as Record<string, unknown>[])
      .catch(() => []),
    Promise.all(OUTBOX_STATUSES.map((status) => countOutbox(payload, status))),
    oldestUnprocessed(payload),
    payload
      .count({
        collection: 'articles',
        where: {
          and: [
            { autoPublished: { equals: true } },
            { publishedAt: { greater_than: new Date(nowMs - 86_400_000).toISOString() } },
          ],
        },
      })
      .then((result) => result.totalDocs)
      .catch(() => 0),
  ])

  // Consumo por dimensao: o maior contador de cada uma. Ha uma linha por CHAVE
  // (cada autor, cada editoria), e o que se aproxima do teto e o maior — somar
  // as linhas responderia outra pergunta.
  const usage = QUOTA_DIMENSIONS.map((dimension) => {
    const rows = counters.filter((row) => row.dimensionType === dimension)
    const peak = rows.reduce((max, row) => {
      const value = typeof row.currentCount === 'number' ? row.currentCount : 0
      return value > max ? value : max
    }, 0)
    return { dimension, peak, keys: rows.length, limit: limitFor(config, dimension) }
  })

  const queue = Object.fromEntries(
    OUTBOX_STATUSES.map((status, index) => [status, outboxCounts[index] ?? 0]),
  ) as Record<OutboxStatus, number>

  const stuck = oldest !== null && nowMs - Date.parse(oldest) > 30 * 60_000

  return (
    <article className="cinerie-automation">
      <div className="cinerie-automation__heading">
        <div>
          <span className="cinerie-dashboard__eyebrow">MNScr</span>
          <h2>Automação e fila de publicação</h2>
        </div>
        <span
          className={`cinerie-automation__flag is-${config.enabled ? 'on' : 'off'}`}
        >
          {config.enabled ? 'Autopublicação ativada' : 'Autopublicação desativada'}
        </span>
      </div>

      <p className="cinerie-automation__day">
        Dia editorial {localDate} ({config.timeZone}) — janela {window.startUtcIso.slice(11, 16)}
        {' UTC'} até {window.nextStartUtcIso.slice(11, 16)} UTC. {autoPublished} matéria(s)
        autopublicada(s) nas últimas 24 h.
      </p>

      <table className="cinerie-automation__quota">
        <caption>Consumo dos tetos diários</caption>
        <thead>
          <tr>
            <th scope="col">Dimensão</th>
            <th scope="col">Maior consumo</th>
            <th scope="col">Teto</th>
            <th scope="col">Chaves ativas</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((row) => {
            const near =
              row.limit !== null && row.limit > 0 && row.peak / row.limit >= 0.8
            return (
              <tr className={near ? 'is-near-limit' : undefined} key={row.dimension}>
                <th scope="row">{DIMENSION_LABELS[row.dimension]}</th>
                <td>{row.peak}</td>
                <td>{row.limit === null ? 'sem teto' : row.limit}</td>
                <td>{row.keys}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div className="cinerie-automation__queue" aria-label="Fila de projeção">
        {OUTBOX_STATUSES.map((status) => (
          <div className={`cinerie-automation__queue-cell is-${status}`} key={status}>
            <span>{OUTBOX_LABELS[status]}</span>
            <strong>{queue[status]}</strong>
          </div>
        ))}
      </div>

      <p className={`cinerie-automation__worker is-${stuck ? 'stuck' : 'ok'}`} role="status">
        {oldest === null ? (
          <>Nenhum evento esperando projeção — a fila está limpa.</>
        ) : (
          <>
            Evento mais antigo à espera: <strong>{ageLabel(oldest, nowMs)}</strong>.{' '}
            {stuck
              ? 'Parado há tempo demais — verifique se o worker de projeção está no ar.'
              : 'Dentro do esperado para o intervalo de leitura do worker.'}
          </>
        )}
      </p>

      {queue.dead_letter > 0 ? (
        <p className="cinerie-automation__dead" role="alert">
          {queue.dead_letter} evento(s) descartado(s): o corpo não pôde ser projetado e não será
          reprocessado sozinho.
        </p>
      ) : null}
    </article>
  )
}
