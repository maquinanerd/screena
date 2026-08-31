/**
 * normalize.ts — Normalizacoes puras de campos TMDB.
 *
 * Sem rede/DB. A ingestao NAO inventa dado: campos ausentes/invalidos viram
 * `null`. `original_language` so e mantido quando o codigo existe em
 * `languages` — nunca cria idioma fora do seed (a FK
 * `movies.original_language -> languages.code` exige).
 *
 * ============================================================================
 * A LISTA FECHADA ERA AQUI — E O QUE ELA CUSTOU
 * ============================================================================
 * Ate 2026-08-31 `languages` tinha TRES linhas (`pt-BR`, `en`, `es`), entao
 * este guarda-FK virou, na pratica, uma allowlist de dois idiomas: tudo que nao
 * fosse `en` ou `es` virava NULL. Medido em producao: 20.825 filmes (43%) e
 * 20.680 series (60%) com a coluna nula, e a coluna INTEIRA com tres valores
 * possiveis. O portugues era o caso mais cruel — o TMDB emite `pt`, a tabela
 * tinha `pt-BR`, e todo titulo brasileiro caia para NULL.
 *
 * O defeito NUNCA foi este arquivo: ele fazia exatamente o que a FK exigia. O
 * defeito era `languages` acumular dois papeis (dicionario de idiomas do mundo
 * + politica de autoria). Separados os dois — vocabulario ISO 639-1 completo em
 * `@screena/db` `LANGUAGE_VOCABULARY`, politica em `CONTENT_AUTHORING_LOCALES`
 * de `@screena/config` — este guarda passou a cobrir o mundo, e o idioma que
 * vem do TMDB e gravado como vem.
 *
 * ============================================================================
 * O QUE SOBROU DE FECHADO, E POR QUE NAO E MAIS SILENCIOSO
 * ============================================================================
 * Um codigo que o TMDB emita e nao esteja no vocabulario continua virando
 * `null` — a alternativa seria estourar a FK e derrubar o job inteiro. O que
 * mudou e que ele deixa de sumir calado: `readOriginalLanguage` devolve o valor
 * RECUSADO, e quem tem canal de relatorio (o backfill) o conta e o imprime por
 * codigo. Descarte silencioso e o defeito que esta leva existe para fechar;
 * repeti-lo aqui seria trocar de esconderijo.
 */

import { LANGUAGE_SEED } from '@screena/db'

/**
 * Codigos de idioma conhecidos (espelha o seed `languages`).
 *
 * `LANGUAGE_SEED` passou a conter o vocabulario ISO 639-1 inteiro (186 codigos,
 * incluindo os tres desvios que o TMDB emite: `cn`, `sh`, `xx`), alem dos
 * locales de autoria. Continua sendo a MESMA fonte da tabela — o que mudou foi
 * o tamanho dela.
 */
const KNOWN_LANGUAGE_CODES: ReadonlySet<string> = new Set(LANGUAGE_SEED.map((lang) => lang.code))

/** String nao-vazia (trimada) ou null. */
export function nullableString(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/** Numero finito ou null. */
export function nullableNumber(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

/** imdb_id valido (nao-vazio) ou null. Respeita o CHECK `imdb_id <> ''`. */
export function normalizeImdbId(raw: string | null | undefined): string | null {
  return nullableString(raw)
}

/** Data TMDB ('YYYY-MM-DD') validada por forma, ou null. Nao tenta corrigir. */
export function normalizeDate(raw: string | null | undefined): string | null {
  const value = nullableString(raw)
  if (value === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

/**
 * Leitura de `original_language` com o motivo do descarte PRESERVADO.
 *
 * Tres desfechos, e distingui-los importa: "o TMDB nao mandou idioma" e um
 * fato sobre o payload; "o TMDB mandou um codigo que nao conhecemos" e um
 * fato sobre NOS. Colapsar os dois em `null` foi o que deixou 41.505 titulos
 * mudos sem ninguem perceber.
 */
export type OriginalLanguageOutcome =
  /** Codigo aceito, gravavel na coluna. */
  | { readonly code: string; readonly rejected: null }
  /** Veio codigo, e ele NAO existe em `languages` (viraria violacao de FK). */
  | { readonly code: null; readonly rejected: string }
  /** Nao veio codigo nenhum. */
  | { readonly code: null; readonly rejected: null }

/** Le `original_language` devolvendo tambem o codigo recusado, quando houver. */
export function readOriginalLanguage(raw: string | null | undefined): OriginalLanguageOutcome {
  const code = nullableString(raw)
  if (code === null) return { code: null, rejected: null }
  if (KNOWN_LANGUAGE_CODES.has(code)) return { code, rejected: null }
  return { code: null, rejected: code }
}

/**
 * original_language: gravado COMO VEM quando o codigo existe em `languages`.
 *
 * Quem precisa saber que houve recusa usa `readOriginalLanguage`; esta forma
 * curta existe para os normalizadores, que so tem uma coluna para preencher.
 */
export function normalizeOriginalLanguage(raw: string | null | undefined): string | null {
  return readOriginalLanguage(raw).code
}

/** True se o codigo de idioma e conhecido (existe no seed `languages`). */
export function isKnownLanguage(code: string): boolean {
  return KNOWN_LANGUAGE_CODES.has(code)
}
