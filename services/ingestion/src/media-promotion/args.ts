/**
 * args.ts — Parser FAIL-LOUD do CLI de promocao de midia. PURO, sem IO.
 *
 * Aceita `--flag=valor` e `--flag valor`. Flag desconhecida, valor faltante ou
 * invalido geram ERRO explicito — nunca default silencioso.
 *
 * NENHUM DEFAULT PERIGOSO:
 *  - `--target` e OBRIGATORIO — inclusive `all`. Nao ha alvo default: rodar sem
 *    dizer o alvo nunca pode significar "tudo" por omissao. `--target=all` NAO
 *    funde os censos: cada alvo roda com denominador e freio proprios (ver
 *    `ALL_TARGETS`).
 *  - sem `--confirm` e sempre dry-run;
 *  - `--reviewer` e obrigatorio para mutar (identidade humana no log);
 *  - `--only-official` e OPT-IN: por decisao do dono (2026-08-25) `official` nao
 *    filtra por padrao.
 *
 * NAO EXISTE flag que pule o gate de licenca. Procurar por uma aqui e o teste
 * mais rapido de que este parser continua honesto.
 */

import { PROMOTION_TARGETS, type PromotionTarget } from './types.js'

/**
 * O valor de `--target` que significa TODOS os alvos, em UMA execucao.
 *
 * ============================================================================
 * POR QUE ELE EXISTE AGORA, DEPOIS DE O PARSER O TER RECUSADO DE PROPOSITO
 * ============================================================================
 * A recusa original tinha um argumento correto: dois alvos numa execucao so
 * juntariam DOIS censos e DOIS denominadores num relatorio, e o freio perderia o
 * sentido — "5% de que acervo?".
 *
 * O que muda nao e o argumento, e a implementacao: `--target=all` NAO funde os
 * alvos. Ele executa a MESMA promocao, alvo por alvo, cada um com seu proprio
 * censo, seu proprio denominador, seu proprio freio e seu proprio desfecho; o
 * relatorio empilha as execucoes em vez de somar. O freio continua respondendo
 * "que fracao DESTE acervo vai ao ar", que e a pergunta que ele sempre fez.
 *
 * O que isso resolve e operacional, e o dono pediu por escrito: promover o
 * acervo inteiro exigia saber a lista de alvos de cor e rodar o comando uma vez
 * por alvo. Um servico que precisa do operador como laco `for` nao esta pronto.
 */
export const ALL_TARGETS = 'all'

/** O alvo pedido: um especifico, ou todos. */
export type PromoteMediaTargetSelection = PromotionTarget | typeof ALL_TARGETS

/** Expande a selecao na lista de alvos a executar, na ordem declarada. */
export function resolveTargets(
  selection: PromoteMediaTargetSelection,
): readonly PromotionTarget[] {
  return selection === ALL_TARGETS ? PROMOTION_TARGETS : [selection]
}

/** Argumentos ja validados. */
export interface PromoteMediaArgs {
  readonly target: PromoteMediaTargetSelection
  /** `movie` | `tv` | `person` | `null` (todos do alvo). */
  readonly entityType: string | null
  readonly tmdbId: number | null
  readonly limit: number | null
  readonly confirm: boolean
  readonly revoke: boolean
  readonly confirmMassChange: boolean
  readonly onlyOfficial: boolean
  readonly maxChanges: number | null
  readonly maxChangePercent: number | null
  readonly reviewer: string | null
  readonly json: boolean
}

export type PromoteMediaArgsResult =
  | { readonly ok: true; readonly args: PromoteMediaArgs }
  | { readonly ok: false; readonly error: string }

interface Token {
  readonly name: string
  readonly value: string | undefined
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  'target',
  'entity-type',
  'tmdb-id',
  'limit',
  'max-changes',
  'max-change-percent',
  'reviewer',
])

const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'confirm',
  'revoke',
  'confirm-mass-change',
  'only-official',
  'json',
])

/** Entidades validas por alvo. Um `--entity-type=person` em video e erro, nao filtro vazio. */
const ENTITY_TYPES_BY_TARGET: Readonly<Record<PromotionTarget, readonly string[]>> = {
  video: ['movie', 'tv'],
  'person-photo': ['person'],
}

/** Todos os valores aceitos por `--target`. */
const TARGET_VALUES: readonly string[] = [...PROMOTION_TARGETS, ALL_TARGETS]

function tokenize(
  argv: readonly string[],
): { readonly ok: true; readonly tokens: readonly Token[] } | { readonly ok: false; readonly error: string } {
  const tokens: Token[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue
    if (!token.startsWith('--')) {
      return { ok: false, error: `argumento inesperado: "${token}" (use --flag=valor ou --flag valor).` }
    }
    const eq = token.indexOf('=')
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq)
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1)

    if (VALUE_FLAGS.has(name) && value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        return { ok: false, error: `a flag "--${name}" exige um valor (use --${name}=valor).` }
      }
      value = next
      i += 1
    }
    tokens.push({ name, value })
  }
  return { ok: true, tokens }
}

/** Inteiro > 0 estrito (rejeita "1.5", "01", "abc", "-2"). */
function parsePositiveInt(raw: string): number | null {
  const trimmed = raw.trim()
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== trimmed) return null
  return parsed
}

/** Percentual 0..100, aceitando decimal ("5", "0.5", "12.5"). */
function parsePercent(raw: string): number | null {
  const parsed = Number.parseFloat(raw.trim())
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null
  return parsed
}

/** Parser fail-loud. */
export function parsePromoteMediaArgs(argv: readonly string[]): PromoteMediaArgsResult {
  const tokenized = tokenize(argv)
  if (!tokenized.ok) return { ok: false, error: tokenized.error }

  let target: PromoteMediaTargetSelection | null = null
  let entityType: string | null = null
  let tmdbId: number | null = null
  let limit: number | null = null
  let confirm = false
  let revoke = false
  let confirmMassChange = false
  let onlyOfficial = false
  let maxChanges: number | null = null
  let maxChangePercent: number | null = null
  let reviewer: string | null = null
  let json = false

  for (const token of tokenized.tokens) {
    const { name, value } = token

    if (BOOLEAN_FLAGS.has(name)) {
      if (value !== undefined) return { ok: false, error: `a flag "--${name}" e booleana e nao aceita valor.` }
      if (name === 'confirm') confirm = true
      if (name === 'revoke') revoke = true
      if (name === 'confirm-mass-change') confirmMassChange = true
      if (name === 'only-official') onlyOfficial = true
      if (name === 'json') json = true
      continue
    }
    if (!VALUE_FLAGS.has(name)) return { ok: false, error: `flag desconhecida: "--${name}".` }
    if (value === undefined || value.trim() === '') {
      return { ok: false, error: `a flag "--${name}" recebeu valor vazio.` }
    }

    switch (name) {
      case 'target': {
        const candidate = value.trim().toLowerCase()
        if (!TARGET_VALUES.includes(candidate)) {
          return {
            ok: false,
            error: `--target invalido: "${value}". Use ${TARGET_VALUES.join(', ')}.`,
          }
        }
        target = candidate as PromoteMediaTargetSelection
        break
      }
      case 'entity-type': {
        entityType = value.trim().toLowerCase()
        break
      }
      case 'tmdb-id': {
        const parsed = parsePositiveInt(value)
        if (parsed === null) return { ok: false, error: `--tmdb-id invalido: "${value}". Use inteiro > 0.` }
        tmdbId = parsed
        break
      }
      case 'limit': {
        const parsed = parsePositiveInt(value)
        if (parsed === null) return { ok: false, error: `--limit invalido: "${value}". Use inteiro > 0.` }
        limit = parsed
        break
      }
      case 'max-changes': {
        const trimmed = value.trim()
        const parsed = Number.parseInt(trimmed, 10)
        // Zero E valido aqui: `--max-changes=0` e o modo "nao deixe passar nada
        // sem assinatura", util para congelar o comando temporariamente.
        if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== trimmed) {
          return { ok: false, error: `--max-changes invalido: "${value}". Use inteiro >= 0.` }
        }
        maxChanges = parsed
        break
      }
      case 'max-change-percent': {
        const parsed = parsePercent(value)
        if (parsed === null) {
          return { ok: false, error: `--max-change-percent invalido: "${value}". Use 0..100.` }
        }
        maxChangePercent = parsed
        break
      }
      case 'reviewer': {
        reviewer = value.trim()
        break
      }
    }
  }

  if (target === null) {
    return {
      ok: false,
      error:
        `--target e obrigatorio: use ${TARGET_VALUES.join(', ')}. Nao ha alvo DEFAULT — ` +
        `"todos" existe, mas tem de ser pedido.`,
    }
  }

  // `--entity-type` estreita UM alvo. Com `all` ele nao tem significado: a mesma
  // string seria valida num alvo e invalida no outro, e escolher em silencio a
  // interpretacao mais permissiva e como um filtro vira nada.
  if (target === ALL_TARGETS && entityType !== null) {
    return {
      ok: false,
      error: `--entity-type nao se combina com --target=${ALL_TARGETS} (cada alvo tem entidades proprias). Rode um alvo por vez para estreitar.`,
    }
  }
  if (target !== ALL_TARGETS) {
    const permitidos = ENTITY_TYPES_BY_TARGET[target]
    if (entityType !== null && !permitidos.includes(entityType)) {
      return {
        ok: false,
        error: `--entity-type "${entityType}" nao existe no alvo "${target}" (validos: ${permitidos.join(', ')}).`,
      }
    }
  }

  // Identidade humana obrigatoria para QUALQUER mutacao, inclusive reversao: a
  // pergunta "quem apagou isto?" e tao operacional quanto "quem acendeu?".
  if (confirm && (reviewer === null || reviewer === '')) {
    return {
      ok: false,
      error: '--reviewer e obrigatorio para mutar com --confirm (identidade humana no relatorio e no log).',
    }
  }

  if (revoke && onlyOfficial) {
    return { ok: false, error: '--only-official nao faz sentido com --revoke (reversao nao filtra por origem do video).' }
  }

  return {
    ok: true,
    args: {
      target,
      entityType,
      tmdbId,
      limit,
      confirm,
      revoke,
      confirmMassChange,
      onlyOfficial,
      maxChanges,
      maxChangePercent,
      reviewer,
      json,
    },
  }
}
