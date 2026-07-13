/**
 * entity-schema.ts — Helpers puros de identidade Schema.org por entidade.
 *
 * Constroi o grafo `sameAs[]` de uma entidade (filme/serie/pessoa) SOMENTE a
 * partir de IDs externos REAIS ja persistidos em `entity_external_ids`. Nunca
 * inventa um perfil: so as fontes canonicas conhecidas (IMDb, TMDB, Wikidata)
 * viram URL, e apenas quando o `external_id` tem o formato valido daquela fonte.
 *
 * Tudo aqui e puro e determinista: sem rede, banco, IO, Date ou Math.random —
 * pode ser importado no caminho de render (invariantes 3/4). O `@id` e o
 * `mainEntityOfPage` sao a propria URL canonica da entidade e ficam a cargo de
 * quem monta o JSON-LD; este modulo cuida apenas do `sameAs`.
 */

/** Tipo da entidade para escolher o caminho canonico da fonte. */
export type EntitySchemaKind = "movie" | "tv" | "person";

/** Subconjunto de `entity_external_ids` necessario para montar `sameAs`. */
export interface ExternalIdInput {
  /** Fonte do identificador externo (ex.: "imdb", "tmdb", "wikidata"). */
  readonly source: string;
  /** Identificador na fonte (ex.: "tt0111161", "550", "Q42"). */
  readonly externalId: string;
}

/** IMDb: titulos usam `tt#`, pessoas usam `nm#`. */
const IMDB_TITLE_ID = /^tt\d+$/;
const IMDB_NAME_ID = /^nm\d+$/;
/** TMDB: identificador numerico puro. */
const TMDB_ID = /^\d+$/;
/** Wikidata: `Q` seguido de digitos. */
const WIKIDATA_ID = /^Q\d+$/;

/**
 * Prioridade estavel da saida (a ordem do array de entrada nao afeta o
 * resultado): IMDb, depois TMDB, depois Wikidata.
 */
const SOURCE_ORDER = ["imdb", "tmdb", "wikidata"] as const;

function imdbUrl(kind: EntitySchemaKind, id: string): string | null {
  if (kind === "person") {
    return IMDB_NAME_ID.test(id) ? `https://www.imdb.com/name/${id}/` : null;
  }
  return IMDB_TITLE_ID.test(id) ? `https://www.imdb.com/title/${id}/` : null;
}

function tmdbUrl(kind: EntitySchemaKind, id: string): string | null {
  if (!TMDB_ID.test(id)) return null;
  const segment = kind === "person" ? "person" : kind === "tv" ? "tv" : "movie";
  return `https://www.themoviedb.org/${segment}/${id}`;
}

function wikidataUrl(id: string): string | null {
  return WIKIDATA_ID.test(id) ? `https://www.wikidata.org/wiki/${id}` : null;
}

/**
 * Monta `sameAs[]` a partir dos IDs externos reais da entidade.
 *
 * - So considera as fontes canonicas conhecidas (IMDb, TMDB, Wikidata).
 * - So emite uma URL quando o `external_id` casa com o formato daquela fonte
 *   (`tt#`/`nm#` para IMDb, numerico para TMDB, `Q#` para Wikidata) — jamais
 *   inventa Wikidata nem fabrica ID.
 * - Uma fonte desconhecida ou um ID malformado e simplesmente ignorado.
 * - Saida deduplicada por fonte e em ordem estavel; array vazio quando nao ha
 *   nenhum ID externo valido (o chamador entao omite `sameAs` do JSON-LD).
 */
export function buildSameAs(
  ids: readonly ExternalIdInput[],
  kind: EntitySchemaKind,
): string[] {
  const bySource = new Map<string, string>();
  for (const row of ids) {
    const source = row.source.trim().toLowerCase();
    const externalId = row.externalId.trim();
    if (externalId === "" || bySource.has(source)) continue;

    let url: string | null = null;
    if (source === "imdb") url = imdbUrl(kind, externalId);
    else if (source === "tmdb") url = tmdbUrl(kind, externalId);
    else if (source === "wikidata") url = wikidataUrl(externalId);

    if (url !== null) bySource.set(source, url);
  }

  const out: string[] = [];
  for (const source of SOURCE_ORDER) {
    const url = bySource.get(source);
    if (url !== undefined) out.push(url);
  }
  return out;
}
