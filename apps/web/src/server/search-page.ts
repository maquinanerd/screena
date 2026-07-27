/**
 * search-page.ts - Camada de dados SERVER-ONLY da busca publica tecnica (/pt/busca).
 *
 * Invariantes 3 e 4:
 *  - Le SOMENTE PostgreSQL local via @screena/db (Prisma). NUNCA chama TMDB,
 *    RapidAPI, ratings, streaming ou qualquer API externa no render.
 *  - Zero Gemini/IA no render: nenhuma chamada a modelo acontece aqui.
 *  - Somente leitura: nao escreve no banco; apenas monta snapshot para render.
 *
 * A consulta ranqueada espelha a do worker (services/ingestion, modulo
 * search/query.ts), porem esta INLINE de proposito: apps/web NAO depende de
 * services/ingestion. Divergencia conhecida e aceita: o worker tem um ramo extra
 * de tier 3 para prefixo de alias; aqui esse caso cai em fuzzy (tier 4). A linha
 * continua sendo retornada (o WHERE cobre alias LIKE), so ranqueia abaixo.
 *
 * Seguranca: o termo do usuario NUNCA e concatenado no SQL — entra apenas como
 * parametro posicional ($1..$5).
 */

import { cache } from 'react'
import { getPrismaClient } from '@screena/db/server'

import {
  buildSearchPageView,
  type SearchNewsRowInput,
  type SearchPageView,
  type SearchRowInput,
} from '../lib/search-presenter'

/** Locale unico publicado hoje (invariante 7: pt-BR publica primeiro). */
const SEARCH_LOCALE = 'pt-BR'

/** Limites de seguranca da busca (espelham SEARCH_* do worker). */
const SEARCH_DEFAULT_LIMIT = 20
const SEARCH_MAX_LIMIT = 50
const SEARCH_MIN_LIMIT = 1

/** Marcas combinantes Unicode (acentos) removidas apos a decomposicao NFD. */
const COMBINING_MARKS = /[̀-ͯ]/g

/**
 * SQL de busca ranqueada. `$1`=termo dobrado, `$2`=prefixo (termo || '%'),
 * `$3`=locale, `$4`=limit, `$5`=offset. `%` e o operador de similaridade trgm
 * (pg_trgm). Nenhum literal do usuario e interpolado.
 */
const SEARCH_SQL = `
  SELECT
    entity_type,
    entity_id,
    primary_text,
    subtitle,
    year,
    popularity,
    image_path,
    canonical_url,
    CASE
      WHEN immutable_unaccent(lower(primary_text)) = $1 THEN 0
      WHEN normalized_aliases <> '' AND $1 = ANY(string_to_array(normalized_aliases, '|')) THEN 1
      WHEN immutable_unaccent(lower(primary_text)) LIKE $2 THEN 2
      WHEN normalized_text LIKE $2 THEN 3
      ELSE 4
    END AS match_tier,
    similarity(normalized_text, $1) AS sim
  FROM search_documents
  -- doc_kind = 'entity' e obrigatorio desde que a tabela passou a abrigar
  -- tambem documentos de ARTIGO. Sem este filtro as linhas de artigo entram no
  -- resultado com entity_type NULL: o presenter as descarta, mas elas ja
  -- consumiram slots do LIMIT, e a pagina perderia entidades silenciosamente.
  WHERE doc_kind = 'entity'
    AND locale = $3
    AND (
      normalized_text = $1
      OR normalized_text LIKE $2
      OR normalized_text % $1
      OR (normalized_aliases <> '' AND EXISTS (
        SELECT 1 FROM unnest(string_to_array(normalized_aliases, '|')) AS a(alias)
        WHERE alias = $1 OR alias LIKE $2
      ))
    )
  ORDER BY match_tier ASC, sim DESC, popularity DESC NULLS LAST, year DESC NULLS LAST, entity_id ASC
  LIMIT $4 OFFSET $5
`

/**
 * SQL de busca EDITORIAL (doc_kind='article'). Mesma tabela, mesma dobra e
 * mesma disciplina de parametros da busca de entidades — nao existe um segundo
 * search engine. As diferencas sao proprias do dominio: artigo nao tem ano nem
 * popularidade para desempatar, entao o desempate final e por `article_id`.
 *
 * A projecao so contem artigo PUBLICAVEL (o worker remove o documento quando o
 * artigo deixa de ser publicavel), entao rascunho, materia retratada e materia
 * agendada nao tem linha aqui para casar.
 */
const NEWS_SEARCH_SQL = `
  SELECT
    article_id,
    primary_text,
    subtitle,
    canonical_url,
    CASE
      WHEN immutable_unaccent(lower(primary_text)) = $1 THEN 0
      WHEN immutable_unaccent(lower(primary_text)) LIKE $2 THEN 2
      WHEN normalized_text LIKE $2 THEN 3
      ELSE 4
    END AS match_tier,
    similarity(normalized_text, $1) AS sim
  FROM search_documents
  WHERE doc_kind = 'article'
    AND locale = $3
    AND (
      normalized_text = $1
      OR normalized_text LIKE $2
      OR normalized_text % $1
    )
  ORDER BY match_tier ASC, sim DESC, article_id DESC
  LIMIT $4
`

/** Quantas noticias acompanham uma busca (secao de apoio, nao a lista principal). */
const NEWS_SEARCH_LIMIT = 5

interface NewsSearchSqlRow {
  article_id: bigint | number | string
  primary_text: string
  subtitle: string | null
  canonical_url: string | null
  match_tier: number | bigint
  sim: number | null
}

/** Forma crua devolvida pelo SQL (subset usado; `popularity` so ordena). */
interface SearchSqlRow {
  entity_type: string
  entity_id: bigint | number | string
  primary_text: string
  subtitle: string | null
  year: number | null
  image_path: string | null
  canonical_url: string | null
  match_tier: number | bigint
  sim: number | null
}

export interface SearchPageOptions {
  limit?: number
  offset?: number
}

/**
 * "Dobra" o termo do usuario: decompoe (NFD), remove acentos, minusculo e
 * colapsa espacos. E EXATAMENTE a mesma transformacao aplicada ao
 * `normalized_text` gravado na projecao pelo worker — os dois lados precisam
 * casar de forma deterministica.
 */
export function foldSearchTerm(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Limita um inteiro ao intervalo [min, max]. */
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = value !== undefined && Number.isFinite(value) ? Math.floor(value) : fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

function toNumber(value: number | bigint): number {
  return typeof value === 'number' ? value : Number(value)
}

/** Rotulo de motivo de casamento a partir do match_tier do SQL. */
function matchReasonFromTier(tier: number): string {
  switch (tier) {
    case 0:
      return 'exact'
    case 1:
      return 'alias'
    case 2:
    case 3:
      return 'prefix'
    default:
      return 'fuzzy'
  }
}

/** Score monotonico [0,1] a partir do tier + similaridade (maior = melhor). */
function scoreFromTier(tier: number, similarity: number): number {
  const sim = Number.isFinite(similarity) ? Math.max(0, Math.min(1, similarity)) : 0
  switch (tier) {
    case 0:
      return 1
    case 1:
      return 0.95
    case 2:
      return 0.9
    case 3:
      return 0.85
    default:
      // fuzzy: puxado pela similaridade trgm, sempre abaixo do prefixo.
      return Math.min(0.8, 0.4 + sim * 0.4)
  }
}

/**
 * Busca ranqueada da pagina publica. Termo vazio (so espacos/acentos) devolve a
 * view vazia SEM tocar o banco.
 */
export const getSearchPageData = cache(
  async (query: string, opts?: SearchPageOptions): Promise<SearchPageView> => {
    const limit = clampInt(opts?.limit, SEARCH_DEFAULT_LIMIT, SEARCH_MIN_LIMIT, SEARCH_MAX_LIMIT)
    const offset = clampInt(opts?.offset, 0, 0, Number.MAX_SAFE_INTEGER)
    const term = foldSearchTerm(query)

    if (term === '') {
      return buildSearchPageView({ query, rows: [], newsRows: [], limit, offset })
    }

    const prisma = getPrismaClient()
    // Entidades e noticias sao duas consultas a MESMA tabela, disparadas juntas:
    // sao listas independentes (a de noticias e um apoio de tamanho fixo e nao
    // participa da paginacao das entidades).
    const [sqlRows, newsSqlRows] = await Promise.all([
      prisma.$queryRawUnsafe<SearchSqlRow[]>(
        SEARCH_SQL,
        term,
        `${term}%`,
        SEARCH_LOCALE,
        limit,
        offset,
      ),
      // Noticias so acompanham a PRIMEIRA pagina: repeti-las em cada pagina de
      // entidades seria ruido, e paginar duas listas no mesmo controle mente
      // sobre o que "proxima pagina" significa.
      offset === 0
        ? prisma.$queryRawUnsafe<NewsSearchSqlRow[]>(
            NEWS_SEARCH_SQL,
            term,
            `${term}%`,
            SEARCH_LOCALE,
            NEWS_SEARCH_LIMIT,
          )
        : Promise.resolve([] as NewsSearchSqlRow[]),
    ])

    const rows: SearchRowInput[] = sqlRows.map((row) => {
      const tier = toNumber(row.match_tier)
      return {
        entityType: row.entity_type,
        entityId: String(row.entity_id),
        title: row.primary_text,
        subtitle: row.subtitle,
        year: row.year,
        imagePath: row.image_path,
        canonicalUrl: row.canonical_url,
        matchReason: matchReasonFromTier(tier),
        score: scoreFromTier(tier, row.sim ?? 0),
      }
    })

    const newsRows: SearchNewsRowInput[] = newsSqlRows.map((row) => {
      const tier = toNumber(row.match_tier)
      return {
        articleId: String(row.article_id),
        title: row.primary_text,
        subtitle: row.subtitle,
        canonicalUrl: row.canonical_url,
        matchReason: matchReasonFromTier(tier),
        score: scoreFromTier(tier, row.sim ?? 0),
      }
    })

    return buildSearchPageView({ query, rows, newsRows, limit, offset })
  },
)
