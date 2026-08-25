/**
 * stale-entity-candidates.ts — Selecao de candidatos que PRECISAM de
 * re-consulta (Prisma). COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * Lista ate `limit` entidades locais com `imdb_id` cuja nota mais recente
 * daquele `provider_api` foi coletada ANTES do `cutoff` — ou que nunca foram
 * coletadas. Notas mudam devagar e o plano gratuito da OMDb tem teto DIARIO;
 * reconsultar quem foi visto ha dois dias e cota jogada fora.
 *
 * NUNCA casa por titulo/ano.
 *
 * ============================================================================
 * A ORDEM MUDOU: `popularity DESC NULLS LAST, id ASC` (2026-08-21)
 * ============================================================================
 * Era `id ASC`, e o comentario dava o motivo certo pela razao errada. O motivo —
 * ordem ESTAVEL, para o relatorio nao "pular" candidatos entre execucoes —
 * continua valendo e continua garantido: o desempate por `id` mantem a ordem
 * TOTAL e deterministica.
 *
 * O que estava errado era o CAMPO. `id` e ordem de INSERCAO. Com 239 titulos
 * isso e invisivel; com 10 mil e uma volta de dez dias (1.000 requisicoes/dia,
 * teto do plano gratuito da OMDb), `id ASC` deixa o titulo mais aberto do site
 * esperando nove dias atras de novecentos que ninguem abriu — deterministicamente
 * errado.
 *
 * `popularity` e o sinal MEDIDO que existe: o TMDB o calcula a partir de
 * visualizacoes de pagina, votos e watchlist do dia anterior, ele ja vem
 * preenchido para todo o catalogo, ja tem indice (`@@index([popularity])`) e e
 * atualizado por nos em todo sync de detalhe. Ver `priority.ts` em
 * `@screena/sync` para por que "titulo que o leitor abriu recentemente" NAO foi
 * usado: a Cinerie nao registra visualizacao de pagina, e ordenar por um sinal
 * que nao se mede seria fabricar prioridade.
 *
 * `skippedFresh` NAO e um detalhe cosmetico. Sem ele, um ciclo saudavel em que
 * tudo ja esta fresco reportaria "0 consultados" — indistinguivel de "a selecao
 * quebrou". O numero e o que separa as duas leituras.
 */

import type { PrismaClient } from '@screena/db/server'

import type {
  RatingsEntityCandidate,
  StaleCandidateSelection,
  StaleEntityCandidateSelectPort,
} from '../ports.js'
import type { RatingsEntityType } from '../film-show-ratings/types.js'

/** Linha crua projetada do SQL. */
interface CandidateRow {
  readonly id: bigint
  readonly imdb_id: string
  readonly tmdb_id: number | null
}

/**
 * Conta quantas entidades do tipo foram PULADAS por coleta recente.
 *
 * Consulta separada de proposito: embuti-la na selecao (via window function)
 * misturaria "quem consultar" com "quantos ignorei" numa query so, e o custo de
 * um COUNT sobre indice nao justifica a perda de legibilidade num worker
 * offline.
 */
const SKIPPED_FRESH_SQL = (table: string): string => `
  SELECT count(*)::int AS skipped
    FROM "${table}" e
   WHERE e."imdb_id" IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM "external_ratings" r
        WHERE r."entity_type" = $1::"EntityType"
          AND r."entity_id" = e."id"
          AND r."provider_api" = $2
          AND r."fetched_at" >= $3::timestamptz AT TIME ZONE 'UTC'
     )
`

/**
 * Seleciona candidatos "stale".
 *
 * `NOT EXISTS` cobre os DOIS casos numa condicao so: entidade nunca coletada
 * (nao ha linha) e entidade coletada ha tempo suficiente (a linha existe mas e
 * antiga). Escrever `fetched_at < cutoff` num JOIN deixaria de fora justamente
 * quem nunca foi coletado — o oposto do desejado.
 *
 * A data entra como ISO + `::timestamptz AT TIME ZONE 'UTC'` porque as colunas
 * sao `timestamp` SEM tz armazenando UTC (convencao Prisma): bindar um `Date`
 * cru gravaria/compararia no fuso LOCAL da sessao, e em servidor fora de UTC a
 * janela deslocaria pelo offset. Mesma licao do `external-ratings-store.ts`.
 */
const STALE_SQL = (table: string, withCutoff: boolean): string => `
  SELECT e."id" AS id, e."imdb_id" AS imdb_id, e."tmdb_id" AS tmdb_id
    FROM "${table}" e
   WHERE e."imdb_id" IS NOT NULL
     ${
       withCutoff
         ? `AND NOT EXISTS (
       SELECT 1
         FROM "external_ratings" r
        WHERE r."entity_type" = $1::"EntityType"
          AND r."entity_id" = e."id"
          AND r."provider_api" = $2
          AND r."fetched_at" >= $3::timestamptz AT TIME ZONE 'UTC'
     )`
         : ''
     }
   ORDER BY e."popularity" DESC NULLS LAST, e."id" ASC
   LIMIT ${withCutoff ? '$4' : '$3'}
`

/** Cria um `StaleEntityCandidateSelectPort` sobre `movies` / `tv_shows`. */
export function createPrismaStaleEntityCandidates(
  prisma: PrismaClient,
): StaleEntityCandidateSelectPort {
  return {
    async selectStaleByType(input): Promise<StaleCandidateSelection> {
      const table = input.entityType === 'movie' ? 'movies' : 'tv_shows'
      const take = Math.max(0, Math.trunc(input.limit))
      const withCutoff = input.cutoff !== null

      const rows = withCutoff
        ? await prisma.$queryRawUnsafe<CandidateRow[]>(
            STALE_SQL(table, true),
            input.entityType,
            input.providerApi,
            (input.cutoff as Date).toISOString(),
            take,
          )
        : await prisma.$queryRawUnsafe<CandidateRow[]>(
            STALE_SQL(table, false),
            input.entityType,
            input.providerApi,
            take,
          )

      let skippedFresh = 0
      if (withCutoff) {
        const counted = await prisma.$queryRawUnsafe<{ skipped: number }[]>(
          SKIPPED_FRESH_SQL(table),
          input.entityType,
          input.providerApi,
          (input.cutoff as Date).toISOString(),
        )
        skippedFresh = counted[0]?.skipped ?? 0
      }

      const candidates: RatingsEntityCandidate[] = []
      for (const row of rows) {
        // Defensivo: o WHERE ja filtra imdb nao-nulo, mas nunca enfileiramos um
        // candidato sem IMDb id (a consulta a OMDb depende dele).
        if (row.imdb_id === null || row.imdb_id === undefined) continue
        candidates.push({
          entityType: input.entityType as RatingsEntityType,
          entityId: row.id.toString(),
          imdbId: row.imdb_id,
          tmdbId: row.tmdb_id ?? null,
        })
      }

      return { candidates, skippedFresh }
    },
  }
}
