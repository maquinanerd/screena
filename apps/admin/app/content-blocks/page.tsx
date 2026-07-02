import type { ReactNode } from "react";

import {
  contentBlockBadgeVariant,
  contentBlockStatusLabel,
  formatIsoDate,
} from "../../src/lib/editorial-status";
import {
  CONTENT_BLOCK_TYPES,
  ENTITY_TYPES,
  hasContentBlockFilters,
  parseContentBlockFilters,
  reviewBucketLabel,
  type ContentBlockFilters,
  type RawSearchParams,
} from "../../src/lib/editorial-filters";
import { getContentBlockListData } from "../../src/server/content-blocks";

/**
 * Listagem de content_blocks com FILTROS via search params e link "Revisar" para
 * o detalhe. Read-only nesta tela: filtros sao apenas links; a escrita
 * (review_status) acontece so na pagina de detalhe. `force-dynamic`: nunca toca o
 * banco no build.
 */
export const dynamic = "force-dynamic";

type Dimension = "status" | "language" | "entityType" | "blockType";

interface Chip {
  label: string;
  value: string | null;
}

const STATUS_CHIPS: readonly Chip[] = [
  { label: "Todos", value: null },
  { label: "Pendentes", value: "pending" },
  { label: "Aprovados", value: "approved" },
  { label: "Bloqueados", value: "blocked" },
];

const LANGUAGE_CHIPS: readonly Chip[] = [
  { label: "Todos", value: null },
  { label: "pt-BR", value: "pt-BR" },
  { label: "en", value: "en" },
  { label: "es", value: "es" },
];

const ENTITY_CHIPS: readonly Chip[] = [
  { label: "Todos", value: null },
  ...ENTITY_TYPES.map((value) => ({ label: value, value })),
];

const BLOCK_TYPE_CHIPS: readonly Chip[] = [
  { label: "Todos", value: null },
  ...CONTENT_BLOCK_TYPES.map((value) => ({ label: value, value })),
];

/** Monta o href de `/content-blocks` preservando os filtros e sobrescrevendo um. */
function buildHref(
  filters: ContentBlockFilters,
  patch: Partial<Record<Dimension, string | null>>,
): string {
  const merged = {
    status: filters.statusBucket,
    language: filters.language,
    entityType: filters.entityType,
    blockType: filters.blockType,
    ...patch,
  };
  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.language) params.set("language", merged.language);
  if (merged.entityType) params.set("entityType", merged.entityType);
  if (merged.blockType) params.set("blockType", merged.blockType);
  const qs = params.toString();
  return qs === "" ? "/content-blocks" : `/content-blocks?${qs}`;
}

function FilterGroup({
  title,
  chips,
  active,
  filters,
  dimension,
}: {
  title: string;
  chips: readonly Chip[];
  active: string | null;
  filters: ContentBlockFilters;
  dimension: Dimension;
}): ReactNode {
  return (
    <div className="admin-filter-group">
      <span className="admin-filter-group__title">{title}</span>
      <div className="admin-filter-chips">
        {chips.map((chip) => {
          const isActive = chip.value === active;
          return (
            <a
              key={chip.label}
              className={`admin-chip${isActive ? " admin-chip--active" : ""}`}
              href={buildHref(filters, { [dimension]: chip.value })}
            >
              {chip.label}
            </a>
          );
        })}
      </div>
    </div>
  );
}

export default async function AdminContentBlocksPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const filters = parseContentBlockFilters(sp);
  const data = await getContentBlockListData(filters);
  const filtered = hasContentBlockFilters(filters);

  return (
    <>
      <p className="admin-notice">
        Diagnostico do estado de revisao de cada bloco editorial. Use os filtros e o link
        <strong> Revisar</strong> para abrir o bloco e alterar o <code>review_status</code>.
      </p>

      <div className="admin-filters">
        <FilterGroup title="Status" chips={STATUS_CHIPS} active={filters.statusBucket} filters={filters} dimension="status" />
        <FilterGroup title="Idioma" chips={LANGUAGE_CHIPS} active={filters.language} filters={filters} dimension="language" />
        <FilterGroup title="entity_type" chips={ENTITY_CHIPS} active={filters.entityType} filters={filters} dimension="entityType" />
        <FilterGroup title="block_type" chips={BLOCK_TYPE_CHIPS} active={filters.blockType} filters={filters} dimension="blockType" />
      </div>

      <h2 className="admin-section-title">
        Content blocks ({data.shown} de {data.total} {filtered ? "no filtro" : "no total"})
      </h2>
      {data.total > data.shown ? (
        <p className="admin-meta">Exibindo os {data.limit} blocos mais recentes.</p>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="admin-table-wrap">
          <p className="admin-empty">
            {filtered
              ? `Nenhum bloco para o filtro (${reviewBucketLabel(filters.statusBucket)}${filters.language ? `, ${filters.language}` : ""}${filters.entityType ? `, ${filters.entityType}` : ""}${filters.blockType ? `, ${filters.blockType}` : ""}).`
              : "Nenhum content block encontrado."}
          </p>
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
                <th>Acao</th>
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
                  <td>
                    <a className="admin-link-action" href={`/content-blocks/${row.id}`}>
                      Revisar
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
