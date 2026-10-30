/**
 * stale-entity-candidates.ts — Selecao de candidatos a consulta OMDb (Prisma).
 * COBERTO pelo typecheck da raiz E por `tsconfig.runtime.json`.
 *
 * Lista ate `limit` entidades locais com `imdb_id`. NUNCA casa por titulo/ano.
 *
 * ============================================================================
 * DOIS TRABALHOS, DOIS CONJUNTOS DISJUNTOS (2026-08-31)
 * ============================================================================
 * Ate aqui havia UMA consulta, e ela juntava dois conjuntos com um `NOT EXISTS`
 * sobre `(provider_api, fetched_at >= cutoff)`: "nunca coletado" e "coletado ha
 * tempo". Juntar foi conveniente e foi o erro. Os dois pedem orcamentos
 * diferentes, ordens diferentes e ate um relogio diferente:
 *
 *   `coverage` — ZERO linhas em `external_ratings`, de QUALQUER provider. Nao
 *                aplica cutoff de FRESCOR: `now - never` nao e um intervalo.
 *                Trabalho FINITO — ele acaba. Mas pula, por
 *                `OMDB_COVERAGE_RETRY_AFTER_DAYS`, quem a OMDb JA respondeu sem
 *                nota (ver "ZERO NOTAS NAO E NUNCA PERGUNTADO" abaixo).
 *   `refresh`  — TEM linha, e a coleta daquele provider e anterior ao cutoff.
 *                Aqui sim `RATING_STALE_POLICY` manda. Trabalho PERPETUO.
 *
 * Os conjuntos sao DISJUNTOS por construcao (`NOT EXISTS(qualquer)` versus
 * `EXISTS(qualquer)`), entao nenhum titulo e consultado duas vezes no mesmo dia
 * por dois lotes diferentes — o que gastaria cota em dobro pelo mesmo payload.
 *
 * Por que `coverage` olha QUALQUER provider e nao so `omdb`: "tem nota" e um
 * fato sobre a PAGINA, nao sobre o cano. Um titulo com nota vinda de outro
 * provider ja nao esta mudo, e mandar a cobertura atras dele gastaria a fatia
 * finita no titulo errado.
 *
 * ============================================================================
 * A ORDEM E EDITORIAL, NAO DE INSERCAO NEM SO DE POPULARIDADE
 * ============================================================================
 * Era `popularity DESC NULLS LAST, id ASC` — melhor que o `id ASC` que veio
 * antes, e ainda assim cego para a unica coisa que o leitor faz: procurar o que
 * ACABOU de estrear. `popularity` do TMDB reage a estreia com atraso e nunca
 * sabe que um filme estreia semana que vem.
 *
 * Prioridade declarada (a mesma para os dois modos):
 *
 *   1  estreou dentro da janela de exibicao (ate 90 dias atras)
 *   2  estreia nos proximos 60 dias
 *   3  serie com temporada no ar
 *   4  o resto, por `popularity` DESC NULLS LAST
 *   5  desempate ESTAVEL por `id` ASC
 *
 * O balde 1 usa 90 dias, nao 30: "estreou nos ultimos 30 dias" e "ainda em
 * cartaz" sao o MESMO balde no enunciado, e a corrida de cinema tipica cobre os
 * dois em ~90 dias. Separa-los criaria um balde 1 que esvazia em 30 dias e um
 * balde 1b indistinguivel na pratica.
 *
 * O balde 3 usa `('Returning Series', 'In Production')`, mais estreito que o
 * `AIRING_TV_STATUSES` de `@screena/sync` (que inclui `Planned` e `Pilot`).
 * Deliberado: aquele conjunto responde "o detalhe ainda muda?"; este responde
 * "tem episodio no ar?". `Planned` nao tem.
 *
 * O desempate por `id` NAO e decorativo: ele mantem a ordem TOTAL e
 * deterministica, entao dois ciclos com o mesmo limite selecionam o mesmo
 * prefixo e o relatorio nao "pula" candidatos entre execucoes.
 *
 * CUSTO: a `CASE` no `ORDER BY` impede uso do indice de `release_date` para
 * ordenar — o plano vira scan + top-N heapsort. Sobre 48k filmes, num worker
 * OFFLINE, isso e ordem de dezenas de ms; o gate de render (invariante 3) nao e
 * tocado. Trocar correcao de prioridade por um indice aqui seria otimizar o lado
 * errado.
 *
 * `skippedFresh` NAO e cosmetico. Sem ele, um ciclo saudavel em que tudo ja esta
 * fresco reportaria "0 consultados" — indistinguivel de "a selecao quebrou". O
 * numero e o que separa as duas leituras. No modo `coverage` ele conta quem foi
 * pulado por ter sido PERGUNTADO ha menos de `OMDB_COVERAGE_RETRY_AFTER_DAYS`.
 *
 * ============================================================================
 * ZERO NOTAS NAO E NUNCA PERGUNTADO (2026-10-29)
 * ============================================================================
 * A ordem e total e deterministica, e a cobertura nao tinha memoria de quem ja
 * tinha perguntado: o titulo que a OMDb responde "N/A" continua com zero notas e
 * voltava ao topo todo dia. Medido em producao: 618 das 700 consultas do dia
 * repetiam titulos ja perguntados, e 7.343 dos 7.737 filmes populares nunca
 * tinham sido alcancados. Ver `OMDB_COVERAGE_RETRY_AFTER_DAYS` em
 * `@screena/config`.
 *
 * A memoria e o proprio `api_cache`: toda consulta que toca a rede grava ali a
 * resposta, inclusive "N/A" e `Response: "False"`, na chave do cliente OMDb. A
 * chave vem de `buildOmdbByImdbIdRequest` — o MESMO construtor que a consulta
 * usa —, nunca de uma string montada a mao aqui: se o formato da chave mudar, os
 * dois lados mudam juntos.
 */

import type { PrismaClient } from '@screena/db/server'
import {
  OMDB_COVERAGE_RECENT_MIN_VOTES,
  OMDB_COVERAGE_RECENT_RETRY_AFTER_DAYS,
  OMDB_COVERAGE_RETRY_AFTER_DAYS,
  type OmdbRotationMode,
} from '@screena/config'
import { buildOmdbByImdbIdRequest } from '@screena/omdb-client'

import type {
  RatingsEntityCandidate,
  StaleCandidateSelection,
  StaleEntityCandidateSelectPort,
} from '../ports.js'
import type { RatingsEntityType } from '../entity-types.js'

/** Linha crua projetada do SQL. */
interface CandidateRow {
  readonly id: bigint
  readonly imdb_id: string
  readonly tmdb_id: number | null
}

/** Janela de exibicao: estreou ha ate tantos dias ainda e "novidade". */
export const RECENT_RELEASE_WINDOW_DAYS = 90
/** Estreia anunciada dentro desta janela ja merece nota antes da estreia. */
export const UPCOMING_RELEASE_WINDOW_DAYS = 60
/** Serie com episodio no ar, no vocabulario do TMDB. */
const ON_AIR_TV_STATUSES = "('Returning Series', 'In Production')"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A clausula de PRIORIDADE editorial, por tipo.
 *
 * Recebe os INDICES dos tres parametros de data (piso da janela recente, hoje,
 * teto da janela futura). As datas vem de `now` INJETADO, nunca de
 * `CURRENT_DATE`: misturar o relogio do processo com o do banco tornaria a
 * ordem impossivel de testar de forma determinista.
 *
 * Cada `$n` entra como ISO + `::timestamptz AT TIME ZONE 'UTC'` -> `::date`
 * porque as colunas sao `date` guardando UTC (convencao Prisma); bindar um
 * `Date` cru compararia no fuso LOCAL da sessao, e num servidor fora de UTC a
 * janela deslizaria pelo offset. Mesma licao do `external-ratings-store.ts`.
 *
 * NAO ha guarda de NULL. `release_date`/`first_air_date` nulo faz as duas
 * primeiras comparacoes darem NULL (nunca `true`), e a linha cai naturalmente no
 * balde 3 (serie no ar) ou 4. Uma guarda `WHEN date IS NULL THEN 4` antecipada
 * mandaria uma serie EM EXIBICAO sem data de estreia para o fim da fila — o
 * oposto do que o balde 3 existe para fazer.
 */
function priorityCase(
  entityType: RatingsEntityType,
  floorIdx: number,
  todayIdx: number,
  ceilIdx: number,
): string {
  const dateColumn = entityType === 'movie' ? 'release_date' : 'first_air_date'
  const asDate = (idx: number): string => `($${String(idx)}::timestamptz AT TIME ZONE 'UTC')::date`
  const floor = asDate(floorIdx)
  const today = asDate(todayIdx)
  const ceil = asDate(ceilIdx)

  // Balde 3 so existe para serie: um filme nao tem temporada no ar.
  const onAir = entityType === 'tv' ? `
      WHEN e."status" IN ${ON_AIR_TV_STATUSES} THEN 3` : ''

  return `CASE
      WHEN e."${dateColumn}" >= ${floor} AND e."${dateColumn}" <= ${today} THEN 1
      WHEN e."${dateColumn}" > ${today} AND e."${dateColumn}" <= ${ceil} THEN 2${onAir}
      ELSE 4
    END`
}

/**
 * Existe QUALQUER nota externa para esta entidade?
 *
 * Sem `provider_api`: ver o cabecalho — "tem nota" e fato sobre a pagina.
 * Coberto por `external_ratings_entity_type_entity_id_idx`.
 */
const ANY_RATING_EXISTS = `
       SELECT 1
         FROM "external_ratings" r
        WHERE r."entity_type" = $1::"EntityType"
          AND r."entity_id" = e."id"
`

/** A coleta DAQUELE provider e recente demais para justificar nova requisicao? */
const FRESH_FOR_PROVIDER = `
       SELECT 1
         FROM "external_ratings" r
        WHERE r."entity_type" = $1::"EntityType"
          AND r."entity_id" = e."id"
          AND r."provider_api" = $2
          AND r."fetched_at" >= $3::timestamptz AT TIME ZONE 'UTC'
`

/**
 * Conta quantas entidades do modo `refresh` foram PULADAS por coleta recente.
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
     AND EXISTS (${FRESH_FOR_PROVIDER})
`

/** Um imdb id que nao existe, so para descobrir onde o id entra na chave. */
const KEY_PROBE_IMDB_ID = 'tt0000000'

/**
 * Prefixo e sufixo da `request_key` que o cliente OMDb grava em `api_cache`,
 * em volta do imdb id. Derivados do construtor real — ver o cabecalho.
 */
export function omdbCacheKeyParts(): { readonly prefix: string; readonly suffix: string } {
  const key = buildOmdbByImdbIdRequest(KEY_PROBE_IMDB_ID).cacheKey.requestKey
  const parts = key.split(KEY_PROBE_IMDB_ID)
  if (parts.length !== 2) {
    // Fail-loud: sem saber onde o id entra, a selecao nao reconheceria nenhuma
    // consulta anterior e voltaria a reperguntar tudo todo dia, calada.
    throw new Error(`chave de cache OMDb sem lugar unico para o imdb id: ${key}`)
  }
  return { prefix: parts[0] as string, suffix: parts[1] as string }
}

/** Indices dos parametros que `recentAttempt` le. */
interface AttemptParams {
  readonly provider: number
  readonly prefix: number
  readonly suffix: number
  /** Corte LONGO (`OMDB_COVERAGE_RETRY_AFTER_DAYS`). */
  readonly cutoff: number
  /** Corte CURTO da estreia com publico (`OMDB_COVERAGE_RECENT_RETRY_AFTER_DAYS`). */
  readonly recentCutoff: number
  /** Piso e hoje da janela de estreia (os mesmos da ordem editorial). */
  readonly floor: number
  readonly today: number
  /** `OMDB_COVERAGE_RECENT_MIN_VOTES`. */
  readonly minVotes: number
}

/**
 * A OMDb ja foi perguntada sobre esta entidade desde o corte DELA?
 *
 * O corte depende do titulo: a estreia com publico (estreou na janela recente e
 * tem votos no TMDB) usa o curto; o resto usa o longo. Coberto pelo unique
 * `(provider_api, request_key, params_hash)` de `api_cache`.
 */
const recentAttempt = (entityType: RatingsEntityType, p: AttemptParams): string => {
  const dateColumn = entityType === 'movie' ? 'release_date' : 'first_air_date'
  const asDate = (idx: number): string => `($${String(idx)}::timestamptz AT TIME ZONE 'UTC')::date`
  return `
       SELECT 1
         FROM "api_cache" c
        WHERE c."provider_api" = $${String(p.provider)}
          AND c."request_key" = $${String(p.prefix)} || e."imdb_id" || $${String(p.suffix)}
          AND c."fetched_at" >= CASE
                WHEN e."${dateColumn}" >= ${asDate(p.floor)}
                 AND e."${dateColumn}" <= ${asDate(p.today)}
                 AND COALESCE(e."vote_count_tmdb", 0) >= $${String(p.minVotes)}::int
                THEN $${String(p.recentCutoff)}::timestamptz AT TIME ZONE 'UTC'
                ELSE $${String(p.cutoff)}::timestamptz AT TIME ZONE 'UTC'
              END
`
}

/**
 * Candidatos do modo `coverage`: zero notas, de qualquer provider, e nao
 * perguntados desde o corte de repergunta daquele titulo.
 *
 * Params: $1 entityType, $2 piso, $3 hoje, $4 teto, $5 limite,
 *         $6 provider, $7 prefixo da chave, $8 sufixo da chave, $9 corte longo,
 *         $10 corte curto, $11 votos minimos.
 * Nao ha cutoff de FRESCOR aqui — e o ponto do modo; o corte e de TENTATIVA.
 */
const COVERAGE_SQL = (table: string, entityType: RatingsEntityType): string => `
  SELECT e."id" AS id, e."imdb_id" AS imdb_id, e."tmdb_id" AS tmdb_id
    FROM "${table}" e
   WHERE e."imdb_id" IS NOT NULL
     AND NOT EXISTS (${ANY_RATING_EXISTS})
     AND NOT EXISTS (${recentAttempt(entityType, {
       provider: 6,
       prefix: 7,
       suffix: 8,
       cutoff: 9,
       recentCutoff: 10,
       floor: 2,
       today: 3,
       minVotes: 11,
     })})
   ORDER BY ${priorityCase(entityType, 2, 3, 4)},
            e."popularity" DESC NULLS LAST,
            e."id" ASC
   LIMIT $5
`

/**
 * Conta quem a cobertura PULOU por ter sido perguntado ha pouco.
 *
 * Params: $1 entityType, $2 provider, $3 prefixo, $4 sufixo, $5 corte longo,
 *         $6 corte curto, $7 piso, $8 hoje, $9 votos minimos.
 */
const COVERAGE_SKIPPED_SQL = (table: string, entityType: RatingsEntityType): string => `
  SELECT count(*)::int AS skipped
    FROM "${table}" e
   WHERE e."imdb_id" IS NOT NULL
     AND NOT EXISTS (${ANY_RATING_EXISTS})
     AND EXISTS (${recentAttempt(entityType, {
       provider: 2,
       prefix: 3,
       suffix: 4,
       cutoff: 5,
       recentCutoff: 6,
       floor: 7,
       today: 8,
       minVotes: 9,
     })})
`

/**
 * Candidatos do modo `refresh`: ja tem nota, e a coleta do provider e antiga.
 *
 * Com cutoff:  $1 tipo, $2 provider, $3 cutoff, $4 piso, $5 hoje, $6 teto, $7 limite.
 * Sem cutoff:  $1 tipo, $2 provider, $3 piso, $4 hoje, $5 teto, $6 limite.
 *
 * Sem cutoff (politica de frescor ausente) nao filtramos por tempo, mas o
 * `EXISTS` continua: sem ele o modo invadiria o conjunto da cobertura e os dois
 * lotes do dia consultariam o mesmo titulo, pagando duas vezes pelo mesmo
 * payload.
 *
 * `$2` fica bound e nao referenciado no ramo sem cutoff. E deliberado: o Postgres
 * deriva a aridade do MAIOR `$n`, entao o parametro existe de qualquer forma, e
 * manter a posicao fixa evita renumerar a lista inteira em dois lugares.
 */
const REFRESH_SQL = (table: string, entityType: RatingsEntityType, withCutoff: boolean): string => {
  const floorIdx = withCutoff ? 4 : 3
  const limitIdx = withCutoff ? 7 : 6
  const staleClause = withCutoff ? `
     AND NOT EXISTS (${FRESH_FOR_PROVIDER})` : ''

  return `
  SELECT e."id" AS id, e."imdb_id" AS imdb_id, e."tmdb_id" AS tmdb_id
    FROM "${table}" e
   WHERE e."imdb_id" IS NOT NULL
     AND EXISTS (${ANY_RATING_EXISTS})${staleClause}
   ORDER BY ${priorityCase(entityType, floorIdx, floorIdx + 1, floorIdx + 2)},
            e."popularity" DESC NULLS LAST,
            e."id" ASC
   LIMIT $${String(limitIdx)}
`
}

/** Cria um `StaleEntityCandidateSelectPort` sobre `movies` / `tv_shows`. */
export function createPrismaStaleEntityCandidates(
  prisma: PrismaClient,
): StaleEntityCandidateSelectPort {
  return {
    async selectStaleByType(input): Promise<StaleCandidateSelection> {
      const table = input.entityType === 'movie' ? 'movies' : 'tv_shows'
      const take = Math.max(0, Math.trunc(input.limit))
      const mode: OmdbRotationMode = input.mode ?? 'refresh'
      const now = input.now ?? new Date()

      // Os TRES marcos da ordem editorial. `today` e explicito (e nao
      // `CURRENT_DATE`) para que a ordem seja testavel com um relogio fixo.
      const floor = new Date(now.getTime() - RECENT_RELEASE_WINDOW_DAYS * DAY_MS).toISOString()
      const today = now.toISOString()
      const ceil = new Date(now.getTime() + UPCOMING_RELEASE_WINDOW_DAYS * DAY_MS).toISOString()

      let rows: CandidateRow[]
      let skippedFresh = 0

      if (mode === 'coverage') {
        // Nenhum cutoff de frescor: nada aqui tem nota. O corte e de TENTATIVA —
        // quem a OMDb respondeu sem nota espera a janela antes de voltar.
        const { prefix, suffix } = omdbCacheKeyParts()
        const retryCutoff = new Date(
          now.getTime() - OMDB_COVERAGE_RETRY_AFTER_DAYS * DAY_MS,
        ).toISOString()
        const recentRetryCutoff = new Date(
          now.getTime() - OMDB_COVERAGE_RECENT_RETRY_AFTER_DAYS * DAY_MS,
        ).toISOString()
        rows = await prisma.$queryRawUnsafe<CandidateRow[]>(
          COVERAGE_SQL(table, input.entityType),
          input.entityType,
          floor,
          today,
          ceil,
          take,
          input.providerApi,
          prefix,
          suffix,
          retryCutoff,
          recentRetryCutoff,
          OMDB_COVERAGE_RECENT_MIN_VOTES,
        )
        const counted = await prisma.$queryRawUnsafe<{ skipped: number }[]>(
          COVERAGE_SKIPPED_SQL(table, input.entityType),
          input.entityType,
          input.providerApi,
          prefix,
          suffix,
          retryCutoff,
          recentRetryCutoff,
          floor,
          today,
          OMDB_COVERAGE_RECENT_MIN_VOTES,
        )
        skippedFresh = counted[0]?.skipped ?? 0
      } else {
        const withCutoff = input.cutoff !== null
        rows = withCutoff
          ? await prisma.$queryRawUnsafe<CandidateRow[]>(
              REFRESH_SQL(table, input.entityType, true),
              input.entityType,
              input.providerApi,
              (input.cutoff as Date).toISOString(),
              floor,
              today,
              ceil,
              take,
            )
          : await prisma.$queryRawUnsafe<CandidateRow[]>(
              REFRESH_SQL(table, input.entityType, false),
              input.entityType,
              input.providerApi,
              floor,
              today,
              ceil,
              take,
            )

        if (withCutoff) {
          const counted = await prisma.$queryRawUnsafe<{ skipped: number }[]>(
            SKIPPED_FRESH_SQL(table),
            input.entityType,
            input.providerApi,
            (input.cutoff as Date).toISOString(),
          )
          skippedFresh = counted[0]?.skipped ?? 0
        }
      }

      const candidates: RatingsEntityCandidate[] = []
      for (const row of rows) {
        // Defensivo: o WHERE ja filtra imdb nao-nulo, mas nunca enfileiramos um
        // candidato sem IMDb id (a consulta a OMDb depende dele).
        if (row.imdb_id === null || row.imdb_id === undefined) continue
        candidates.push({
          entityType: input.entityType,
          entityId: row.id.toString(),
          imdbId: row.imdb_id,
          tmdbId: row.tmdb_id ?? null,
        })
      }

      return { candidates, skippedFresh }
    },
  }
}
