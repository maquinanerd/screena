import type { ReactNode } from "react";

import { VerticalBadge } from "../../src/components/ops/badges";
import { TitleSearchForm } from "../../src/components/ops/forms";
import { Stamp, Undetermined } from "../../src/components/ops/measured";
import { formatDecimal } from "../../src/lib/ops/format";
import { titlePath } from "../../src/lib/ops/title-routes";
import { searchTitles } from "../../src/server/ops/titles";

/**
 * Titulos — busca por nome, id do TMDB, id interno ou imdb_id, e o caminho para a
 * ficha de diagnostico de cada titulo.
 */
export const dynamic = "force-dynamic";

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const query = await searchParams;
  const raw = Array.isArray(query.q) ? query.q[0] : query.q;
  const term = (raw ?? "").trim();
  const now = new Date();
  const results = term === "" ? null : await searchTitles(term, now);

  return (
    <>
      <h1 className="ops-page-title">Títulos</h1>
      <p className="ops-lede">
        A ficha de cada título responde por que ele está assim na página — sinopse, notas, trailer, indexação — e o que
        o sistema vai fazer com ele. As ações de forçar atualização ficam na ficha.
      </p>
      <TitleSearchForm defaultValue={term} />

      {results === null ? null : !results.ok ? (
        <p>
          <Undetermined reason={results.reason} />
          <Stamp source={results.source} measuredAt={results.measuredAt} />
        </p>
      ) : results.value.length === 0 ? (
        <p className="ops-muted">Nenhum filme ou série encontrado para essa busca.</p>
      ) : (
        <>
          <div className="ops-table-wrap">
            <table className="ops-table" data-table="busca-titulos">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Título</th>
                  <th>Original</th>
                  <th>Ano</th>
                  <th>tmdb_id</th>
                  <th>imdb_id</th>
                  <th className="num">Popularidade</th>
                </tr>
              </thead>
              <tbody>
                {results.value.map((hit) => (
                  <tr key={`${hit.kind}-${hit.id}`}>
                    <td>
                      <VerticalBadge kind={hit.kind} />
                    </td>
                    <td>
                      <a href={titlePath(hit.kind, hit.id)}>{hit.title}</a>
                    </td>
                    <td>{hit.originalTitle}</td>
                    <td>{hit.year ?? "sem data"}</td>
                    <td className="ops-mono">{hit.tmdbId}</td>
                    <td className="ops-mono">{hit.imdbId ?? <span className="ops-red-text">sem imdb_id</span>}</td>
                    <td className="num">{hit.popularity === null ? "sem dado" : formatDecimal(hit.popularity, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Stamp source={results.source} measuredAt={results.measuredAt} />
        </>
      )}
    </>
  );
}
