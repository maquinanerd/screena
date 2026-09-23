/**
 * entity-indexes.ts - Camada de dados SERVER-ONLY das listagens publicas
 * (portas de entrada) de filmes, series e pessoas.
 *
 * Invariantes 3 e 4:
 *  - Le somente PostgreSQL local via @screena/db (Prisma).
 *  - Nao chama TMDB, Gemini, ratings, streaming ou qualquer API externa.
 *  - Nao escreve no banco; apenas monta snapshot para render.
 *
 * So entram na listagem entidades com slug canonico pt-BR e titulo/nome valido;
 * a ordenacao/cap/gate anti-thin vivem no presenter puro `entity-index-presenter`.
 *
 * ============================================================================
 * A LISTAGEM LIA O CATALOGO INTEIRO PARA MOSTRAR 24 CARDS (corrigido 2026-08-28)
 * ============================================================================
 * Ate esta leva, cada uma das tres listagens fazia, POR REQUISICAO:
 *
 *   1. `slugs.findMany` SEM limite  -> todos os slugs canonicos daquele tipo;
 *   2. `movies.findMany` em lotes   -> todas as entidades daqueles ids;
 *   3. `entity_translations` em lotes -> todas as traducoes daqueles ids;
 *   4. `cinerie_score_calculations` em lotes -> todos os calculos.
 *
 * Com ~21 mil filmes com slug isso e ~63 mil linhas cruzando o driver para
 * escolher 24 — e o `findManyInChunks` (que continua necessario, ver
 * `../lib/prisma-in-chunks`) transformava cada leitura em 5 idas SEQUENCIAIS ao
 * banco. Medido em producao em 2026-08-28: TTFB de 3.016 ms em `/pt/filmes/`,
 * 4.496 ms em `/pt/series/` e 3.111 ms em `/pt/pessoas/`, contra 336 ms de
 * `/api/health/` pela MESMA rota de rede.
 *
 * Agora a SELECAO e a ORDENACAO acontecem no banco, com `LIMIT`: uma consulta
 * traz as 24 linhas exibidas (mais folga), e um `COUNT` separado traz o total
 * que a UI precisa para "hasMore" e para a indexabilidade. O `findManyInChunks`
 * NAO foi removido: ele continua sendo a rede de seguranca do teto de 32.767
 * bind variables do protocolo do PostgreSQL, e continua em uso onde a lista de
 * ids e legitimamente grande. O que mudou e que esta lista deixou de ser.
 *
 * DIVERGENCIA DECLARADA — QUEM DESEMPATA MUDOU. O desempate alfabetico passou
 * a ser o do PostgreSQL (`ORDER BY ... ASC` na collation do banco) em vez do
 * `localeCompare` do Node. Para o mesmo ano, dois titulos com acento podem
 * trocar de posicao. Isso e consequencia inevitavel de ordenar no banco: manter
 * o `localeCompare` como autoridade exigiria carregar o catalogo inteiro de
 * novo, que e exatamente o defeito. O presenter continua sendo quem monta o
 * card e quem decide o que e valido — ele so nao reordena mais o que ja veio
 * ordenado (`preordered`).
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

import { resolveEditorialScores, scoreFields } from "./editorial-score";
import { SITE_URL } from "../lib/site";
import {
  buildMovieIndexView,
  buildPersonIndexView,
  buildSeriesIndexView,
  evaluateEntityIndexIndexability,
  INDEX_ITEM_LIMIT,
  type EntityIndexView,
  type MovieListItemInput,
  type PersonListItemInput,
  type SeriesListItemInput,
} from "../lib/entity-index-presenter";
import {
  MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY,
  TMDB_FALLBACK_SLUG_SQL_PATTERN,
  type IndexabilityResult,
} from "@screena/seo";
import { PUBLISHED_LOCALES } from "../lib/synopsis-language";
import { absentDecisionFor, readDecisionCoverageForPage } from "./seo/decision-coverage";

const LANGUAGE_CODE = "pt-BR";
const MOVIE_INDEX_PATH = "/pt/filmes/";
const SERIES_INDEX_PATH = "/pt/series/";
const PERSON_INDEX_PATH = "/pt/pessoas/";

/**
 * Quantas linhas a consulta traz: o que a pagina EXIBE mais uma folga.
 *
 * A folga existe porque o presenter ainda pode descartar uma linha por um
 * motivo que o SQL nao conhece (imagem local recusada por
 * `normalizeEntityLocalImagePath`, por exemplo, nao remove o card — mas se um
 * dia remover, a folga cobre). Duas vezes o limite e barato (48 linhas contra
 * 63 mil) e evita que a listagem encolha em silencio.
 */
export const INDEX_FETCH_LIMIT = INDEX_ITEM_LIMIT * 2;

export interface EntityIndexData {
  view: EntityIndexView;
  indexability: IndexabilityResult;
  canonicalUrl: string;
}

function yearFromDate(date: Date | null): number | null {
  return date === null ? null : date.getUTCFullYear();
}

/**
 * O TITULO EXIBIVEL, em SQL, com a MESMA regra do presenter: traducao pt-BR
 * quando houver, senao o titulo original; branco conta como ausente
 * (`trimToNull`). Aparece tres vezes (filtro, ordem do person, projecao) e por
 * isso e uma constante — divergir entre elas faria a contagem discordar da
 * lista.
 */
const DISPLAY_TITLE_SQL = (originalColumn: string): string =>
  `COALESCE(NULLIF(btrim(t.title), ''), NULLIF(btrim(${originalColumn}), ''))`;

/**
 * Ano de ordenacao — `EXTRACT(YEAR ...)`, nao a data.
 *
 * O presenter ordena por ANO e so entao alfabeticamente. Ordenar pela data
 * completa colocaria dezembro na frente de janeiro do MESMO ano e mudaria a
 * pagina em silencio; o `EXTRACT` reproduz a regra que ja existia.
 */
const SORT_YEAR_SQL = (dateColumn: string): string =>
  `EXTRACT(YEAR FROM ${dateColumn})`;

interface MovieRow {
  id: bigint;
  title_original: string;
  release_date: Date | null;
  poster_path: string | null;
  slug: string;
  translation_title: string | null;
}

interface SeriesRow {
  id: bigint;
  name_original: string;
  first_air_date: Date | null;
  last_air_date: Date | null;
  poster_path: string | null;
  slug: string;
  translation_title: string | null;
}

interface PersonRow {
  id: bigint;
  name: string;
  known_for_department: string | null;
  profile_path: string | null;
  slug: string;
  translation_title: string | null;
}

interface CountRow {
  total: bigint;
}

const MOVIE_PAGE_SQL = `
  SELECT m.id,
         m.title_original,
         m.release_date,
         m.poster_path,
         s.slug,
         t.title AS translation_title
  FROM slugs s
  JOIN movies m ON m.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'movie'::"EntityType"
   AND t.entity_id = m.id
   AND t.language_code = $1
  WHERE s.entity_type = 'movie'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("m.title_original")} IS NOT NULL
  ORDER BY ${SORT_YEAR_SQL("m.release_date")} DESC NULLS LAST,
           NULLIF(btrim(m.title_original), '') ASC,
           m.id ASC
  LIMIT $2
`;

const MOVIE_COUNT_SQL = `
  SELECT count(*)::bigint AS total
  FROM slugs s
  JOIN movies m ON m.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'movie'::"EntityType"
   AND t.entity_id = m.id
   AND t.language_code = $1
  WHERE s.entity_type = 'movie'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("m.title_original")} IS NOT NULL
`;

const SERIES_PAGE_SQL = `
  SELECT v.id,
         v.name_original,
         v.first_air_date,
         v.last_air_date,
         v.poster_path,
         s.slug,
         t.title AS translation_title
  FROM slugs s
  JOIN tv_shows v ON v.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'tv'::"EntityType"
   AND t.entity_id = v.id
   AND t.language_code = $1
  WHERE s.entity_type = 'tv'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("v.name_original")} IS NOT NULL
  ORDER BY ${SORT_YEAR_SQL("v.first_air_date")} DESC NULLS LAST,
           NULLIF(btrim(v.name_original), '') ASC,
           v.id ASC
  LIMIT $2
`;

const SERIES_COUNT_SQL = `
  SELECT count(*)::bigint AS total
  FROM slugs s
  JOIN tv_shows v ON v.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'tv'::"EntityType"
   AND t.entity_id = v.id
   AND t.language_code = $1
  WHERE s.entity_type = 'tv'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("v.name_original")} IS NOT NULL
`;

/**
 * Locales publicados como parametro de SQL — os MESMOS que o sitemap passa ao
 * portao de localizacao das obras (`seo/sitemap-index.ts`).
 */
const PUBLISHED_LOCALE_CODES: string[] = [...PUBLISHED_LOCALES];

/**
 * De onde sai a listagem de pessoas: o elenco PRINCIPAL das obras mais populares
 * de cada tipo (`popularity` do TMDB, indexada nas duas tabelas).
 *
 * POR QUE NAO "TODAS AS PESSOAS POR NOME". Ate 22/09/2026 a listagem ordenava as
 * ~73 mil pessoas com slug por um predicado de biografia que nenhuma cumpria e,
 * depois, pelo nome — e o collation do banco poe nomes em hangul antes do
 * alfabeto latino. Medido em producao: os 24 cards de /pt/pessoas/ eram nomes
 * coreanos de uma silaba ("길", "던", "료"...), de slug `tmdb-N`, com tres obras
 * e 38 palavras. A D2 manda a listagem "priorizar perfis aptos"; o portao de
 * pessoa agora e avaliavel, mas custa uma subconsulta por pessoa — avalia-lo nas
 * 73 mil a cada visita custaria segundos.
 *
 * O recorte o torna barato e util: poucas centenas de candidatos (os primeiros
 * creditos de elenco das obras mais populares), o MESMO portao do sitemap sobre
 * eles, e a ordem pela popularidade da obra mais popular de cada um.
 */
const PERSON_LISTING_SOURCE_MOVIES = 60;
const PERSON_LISTING_SOURCE_SERIES = 40;
/** "Elenco principal": as primeiras posicoes de credito (`billing_order`) de cada obra. */
const PERSON_LISTING_TOP_BILLING = 4;

/**
 * Pessoas APTAS (portao D2) do elenco principal das obras populares, da obra mais
 * popular para a menos.
 *
 * O bloco do portao e o do SQL do sitemap, caractere a caractere
 * (`tests/web/sitemap-person-eligibility.test.ts` trava): quem abre a listagem e
 * exatamente quem o sitemap oferece ao indice — nunca um perfil que a propria
 * ficha marca `noindex`. Inclui a decisao persistida da PESSOA, como o sitemap.
 */
async function readFeaturedPeople(
  prisma: ReturnType<typeof getPrismaClient>,
  limit: number,
): Promise<PersonRow[]> {
  const language = LANGUAGE_CODE;
  const coverage = await readDecisionCoverageForPage(language);
  const absentMovie = absentDecisionFor(coverage, "movie");
  const absentTv = absentDecisionFor(coverage, "tv");
  const absentPerson = absentDecisionFor(coverage, "person");
  return prisma.$queryRaw<PersonRow[]>`
      WITH obras_populares AS (
        (SELECT 'movie'::"EntityType" AS entity_type, m.id AS entity_id, m.popularity AS popularity
           FROM movies m
          WHERE m.popularity IS NOT NULL
          ORDER BY m.popularity DESC
          LIMIT ${PERSON_LISTING_SOURCE_MOVIES})
        UNION ALL
        (SELECT 'tv'::"EntityType" AS entity_type, t.id AS entity_id, t.popularity AS popularity
           FROM tv_shows t
          WHERE t.popularity IS NOT NULL
          ORDER BY t.popularity DESC
          LIMIT ${PERSON_LISTING_SOURCE_SERIES})
      ),
      candidatos AS (
        SELECT cm.person_id, MAX(o.popularity) AS relevancia
          FROM obras_populares o
          JOIN cast_members cm ON cm.entity_type = o.entity_type AND cm.entity_id = o.entity_id
         WHERE cm.billing_order < ${PERSON_LISTING_TOP_BILLING}
         GROUP BY cm.person_id
      )
      SELECT p.id, p.name, p.known_for_department, p.profile_path, s.slug, tr.title AS translation_title
      FROM candidatos c
      JOIN people p ON p.id = c.person_id
      JOIN slugs s ON s.entity_type = 'person' AND s.entity_id = p.id
        AND s.language_code = ${language} AND s.is_canonical = true
      LEFT JOIN entity_translations tr
        ON tr.entity_type = 'person' AND tr.entity_id = p.id AND tr.language_code = ${language}
      WHERE BTRIM(p.name) <> ''
        -- PORTAO DE PESSOA (decisao do dono D2, 2026-09-11; leitura de 22/09/2026):
        -- foto E conteudo proprio suficiente. Biografia EXIBIVEL com ao menos uma
        -- obra no indice, OU uma filmografia de MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY
        -- obras no indice. E o portao que a pagina aplica (entity-quality-gates.ts).
        -- Ate 22/09 a biografia era obrigatoria; como biography_source_status nasce
        -- unknown e libera-lo e decisao de licenca, o sitemap tinha zero pessoa.
        -- OBRA NO INDICE e o predicado que poe a obra no sitemap: slug canonico,
        -- titulo original, portao de localizacao D3 e decisao efetiva index.
        -- Conta OBRA distinta (UNION), nao linha de credito, e para no piso
        -- (LIMIT): a pessoa com 150 obras custa o mesmo que a de 5.
        -- NUNCA use crase neste comentario: ela fecha o template literal.
        AND BTRIM(COALESCE(p.profile_path, '')) <> ''
        AND (
          SELECT COUNT(*) FROM (
            SELECT 1
            FROM (
              SELECT cm.entity_type, cm.entity_id FROM cast_members cm
              WHERE cm.person_id = p.id AND cm.entity_type IN ('movie','tv')
              UNION
              SELECT rm.entity_type, rm.entity_id FROM crew_members rm
              WHERE rm.person_id = p.id AND rm.entity_type IN ('movie','tv')
            ) obra
            JOIN slugs ws ON ws.entity_type = obra.entity_type AND ws.entity_id = obra.entity_id
              AND ws.language_code = ${language} AND ws.is_canonical = true
            LEFT JOIN movies wm ON obra.entity_type = 'movie' AND wm.id = obra.entity_id
            LEFT JOIN tv_shows wt ON obra.entity_type = 'tv' AND wt.id = obra.entity_id
            WHERE BTRIM(COALESCE(wm.title_original, wt.name_original, '')) <> ''
              AND NOT (
                ws.slug ~ ${TMDB_FALLBACK_SLUG_SQL_PATTERN}
                AND NOT EXISTS (
                  SELECT 1 FROM entity_translations et
                  WHERE et.entity_type = obra.entity_type AND et.entity_id = obra.entity_id
                    AND et.language_code = ANY(${PUBLISHED_LOCALE_CODES})
                    AND ((BTRIM(COALESCE(et.title, '')) <> ''
                          AND BTRIM(COALESCE(et.title, '')) <> BTRIM(COALESCE(wm.title_original, wt.name_original, '')))
                      OR BTRIM(COALESCE(et.summary, '')) <> ''
                      OR BTRIM(COALESCE(et.meta_description, '')) <> '')
                )
              )
              AND COALESCE((SELECT wd.decision::text FROM page_indexability_decisions wd
                WHERE wd.entity_type = obra.entity_type AND wd.entity_id = obra.entity_id
                  AND wd.language_code = ${language} AND wd.is_current = true
                LIMIT 1), CASE obra.entity_type::text WHEN 'movie' THEN ${absentMovie} ELSE ${absentTv} END) = 'index'
            LIMIT ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}
          ) obras_no_indice
        ) >= CASE
          WHEN BTRIM(COALESCE(p.biography, '')) <> ''
            AND p.biography_source_status::text IN ('official','licensed','third_party')
          THEN 1
          ELSE ${MIN_INDEXABLE_WORKS_WITHOUT_BIOGRAPHY}
        END
        AND COALESCE((SELECT d.decision::text FROM page_indexability_decisions d
          WHERE d.entity_type = 'person' AND d.entity_id = s.entity_id
            AND d.language_code = ${language} AND d.is_current = true
          LIMIT 1), ${absentPerson}) = 'index'
      ORDER BY c.relevancia DESC, p.id ASC
      LIMIT ${limit}`;
}

/**
 * Complemento, so quando os aptos nao enchem a pagina (banco pequeno, ou sem
 * `popularity`): as demais pessoas com slug, na ordem do nome exibivel. Em
 * producao ha milhares de aptos e esta consulta nao roda.
 */
const PERSON_PAGE_SQL = `
  SELECT p.id,
         p.name,
         p.known_for_department,
         p.profile_path,
         s.slug,
         t.title AS translation_title
  FROM slugs s
  JOIN people p ON p.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'person'::"EntityType"
   AND t.entity_id = p.id
   AND t.language_code = $1
  WHERE s.entity_type = 'person'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("p.name")} IS NOT NULL
  ORDER BY ${DISPLAY_TITLE_SQL("p.name")} ASC,
           p.id ASC
  LIMIT $2
`;

const PERSON_COUNT_SQL = `
  SELECT count(*)::bigint AS total
  FROM slugs s
  JOIN people p ON p.id = s.entity_id
  LEFT JOIN entity_translations t
    ON t.entity_type = 'person'::"EntityType"
   AND t.entity_id = p.id
   AND t.language_code = $1
  WHERE s.entity_type = 'person'::"EntityType"
    AND s.language_code = $1
    AND s.is_canonical
    AND ${DISPLAY_TITLE_SQL("p.name")} IS NOT NULL
`;

function totalFrom(rows: CountRow[]): number {
  const first = rows[0];
  return first === undefined ? 0 : Number(first.total);
}

export const getMovieIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<MovieRow[]>(MOVIE_PAGE_SQL, LANGUAGE_CODE, INDEX_FETCH_LIMIT),
    prisma.$queryRawUnsafe<CountRow[]>(MOVIE_COUNT_SQL, LANGUAGE_CODE),
  ]);

  // O Cinerie Score em LOTE (ver `editorial-score`): agora sobre as 48 linhas da
  // pagina, nao sobre o catalogo. A NOTA vem de `cinerie_score_calculations` —
  // as colunas `movies.screen_score*` nao sao mais lidas por tela nenhuma.
  const scores = await resolveEditorialScores(
    prisma,
    "movie",
    rows.map((row) => row.id),
  );

  const items: MovieListItemInput[] = rows.map((row) => {
    const key = row.id.toString();
    return {
      id: key,
      titleOriginal: row.title_original,
      translationTitle: row.translation_title,
      slug: row.slug,
      year: yearFromDate(row.release_date),
      posterPath: row.poster_path,
      ...scoreFields(scores.get(key)),
    };
  });

  const view = buildMovieIndexView(items, {
    preordered: true,
    totalCount: totalFrom(counts),
  });
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${MOVIE_INDEX_PATH}`,
  };
});

export const getSeriesIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const [rows, counts] = await Promise.all([
    prisma.$queryRawUnsafe<SeriesRow[]>(SERIES_PAGE_SQL, LANGUAGE_CODE, INDEX_FETCH_LIMIT),
    prisma.$queryRawUnsafe<CountRow[]>(SERIES_COUNT_SQL, LANGUAGE_CODE),
  ]);

  const scores = await resolveEditorialScores(
    prisma,
    "tv",
    rows.map((row) => row.id),
  );

  const items: SeriesListItemInput[] = rows.map((row) => {
    const key = row.id.toString();
    return {
      id: key,
      nameOriginal: row.name_original,
      translationTitle: row.translation_title,
      slug: row.slug,
      firstAirYear: yearFromDate(row.first_air_date),
      lastAirYear: yearFromDate(row.last_air_date),
      posterPath: row.poster_path,
      ...scoreFields(scores.get(key)),
    };
  });

  const view = buildSeriesIndexView(items, {
    preordered: true,
    totalCount: totalFrom(counts),
  });
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${SERIES_INDEX_PATH}`,
  };
});

export const getPersonIndexData = cache(async (): Promise<EntityIndexData> => {
  const prisma = getPrismaClient();
  const [featured, counts] = await Promise.all([
    readFeaturedPeople(prisma, INDEX_FETCH_LIMIT),
    prisma.$queryRawUnsafe<CountRow[]>(PERSON_COUNT_SQL, LANGUAGE_CODE),
  ]);
  const rows = [...featured];
  if (rows.length < INDEX_FETCH_LIMIT) {
    const chosen = new Set(rows.map((row) => row.id.toString()));
    const rest = await prisma.$queryRawUnsafe<PersonRow[]>(
      PERSON_PAGE_SQL,
      LANGUAGE_CODE,
      INDEX_FETCH_LIMIT,
    );
    for (const row of rest) {
      if (rows.length >= INDEX_FETCH_LIMIT) break;
      if (!chosen.has(row.id.toString())) rows.push(row);
    }
  }

  const items: PersonListItemInput[] = rows.map((row) => ({
    id: row.id.toString(),
    name: row.name,
    translationTitle: row.translation_title,
    slug: row.slug,
    knownForDepartment: row.known_for_department,
    profilePath: row.profile_path,
  }));

  const view = buildPersonIndexView(items, {
    preordered: true,
    totalCount: totalFrom(counts),
  });
  return {
    view,
    indexability: evaluateEntityIndexIndexability({ itemCount: view.totalCount }),
    canonicalUrl: `${SITE_URL}${PERSON_INDEX_PATH}`,
  };
});
