/**
 * args.ts — Parser PURO da CLI `pnpm ratings`.
 *
 * Sem IO: recebe `argv` e devolve um comando tipado ou um erro legivel. Assim a
 * regra de "o que a CLI aceita" e testavel sem banco, sem rede e sem chave.
 *
 * Disciplina que atravessa o parser: TODO comando de escrita e dry-run por
 * DEFAULT. `--apply`/`--confirm` sao explicitos e nunca implicitos. Um operador
 * que erra a flag ve um relatorio; nunca uma mutacao.
 */

import { RATING_SOURCES, type RatingSource } from '@screena/config'

/** Subcomandos da CLI. */
export const RATINGS_COMMANDS = ['sample', 'sync', 'review', 'promote', 'revoke', 'help'] as const

export type RatingsCommand = (typeof RATINGS_COMMANDS)[number]

/** Entidades suportadas. */
export const RATINGS_ENTITIES = ['movie', 'tv'] as const

export type RatingsEntity = (typeof RATINGS_ENTITIES)[number]

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 200
/** Teto de um lote de promocao/revogacao (§11: bulk limitado). */
export const MAX_BULK_IDS = 20

/** `ratings sample` — inspeciona o payload SEM persistir nada. */
export interface SampleArgs {
  readonly command: 'sample'
  readonly source: RatingSource | null
  readonly entity: RatingsEntity
  readonly limit: number
  readonly id: string | null
  /** Sempre `true`: sample nunca escreve. Existe para o relatorio dizer isso. */
  readonly dryRun: true
  readonly json: boolean
}

/** `ratings sync` — persiste em external_ratings (display_allowed=false). */
export interface SyncArgs {
  readonly command: 'sync'
  readonly entity: RatingsEntity
  readonly limit: number
  readonly id: string | null
  /** `false` = dry-run (default). */
  readonly apply: boolean
  readonly json: boolean
}

/** `ratings review` — lista candidatas a promocao (read-only). */
export interface ReviewArgs {
  readonly command: 'review'
  readonly source: RatingSource | null
  readonly entity: RatingsEntity | null
  readonly limit: number
  readonly json: boolean
}

/** `ratings promote` — liga display_allowed nos ids dados. */
export interface PromoteArgs {
  readonly command: 'promote'
  readonly ids: readonly string[]
  readonly reviewer: string | null
  /** `false` = dry-run (default). */
  readonly confirm: boolean
  readonly json: boolean
}

/** `ratings revoke` — desliga display_allowed nos ids dados. */
export interface RevokeArgs {
  readonly command: 'revoke'
  readonly ids: readonly string[]
  readonly confirm: boolean
  readonly json: boolean
}

/** `ratings help`. */
export interface HelpArgs {
  readonly command: 'help'
}

export type RatingsArgs = SampleArgs | SyncArgs | ReviewArgs | PromoteArgs | RevokeArgs | HelpArgs

export type ParseResult =
  | { readonly ok: true; readonly args: RatingsArgs }
  | { readonly ok: false; readonly error: string }

/** Lê `--chave=valor` e `--chave valor`. */
function readFlags(argv: readonly string[]): {
  readonly flags: Map<string, string | true>
  readonly error: string | null
} {
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!
    if (!token.startsWith('--')) return { flags, error: `argumento posicional inesperado: "${token}"` }
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1))
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next)
      i += 1
    } else {
      flags.set(body, true)
    }
  }
  return { flags, error: null }
}

function readLimit(flags: Map<string, string | true>): number | string {
  const raw = flags.get('limit')
  if (raw === undefined) return DEFAULT_LIMIT
  if (raw === true) return '--limit exige um numero'
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return `--limit invalido: "${raw}"`
  if (parsed > MAX_LIMIT) return `--limit acima do teto (${MAX_LIMIT})`
  return parsed
}

/**
 * Leitura de uma flag opcional cujo valor de SUCESSO tambem e string.
 *
 * Discriminado de proposito. Um retorno `RatingSource | string | null` faria
 * `typeof x === 'string'` significar, ao mesmo tempo, "deu erro" e "leu 'imdb'"
 * — e o caminho feliz viraria erro de uso. Foi exatamente o que aconteceu aqui;
 * o teste do comando canonico pegou. `readLimit` (number|string) e `readIds`
 * (array|string) nao tem o problema porque sucesso e erro tem tipos disjuntos.
 */
type FlagRead<T> =
  | { readonly ok: true; readonly value: T | null }
  | { readonly ok: false; readonly error: string }

function readEntity(flags: Map<string, string | true>): FlagRead<RatingsEntity> {
  const raw = flags.get('entity')
  if (raw === undefined) return { ok: true, value: null }
  if (raw === true) return { ok: false, error: '--entity exige movie|tv' }
  if (!(RATINGS_ENTITIES as readonly string[]).includes(raw)) {
    return { ok: false, error: `--entity invalido: "${raw}" (use movie|tv)` }
  }
  return { ok: true, value: raw as RatingsEntity }
}

function readSource(flags: Map<string, string | true>): FlagRead<RatingSource> {
  const raw = flags.get('source')
  if (raw === undefined) return { ok: true, value: null }
  if (raw === true) return { ok: false, error: '--source exige uma fonte editorial' }
  if (!(RATING_SOURCES as readonly string[]).includes(raw)) {
    return { ok: false, error: `--source invalido: "${raw}" (use ${RATING_SOURCES.join('|')})` }
  }
  return { ok: true, value: raw as RatingSource }
}

/**
 * Lê `--ids=1,2,3`. Exige ids inteiros positivos e limita o lote.
 *
 * O teto existe porque promocao e ato editorial: revisar 20 notas e possivel,
 * "aprovar 5 mil" nao e revisao, e um carimbo.
 */
function readIds(flags: Map<string, string | true>): readonly string[] | string {
  const raw = flags.get('ids')
  if (raw === undefined || raw === true) return '--ids e obrigatorio (ex.: --ids=1,2,3)'
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (parts.length === 0) return '--ids vazio'
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return `--ids contem id nao numerico: "${part}"`
  }
  if (parts.length > MAX_BULK_IDS) {
    return `--ids acima do teto de lote (${MAX_BULK_IDS}); promocao e revisao, nao carimbo`
  }
  const unique = new Set(parts)
  if (unique.size !== parts.length) return '--ids contem duplicatas'
  return parts
}

const isTrue = (v: string | true | undefined): boolean => v === true || v === 'true'

/** Faz o parse de `argv` (sem o nome do binario). */
export function parseRatingsArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { ok: true, args: { command: 'help' } }
  }
  if (!(RATINGS_COMMANDS as readonly string[]).includes(command)) {
    return { ok: false, error: `comando desconhecido: "${command}" (use ${RATINGS_COMMANDS.join('|')})` }
  }

  const { flags, error } = readFlags(rest)
  if (error !== null) return { ok: false, error }
  if (isTrue(flags.get('help'))) return { ok: true, args: { command: 'help' } }

  const json = isTrue(flags.get('json'))

  if (command === 'sample' || command === 'sync') {
    const limit = readLimit(flags)
    if (typeof limit === 'string') return { ok: false, error: limit }
    const entity = readEntity(flags)
    if (!entity.ok) return { ok: false, error: entity.error }
    const id = flags.get('id')
    if (id === true) return { ok: false, error: '--id exige um IMDb id (tt...)' }
    if (typeof id === 'string' && !/^tt\d+$/.test(id)) {
      return { ok: false, error: `--id deve ser um IMDb id (tt<digitos>), recebido "${id}"` }
    }

    if (command === 'sample') {
      const source = readSource(flags)
      if (!source.ok) return { ok: false, error: source.error }
      // `--apply` num sample nao e "quase certo": e o operador achando que vai
      // gravar. Recusar e mais seguro que ignorar em silencio.
      if (flags.has('apply')) {
        return { ok: false, error: 'sample nunca escreve; use `ratings sync --apply` para persistir' }
      }
      return {
        ok: true,
        args: {
          command: 'sample',
          source: source.value,
          entity: entity.value ?? 'movie',
          limit,
          id: id ?? null,
          dryRun: true,
          json,
        },
      }
    }

    return {
      ok: true,
      args: {
        command: 'sync',
        entity: entity.value ?? 'movie',
        limit,
        id: id ?? null,
        apply: isTrue(flags.get('apply')),
        json,
      },
    }
  }

  if (command === 'review') {
    const limit = readLimit(flags)
    if (typeof limit === 'string') return { ok: false, error: limit }
    const entity = readEntity(flags)
    if (!entity.ok) return { ok: false, error: entity.error }
    const source = readSource(flags)
    if (!source.ok) return { ok: false, error: source.error }
    return { ok: true, args: { command: 'review', source: source.value, entity: entity.value, limit, json } }
  }

  const ids = readIds(flags)
  if (typeof ids === 'string') return { ok: false, error: ids }
  const confirm = isTrue(flags.get('confirm'))

  if (command === 'promote') {
    const rawReviewer = flags.get('reviewer')
    if (rawReviewer === true) return { ok: false, error: '--reviewer exige uma identidade humana' }
    const reviewer = typeof rawReviewer === 'string' ? rawReviewer.trim() : null
    // Promover exige NOME. "quem aprovou isso?" precisa ter resposta seis meses
    // depois, e um dry-run sem revisor ainda e util (mostra o que aconteceria).
    if (confirm && (reviewer === null || reviewer === '')) {
      return { ok: false, error: '--confirm exige --reviewer=<identidade humana>' }
    }
    return { ok: true, args: { command: 'promote', ids, reviewer, confirm, json } }
  }

  return { ok: true, args: { command: 'revoke', ids, confirm, json } }
}
