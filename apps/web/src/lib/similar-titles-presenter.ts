/**
 * similar-titles-presenter.ts — "Mais como este" (telas 06/07 do canonico). PURO.
 *
 * ============ O BURACO QUE ISTO FECHA ============
 *
 * O canonico fecha a pagina de titulo com uma grade de DUAS colunas:
 * `320px minmax(0,1fr)` — ficha tecnica a esquerda, "Mais como este" a direita.
 * No repositorio a segunda coluna existia como `<div />`: um elemento vazio
 * ocupando metade da faixa. Nao era "bloco ausente" (que e um estado honesto e
 * previsto): era meia pagina reservada para nada, em TODO titulo.
 *
 * ============ POR QUE COLECAO, E NAO GENERO ============
 *
 * A escolha do sinal nao foi de gosto — foi o que o banco sustenta. A tabela
 * `genres` existe, mas e um DICIONARIO (`(media_type, tmdb_id) -> name`): NAO ha
 * tabela de ligacao entre filme e genero. Recomendar por genero exigiria uma
 * migration, que esta fora de tarefa aprovada para banco (CLAUDE.md, lista
 * NUNCA). Ja `movie_collection_memberships` -> `collections` esta no schema E
 * populado pela ingestao: e a colecao do TMDB, a franquia. Dois filmes da mesma
 * colecao sao parentes DECLARADOS pela fonte, nao inferidos por heuristica.
 *
 * Serie nao tem equivalente (`tv_shows` so liga a `networks` e a
 * `production_companies`, que agrupam milhares de titulos sem parentesco). Por
 * isso a serie NAO ganha um sinal pior para preencher espaco: o bloco nao
 * renderiza e a ausencia vai para o log com `no_recommendation_dataset` — o
 * motivo que ja existia em `section-absence.ts` esperando por este bloco.
 *
 * ============ O ROTULO DIZ A RELACAO ============
 *
 * O titulo do bloco e o do canonico ("Mais como este"), mas ele vem acompanhado
 * do NOME da colecao. Sem isso a promessa seria mais larga que a entrega: o
 * leitor leria "mais como este" e receberia so a franquia, sem saber que era so
 * a franquia. Com o nome da colecao na tela, o que ele ve e o que foi
 * prometido.
 *
 * Sem rede, sem DB, sem `Date`, sem IO: o modulo recebe linhas e devolve cards.
 */

import { buildTmdbImageUrl } from "./tmdb-image-url";

/** Tamanho TMDB do poster do card (mesma medida do trilho de recomendacao). */
const POSTER_TMDB_SIZE = "w300" as const;
const POSTER_WIDTH = 210;
const POSTER_HEIGHT = 315;

/** Teto de cards. Acima disto o trilho vira catalogo, nao recomendacao. */
export const SIMILAR_TITLES_LIMIT = 8;

/** Uma linha crua vinda do banco (ja juntada pelo getter server-only). */
export interface SimilarTitleRow {
  /** Id local da entidade, serializado. */
  readonly entityId: string;
  /** `movies.title_original` — fallback de titulo, nunca inventado. */
  readonly titleOriginal: string;
  /** Titulo pt-BR (`entity_translations`) quando existir. */
  readonly translationTitle: string | null;
  /** Slug canonico pt-BR. `null` => o card NAO existe (nao ha para onde ir). */
  readonly slug: string | null;
  /** Ano de estreia, quando ha data. */
  readonly year: number | null;
  /** `movies.poster_path` cru do TMDB. */
  readonly posterPath: string | null;
  /** `movie_collection_memberships.position` — a ordem declarada pela fonte. */
  readonly position: number | null;
}

/** Imagem ja normalizada para render publico. */
export interface SimilarTitlePoster {
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** Um card do trilho. */
export interface SimilarTitleCard {
  readonly entityId: string;
  readonly href: string;
  readonly title: string;
  readonly year: number | null;
  readonly poster: SimilarTitlePoster | null;
}

/** O bloco inteiro, ja com a relacao que o justifica. */
export interface SimilarTitlesView {
  /**
   * Qual dataset produziu estes cards. Existe UM hoje (`collection`); o campo
   * esta aqui para que um segundo sinal futuro nao possa entrar de carona sem
   * dizer o proprio nome na tela.
   */
  readonly relation: "collection";
  /** Nome da colecao do TMDB (ex.: "Colecao O Poderoso Chefao"). */
  readonly relationLabel: string;
  readonly items: readonly SimilarTitleCard[];
}

function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Ordena pela ordem DECLARADA pela colecao (`position`), com o ano como
 * desempate e o titulo como ultimo criterio.
 *
 * Linha sem `position` vai para o FIM, nao para o comeco: `null` significa "a
 * fonte nao disse", e chutar que isso e o primeiro da franquia inventaria uma
 * cronologia. O ano ainda ordena esse resto.
 */
function compareRows(a: SimilarTitleRow, b: SimilarTitleRow): number {
  const positionA = a.position ?? Number.MAX_SAFE_INTEGER;
  const positionB = b.position ?? Number.MAX_SAFE_INTEGER;
  if (positionA !== positionB) return positionA - positionB;

  const yearA = a.year ?? Number.MAX_SAFE_INTEGER;
  const yearB = b.year ?? Number.MAX_SAFE_INTEGER;
  if (yearA !== yearB) return yearA - yearB;

  return a.titleOriginal.localeCompare(b.titleOriginal, "pt-BR");
}

/**
 * Monta o bloco. Devolve `null` quando NAO ha bloco — e quem chama transforma
 * isso em ausencia registrada, nunca em secao vazia.
 *
 * Descarta, em silencio proposital, apenas o que nao pode virar card:
 *  - a propria entidade (`excludeEntityId`);
 *  - linha sem slug canonico pt-BR (nao ha destino; um card morto e pior que
 *    um card a menos);
 *  - duplicata do mesmo `entityId` (um filme em duas colecoes apareceria duas
 *    vezes no mesmo trilho).
 */
export function buildSimilarTitles(
  rows: readonly SimilarTitleRow[],
  options: {
    readonly excludeEntityId: string;
    readonly relationLabel: string | null;
    readonly limit?: number;
  },
): SimilarTitlesView | null {
  const relationLabel = trimToNull(options.relationLabel);
  if (relationLabel === null) return null;

  const limit = options.limit ?? SIMILAR_TITLES_LIMIT;
  if (limit <= 0) return null;

  const seen = new Set<string>([options.excludeEntityId]);
  const usable: SimilarTitleRow[] = [];
  for (const row of rows) {
    if (seen.has(row.entityId)) continue;
    if (trimToNull(row.slug) === null) continue;
    seen.add(row.entityId);
    usable.push(row);
  }
  if (usable.length === 0) return null;

  const items = usable
    .slice()
    .sort(compareRows)
    .slice(0, limit)
    .map((row): SimilarTitleCard => {
      const src = buildTmdbImageUrl(row.posterPath, POSTER_TMDB_SIZE);
      return {
        entityId: row.entityId,
        href: `/pt/filmes/${trimToNull(row.slug) as string}/`,
        title: trimToNull(row.translationTitle) ?? row.titleOriginal,
        year: row.year,
        poster:
          src === null ? null : { src, width: POSTER_WIDTH, height: POSTER_HEIGHT },
      };
    });

  return { relation: "collection", relationLabel, items };
}
