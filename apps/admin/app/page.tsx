import type { ReactNode } from "react";

import { getDashboardData } from "../src/server/dashboard";

/**
 * Dashboard do admin editorial (SOMENTE LEITURA).
 *
 * Mostra contagens REAIS lidas do PostgreSQL local (zero API externa, zero
 * publicacao). `force-dynamic`: renderiza sob demanda, nunca no build (nao toca
 * o banco durante `next build`).
 */
export const dynamic = "force-dynamic";

interface CountCard {
  label: string;
  value: number;
}

function Cards({ cards }: { cards: CountCard[] }): ReactNode {
  return (
    <div className="admin-cards">
      {cards.map((card) => (
        <div className="admin-card" key={card.label}>
          <div className="admin-card__value">{card.value}</div>
          <div className="admin-card__label">{card.label}</div>
        </div>
      ))}
    </div>
  );
}

export default async function AdminDashboardPage(): Promise<ReactNode> {
  const data = await getDashboardData();

  const articleCards: CountCard[] = [
    { label: "Registros de artigo", value: data.articleRecords },
    { label: "Versoes (traducoes) totais", value: data.articles.total },
    { label: "Versoes publicaveis", value: data.articles.publishable },
    { label: "Versoes noindex", value: data.articles.noindex },
    { label: "Versoes bloqueadas (licenca/display/revisao)", value: data.articles.blocked },
  ];

  const blockCards: CountCard[] = [
    { label: "Content blocks totais", value: data.contentBlocks.total },
    { label: "Pendentes de revisao", value: data.contentBlocks.pending },
    { label: "Publicaveis", value: data.contentBlocks.publishable },
    { label: "Bloqueados/arquivados", value: data.contentBlocks.blocked },
  ];

  return (
    <>
      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Este painel apenas visualiza o estado de revisao.
        Nao ha publicacao, edicao ou escrita no banco. Contagens sao numeros reais do PostgreSQL
        local; banco vazio aparece como zero.
      </p>

      <h2 className="admin-section-title">Artigos / noticias</h2>
      <Cards cards={articleCards} />
      <p className="admin-meta">
        Ver detalhes em <a href="/articles">Artigos</a>.
      </p>

      <h2 className="admin-section-title">Content blocks editoriais</h2>
      <Cards cards={blockCards} />
      <p className="admin-meta">
        Ver detalhes em <a href="/content-blocks">Content blocks</a>.
      </p>
    </>
  );
}
