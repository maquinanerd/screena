import type { ReactNode } from "react";

import { getDashboardData } from "../src/server/dashboard";

/**
 * Dashboard do admin editorial.
 *
 * Este painel de visao geral e SOMENTE LEITURA: mostra contagens REAIS lidas do
 * PostgreSQL local (zero API externa). As ACOES editoriais controladas (alterar
 * review_status / index_status) ficam nas telas de detalhe, alcancadas pelo link
 * "Revisar" nas listagens ou pelas filas abaixo, e so funcionam quando a flag
 * `ADMIN_EDITORIAL_ACTIONS_ENABLED=true`.
 *
 * `force-dynamic`: renderiza sob demanda, nunca no build (nao toca o banco durante
 * `next build`).
 */
export const dynamic = "force-dynamic";

interface CountCard {
  label: string;
  value: number;
  href?: string;
}

function Cards({ cards }: { cards: CountCard[] }): ReactNode {
  return (
    <div className="admin-cards">
      {cards.map((card) =>
        card.href !== undefined ? (
          <a className="admin-card admin-card--link" key={card.label} href={card.href}>
            <div className="admin-card__value">{card.value}</div>
            <div className="admin-card__label">{card.label} →</div>
          </a>
        ) : (
          <div className="admin-card" key={card.label}>
            <div className="admin-card__value">{card.value}</div>
            <div className="admin-card__label">{card.label}</div>
          </div>
        ),
      )}
    </div>
  );
}

export default async function AdminDashboardPage(): Promise<ReactNode> {
  const data = await getDashboardData();
  const actions = data.editorialActions;

  const articleCards: CountCard[] = [
    { label: "Pendentes de revisao", value: data.articleReview.pending, href: "/articles?status=pending" },
    { label: "Aprovados (review)", value: data.articleReview.approved, href: "/articles?status=approved" },
    { label: "Bloqueados", value: data.articles.blocked, href: "/articles?status=blocked" },
    { label: "Versoes (traducoes) totais", value: data.articles.total },
  ];

  const blockCards: CountCard[] = [
    { label: "Pendentes de revisao", value: data.contentBlocks.pending, href: "/content-blocks?status=pending" },
    { label: "Aprovados (review)", value: data.contentBlocks.publishable, href: "/content-blocks?status=approved" },
    { label: "Bloqueados/arquivados", value: data.contentBlocks.blocked, href: "/content-blocks?status=blocked" },
    { label: "Content blocks totais", value: data.contentBlocks.total },
  ];

  return (
    <>
      <p className="admin-notice">
        <strong>Modo somente leitura</strong> neste painel de visao geral. Contagens reais do
        PostgreSQL local (banco vazio aparece como zero). As acoes editoriais controladas ficam
        nas telas de detalhe (link <strong>Revisar</strong>).
      </p>

      <div
        className={`admin-flag admin-flag--${actions.enabled ? "on" : "off"}`}
        role="status"
      >
        <span className="admin-flag__caption">Acoes editoriais</span>
        <span className={`admin-badge admin-badge--${actions.enabled ? "ok" : "hold"}`}>
          {actions.enabled ? "Habilitadas" : "Desativadas por ambiente"}
        </span>
        <span className="admin-flag__note">
          Controladas por <code>{actions.envKey}</code> (valor nunca exibido).
        </span>
      </div>

      <h2 className="admin-section-title">Workflow editorial</h2>
      <div className="admin-cards">
        <a className="admin-card admin-card--link" href="/workflow">
          <div className="admin-card__title">Abrir workflow →</div>
          <div className="admin-card__label">
            Revisar, indexar e aprovar em lote pequeno (ate 20 por acao).
          </div>
        </a>
        <a className="admin-card admin-card--link" href="/review-queue">
          <div className="admin-card__title">Fila de revisao →</div>
          <div className="admin-card__label">
            Bloqueados, aguardando revisao e prontos para indexar.
          </div>
        </a>
        <div className="admin-card">
          <div className="admin-card__value">
            {data.articleReview.pending + data.contentBlocks.pending}
          </div>
          <div className="admin-card__label">Itens aguardando decisao</div>
        </div>
        <div className="admin-card">
          <div className="admin-card__value">
            {actions.enabled ? "Sim" : "Nao"}
          </div>
          <div className="admin-card__label">Acoes em lote habilitadas</div>
        </div>
      </div>

      <h2 className="admin-section-title">Fila de revisao — contagens</h2>
      <div className="admin-cards">
        <div className="admin-card">
          <div className="admin-card__value">{data.articles.blocked}</div>
          <div className="admin-card__label">Artigos bloqueados</div>
        </div>
        <div className="admin-card">
          <div className="admin-card__value">{data.articles.publishable}</div>
          <div className="admin-card__label">Artigos prontos p/ indexar (candidatos)</div>
        </div>
        <div className="admin-card">
          <div className="admin-card__value">{data.contentBlocks.pending}</div>
          <div className="admin-card__label">Content blocks pendentes</div>
        </div>
      </div>

      <h2 className="admin-section-title">Fila editorial — Artigos / noticias</h2>
      <Cards cards={articleCards} />
      <p className="admin-meta">
        Registros de artigo (fatos): {data.articleRecords}. Ver <a href="/articles">Artigos</a>.
      </p>

      <h2 className="admin-section-title">Fila editorial — Content blocks</h2>
      <Cards cards={blockCards} />
      <p className="admin-meta">
        Ver <a href="/content-blocks">Content blocks</a>.
      </p>

      <h2 className="admin-section-title">Operacao e seguranca</h2>
      <div className="admin-cards">
        <a className="admin-card admin-card--link" href="/security">
          <div className="admin-card__title">Segurança do Admin</div>
          <div className="admin-card__label">
            Verifique proteção, ambiente, credenciais e o estado das ações editoriais sem expor
            secrets.
          </div>
        </a>
      </div>
    </>
  );
}
