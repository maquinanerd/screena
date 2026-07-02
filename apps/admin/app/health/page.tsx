import type { ReactNode } from "react";

import { getHealthData } from "../../src/server/health";

/**
 * Health do admin (SOMENTE LEITURA).
 *
 * Mostra se o banco respondeu e contagens basicas. NUNCA imprime DATABASE_URL,
 * tokens ou a mensagem crua do erro. `force-dynamic`: nunca toca o banco no build.
 */
export const dynamic = "force-dynamic";

export default async function AdminHealthPage(): Promise<ReactNode> {
  const health = await getHealthData();

  return (
    <>
      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Diagnostico de conectividade e volume. Nenhum
        segredo (DATABASE_URL, tokens) e exibido aqui.
      </p>

      <h2 className="admin-section-title">Banco de dados</h2>
      <p>
        Status:{" "}
        <span className={`admin-badge admin-badge--${health.dbOk ? "ok" : "blocked"}`}>
          {health.dbOk ? "Conectado" : "Sem conexao"}
        </span>
      </p>
      {!health.dbOk ? (
        <p className="admin-meta">Falha de conexao ({health.errorLabel ?? "desconhecida"}).</p>
      ) : null}

      {health.counts !== null ? (
        <>
          <h2 className="admin-section-title">Contagens basicas</h2>
          <div className="admin-cards">
            <div className="admin-card">
              <div className="admin-card__value">{health.counts.articleTranslations}</div>
              <div className="admin-card__label">Versoes de artigo</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__value">{health.counts.contentBlocks}</div>
              <div className="admin-card__label">Content blocks</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__value">{health.counts.movies}</div>
              <div className="admin-card__label">Filmes</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__value">{health.counts.tvShows}</div>
              <div className="admin-card__label">Series</div>
            </div>
            <div className="admin-card">
              <div className="admin-card__value">{health.counts.people}</div>
              <div className="admin-card__label">Pessoas</div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
