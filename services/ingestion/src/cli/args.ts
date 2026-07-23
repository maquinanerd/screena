/**
 * args.ts — Parser PURO da CLI `pnpm catalog` (Backend A, Parte B). Sem IO.
 *
 * FAIL-LOUD, pelo mesmo motivo do parser de raw-sync: aceitar `--flag valor`
 * silenciosamente como "flag sem valor" fez um piloto rodar contra a fila errada.
 * Aqui, flag desconhecida, valor faltante, numero invalido, data impossivel ou
 * combinacao incompativel geram ERRO — nunca fallback silencioso.
 *
 * Aceita os dois formatos: `--flag=valor` e `--flag valor`. Um valor que comeca
 * com `--` so pode ser passado via `=` (na forma separada, o proximo `--token`
 * e outra flag, nao o valor).
 *
 * Sem dependencia de biblioteca de CLI: o contrato e pequeno e fechado, e um
 * parser proprio testavel custa menos que uma dependencia no worker.
 */

/** Comandos da CLI. */
export const CATALOG_COMMANDS = [
  'bootstrap',
  'plan-bootstrap',
  'enqueue',
  'worker',
  'sync',
  'changes',
  'discovery',
  'media',
  'episodes',
  'search-reindex',
  'search-status',
  'status',
  'audit-database',
  'dead-letter',
] as const

/** Um comando valido. */
export type CatalogCommand = (typeof CATALOG_COMMANDS)[number]

/** Subcomandos de `dead-letter`. */
export const DEAD_LETTER_SUBCOMMANDS = ['list', 'replay'] as const

/** Um subcomando valido de dead-letter. */
export type DeadLetterSubcommand = (typeof DEAD_LETTER_SUBCOMMANDS)[number]

/** Flags de valor string. */
const STRING_FLAGS: ReadonlySet<string> = new Set([
  'entity',
  'strategy',
  'ids-file',
  'locale',
  'country',
  'list',
  'window',
  'checkpoint',
  'request-id',
  'mode',
  'format',
])

/** Flags de valor inteiro (>= 0). */
const INT_FLAGS: ReadonlySet<string> = new Set([
  'id',
  'limit',
  'offset',
  'concurrency',
  'poll-interval-ms',
  'max-jobs',
  'max-pages',
  'season',
  'timeout-ms',
  // Orcamento operacional do `plan-bootstrap`. Existem porque `--limit` mede
  // TITULO, e titulo nao e a unidade de custo: 3 series populares ja
  // produziram 639 temporadas e 33.178 episodios.
  'max-titles',
  'max-series',
  'max-seasons',
  'max-episodes',
  'max-api-calls',
  'max-duration-minutes',
  'max-media-items',
])

/** Flags de valor data (YYYY-MM-DD). */
const DATE_FLAGS: ReadonlySet<string> = new Set(['from', 'to'])

/** Flags booleanas (presenca = true). */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'resume',
  'dry-run',
  'apply',
  'force',
  'confirm-production-read',
  'json',
  'human',
  'help',
])

/** Flags parseadas (null = nao informada; o comando aplica o default). */
export interface CatalogFlags {
  readonly entity: string | null
  readonly strategy: string | null
  readonly idsFile: string | null
  readonly locale: string | null
  readonly country: string | null
  readonly list: string | null
  readonly window: string | null
  readonly checkpoint: string | null
  readonly requestId: string | null
  readonly mode: string | null
  readonly format: string | null
  readonly id: number | null
  readonly limit: number | null
  readonly offset: number | null
  readonly concurrency: number | null
  readonly pollIntervalMs: number | null
  readonly maxJobs: number | null
  readonly maxPages: number | null
  readonly season: number | null
  readonly timeoutMs: number | null
  /** Tetos do orcamento (`plan-bootstrap`). null = sem teto naquela dimensao. */
  readonly maxTitles: number | null
  readonly maxSeries: number | null
  readonly maxSeasons: number | null
  readonly maxEpisodes: number | null
  readonly maxApiCalls: number | null
  readonly maxDurationMinutes: number | null
  readonly maxMediaItems: number | null
  readonly from: string | null
  readonly to: string | null
  readonly resume: boolean
  readonly dryRun: boolean
  readonly apply: boolean
  readonly force: boolean
  readonly confirmProductionRead: boolean
  readonly json: boolean
  readonly human: boolean
  readonly help: boolean
  /** Argumentos posicionais restantes (ex.: ids soltos). */
  readonly positionals: readonly string[]
}

/** Invocacao parseada. */
export interface CatalogInvocation {
  readonly command: CatalogCommand
  readonly subcommand: DeadLetterSubcommand | null
  readonly flags: CatalogFlags
}

/** Resultado do parse. `help` pede o texto de ajuda (nao e erro). */
export type CatalogArgsResult =
  | { readonly ok: true; readonly help: true; readonly command: CatalogCommand | null }
  | { readonly ok: true; readonly help: false; readonly invocation: CatalogInvocation }
  | { readonly ok: false; readonly error: string }

function fail(error: string): CatalogArgsResult {
  return { ok: false, error }
}

/** Valida `YYYY-MM-DD` rejeitando data impossivel (2026-02-31). */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  // `Date` normaliza silenciosamente: so aceitamos quando o round-trip bate.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Comandos que MUTAM estado e por isso exigem --dry-run ou --apply. */
const MUTATING_COMMANDS: ReadonlySet<CatalogCommand> = new Set([
  'bootstrap',
  'enqueue',
  'sync',
  'changes',
  'discovery',
  'media',
  'episodes',
  'search-reindex',
])

/** Comandos somente-leitura. */
const READ_ONLY_COMMANDS: ReadonlySet<CatalogCommand> = new Set([
  'status',
  'search-status',
  'audit-database',
  // `plan-bootstrap` le listas e detalhes do TMDB para estimar custo, e NAO
  // persiste nada — nem entidade, nem cache, nem job. Por isso `--apply` nao
  // faz sentido nele: nao ha o que aplicar.
  'plan-bootstrap',
])

/** True quando o comando exige `--dry-run` ou `--apply` explicito. */
export function requiresDryRunOrApply(command: CatalogCommand, subcommand: string | null): boolean {
  if (command === 'dead-letter') return subcommand === 'replay'
  return MUTATING_COMMANDS.has(command)
}

/** True quando o comando e somente-leitura. */
export function isReadOnlyCommand(command: CatalogCommand): boolean {
  return READ_ONLY_COMMANDS.has(command)
}

/**
 * Faz o parse fail-loud de `argv` (sem `node` nem o script).
 *
 * Ordem: comando -> subcomando (dead-letter) -> flags -> validacao cruzada.
 */
export function parseCatalogArgs(argv: readonly string[]): CatalogArgsResult {
  if (argv.length === 0) return { ok: true, help: true, command: null }

  const first = argv[0]
  if (first === undefined) return { ok: true, help: true, command: null }
  if (first === '--help' || first === '-h' || first === 'help') {
    return { ok: true, help: true, command: null }
  }
  if (!(CATALOG_COMMANDS as readonly string[]).includes(first)) {
    return fail(
      `comando desconhecido: "${first}". Use um de: ${CATALOG_COMMANDS.join(', ')}. Veja "catalog --help".`,
    )
  }
  const command = first as CatalogCommand

  let rest = argv.slice(1)
  let subcommand: DeadLetterSubcommand | null = null

  if (command === 'dead-letter') {
    const sub = rest[0]
    if (sub === undefined || sub === '--help' || sub === '-h') {
      return { ok: true, help: true, command }
    }
    if (!(DEAD_LETTER_SUBCOMMANDS as readonly string[]).includes(sub)) {
      return fail(
        `subcomando desconhecido de dead-letter: "${sub}". Use: ${DEAD_LETTER_SUBCOMMANDS.join(', ')}.`,
      )
    }
    subcommand = sub as DeadLetterSubcommand
    rest = rest.slice(1)
  }

  const strings: Record<string, string> = {}
  const ints: Record<string, number> = {}
  const dates: Record<string, string> = {}
  const booleans = new Set<string>()
  const positionals: string[] = []

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (token === undefined) continue

    if (token === '-h') {
      booleans.add('help')
      continue
    }
    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)

    if (BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) {
        // `--apply=true` e ambiguo: aceitar `=false` como true seria armadilha.
        return fail(`flag booleana --${name} nao aceita valor (recebeu "=${value}").`)
      }
      booleans.add(name)
      continue
    }

    const isString = STRING_FLAGS.has(name)
    const isInt = INT_FLAGS.has(name)
    const isDate = DATE_FLAGS.has(name)
    if (!isString && !isInt && !isDate) {
      return fail(`flag desconhecida: --${name}. Veja "catalog ${command} --help".`)
    }

    if (value === undefined) {
      const next = rest[i + 1]
      // Um `--token` seguinte e outra flag, nunca o valor desta.
      if (next === undefined || next.startsWith('--')) {
        return fail(`flag --${name} exige valor (use --${name}=<valor> ou --${name} <valor>).`)
      }
      value = next
      i += 1
    }

    if (value.length === 0) return fail(`flag --${name} recebeu valor vazio.`)

    if (isInt) {
      if (!/^\d+$/.test(value)) {
        return fail(`flag --${name} exige inteiro >= 0, recebeu "${value}".`)
      }
      ints[name] = Number(value)
      continue
    }
    if (isDate) {
      if (!isValidIsoDate(value)) {
        return fail(`flag --${name} exige data YYYY-MM-DD valida, recebeu "${value}".`)
      }
      dates[name] = value
      continue
    }
    strings[name] = value
  }

  if (booleans.has('help')) return { ok: true, help: true, command }

  const flags: CatalogFlags = {
    entity: strings.entity ?? null,
    strategy: strings.strategy ?? null,
    idsFile: strings['ids-file'] ?? null,
    locale: strings.locale ?? null,
    country: strings.country ?? null,
    list: strings.list ?? null,
    window: strings.window ?? null,
    checkpoint: strings.checkpoint ?? null,
    requestId: strings['request-id'] ?? null,
    mode: strings.mode ?? null,
    format: strings.format ?? null,
    id: ints.id ?? null,
    limit: ints.limit ?? null,
    offset: ints.offset ?? null,
    concurrency: ints.concurrency ?? null,
    pollIntervalMs: ints['poll-interval-ms'] ?? null,
    maxJobs: ints['max-jobs'] ?? null,
    maxPages: ints['max-pages'] ?? null,
    season: ints.season ?? null,
    timeoutMs: ints['timeout-ms'] ?? null,
    maxTitles: ints['max-titles'] ?? null,
    maxSeries: ints['max-series'] ?? null,
    maxSeasons: ints['max-seasons'] ?? null,
    maxEpisodes: ints['max-episodes'] ?? null,
    maxApiCalls: ints['max-api-calls'] ?? null,
    maxDurationMinutes: ints['max-duration-minutes'] ?? null,
    maxMediaItems: ints['max-media-items'] ?? null,
    from: dates.from ?? null,
    to: dates.to ?? null,
    resume: booleans.has('resume'),
    dryRun: booleans.has('dry-run'),
    apply: booleans.has('apply'),
    force: booleans.has('force'),
    confirmProductionRead: booleans.has('confirm-production-read'),
    json: booleans.has('json'),
    human: booleans.has('human'),
    help: false,
    positionals,
  }

  const crossCheck = validateInvocation(command, subcommand, flags)
  if (crossCheck !== null) return fail(crossCheck)

  return { ok: true, help: false, invocation: { command, subcommand, flags } }
}

/**
 * Validacao cruzada. Retorna a mensagem de erro, ou null quando esta ok.
 *
 * Aqui moram as regras que dependem de MAIS de uma flag — as que um parser
 * generico nao pega e que, se passassem, viravam efeito colateral silencioso.
 */
export function validateInvocation(
  command: CatalogCommand,
  subcommand: string | null,
  flags: CatalogFlags,
): string | null {
  if (flags.dryRun && flags.apply) {
    return '--dry-run e --apply sao mutuamente exclusivos.'
  }
  if (flags.json && flags.human) {
    return '--json e --human sao mutuamente exclusivos.'
  }

  // O worker e a excecao: sua acao E processar; nao ha "plano" a exibir.
  if (requiresDryRunOrApply(command, subcommand) && !flags.dryRun && !flags.apply) {
    return `"${command}${subcommand ? ` ${subcommand}` : ''}" muta estado: passe --dry-run (calcula e exibe) ou --apply (executa).`
  }
  if (isReadOnlyCommand(command) && flags.apply) {
    return `"${command}" e somente-leitura: --apply nao se aplica.`
  }

  if (flags.from !== null && flags.to !== null && flags.from > flags.to) {
    // Comparacao lexicografica basta em YYYY-MM-DD (formato ordenavel).
    return `janela invalida: --from (${flags.from}) e posterior a --to (${flags.to}).`
  }

  if (command === 'changes' && flags.entity === null) {
    return '"changes" exige --entity (movie|tv|person, ou lista separada por virgula).'
  }
  if (command === 'discovery' && flags.list === null) {
    return '"discovery" exige --list (trending|popular|top_rated|upcoming|now_playing|airing_today|on_the_air|discover).'
  }
  if (command === 'discovery' && flags.entity === null) {
    return '"discovery" exige --entity (movie|tv).'
  }
  if (command === 'episodes' && flags.id === null) {
    return '"episodes" exige --id (tmdb id da serie).'
  }
  if (command === 'media' && flags.id === null) {
    return '"media" exige --id (tmdb id da entidade).'
  }
  if (command === 'media' && flags.entity === null) {
    return '"media" exige --entity (movie|tv|season|episode|person).'
  }
  if (command === 'sync' && flags.id === null && flags.idsFile === null) {
    return '"sync" exige --id <tmdbId> ou --ids-file <arquivo>.'
  }
  if (command === 'sync' && flags.entity === null) {
    return '"sync" exige --entity.'
  }
  if (command === 'enqueue' && flags.positionals.length === 0) {
    return '"enqueue" exige o tipo de job como argumento (ex.: catalog enqueue sync_details --entity movie --id 603 --apply).'
  }

  if (command === 'worker' && flags.concurrency !== null && flags.concurrency === 0) {
    return '--concurrency deve ser >= 1.'
  }
  if (command === 'dead-letter' && subcommand === 'replay' && flags.limit === 0) {
    return '--limit=0 nao reprocessaria nada; omita a flag para reprocessar tudo.'
  }

  return null
}
