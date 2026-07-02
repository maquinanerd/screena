import type { ReactNode } from "react";

import { articleBadgeVariant, articleStatusLabel, formatIsoDate } from "../../src/lib/editorial-status";
import {
  hasArticleFilters,
  parseArticleFilters,
  reviewBucketLabel,
  type ArticleFilters,
  type RawSearchParams,
} from "../../src/lib/editorial-filters";
import { getArticleListData } from "../../src/server/articles";

/**
 * Listagem de versoes de artigo (article_translations) com FILTROS via search
 * params e link "Revisar" para o detalhe. Read-only nesta tela: os filtros sao
 * apenas links (`<a href="?...">`), sem `<form>`/`<select>`; a escrita acontece
 * so na pagina de detalhe. `force-dynamic`: nunca toca o banco no build.
 */
export const dynamic = "force-dynamic";

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

const INDEX_CHIPS: readonly Chip[] = [
  { label: "Todos", value: null },
  { label: "index", value: "index" },
  { label: "noindex", value: "noindex" },
  { label: "draft", value: "draft" },
  { label: "stale", value: "stale" },
  { label: "blocked", value: "blocked" },
];

/** Monta o href de `/articles` preservando os filtros e sobrescrevendo um. */
function buildHref(filters: ArticleFilters, patch: Partial<Record<"status" | "language" | "indexStatus", string | null>>): string {
  const merged = {
    status: filters.statusBucket,
    language: filters.language,
    indexStatus: filters.indexStatus,
    ...patch,
  };
  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.language) params.set("language", merged.language);
  if (merged.indexStatus) params.set("indexStatus", merged.indexStatus);
  const qs = params.toString();
  return qs === "" ? "/articles" : `/articles?${qs}`;
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
  filters: ArticleFilters;
  dimension: "status" | "language" | "indexStatus";
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

export default async function AdminArticlesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<ReactNode> {
  const sp = await searchParams;
  const filters = parseArticleFilters(sp);
  const data = await getArticleListData(filters);
  const filtered = hasArticleFilters(filters);

  return (
    <>
      <p className="admin-notice">
        Diagnostico do estado editorial de cada versao de artigo. Use os filtros e o link
        <strong> Revisar</strong> para abrir a versao e aplicar acoes editoriais controladas.
      </p>

      <div className="admin-filters">
        <FilterGroup title="Status" chips={STATUS_CHIPS} active={filters.statusBucket} filters={filters} dimension="status" />
        <FilterGroup title="Idioma" chips={LANGUAGE_CHIPS} active={filters.language} filters={filters} dimension="language" />
        <FilterGroup title="index_status" chips={INDEX_CHIPS} active={filters.indexStatus} filters={filters} dimension="indexStatus" />
      </div>

      <h2 className="admin-section-title">
        Artigos ({data.shown} de {data.total} {filtered ? "no filtro" : "no total"})
      </h2>
      {data.total > data.shown ? (
        <p className="admin-meta">Exibindo as {data.limit} versoes mais recentes.</p>
      ) : null}

      {data.rows.length === 0 ? (
        <div className="admin-table-wrap">
          <p className="admin-empty">
            {filtered
              ? `Nenhuma versao para o filtro (${reviewBucketLabel(filters.statusBucket)}${filters.language ? `, ${filters.language}` : ""}${filters.indexStatus ? `, ${filters.indexStatus}` : ""}).`
              : "Nenhum artigo encontrado."}
          </p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Titulo</th>
                <th>Idioma</th>
                <th>Status</th>
                <th>review_status</th>
                <th>index_status</th>
                <th>display</th>
                <th>Atualizado</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{row.languageCode}</td>
                  <td>
                    <span className={`admin-badge admin-badge--${articleBadgeVariant(row.status)}`}>
                      {articleStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{row.reviewStatus}</td>
                  <td>{row.indexStatus}</td>
                  <td>{row.displayAllowed ? "sim" : "nao"}</td>
                  <td>{formatIsoDate(row.updatedAtIso)}</td>
                  <td>
                    <a className="admin-link-action" href={`/articles/${row.id}`}>
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
