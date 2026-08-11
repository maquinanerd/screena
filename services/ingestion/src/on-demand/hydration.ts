/**
 * hydration.ts — Nucleo PURO do CRESCIMENTO SOB DEMANDA.
 *
 * E este mecanismo que da cobertura de 100% sem espelhar 100%: entidade pedida
 * e ausente e buscada na hora, persistida, e passa a existir permanentemente.
 * Para o usuario, indistinguivel de um espelho completo — e sem pagar disco por
 * 6,32 M entidades que ninguem pediu.
 *
 * TRES DEFESAS, e por que cada uma existe:
 *
 *  1. CACHE NEGATIVO. Sem ele, um crawler batendo em ids inexistentes vira um
 *     amplificador de cota: cada 404 do TMDB custa um request, e o crawler
 *     repete. O 404 e memorizado com TTL. TTL, nao permanente: o TMDB publica
 *     entidades novas o tempo todo, e um "nao existe" eterno seria uma mentira
 *     com data de validade vencida.
 *  2. RATE LIMIT POR ORIGEM. Janela deslizante por origem, para que uma origem
 *     abusiva nao consuma a cota que as outras precisam.
 *  3. COALESCENCIA. Dez pedidos simultaneos do mesmo id fazem UMA busca. Sem
 *     isso, um titulo que viraliza multiplica o custo pelo numero de leitores
 *     simultaneos — exatamente quando a cota e mais escassa.
 *
 * O QUE ESTE MODULO NAO FAZ, E POR QUE: ele NAO chama o TMDB. A busca entra
 * como a porta `fetchEntity`. A invariante 3 (zero API externa no render) e
 * absoluta e travada por `tests/governance/no-render-external-api.test.ts` e
 * `web-render-layering.test.ts`, que varrem `apps/web/app` inteiro — inclusive
 * rotas de API. Logo a hidratacao roda no WORKER, nunca no processo que
 * renderiza. Ver a nota de transporte no README desta pasta.
 *
 * NENHUM DESFECHO E SILENCIOSO: `HydrationOutcome` tem um valor nomeado para
 * cada caminho, inclusive os de recusa. Nada aqui devolve `null` para dizer
 * "deu errado" — `null` diria "nao existe", que e outra coisa.
 */

/** Tipos hidrataveis sob demanda. */
export const HYDRATABLE_KINDS = ['movie', 'tv', 'person'] as const

/** Um tipo hidratavel. */
export type HydratableKind = (typeof HYDRATABLE_KINDS)[number]

/** Identidade do pedido. */
export interface HydrationRequest {
  readonly kind: HydratableKind
  readonly tmdbId: number
  /** Quem pediu (IP, sessao, agente). Escopo do rate limit. */
  readonly origin: string
}

/** Desfecho de uma hidratacao. Um valor por caminho — nenhum colapsa no outro. */
export type HydrationOutcome =
  /** Buscado e persistido agora. */
  | 'hydrated'
  /** Ja existia: nada foi buscado. */
  | 'already_present'
  /** Coalescido: outro pedido identico ja estava em voo. */
  | 'coalesced'
  /** O TMDB confirmou que o id NAO existe. Memorizado com TTL. */
  | 'not_found'
  /** Cache negativo em vigor: nao existe, e ja sabiamos. Zero request gasto. */
  | 'known_absent'
  /** Rate limit da origem estourado. NAO e "nao existe". */
  | 'rate_limited'
  /** Pedido malformado (id invalido, tipo desconhecido). */
  | 'invalid_request'
  /** A busca falhou (rede, 5xx, credencial). NAO e "nao existe". */
  | 'failed'

/** Resultado de uma hidratacao, sempre com motivo legivel. */
export interface HydrationResult {
  readonly outcome: HydrationOutcome
  /** Id interno quando a entidade existe agora; `null` caso contrario. */
  readonly entityId: string | null
  /** Sempre preenchido. Um desfecho sem explicacao e um desfecho silencioso. */
  readonly detail: string
  /** Requests de cota realmente gastos por este pedido (0 ou 1). */
  readonly quotaSpent: number
}

/** Porta de leitura do que ja existe localmente. */
export interface LocalEntityLookup {
  /** Id interno, ou `null` quando a entidade nao esta no banco. */
  find(kind: HydratableKind, tmdbId: number): Promise<string | null>
}

/** Desfecho da busca no upstream. */
export type FetchOutcome =
  | { readonly status: 'found'; readonly entityId: string }
  /** O upstream confirmou 404 — o id nao existe. */
  | { readonly status: 'not_found' }
  /** Falha de transporte/credencial. Distinta de 404 de proposito. */
  | { readonly status: 'failed'; readonly errorClass: string; readonly message: string }

/**
 * Porta de busca + persistencia. Roda no WORKER, nunca no render.
 *
 * Contrato: NUNCA lanca para sinalizar ausencia. Ausencia e
 * `{status:'not_found'}`; falha e `{status:'failed'}`. Colapsar as duas faria o
 * cache negativo memorizar uma queda de rede como "este filme nao existe".
 */
export interface EntityHydrationPort {
  fetchAndPersist(kind: HydratableKind, tmdbId: number): Promise<FetchOutcome>
}

/** Cache negativo com TTL. */
export interface NegativeCache {
  has(kind: HydratableKind, tmdbId: number, now: Date): boolean
  remember(kind: HydratableKind, tmdbId: number, now: Date): void
  /** Entradas vivas (diagnostico). */
  size(now: Date): number
}

/** TTL default do cache negativo: 24 h. */
export const DEFAULT_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000

/** Teto de entradas do cache negativo, para nao virar vazamento de memoria. */
export const DEFAULT_NEGATIVE_CACHE_MAX = 50_000

/** Cria um cache negativo em memoria, com TTL e teto. */
export function createNegativeCache(
  ttlMs: number = DEFAULT_NEGATIVE_TTL_MS,
  maxEntries: number = DEFAULT_NEGATIVE_CACHE_MAX,
): NegativeCache {
  const entries = new Map<string, number>()
  const keyOf = (kind: HydratableKind, tmdbId: number): string => `${kind}:${tmdbId}`

  function prune(now: number): void {
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) entries.delete(key)
    }
  }

  return {
    has(kind, tmdbId, now) {
      const expiresAt = entries.get(keyOf(kind, tmdbId))
      if (expiresAt === undefined) return false
      if (expiresAt <= now.getTime()) {
        entries.delete(keyOf(kind, tmdbId))
        return false
      }
      return true
    },
    remember(kind, tmdbId, now) {
      const nowMs = now.getTime()
      if (entries.size >= maxEntries) {
        prune(nowMs)
        // Ainda cheio depois da poda: descarta a entrada mais antiga. Perder um
        // negativo custa UM request; vazar memoria derruba o worker.
        if (entries.size >= maxEntries) {
          const oldest = entries.keys().next()
          if (!oldest.done) entries.delete(oldest.value)
        }
      }
      entries.set(keyOf(kind, tmdbId), nowMs + ttlMs)
    },
    size(now) {
      prune(now.getTime())
      return entries.size
    },
  }
}

/** Limitador por origem, em janela deslizante. */
export interface OriginRateLimiter {
  /** Consome uma permissao. `false` quando a origem estourou a janela. */
  tryConsume(origin: string, now: Date): boolean
}

/** Permissoes por origem, por janela. */
export const DEFAULT_RATE_LIMIT = 30
/** Tamanho da janela do rate limit: 1 minuto. */
export const DEFAULT_RATE_WINDOW_MS = 60_000

/** Cria um limitador por origem em janela deslizante. */
export function createOriginRateLimiter(
  limit: number = DEFAULT_RATE_LIMIT,
  windowMs: number = DEFAULT_RATE_WINDOW_MS,
): OriginRateLimiter {
  const hits = new Map<string, number[]>()
  return {
    tryConsume(origin, now) {
      const nowMs = now.getTime()
      const cutoff = nowMs - windowMs
      const recent = (hits.get(origin) ?? []).filter((t) => t > cutoff)
      if (recent.length >= limit) {
        hits.set(origin, recent)
        return false
      }
      recent.push(nowMs)
      hits.set(origin, recent)
      return true
    },
  }
}

/** Dependencias do hidratador. */
export interface HydratorDeps {
  readonly lookup: LocalEntityLookup
  readonly hydration: EntityHydrationPort
  readonly negativeCache: NegativeCache
  readonly rateLimiter: OriginRateLimiter
  readonly now: () => Date
  /** Observabilidade. Chamado para TODO desfecho, inclusive os de recusa. */
  readonly onOutcome?: (request: HydrationRequest, result: HydrationResult) => void
}

/** O hidratador sob demanda. */
export interface OnDemandHydrator {
  hydrate(request: HydrationRequest): Promise<HydrationResult>
  /** Buscas em voo agora (diagnostico da coalescencia). */
  inFlight(): number
}

function result(
  outcome: HydrationOutcome,
  detail: string,
  entityId: string | null = null,
  quotaSpent = 0,
): HydrationResult {
  return { outcome, entityId, detail, quotaSpent }
}

/** Cria o hidratador sob demanda. */
export function createOnDemandHydrator(deps: HydratorDeps): OnDemandHydrator {
  // Coalescencia: uma promessa em voo por (kind, id). Dez pedidos simultaneos
  // do mesmo id compartilham UMA busca.
  const inFlight = new Map<string, Promise<FetchOutcome>>()

  async function run(request: HydrationRequest): Promise<HydrationResult> {
    const { kind, tmdbId, origin } = request
    const now = deps.now()

    if (!(HYDRATABLE_KINDS as readonly string[]).includes(kind)) {
      return result('invalid_request', `tipo nao hidratavel: ${String(kind)}`)
    }
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return result('invalid_request', `tmdbId invalido: ${String(tmdbId)}`)
    }

    // Ja existe: caminho mais barato, zero cota, sem tocar rate limit.
    const existing = await deps.lookup.find(kind, tmdbId)
    if (existing !== null) {
      return result('already_present', `${kind}#${tmdbId} ja existe localmente`, existing)
    }

    // Cache negativo ANTES do rate limit: um 404 conhecido nao deve consumir a
    // franquia da origem, senao um crawler derruba a franquia de todo mundo.
    if (deps.negativeCache.has(kind, tmdbId, now)) {
      return result(
        'known_absent',
        `${kind}#${tmdbId} confirmado inexistente pelo upstream dentro do TTL`,
      )
    }

    if (!deps.rateLimiter.tryConsume(origin, now)) {
      // NAO e 404. Devolver "nao existe" aqui ensinaria o cache negativo a
      // mentir sobre um titulo que existe.
      return result('rate_limited', `origem excedeu a franquia de pedidos sob demanda`)
    }

    const key = `${kind}:${tmdbId}`
    const pending = inFlight.get(key)
    if (pending !== undefined) {
      const outcome = await pending
      if (outcome.status === 'found') {
        return result('coalesced', `${kind}#${tmdbId} hidratado por pedido concorrente`, outcome.entityId)
      }
      if (outcome.status === 'not_found') {
        return result('coalesced', `${kind}#${tmdbId} inexistente (confirmado por pedido concorrente)`)
      }
      return result('coalesced', `${kind}#${tmdbId} falhou no pedido concorrente: ${outcome.message}`)
    }

    const promise = deps.hydration.fetchAndPersist(kind, tmdbId)
    inFlight.set(key, promise)
    let outcome: FetchOutcome
    try {
      outcome = await promise
    } catch (error) {
      // A porta nao deveria lancar. Se lancar, e FALHA — nunca "nao existe".
      const message = error instanceof Error ? error.message : String(error)
      return result('failed', `${kind}#${tmdbId}: porta de hidratacao lancou: ${message}`, null, 1)
    } finally {
      inFlight.delete(key)
    }

    if (outcome.status === 'found') {
      return result('hydrated', `${kind}#${tmdbId} buscado e persistido`, outcome.entityId, 1)
    }
    if (outcome.status === 'not_found') {
      deps.negativeCache.remember(kind, tmdbId, now)
      return result('not_found', `${kind}#${tmdbId} nao existe no upstream (memorizado com TTL)`, null, 1)
    }
    // Falha NUNCA entra no cache negativo: memorizar uma queda de rede como
    // "este filme nao existe" esconderia a entidade ate o TTL expirar.
    return result(
      'failed',
      `${kind}#${tmdbId} falhou (${outcome.errorClass}): ${outcome.message}`,
      null,
      1,
    )
  }

  return {
    async hydrate(request) {
      const hydrationResult = await run(request)
      deps.onOutcome?.(request, hydrationResult)
      return hydrationResult
    },
    inFlight: () => inFlight.size,
  }
}
