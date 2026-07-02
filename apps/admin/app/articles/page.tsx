import type { ReactNode } from "react";

import { articleBadgeVariant, articleStatusLabel, formatIsoDate } from "../../src/lib/editorial-status";
import { getArticleListData } from "../../src/server/articles";

/**
 * Listagem read-only de versoes de artigo (article_translations).
 *
 * Somente leitura: nao ha formulario, botao de publicar/salvar/excluir nem
 * edicao. `force-dynamic`: nunca toca o banco no build.
 */
export const dynamic = "force-dynamic";

export default async function AdminArticlesPage(): Promise<ReactNode> {
  const data = await getArticleListData();

  return (
    <>
      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Diagnostico do estado editorial de cada versao de
        artigo. Nenhuma acao de escrita disponivel.
      </p>

      <h2 className="admin-section-title">Artigos ({data.shown} de {data.total})</h2>
      {data.total > data.shown ? (
        <p className="admin-meta">
          Exibindo as {data.limit} versoes mais recentes (ordenadas por atualizacao).
        </p>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="admin-table-wrap">
          <p className="admin-empty">Nenhum artigo encontrado.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Titulo</th>
                <th>Slug</th>
                <th>Idioma</th>
                <th>Status</th>
                <th>review_status</th>
                <th>index_status</th>
                <th>license_status</th>
                <th>display</th>
                <th>Publicado</th>
                <th>Atualizado</th>
                <th>Lacunas</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{row.slug}</td>
                  <td>{row.languageCode}</td>
                  <td>
                    <span className={`admin-badge admin-badge--${articleBadgeVariant(row.status)}`}>
                      {articleStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{row.reviewStatus}</td>
                  <td>{row.indexStatus}</td>
                  <td>{row.licenseStatus}</td>
                  <td>{row.displayAllowed ? "sim" : "nao"}</td>
                  <td>{formatIsoDate(row.publishedAtIso)}</td>
                  <td>{formatIsoDate(row.updatedAtIso)}</td>
                  <td className="admin-issues">{row.issues.length > 0 ? row.issues.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
