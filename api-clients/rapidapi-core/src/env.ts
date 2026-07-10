/**
 * env.ts — Leitores puros de variavel de ambiente para clients RapidAPI.
 *
 * INVARIANTE: chaves vivem SO em env vars (nunca no frontend, no bundle ou
 * versionadas). Estes leitores sao PUROS: recebem o ambiente como argumento e
 * nao fazem IO.
 *
 * REGRA DE SEGURANCA: `requireSecret` lanca citando apenas o NOME da variavel —
 * nunca o valor, nem um prefixo dele.
 */

import { RapidApiConfigError } from './errors.js'

/** Forma minima de ambiente aceita (subset de `process.env`). */
export type RapidApiEnv = Record<string, string | undefined>

/** Le uma string nao-vazia (trimada); senao `undefined`. */
export function readNonEmpty(raw: string | undefined): string | undefined {
  if (raw == null) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Le um inteiro positivo (>= 1); cai no default se ausente/invalido. */
export function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return value
}

/** Le um inteiro nao-negativo (>= 0); cai no default se ausente/invalido. */
export function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return fallback
  return value
}

/**
 * Normaliza uma base URL removendo a barra final.
 *
 * O client monta `baseUrl + path`, e todo `path` comeca com `/`. Sem isto, um
 * override de env terminado em `/` produziria `//popular/` — que o servidor
 * pode tratar como outra rota, e que sujaria a `request_key` do `api_cache`.
 */
export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Le um segredo OBRIGATORIO. Falha explicita e clara quando ausente.
 *
 * A mensagem cita SO o nome da variavel — nunca o valor (nem truncado).
 */
export function requireSecret(env: RapidApiEnv, name: string): string {
  const value = readNonEmpty(env[name])
  if (value === undefined) {
    throw new RapidApiConfigError(
      `Variavel de ambiente obrigatoria ausente: "${name}". ` +
        'Defina-a no ambiente do worker (nunca no frontend nem versionada).',
    )
  }
  return value
}
