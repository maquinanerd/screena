/**
 * text-backfill.ts — BACKFILL de SINOPSE (filme/serie) e BIOGRAFIA (pessoa) a
 * partir do payload que JA ESTA no banco. Coberto por `tsconfig.runtime.json`.
 *
 * ============================================================================
 * ZERO CHAMADAS AO TMDB
 * ============================================================================
 * O texto ja foi baixado e pago. `MOVIE_APPEND`/`TV_APPEND`/`PERSON_APPEND`
 * pedem `translations` em toda requisicao de detalhe, e a resposta INTEIRA fica
 * em `api_cache.payload` e em `tmdb_raw.payload`. O que faltava era LEITURA — o
 * extrator olhava so o campo de topo, que o TMDB devolve vazio quando o titulo
 * nao tem traducao no idioma pedido. Ver `../localized-text.ts`.
 *
 * Este backfill nao chama rede. `externalCallsMade` e SEMPRE 0, e existe no
 * relatorio exatamente para que essa afirmacao seja verificavel e nao apenas
 * escrita num comentario.
 *
 * ============================================================================
 * A REGRA DE PRECEDENCIA NAO MORA NO SQL
 * ============================================================================
 * A consulta NAO decide de onde o texto vem. Ela so REDUZ o payload para
 * transporte: devolve o campo de topo e as entradas de `translations` cujo
 * `iso_639_1` e `pt` — as duas regioes, `BR` e `PT`. Quem escolhe entre topo e
 * bloco, e entre `BR` e `PT`, e `pickLocalizedText` em TypeScript, que e a unica
 * fonte da regra.
 *
 * A reducao existe por MEMORIA, nao por politica: um detalhe de filme popular
 * com todos os appends passa de 300 KB, e um lote de 500 linhas traria 150 MB
 * de JSON para escolher um paragrafo. Filtrar por `pt` no SQL corta isso para
 * centenas de bytes por linha SEM decidir nada — `pt-PT` viaja junto justamente
 * para que a medicao do Item E (quantos titulos so o portugues europeu
 * recuperaria) saia da MESMA passagem, sem uma segunda consulta e sem que
 * ninguem precise implementar `pt-PT` para conseguir medi-lo.
 *
 * ============================================================================
 * IDEMPOTENCIA POR `ON CONFLICT`, NAO POR EXCECAO CAPTURADA
 * ============================================================================
 * A escrita e um unico `INSERT ... ON CONFLICT (...) DO UPDATE ... WHERE` por
 * linha. O `WHERE` do `DO UPDATE` e o que garante que texto existente NUNCA e
 * sobrescrito — e a garantia e do PostgreSQL, dentro da mesma instrucao, nao de
 * um `SELECT` anterior que uma execucao concorrente invalidaria.
 *
 * Isso importa em dobro neste projeto: ha precedente de idempotencia feita por
 * EXCECAO CAPTURADA (tenta inserir, engole o erro de chave duplicada), que em
 * rajada queima dezenas de milhares de erros por minuto no PostgreSQL. Aqui a
 * segunda execucao nao gera erro nenhum — gera zero linhas afetadas, e esse zero
 * aparece no relatorio como `refusedExistingText`.
 *
 * ============================================================================
 * O QUE ESTE BACKFILL NAO CONSEGUE CONSERTAR (leia antes de contar vitoria)
 * ============================================================================
 * Preencher `people.biography` NAO faz a pessoa sair de `no_biography`. A
 * politica exige TEXTO **e** licenca:
 *
 *     BTRIM(COALESCE(biography,'')) <> ''
 *     AND biography_source_status IN ('official','licensed','third_party')
 *
 * e `biography_source_status` nasce `unknown` e NADA no repositorio o altera —
 * nem CLI, nem migration, nem worker (verificado repo-wide em 2026-08-28).
 * Liberar a exibicao e DECISAO DE LICENCA, humana por definicao (CLAUDE.md
 * secao 6, invariante 6). Por isso o relatorio deste backfill separa
 * `biographiesFilled` de `biographiesDisplayable`: o primeiro e trabalho feito,
 * o segundo e efeito na pagina, e confundir os dois seria medir sucesso em
 * proxy — exatamente o defeito que esta leva existe para fechar.
 */

import type { PrismaClient } from '@screena/db/server'
import { pickLocalizedText, type LocalizedTextSource } from '../localized-text.js'

/** Tipos com texto recuperavel por este backfill. */
export const TEXT_BACKFILLABLE_TYPES = ['movie', 'tv', 'person'] as const

/** Um tipo elegivel. */
export type TextBackfillEntityType = (typeof TEXT_BACKFILLABLE_TYPES)[number]

/** Motivo de uma entidade candidata nao ter sido recuperada. */
export type TextBackfillSkipReason =
  /** Nao ha payload guardado (nem `api_cache`, nem `tmdb_raw`) para o tmdb_id. */
  | 'no_stored_payload'
  /** Ha payload, e ele nao tem o texto em pt-BR nem no campo de topo. */
  | 'no_text_in_payload'
  /** Ha texto SO em pt-PT — recuperavel apenas por decisao editorial (Item E). */
  | 'only_pt_pt'

/** De qual tabela o payload veio. */
export type StoredPayloadSource = 'api_cache' | 'tmdb_raw'

/** Relatorio de UMA execucao do backfill. */
export interface TextBackfillReport {
  readonly language: string
  readonly dryRun: boolean
  /** Entidades sem texto encontradas nesta execucao. */
  readonly candidates: number
  /** Texto efetivamente recuperado do payload (gravado, ou gravavel em dry-run). */
  readonly recovered: number
  /** Linhas realmente escritas. `0` em dry-run, sempre. */
  readonly written: number
  /**
   * Escritas que o `ON CONFLICT ... WHERE` RECUSOU porque ja havia texto.
   * Numa segunda execucao isto e o numero inteiro — e a prova de idempotencia.
   */
  readonly refusedExistingText: number
  readonly skipped: Readonly<Record<string, number>>
  /** Proveniencia do texto recuperado: campo de topo vs bloco de traducoes. */
  readonly bySource: Readonly<Record<LocalizedTextSource, number>>
  /** De qual tabela o payload foi lido. */
  readonly byPayloadSource: Readonly<Record<StoredPayloadSource, number>>
  readonly byType: Readonly<Record<string, number>>
  /**
   * MEDICAO DO ITEM E, nao implementacao. Quantos candidatos NAO tem pt-BR em
   * lugar nenhum mas TEM `pt-PT` no bloco. Estes NAO sao recuperados: aceitar
   * portugues europeu em pagina pt-BR e escolha editorial do dono.
   */
  readonly recoverableOnlyWithPtPt: number
  /** Amostra de sinopses `pt-PT` reais, para o dono julgar legibilidade (E.2). */
  readonly ptPtSamples: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly tmdbId: number
    readonly text: string
  }[]
  /** Chamadas TMDB executadas. SEMPRE 0 — este backfill nao fala com o provider. */
  readonly externalCallsMade: number
  /** Ultimo id processado por tipo — passe de volta em `resumeFrom` para retomar. */
  readonly checkpoint: Readonly<Record<string, string>>
  readonly samples: readonly {
    readonly entityType: string
    readonly entityId: string
    readonly source: LocalizedTextSource
    readonly excerpt: string
  }[]
}

/** Linha crua de um candidato, com o payload JA REDUZIDO. */
interface CandidateRow {
  readonly entity_id: bigint
  readonly tmdb_id: number
  /** Titulo canonico da linha — usado quando a traducao ainda nao existe. */
  readonly fallback_title: string | null
  /** Payload reduzido de `api_cache`, ou `null`. */
  readonly cache_payload: unknown
  /** Payload reduzido de `tmdb_raw`, ou `null`. */
  readonly raw_payload: unknown
}

/** Nome do campo de texto por tipo, nos DOIS lugares do payload TMDB. */
const TEXT_FIELD: Record<TextBackfillEntityType, 'overview' | 'biography'> = {
  movie: 'overview',
  tv: 'overview',
  person: 'biography',
}

/** Tabela canonica e coluna de titulo por tipo. */
const TABLE: Record<TextBackfillEntityType, { table: string; titleColumn: string }> = {
  movie: { table: 'movies', titleColumn: 'title_original' },
  tv: { table: 'tv_shows', titleColumn: 'name_original' },
  person: { table: 'people', titleColumn: 'name' },
}

/**
 * Endpoint de `api_cache` e `entity_type` de `tmdb_raw`, por tipo.
 *
 * `api_cache.request_key` carrega a querystring, e ela ja mudou de forma nesta
 * base (o rotulo de `append_to_response` da CHAVE nao e o append da REQUISICAO —
 * ver o cabecalho de `import/import-movie.ts`). Casar por `endpoint`, que e
 * estavel, e o que mantem o backfill funcionando sobre linhas de varias epocas;
 * `ORDER BY fetched_at DESC` desempata quando ha mais de uma variante de chave.
 */
const CACHE_ENDPOINT: Record<TextBackfillEntityType, string> = {
  movie: '/movie/',
  tv: '/tv/',
  person: '/person/',
}

/**
 * REDUCAO do payload para transporte. NAO decide precedencia (ver cabecalho).
 *
 * Devolve um objeto com a MESMA FORMA que o extrator espera, contendo apenas o
 * campo de topo e as entradas `pt` do bloco (as duas regioes). `jsonb_agg` sobre
 * conjunto vazio devolve `NULL`, dai o `COALESCE` para `[]`.
 */
function reduzirPayload(coluna: string, field: string): string {
  return `jsonb_build_object(
      '${field}', ${coluna} -> '${field}',
      'translations', jsonb_build_object(
        'translations',
        COALESCE(
          (SELECT jsonb_agg(tr)
             FROM jsonb_array_elements(
                    CASE
                      WHEN jsonb_typeof(${coluna} -> 'translations' -> 'translations') = 'array'
                      THEN ${coluna} -> 'translations' -> 'translations'
                      ELSE '[]'::jsonb
                    END
                  ) AS tr
            WHERE tr ->> 'iso_639_1' = 'pt'),
          '[]'::jsonb)))`
}

/**
 * Candidatos: entidades SEM texto, com o payload guardado ja anexado.
 *
 * O predicado de "sem texto" e o MESMO do produtor de indexabilidade
 * (`indexability-writer.ts`), de proposito: um candidato aqui e exatamente uma
 * entidade que a politica hoje reprova por `no_synopsis`/`no_biography`. Se os
 * dois divergirem, o backfill trabalha e o veredito nao muda — que e a definicao
 * de sucesso medido em proxy.
 */
async function readCandidates(
  prisma: PrismaClient,
  entityType: TextBackfillEntityType,
  limit: number,
  afterId: bigint,
): Promise<CandidateRow[]> {
  const { table, titleColumn } = TABLE[entityType]
  const field = TEXT_FIELD[entityType]

  // O que conta como "ja tem texto" — espelha `has_synopsis` / `has_biography`.
  //
  // Para filme/serie a checagem NAO filtra por idioma, e isso e deliberado: a
  // politica (`indexability-writer.ts`) tambem aceita sinopse em QUALQUER
  // idioma, porque a ficha exibe o idioma de origem com aviso na tela para
  // titulo entrado sob demanda. Filtrar por `pt-BR` aqui produziria candidatos
  // que o produtor de indexabilidade NAO considera sem sinopse — trabalho que
  // nao muda veredito nenhum.
  const semTexto =
    entityType === 'person'
      ? `BTRIM(COALESCE(e.biography, '')) = ''`
      : `NOT EXISTS (SELECT 1 FROM entity_translations tx
                      WHERE tx.entity_type = '${entityType}'::"EntityType" AND tx.entity_id = e.id
                        AND BTRIM(COALESCE(tx.summary, '')) <> '')`

  return prisma.$queryRawUnsafe<CandidateRow[]>(
    `SELECT e.id AS entity_id,
            e.tmdb_id,
            e.${titleColumn} AS fallback_title,
            (SELECT ${reduzirPayload('c.payload', field)}
               FROM api_cache c
              WHERE c.provider_api = 'tmdb'
                AND c.endpoint = '${CACHE_ENDPOINT[entityType]}' || e.tmdb_id::text
              ORDER BY c.fetched_at DESC
              LIMIT 1) AS cache_payload,
            (SELECT ${reduzirPayload('r.payload', field)}
               FROM tmdb_raw r
              WHERE r.entity_type = '${entityType}'::"TmdbEntityKind"
                AND r.tmdb_id = e.tmdb_id
              ORDER BY r.fetched_at DESC
              LIMIT 1) AS raw_payload
       FROM ${table} e
      WHERE e.id > ${afterId.toString()}
        AND ${semTexto}
      ORDER BY e.id
      LIMIT ${Math.max(1, Math.floor(limit))}`,
  )
}

/** Escolhe o payload: `api_cache` primeiro (muito mais populado), `tmdb_raw` depois. */
function escolherPayload(
  row: CandidateRow,
  field: string,
): { payload: unknown; from: StoredPayloadSource } | null {
  for (const [payload, from] of [
    [row.cache_payload, 'api_cache' as const],
    [row.raw_payload, 'tmdb_raw' as const],
  ] as const) {
    if (payload === null || payload === undefined) continue
    if (pickLocalizedText(payload, field).text !== null) return { payload, from }
  }
  // Nenhum dos dois tem o texto — devolve o primeiro que EXISTE, para o
  // chamador poder distinguir "sem payload" de "payload sem texto".
  if (row.cache_payload !== null && row.cache_payload !== undefined) {
    return { payload: row.cache_payload, from: 'api_cache' }
  }
  if (row.raw_payload !== null && row.raw_payload !== undefined) {
    return { payload: row.raw_payload, from: 'tmdb_raw' }
  }
  return null
}

/** O texto `pt-PT` do payload, se houver. Usado SO para medir (Item E). */
function textoPtPt(payload: unknown, field: string): string | null {
  if (payload === null || typeof payload !== 'object') return null
  const bloco = (payload as { translations?: unknown }).translations
  if (bloco === null || typeof bloco !== 'object') return null
  const lista = (bloco as { translations?: unknown }).translations
  if (!Array.isArray(lista)) return null
  for (const item of lista) {
    if (item === null || typeof item !== 'object') continue
    const entrada = item as { iso_639_1?: unknown; iso_3166_1?: unknown; data?: unknown }
    if (entrada.iso_639_1 !== 'pt' || entrada.iso_3166_1 !== 'PT') continue
    if (entrada.data === null || typeof entrada.data !== 'object') continue
    const texto = (entrada.data as Record<string, unknown>)[field]
    if (typeof texto === 'string' && texto.trim() !== '') return texto
  }
  return null
}

/**
 * Grava a sinopse de filme/serie. UM statement, com `ON CONFLICT`.
 *
 * EXPORTADA de proposito: o guard de "so preenche vazio" e a parte que um teste
 * de fluxo NAO alcanca. Rodando o backfill inteiro, uma entidade que ja tem
 * texto simplesmente nao entra no conjunto de candidatos — entao um check do
 * tipo "nao sobrescreveu" passa VERDE sem que a instrucao com `ON CONFLICT`
 * tenha sido executada uma unica vez. O que ele protege e a CORRIDA (outro
 * processo gravando entre a leitura e a escrita), e so chamando a funcao
 * diretamente da para provar que o PostgreSQL recusa.
 *
 * O `WHERE` do `DO UPDATE` e a garantia de "so preenche vazio": o PostgreSQL
 * recusa a atualizacao quando ja ha texto, dentro da mesma instrucao. Devolve o
 * numero de linhas afetadas — `0` significa recusada, e e por ai que a segunda
 * execucao se prova sem efeito.
 */
export async function writeSynopsisIfEmpty(
  prisma: PrismaClient,
  entityType: 'movie' | 'tv',
  entityId: bigint,
  language: string,
  title: string | null,
  summary: string,
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `INSERT INTO entity_translations
       (entity_type, entity_id, language_code, title, summary, created_at, updated_at)
     VALUES ($1::"EntityType", $2::bigint, $3, $4, $5, now(), now())
     ON CONFLICT (entity_type, entity_id, language_code)
     DO UPDATE SET summary = EXCLUDED.summary,
                   title = COALESCE(entity_translations.title, EXCLUDED.title),
                   updated_at = now()
      WHERE BTRIM(COALESCE(entity_translations.summary, '')) = ''`,
    entityType,
    entityId,
    language,
    title,
    summary,
  )
}

/**
 * Grava a biografia de pessoa. Nao ha insert: a linha existe.
 *
 * O `AND` no `WHERE` faz o mesmo papel do `WHERE` do `DO UPDATE` — a condicao de
 * "so preenche vazio" e avaliada pelo banco, na propria instrucao.
 *
 * `biography_source_status` NAO e tocado: continua `unknown`, e a pessoa continua
 * `no_biography` ate uma decisao humana de licenca. Ver o cabecalho do arquivo.
 */
export async function writeBiographyIfEmpty(
  prisma: PrismaClient,
  entityId: bigint,
  biography: string,
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `UPDATE people
        SET biography = $2, updated_at = now()
      WHERE id = $1::bigint
        AND BTRIM(COALESCE(biography, '')) = ''`,
    entityId,
    biography,
  )
}

/** Opcoes da execucao. */
export interface TextBackfillOptions {
  readonly language: string
  readonly entityTypes?: readonly TextBackfillEntityType[]
  /** Tamanho do LOTE de leitura. Default 500. */
  readonly batchSize?: number
  /** Teto de entidades processadas por tipo. Omitido = sem teto. */
  readonly limit?: number
  readonly dryRun: boolean
  /** Checkpoint devolvido por uma execucao anterior. */
  readonly resumeFrom?: Readonly<Record<string, string>>
  /** Chamado ao fim de cada lote — progresso para execucao longa (D.3). */
  readonly onBatch?: (progress: {
    readonly entityType: string
    readonly seen: number
    readonly recovered: number
    readonly lastId: string
  }) => void
}

/** Lote default. 500 linhas de payload REDUZIDO cabem folgadas na memoria. */
export const DEFAULT_BATCH_SIZE = 500

/** Executa o backfill de texto. NUNCA chama o TMDB. */
export async function backfillMissingText(
  prisma: PrismaClient,
  options: TextBackfillOptions,
): Promise<TextBackfillReport> {
  const types = options.entityTypes ?? TEXT_BACKFILLABLE_TYPES
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const cap = options.limit ?? null

  const skipped: Record<string, number> = {}
  const bySource: Record<LocalizedTextSource, number> = { detail: 0, translations: 0 }
  const byPayloadSource: Record<StoredPayloadSource, number> = { api_cache: 0, tmdb_raw: 0 }
  const byType: Record<string, number> = {}
  const checkpoint: Record<string, string> = {}
  const samples: TextBackfillReport['samples'][number][] = []
  const ptPtSamples: TextBackfillReport['ptPtSamples'][number][] = []
  let candidates = 0
  let recovered = 0
  let written = 0
  let refusedExistingText = 0
  let recoverableOnlyWithPtPt = 0

  const skip = (reason: TextBackfillSkipReason): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1
  }

  for (const entityType of types) {
    const field = TEXT_FIELD[entityType]
    let after = BigInt(options.resumeFrom?.[entityType] ?? '0')
    let vistos = 0

    for (;;) {
      const restante = cap === null ? batchSize : Math.min(batchSize, cap - vistos)
      if (restante <= 0) break
      const rows = await readCandidates(prisma, entityType, restante, after)
      if (rows.length === 0) break

      for (const row of rows) {
        candidates += 1
        vistos += 1
        after = row.entity_id
        checkpoint[entityType] = String(row.entity_id)

        const escolhido = escolherPayload(row, field)
        if (escolhido === null) {
          skip('no_stored_payload')
          continue
        }

        const texto = pickLocalizedText(escolhido.payload, field)
        if (texto.text === null || texto.source === null) {
          // MEDICAO do Item E: sem pt-BR, mas com pt-PT? Nao recupera — mede.
          const europeu = textoPtPt(escolhido.payload, field)
          if (europeu !== null) {
            recoverableOnlyWithPtPt += 1
            if (ptPtSamples.length < 20) {
              ptPtSamples.push({
                entityType,
                entityId: String(row.entity_id),
                tmdbId: row.tmdb_id,
                text: europeu,
              })
            }
            skip('only_pt_pt')
          } else {
            skip('no_text_in_payload')
          }
          continue
        }

        recovered += 1
        bySource[texto.source] += 1
        byPayloadSource[escolhido.from] += 1
        byType[entityType] = (byType[entityType] ?? 0) + 1
        if (samples.length < 20) {
          samples.push({
            entityType,
            entityId: String(row.entity_id),
            source: texto.source,
            excerpt: texto.text.slice(0, 120),
          })
        }

        if (options.dryRun) continue

        const afetadas =
          entityType === 'person'
            ? await writeBiographyIfEmpty(prisma, row.entity_id, texto.text)
            : await writeSynopsisIfEmpty(
                prisma,
                entityType,
                row.entity_id,
                options.language,
                row.fallback_title,
                texto.text,
              )
        if (afetadas > 0) written += afetadas
        else refusedExistingText += 1
      }

      options.onBatch?.({
        entityType,
        seen: vistos,
        recovered,
        lastId: String(after),
      })
      if (rows.length < restante) break
    }
  }

  return {
    language: options.language,
    dryRun: options.dryRun,
    candidates,
    recovered,
    written,
    refusedExistingText,
    skipped: Object.freeze(skipped),
    bySource: Object.freeze(bySource),
    byPayloadSource: Object.freeze(byPayloadSource),
    byType: Object.freeze(byType),
    recoverableOnlyWithPtPt,
    ptPtSamples,
    externalCallsMade: 0,
    checkpoint: Object.freeze(checkpoint),
    samples,
  }
}
