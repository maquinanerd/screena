/**
 * production-authorization.ts — Quem pode escrever taxonomia EM PRODUCAO.
 *
 * ============ POR QUE ISTO EXISTE ============
 *
 * `genres` e um DICIONARIO, e `movie_genres`/`tv_show_genres` tem FK composta
 * para ele. Dicionario vazio nao degrada: derruba o titulo inteiro com `P2003`.
 * Medido em 25/08/2026, em producao, com `genres` em ZERO linhas:
 *
 *     Key (genre_media_type, genre_tmdb_id)=(movie, 28) is not present in table "genres"
 *     Key (genre_media_type, genre_tmdb_id)=(tv, 18)   is not present in table "genres"
 *
 * 8.366 jobs em `retry_wait` e uma consequencia de produto que nomeia o defeito
 * melhor que qualquer contador: `/pt/series/` listava so titulo obscuro e sem
 * poster. Nao era aleatorio — eram os unicos titulos SEM GENERO, os unicos que
 * passavam na FK. O banco filtrava ao contrario: guardava o obscuro e recusava
 * o popular.
 *
 * E o dicionario nao tinha NENHUM portador que chegasse em producao: nao esta
 * no `db:seed`, nao tem migration data-only, nao tem fila no agendador, e o
 * unico comando que o popula (`bin/sync-tmdb.ts`) abortava em ambiente
 * production-like SEM escape hatch. Nao era "faltou rodar o seed" — nao havia
 * caminho autorizado para roda-lo la.
 *
 * ============ POR QUE O ESCAPE HATCH E ESTREITO ============
 *
 * A autorizacao vale SO para os subcomandos de DICIONARIO/TAXONOMIA. `lists`,
 * `discover` e `trending` escrevem catalogo em massa e continuam com o veto
 * duro: liberar tudo de uma vez trocaria um bloqueio legitimo por uma porta
 * larga, e o que faltava era registrar 35 linhas de taxonomia.
 *
 * A env var espelha `CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED` do worker de
 * catalogo (`src/worker-service/config.ts`) — mesmo formato, mesmo default
 * fail-closed, mesmo significado: escrita em producao exige um SIM explicito.
 *
 * PURO: sem IO, sem relogio, sem rede, sem `process`.
 */

/** Subcomandos que escrevem DICIONARIO/taxonomia (nunca catalogo em massa). */
export const DICTIONARY_SUBCOMMANDS = ['configuration', 'taxonomies', 'genres'] as const

export type DictionarySubcommand = (typeof DICTIONARY_SUBCOMMANDS)[number]

/** Env var que autoriza escrita de taxonomia em producao (default: negado). */
export const TAXONOMY_PRODUCTION_CONFIRMED_ENV = 'CINERIE_SYNC_TMDB_PRODUCTION_CONFIRMED'

/** Recorte do ambiente que a decisao le. Nunca o `process.env` inteiro. */
export interface ProductionAuthorizationEnv {
  readonly NODE_ENV?: string | undefined
  readonly VERCEL_ENV?: string | undefined
  readonly [TAXONOMY_PRODUCTION_CONFIRMED_ENV]?: string | undefined
}

/**
 * Desfecho da decisao. NOMEADO, nunca um booleano: "negado por nao ser
 * dicionario" e "negado por falta de autorizacao" pedem acoes diferentes do
 * operador, e um `false` unico faria o log dizer a mesma coisa nos dois casos.
 */
export type ProductionAuthorization =
  | { readonly allowed: true; readonly reason: 'not-production' | 'authorized' }
  | {
      readonly allowed: false
      readonly reason: 'unauthorized' | 'not-a-dictionary-subcommand'
      readonly message: string
    }

/** `true` so para os valores afirmativos explicitos (fail-closed). */
function isAffirmative(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/** Mesma heuristica de ambiente que as CLIs ja usavam. */
export function isProductionLike(env: ProductionAuthorizationEnv): boolean {
  return `${env.NODE_ENV ?? ''} ${env.VERCEL_ENV ?? ''}`.toLowerCase().includes('production')
}

/** `true` quando o subcomando escreve dicionario/taxonomia. */
export function isDictionarySubcommand(subcommand: string): subcommand is DictionarySubcommand {
  return (DICTIONARY_SUBCOMMANDS as readonly string[]).includes(subcommand)
}

/**
 * Decide se um `--apply` pode escrever, dado o subcomando e o ambiente.
 *
 * Fora de producao nunca ha o que autorizar. Em producao, so subcomando de
 * dicionario pode ser liberado, e ainda assim exige a env var explicita.
 */
export function authorizeTaxonomyWrite(
  subcommand: string,
  env: ProductionAuthorizationEnv,
): ProductionAuthorization {
  if (!isProductionLike(env)) return { allowed: true, reason: 'not-production' }

  if (!isDictionarySubcommand(subcommand)) {
    return {
      allowed: false,
      reason: 'not-a-dictionary-subcommand',
      message:
        `ABORTADO: --apply de "${subcommand}" e proibido em producao. ` +
        `A autorizacao por ${TAXONOMY_PRODUCTION_CONFIRMED_ENV} cobre SO ` +
        `${DICTIONARY_SUBCOMMANDS.join(', ')} (dicionario/taxonomia), nunca catalogo em massa.`,
    }
  }

  if (!isAffirmative(env[TAXONOMY_PRODUCTION_CONFIRMED_ENV])) {
    return {
      allowed: false,
      reason: 'unauthorized',
      message:
        `ABORTADO: producao sem ${TAXONOMY_PRODUCTION_CONFIRMED_ENV}=true. ` +
        `Escrita de taxonomia em producao exige autorizacao explicita ` +
        `(equivalente ao gate do worker de catalogo).`,
    }
  }

  return { allowed: true, reason: 'authorized' }
}
