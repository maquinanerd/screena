import type { Payload } from 'payload'
import React from 'react'

import type { WorkflowStatus } from '../workflow.js'

interface EditorialDashboardProps {
  readonly payload: Payload
}

async function countArticles(payload: Payload, workflowStatus: WorkflowStatus): Promise<number> {
  try {
    const result = await payload.count({
      collection: 'articles',
      where: { workflowStatus: { equals: workflowStatus } },
    })
    return result.totalDocs
  } catch {
    return 0
  }
}

async function countCollection(
  payload: Payload,
  collection: 'authors' | 'media',
): Promise<number> {
  try {
    const result = await payload.count({ collection })
    return result.totalDocs
  } catch {
    return 0
  }
}

export default async function EditorialDashboard({ payload }: EditorialDashboardProps) {
  const [drafts, needsReview, inReview, ready, published, media, authors] = await Promise.all([
    countArticles(payload, 'draft'),
    countArticles(payload, 'needs_review'),
    countArticles(payload, 'in_review'),
    countArticles(payload, 'ready_to_publish'),
    countArticles(payload, 'published'),
    countCollection(payload, 'media'),
    countCollection(payload, 'authors'),
  ])

  const autoPublishEnabled = process.env.EDITORIAL_AUTO_PUBLISH_ENABLED === 'true'

  const metrics = [
    { label: 'Rascunhos', value: drafts, tone: 'neutral' },
    { label: 'Aguardando revisão', value: needsReview, tone: 'warning' },
    { label: 'Em revisão', value: inReview, tone: 'info' },
    { label: 'Prontas para publicar', value: ready, tone: 'success' },
    { label: 'Publicadas', value: published, tone: 'brand' },
  ] as const

  return (
    <section className="cinerie-dashboard" aria-labelledby="cinerie-dashboard-title">
      <header className="cinerie-dashboard__hero">
        <div>
          <span className="cinerie-dashboard__eyebrow">Redação Cinerie</span>
          <h1 id="cinerie-dashboard-title">Central editorial</h1>
          <p>
            Crie, revise e publique matérias com o fluxo editorial governado do Cinerie.
          </p>
        </div>
        <div
          className={`cinerie-dashboard__automation ${
            autoPublishEnabled ? 'is-enabled' : 'is-disabled'
          }`}
        >
          <span className="cinerie-dashboard__automation-dot" aria-hidden="true" />
          <span>
            <strong>Autopublicação</strong>
            <small>{autoPublishEnabled ? 'Ativada' : 'Desativada'}</small>
          </span>
        </div>
      </header>

      <div className="cinerie-dashboard__metrics" aria-label="Resumo editorial">
        {metrics.map((metric) => (
          <article
            className={`cinerie-dashboard__metric is-${metric.tone}`}
            key={metric.label}
          >
            <span>{metric.label}</span>
            <strong>{metric.value.toLocaleString('pt-BR')}</strong>
          </article>
        ))}
      </div>

      <div className="cinerie-dashboard__grid">
        <article className="cinerie-dashboard__panel">
          <div className="cinerie-dashboard__panel-heading">
            <div>
              <span className="cinerie-dashboard__eyebrow">Atalhos</span>
              <h2>Começar agora</h2>
            </div>
          </div>
          <div className="cinerie-dashboard__actions">
            <a className="cinerie-dashboard__action is-primary" href="/admin/collections/articles/create">
              <span className="cinerie-dashboard__action-icon" aria-hidden="true">+</span>
              <span>
                <strong>Nova matéria</strong>
                <small>Abrir um rascunho editorial</small>
              </span>
            </a>
            <a className="cinerie-dashboard__action" href="/admin/collections/media/create">
              <span className="cinerie-dashboard__action-icon" aria-hidden="true">↑</span>
              <span>
                <strong>Enviar mídia</strong>
                <small>Adicionar imagem e licenciamento</small>
              </span>
            </a>
            <a className="cinerie-dashboard__action" href="/admin/collections/authors/create">
              <span className="cinerie-dashboard__action-icon" aria-hidden="true">A</span>
              <span>
                <strong>Novo autor</strong>
                <small>Cadastrar assinatura pública</small>
              </span>
            </a>
          </div>
        </article>

        <article className="cinerie-dashboard__panel">
          <div className="cinerie-dashboard__panel-heading">
            <div>
              <span className="cinerie-dashboard__eyebrow">Operação</span>
              <h2>Biblioteca editorial</h2>
            </div>
            <a href="/admin/collections/articles">Ver matérias</a>
          </div>
          <div className="cinerie-dashboard__library">
            <div>
              <span>Mídias cadastradas</span>
              <strong>{media.toLocaleString('pt-BR')}</strong>
            </div>
            <div>
              <span>Autores públicos</span>
              <strong>{authors.toLocaleString('pt-BR')}</strong>
            </div>
          </div>
          <ol className="cinerie-dashboard__workflow" aria-label="Fluxo editorial recomendado">
            <li><span>1</span><strong>Conteúdo</strong><small>Título, resumo e corpo</small></li>
            <li><span>2</span><strong>Mídia</strong><small>Capa, crédito e licença</small></li>
            <li><span>3</span><strong>Fontes e QA</strong><small>Lastro e validação</small></li>
            <li><span>4</span><strong>Publicação</strong><small>Revisão e estado final</small></li>
          </ol>
        </article>
      </div>
    </section>
  )
}
