import type { ReactNode } from "react";

import {
  contentBlockBadgeVariant,
  contentBlockStatusLabel,
  formatIsoDate,
} from "../../src/lib/editorial-status";
import { getContentBlockListData } from "../../src/server/content-blocks";

/**
 * Listagem read-only de content_blocks editoriais.
 *
 * Somente leitura: sem formulario, sem publicar/salvar/excluir, sem edicao. O
 * link/diagnostico de slug e omitido de proposito nesta fatia (fica como
 * referencia de entidade `entity_type:entity_id`). `force-dynamic`: nunca toca o
 * banco no build.
 */
export const dynamic = "force-dynamic";

export default async function AdminContentBlocksPage(): Promise<ReactNode> {
  const data = await getContentBlockListData();

  return (
    <>
      <p className="admin-notice">
        <strong>Modo somente leitura.</strong> Diagnostico do estado de revisao de cada bloco
        editorial. Nenhuma acao de escrita disponivel.
      </p>

      <h2 className="admin-section-title">
        Content blocks ({data.shown} de {data.total})
      </h2>
      {data.total > data.shown ? (
        <p className="admin-meta">
          Exibindo os {data.limit} blocos mais recentes (ordenados por atualizacao).
        </p>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="admin-table-wrap">
          <p className="admin-empty">Nenhum content block encontrado.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Entidade</th>
                <th>Idioma</th>
                <th>block_type</th>
                <th>Status</th>
                <th>review_status</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.entityType}:{row.entityId}
                  </td>
                  <td>{row.languageCode}</td>
                  <td>{row.blockType}</td>
                  <td>
                    <span
                      className={`admin-badge admin-badge--${contentBlockBadgeVariant(row.status)}`}
                    >
                      {contentBlockStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{row.reviewStatus}</td>
                  <td>{formatIsoDate(row.updatedAtIso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
