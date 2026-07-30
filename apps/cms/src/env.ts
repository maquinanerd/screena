/**
 * env.ts — Validacao de configuracao do CMS. PURO (recebe o env como argumento).
 *
 * O CMS tem banco PROPRIO. Este modulo existe para tornar impossivel, por
 * acidente de configuracao, o Payload apontar para o banco publico do Cinerie:
 * um `migrate` do Payload contra o `screen-db` criaria dezenas de tabelas no
 * banco que serve o site.
 *
 * Regras (todas fail-closed):
 *  - `PAYLOAD_DATABASE_URL` obrigatoria; `DATABASE_URL` NUNCA e fallback;
 *  - `PAYLOAD_SECRET` obrigatoria e com tamanho minimo;
 *  - se `PAYLOAD_DATABASE_URL === DATABASE_URL`, aborta;
 *  - se a URL parecer um banco publico conhecido do Cinerie, aborta.
 *
 * Nenhuma funcao aqui imprime URL, usuario, senha ou segredo — nem em erro.
 */

/** Subconjunto tipado do ambiente lido pelo CMS. So nomes, nunca valores. */
export interface CmsEnv {
  readonly PAYLOAD_DATABASE_URL?: string
  readonly PAYLOAD_SECRET?: string
  /** Presente apenas para DETECTAR colisao. O CMS jamais a utiliza. */
  readonly DATABASE_URL?: string
  readonly NODE_ENV?: string
  readonly PAYLOAD_PUBLIC_SERVER_URL?: string
}

export const PAYLOAD_DATABASE_URL_KEY = 'PAYLOAD_DATABASE_URL' as const
export const PAYLOAD_SECRET_KEY = 'PAYLOAD_SECRET' as const

/** Tamanho minimo do segredo. Curto demais e o mesmo que nao ter. */
export const MIN_SECRET_LENGTH = 32

/**
 * Padroes de nome que denunciam o banco publico do Cinerie.
 *
 * Heuristica por NOME, igual a barreira ja usada em
 * `services/news-ingestion/bin/editorial.ts`. E a segunda camada; a primeira e
 * exigir uma variavel separada.
 */
const PUBLIC_DATABASE_PATTERNS: readonly RegExp[] = [
  /rss_prime/i,
  /screen-db/i,
  /screen_db/i,
  /screena/i,
  /cinerie-db/i,
  /cinerie_db/i,
  /_prod\b/i,
  /production/i,
]

export type CmsConfigErrorCode =
  | 'missing_payload_database_url'
  | 'missing_payload_secret'
  | 'weak_payload_secret'
  | 'payload_database_url_equals_database_url'
  | 'payload_database_url_looks_public'
  | 'payload_database_url_invalid'

export interface CmsConfigError {
  readonly code: CmsConfigErrorCode
  /** Mensagem SEGURA: descreve o problema sem citar o valor. */
  readonly message: string
}

export type CmsConfigResult =
  | { readonly ok: true; readonly databaseUrl: string; readonly secret: string }
  | { readonly ok: false; readonly errors: readonly CmsConfigError[] }

function trimToNull(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Valida a configuracao do CMS.
 *
 * Acumula TODOS os erros em vez de parar no primeiro: quem esta configurando o
 * serviço precisa ver a lista inteira, e nao descobrir um problema por execucao.
 */
export function validateCmsConfig(env: CmsEnv): CmsConfigResult {
  const errors: CmsConfigError[] = []

  const databaseUrl = trimToNull(env.PAYLOAD_DATABASE_URL)
  const secret = trimToNull(env.PAYLOAD_SECRET)
  const publicDatabaseUrl = trimToNull(env.DATABASE_URL)

  if (databaseUrl === null) {
    errors.push({
      code: 'missing_payload_database_url',
      message:
        `${PAYLOAD_DATABASE_URL_KEY} ausente. O CMS tem banco proprio e NUNCA usa ` +
        'DATABASE_URL como fallback.',
    })
  }

  if (secret === null) {
    errors.push({
      code: 'missing_payload_secret',
      message: `${PAYLOAD_SECRET_KEY} ausente.`,
    })
  } else if (secret.length < MIN_SECRET_LENGTH) {
    errors.push({
      code: 'weak_payload_secret',
      message: `${PAYLOAD_SECRET_KEY} precisa de pelo menos ${MIN_SECRET_LENGTH} caracteres.`,
    })
  }

  if (databaseUrl !== null) {
    if (publicDatabaseUrl !== null && databaseUrl === publicDatabaseUrl) {
      errors.push({
        code: 'payload_database_url_equals_database_url',
        message:
          `${PAYLOAD_DATABASE_URL_KEY} e identica a DATABASE_URL. O CMS nao pode ` +
          'compartilhar o banco publico do Cinerie.',
      })
    }

    let parsed: URL | null = null
    try {
      parsed = new URL(databaseUrl)
    } catch {
      errors.push({
        code: 'payload_database_url_invalid',
        message: `${PAYLOAD_DATABASE_URL_KEY} nao e uma URL valida.`,
      })
    }

    if (parsed !== null) {
      // Compara host + caminho (nome do database). Usuario e senha ficam de fora
      // de proposito: nao ha motivo para tocar em credencial nesta checagem.
      const surface = `${parsed.hostname}${parsed.pathname}`
      const hit = PUBLIC_DATABASE_PATTERNS.find((pattern) => pattern.test(surface))
      if (hit !== undefined) {
        errors.push({
          code: 'payload_database_url_looks_public',
          message:
            `${PAYLOAD_DATABASE_URL_KEY} aparenta apontar para um banco publico/produtivo ` +
            'do Cinerie. Use um banco isolado do CMS.',
        })
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, databaseUrl: databaseUrl as string, secret: secret as string }
}

/**
 * Le e valida o ambiente, lancando com uma mensagem acionavel.
 * A mensagem lista os codigos e as descricoes — nunca os valores.
 */
export function requireCmsConfig(env: CmsEnv = process.env as CmsEnv): {
  databaseUrl: string
  secret: string
} {
  const result = validateCmsConfig(env)
  if (result.ok) return { databaseUrl: result.databaseUrl, secret: result.secret }
  const detail = result.errors.map((error) => `  - [${error.code}] ${error.message}`).join('\n')
  throw new Error(`Configuracao invalida do @screena/cms:\n${detail}`)
}
