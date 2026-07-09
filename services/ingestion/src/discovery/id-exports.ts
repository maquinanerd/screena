/**
 * id-exports.ts — Daily ID Exports do TMDB: catalogo de arquivos, montagem de
 * nome/URL por data e parse do formato JSONL. Modulo PURO (sem rede/IO).
 *
 * FONTE OFICIAL: https://developer.themoviedb.org/docs/daily-id-exports.md —
 * arquivos `[type]_ids_MM_DD_YYYY.json.gz` sob `https://files.tmdb.org/p/exports/`,
 * publicados diariamente (job comeca ~07:00 UTC, disponiveis ~08:00 UTC), retidos
 * ~3 meses, com 1 objeto JSON por linha (JSONL gzip).
 *
 * DESCOBERTA != APPEND: aqui cobrimos os 7 tipos exportados, INCLUINDO
 * collection/network/company/keyword. Isso NAO contradiz o `append_to_response`
 * (P0-00b, so 5 tipos): saber que um id EXISTE nao e o mesmo que buscar o
 * detalhe rico daquele id.
 */

/** Base publica dos Daily ID Exports (sem barra final). */
export const TMDB_EXPORTS_BASE_URL = 'https://files.tmdb.org/p/exports'

/** Tipo de entidade descoberto via export (espelha o enum `TmdbEntityKind` do schema). */
export type TmdbDiscoveryKind =
  | 'movie'
  | 'tv'
  | 'person'
  | 'collection'
  | 'network'
  | 'company'
  | 'keyword'

/** Um arquivo de export padrao: prefixo (sem data/extensao) + kind interno. */
export interface IdExportFile {
  /** Prefixo do arquivo, sem data/extensao (ex.: `movie_ids`). */
  readonly file: string
  /** Tipo interno correspondente. */
  readonly kind: TmdbDiscoveryKind
  /**
   * Se o export desse tipo traz o campo `adult` por linha. Quando `true`, um
   * registro SEM `adult` e tratado FAIL-CLOSED (ausencia = anomalia, nunca
   * presumida segura — ver `adult-filter.ts`). `movie` e `person` sempre trazem
   * `adult`; os demais exports nao tem o conceito, entao a ausencia e legitima e
   * segura.
   */
  readonly hasAdultField: boolean
}

/**
 * Os 7 exports PADRAO que a descoberta consome (ordem estavel). NAO inclui os
 * arquivos `adult_*` (ver {@link ADULT_EXPORT_FILES}) — conteudo adulto nunca e
 * baixado (camada 1 do filtro adult).
 */
export const DAILY_ID_EXPORTS: readonly IdExportFile[] = [
  { file: 'movie_ids', kind: 'movie', hasAdultField: true },
  { file: 'tv_series_ids', kind: 'tv', hasAdultField: false },
  { file: 'person_ids', kind: 'person', hasAdultField: true },
  { file: 'collection_ids', kind: 'collection', hasAdultField: false },
  { file: 'tv_network_ids', kind: 'network', hasAdultField: false },
  { file: 'keyword_ids', kind: 'keyword', hasAdultField: false },
  { file: 'production_company_ids', kind: 'company', hasAdultField: false },
]

/**
 * Arquivos `adult_*` publicados pelo TMDB — listados APENAS como trava de
 * governanca/teste. A descoberta NUNCA os baixa nem enfileira (sem conteudo
 * adulto). Camada 1 do filtro adult; a camada 2 e a flag `adult === true`
 * dentro dos arquivos padrao (ver `adult-filter.ts`).
 */
export const ADULT_EXPORT_FILES: readonly string[] = [
  'adult_movie_ids',
  'adult_tv_series_ids',
  'adult_person_ids',
]

/** Formata a data (em UTC) como `MM_DD_YYYY` — o padrao dos nomes de export. */
export function formatExportDate(date: Date): string {
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const yyyy = String(date.getUTCFullYear())
  return `${mm}_${dd}_${yyyy}`
}

/** Nome do arquivo de export para um prefixo + data (ex.: `movie_ids_07_09_2026.json.gz`). */
export function exportFileName(file: string, date: Date): string {
  return `${file}_${formatExportDate(date)}.json.gz`
}

/** URL publica completa de um arquivo de export para uma data. */
export function exportUrl(file: string, date: Date): string {
  return `${TMDB_EXPORTS_BASE_URL}/${exportFileName(file, date)}`
}

/**
 * Registro cru de UMA linha de export. Defensivo: o TMDB pode omitir campos, e
 * so `id` e universal. `adult`/`video`/`popularity` sao os atributos de filtro
 * documentados; `original_title`/`original_name`/`name` ajudam depuracao.
 */
export interface IdExportRecord {
  readonly id: number
  readonly adult?: boolean
  readonly video?: boolean
  readonly popularity?: number
  readonly original_title?: string
  readonly original_name?: string
  readonly name?: string
}

/**
 * Faz parse de UMA linha JSONL do export. Devolve o objeto cru ou `null` para
 * linha vazia/branca ou JSON invalido. NUNCA lanca — um arquivo de ~1M linhas
 * nao pode abortar por causa de 1 linha corrompida; a validacao de `id` e o
 * descarte ficam a cargo do filtro (`filterAdult`).
 */
export function parseIdExportLine(line: string): IdExportRecord | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as IdExportRecord
  } catch {
    return null
  }
}

/** Faz parse de um bloco JSONL inteiro (uma linha por registro; linhas invalidas sao puladas). */
export function parseIdExport(text: string): IdExportRecord[] {
  const out: IdExportRecord[] = []
  for (const line of text.split('\n')) {
    const record = parseIdExportLine(line)
    if (record !== null) out.push(record)
  }
  return out
}
