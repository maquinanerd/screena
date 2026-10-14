/**
 * showcase-relevance.ts — as VITRINES so destacam titulo que esta no indice.
 *
 * DECISAO DO DONO, 13/10/2026, depois da recusa do AdSense por "conteudo de
 * baixo valor": as vitrines de titulo da home (`/pt/`), de `/pt/filmes/`, de
 * `/pt/series/` e de `/pt/explorar/` (com o "Ver todos" dela, `/pt/em-breve/`)
 * usam o MESMO portao de relevancia do sitemap (`DECISOES-DO-DONO-2026-09-24.md`).
 * Fica o filme ou a serie com pais de origem EUA ou Brasil, OU
 * `vote_count_tmdb >= 500`, OU qualquer linha de `watch_availability` no Brasil.
 * Registro: `docs/seo/DECISOES-DO-DONO-2026-10-13.md`.
 *
 * O QUE ESTAVA ERRADO. A decisao de 24/09 tirou do indice 51 mil titulos, mas
 * deixou as vitrines de fora de proposito — e elas seguiram escolhendo por DATA.
 * Medido no ar em 13/10/2026: o "NOVO" da home era o episodio 32 da temporada 29
 * de uma novela polonesa, e o "Em breve" abria com um documentario turco de 45
 * minutos. As duas fichas respondem `noindex, follow`. A primeira dobra do site
 * apontava para paginas que o proprio site declara fora do indice — o oposto de
 * curadoria.
 *
 * O QUE ESTE MODULO NAO FAZ. Nao decide indexacao (quem decide e
 * `seo/title-relevance.ts`, na ficha, e o SQL de `seo/sitemap-index.ts`) e nao
 * apaga nada. So responde, para uma vitrine, "este titulo pode ser destacado?".
 * A curadoria MANUAL do hero (`hero_curation_decisions`) nao passa por aqui:
 * decisao humana vence o filtro, como ja vencia o portao de qualidade.
 *
 * TERCEIRA TRADUCAO DA MESMA REGRA, com os numeros de `@screena/config`: a funcao
 * pura `evaluateRelevanceGate` (pagina), o SQL do sitemap e este SQL. EXISTS
 * correlacionado e nunca CTE, pelo mesmo motivo do sitemap (a PR 323 reverteu um
 * portao em CTE que piorou producao). A chave de EMERGENCIA
 * `CINERIE_RELEVANCE_GATE=off` tambem vale aqui, lida a cada chamada.
 *
 * Invariantes 3 e 4: le so PostgreSQL local. Falha de banco LANCA — nunca vira
 * "nada e relevante" em silencio.
 */

import { getPrismaClient } from "@screena/db/server";
import {
  isRelevanceGateEnabled,
  RELEVANCE_GATE_ANCHOR_COUNTRIES,
  RELEVANCE_GATE_MIN_TMDB_VOTES,
  RELEVANCE_GATE_OFFER_COUNTRY,
} from "@screena/config";

type PrismaClient = ReturnType<typeof getPrismaClient>;

export type RelevanceEntityType = "movie" | "tv";

const COUNTRY_TABLE: Readonly<Record<RelevanceEntityType, string>> = {
  movie: "movie_production_countries",
  tv: "tv_show_origin_countries",
};

const COUNTRY_FK: Readonly<Record<RelevanceEntityType, string>> = {
  movie: "movie_id",
  tv: "tv_show_id",
};

const TITLE_TABLE: Readonly<Record<RelevanceEntityType, string>> = {
  movie: "movies",
  tv: "tv_shows",
};

/**
 * O predicado de relevancia sobre a linha `alias` de `movies`/`tv_shows`, para
 * `$queryRawUnsafe`. Acrescenta os seus parametros ao FIM de `params` e devolve
 * o texto ja com os `$n` certos — quem chama empurra o `LIMIT` DEPOIS, para que
 * ele continue sendo o ultimo parametro numerico (os orcamentos de linha dos
 * testes leem o teto dali).
 *
 * Com a chave de emergencia desligando o portao, devolve `TRUE` e nao acrescenta
 * parametro nenhum: a vitrine volta a ser exatamente o que era.
 */
export function relevanceSql(
  entityType: RelevanceEntityType,
  alias: string,
  params: unknown[],
): string {
  if (!isRelevanceGateEnabled()) return "TRUE";
  params.push(RELEVANCE_GATE_MIN_TMDB_VOTES);
  const votes = `$${params.length}`;
  params.push([...RELEVANCE_GATE_ANCHOR_COUNTRIES]);
  const anchors = `$${params.length}`;
  params.push(RELEVANCE_GATE_OFFER_COUNTRY);
  const offer = `$${params.length}`;
  return `(
      COALESCE(${alias}.vote_count_tmdb, 0) >= ${votes}
      OR EXISTS (
        SELECT 1 FROM ${COUNTRY_TABLE[entityType]} rc
        WHERE rc.${COUNTRY_FK[entityType]} = ${alias}.id AND rc.country_code = ANY(${anchors})
      )
      OR EXISTS (
        SELECT 1 FROM watch_availability rw
        WHERE rw.entity_type = '${entityType}'::"EntityType" AND rw.entity_id = ${alias}.id
          AND rw.country_code = ${offer}
      )
    )`;
}

/**
 * Quais destes titulos passam no portao — UMA consulta por tipo, com teto igual
 * ao tamanho da lista. Para vitrines que ja tem uma lista CURTA na mao (trending,
 * candidatos do hero, recortes do ranking): filtrar depois nao encolhe nada que o
 * banco pudesse completar.
 *
 * Devolve as chaves `id.toString()`. Lista vazia nao consulta.
 */
export async function relevantTitleIds(
  prisma: PrismaClient,
  entityType: RelevanceEntityType,
  ids: readonly bigint[],
): Promise<Set<string>> {
  const unique = [...new Set(ids.map((id) => id.toString()))];
  if (unique.length === 0) return new Set();
  if (!isRelevanceGateEnabled()) return new Set(unique);

  const params: unknown[] = [unique];
  const clause = relevanceSql(entityType, "e", params);
  params.push(unique.length);
  const rows = await prisma.$queryRawUnsafe<{ id: bigint }[]>(
    `SELECT e.id
       FROM ${TITLE_TABLE[entityType]} e
      WHERE e.id = ANY($1::bigint[])
        AND ${clause}
      LIMIT $${params.length}`,
    ...params,
  );
  return new Set(rows.map((row) => row.id.toString()));
}

/** Um titulo de vitrine: tipo e id. */
export interface RelevanceCandidate {
  readonly entityType: RelevanceEntityType;
  readonly entityId: bigint;
}

/**
 * Mantem, NA ORDEM RECEBIDA, so os candidatos que passam no portao. Filmes e
 * series sao conferidos em paralelo; a ordem da vitrine (trending, votos,
 * bayesiana) nunca muda aqui.
 */
export async function keepRelevant<T extends RelevanceCandidate>(
  prisma: PrismaClient,
  candidates: readonly T[],
): Promise<T[]> {
  if (candidates.length === 0) return [];
  const idsOf = (entityType: RelevanceEntityType): bigint[] =>
    candidates.filter((c) => c.entityType === entityType).map((c) => c.entityId);
  const [movies, series] = await Promise.all([
    relevantTitleIds(prisma, "movie", idsOf("movie")),
    relevantTitleIds(prisma, "tv", idsOf("tv")),
  ]);
  return candidates.filter((c) =>
    (c.entityType === "movie" ? movies : series).has(c.entityId.toString()),
  );
}
