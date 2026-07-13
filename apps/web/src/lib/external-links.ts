/**
 * external-links.ts — Monta os links externos DISCRETOS ("Ver em ...") exibidos
 * nas paginas de detalhe, a partir dos MESMOS IDs externos reais que alimentam o
 * `sameAs` do JSON-LD (identidade da entidade).
 *
 * PURO: sem rede/DB/IO. Reusa `buildSameAs` (@screena/seo) como fonte unica das
 * URLs — assim o que o usuario ve e exatamente o grafo `sameAs` da pagina, nunca
 * um link inventado. Uma fonte sem rotulo conhecido e omitida. Nao ha link de
 * streaming/pirataria aqui: apenas fontes canonicas de identidade (IMDb, TMDb,
 * Wikidata) ja validadas por `buildSameAs`.
 */

import { buildSameAs, type EntitySchemaKind, type ExternalIdInput } from "@screena/seo";

export type { EntitySchemaKind, ExternalIdInput };

export interface ExternalLink {
  /** Rotulo curto e humano da fonte (ex.: "IMDb"). */
  label: string;
  /** URL canonica da entidade naquela fonte (identica ao `sameAs`). */
  href: string;
}

/** Host canonico -> rotulo humano. Ordem irrelevante (match por inclusao). */
const HOST_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["imdb.com", "IMDb"],
  ["themoviedb.org", "TMDb"],
  ["wikidata.org", "Wikidata"],
];

/**
 * Constroi os links externos rotulados a partir dos IDs externos reais. Retorna
 * `[]` quando nao ha nenhuma fonte canonica valida — o chamador entao omite a
 * secao (nunca renderiza uma lista vazia que pareceria bug).
 */
export function buildExternalLinks(
  ids: readonly ExternalIdInput[],
  kind: EntitySchemaKind,
): ExternalLink[] {
  const links: ExternalLink[] = [];
  for (const href of buildSameAs(ids, kind)) {
    const match = HOST_LABELS.find(([host]) => href.includes(host));
    if (match !== undefined) links.push({ label: match[1], href });
  }
  return links;
}
