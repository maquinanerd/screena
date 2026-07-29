/**
 * env-auto-publish.ts — Kill switch, limites e FUSO da publicacao automatica.
 * PURO (recebe o ambiente e o instante; nao le `process.env` nem o relogio).
 *
 * A regra que da o tom: **variavel ausente NAO autoriza publicacao**. Em
 * `production`, `EDITORIAL_AUTO_PUBLISH_ENABLED` precisa dizer `true`
 * explicitamente. Um default ligado significaria que um servico novo, um deploy
 * com env incompleta ou um typo no nome da variavel comecariam a publicar
 * sozinhos — e ninguem descobriria pela ausencia de erro.
 *
 * Note o que o kill switch NAO faz: ele nao derruba a readiness. O CMS continua
 * saudavel e atendendo com a automacao desligada; o que muda e o desfecho do
 * endpoint, que passa a ser `ROUTED_TO_REVIEW`. Confundir "desligado por decisao"
 * com "quebrado" faria o orquestrador tirar do ar um servico que esta certo.
 *
 * O FUSO e outra historia: configuracao invalida NAO e decisao, e defeito de
 * plataforma. Ela bloqueia readiness e faz o endpoint responder 503.
 */

export interface AutoPublishConfig {
  readonly enabled: boolean
  /** `null` = sem teto. Em production, ausencia vira teto conservador. */
  readonly dailyLimit: number | null
  readonly perAuthorLimit: number | null
  readonly perSectionLimit: number | null
  readonly perContentTypeLimit: number | null
  /**
   * Quantas vezes UM artigo pode ser reescrito automaticamente.
   *
   * Protecao SEPARADA dos tetos diarios: sem ela, uma automacao em loop
   * reescreveria a mesma materia dezenas de vezes por dia consumindo apenas o
   * teto global, e o leitor veria o texto mudar sozinho.
   */
  readonly perArticleUpdateLimit: number | null
  /** Fuso do DIA CIVIL da redacao. Identificador IANA. */
  readonly timeZone: string
}

export type AutoPublishConfigResult =
  | { readonly ok: true; readonly config: AutoPublishConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Fuso da redacao. Os timestamps continuam em UTC; o DIA e local. */
export const DEFAULT_EDITORIAL_TIME_ZONE = 'America/Sao_Paulo'

/** Teto usado em production quando ninguem declarou um. */
export const CONSERVATIVE_DAILY_LIMIT = 50
export const CONSERVATIVE_PER_AUTHOR_LIMIT = 20
export const CONSERVATIVE_PER_SECTION_LIMIT = 30
export const CONSERVATIVE_PER_CONTENT_TYPE_LIMIT = 40
export const CONSERVATIVE_PER_ARTICLE_UPDATE_LIMIT = 5

function positiveIntOrNull(value: string | undefined): number | null {
  const parsed = Number.parseInt((value ?? '').trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/**
 * O identificador e IANA valido NESTE runtime?
 *
 * Pergunta ao proprio ICU em vez de manter uma lista: uma lista envelheceria a
 * cada mudanca de fuso no mundo, e o Node ja sabe a resposta.
 *
 * Offset fixo (`-03:00`) e abreviacao (`BRT`) sao recusados de proposito: os
 * dois ignoram horario de verao e mudancas historicas, e a conta erraria em
 * silencio exatamente nos dias em que a virada importa.
 */
export function isValidIanaTimeZone(value: string): boolean {
  const candidate = value.trim()
  if (candidate === '') return false
  if (candidate !== 'UTC' && !/^[A-Za-z]+\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/.test(candidate)) {
    return false
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate })
    return true
  } catch {
    return false
  }
}

export function resolveAutoPublishConfig(
  env: Record<string, string | undefined>,
): AutoPublishConfigResult {
  const isProduction = (env.NODE_ENV ?? '').trim() === 'production'
  const declared = (env.EDITORIAL_AUTO_PUBLISH_ENABLED ?? '').trim().toLowerCase()

  // Comparacao POSITIVA: so `true`/`1` ligam. `"false"`, `"0"`, `""`, `"yes"` e
  // qualquer typo deixam desligado.
  const enabled = declared === 'true' || declared === '1'

  const dailyLimit = positiveIntOrNull(env.EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT)
  const perAuthorLimit = positiveIntOrNull(env.EDITORIAL_AUTO_PUBLISH_PER_AUTHOR_LIMIT)
  const perSectionLimit = positiveIntOrNull(env.EDITORIAL_AUTO_PUBLISH_PER_SECTION_LIMIT)
  const perContentTypeLimit = positiveIntOrNull(
    env.EDITORIAL_AUTO_PUBLISH_PER_CONTENT_TYPE_LIMIT,
  )
  const perArticleUpdateLimit = positiveIntOrNull(
    env.EDITORIAL_AUTO_PUBLISH_PER_ARTICLE_UPDATE_LIMIT,
  )

  // FUSO. Em production e obrigatorio e precisa ser IANA: sem ele a janela do
  // dia seria calculada em UTC, e a virada aconteceria as 21h no horario da
  // redacao. Um teto diario que zera no meio da noite anterior nao e um teto.
  const declaredZone = (env.EDITORIAL_AUTO_PUBLISH_TIME_ZONE ?? '').trim()
  if (isProduction) {
    if (declaredZone === '') {
      return { ok: false, errors: ['EDITORIAL_AUTO_PUBLISH_TIME_ZONE ausente em production'] }
    }
    if (!isValidIanaTimeZone(declaredZone)) {
      return {
        ok: false,
        errors: [
          'EDITORIAL_AUTO_PUBLISH_TIME_ZONE nao e identificador IANA valido (offset fixo e abreviacao nao sao aceitos)',
        ],
      }
    }
  } else if (declaredZone !== '' && !isValidIanaTimeZone(declaredZone)) {
    return { ok: false, errors: ['EDITORIAL_AUTO_PUBLISH_TIME_ZONE invalido'] }
  }

  return {
    ok: true,
    config: {
      enabled,
      dailyLimit: dailyLimit ?? (isProduction ? CONSERVATIVE_DAILY_LIMIT : null),
      perAuthorLimit: perAuthorLimit ?? (isProduction ? CONSERVATIVE_PER_AUTHOR_LIMIT : null),
      perSectionLimit: perSectionLimit ?? (isProduction ? CONSERVATIVE_PER_SECTION_LIMIT : null),
      perContentTypeLimit:
        perContentTypeLimit ?? (isProduction ? CONSERVATIVE_PER_CONTENT_TYPE_LIMIT : null),
      perArticleUpdateLimit:
        perArticleUpdateLimit ?? (isProduction ? CONSERVATIVE_PER_ARTICLE_UPDATE_LIMIT : null),
      timeZone: declaredZone === '' ? DEFAULT_EDITORIAL_TIME_ZONE : declaredZone,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Janela do dia civil                                                 */
/* ------------------------------------------------------------------ */

/** Partes de data de um instante, no fuso pedido. */
function localParts(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [y, m, d] = formatter.format(instant).split('-').map(Number)
  return { y: y ?? 0, m: m ?? 0, d: d ?? 0 }
}

/** Deslocamento do fuso, em ms, NAQUELE instante (cobre horario de verao). */
function offsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - instant.getTime()
}

export interface DayWindowUtc {
  /** Inicio do dia civil, em UTC. INCLUSIVO. */
  readonly startUtcIso: string
  /** Inicio do dia SEGUINTE, em UTC. EXCLUSIVO. */
  readonly nextStartUtcIso: string
}

/**
 * Janela `[inicio, proximo_inicio)` do dia civil da redacao, em UTC.
 *
 * Intervalo HALF-OPEN de proposito: com os dois extremos inclusivos, uma
 * publicacao a meia-noite exata contaria em dois dias.
 *
 * O deslocamento e resolvido pelo ICU no instante certo, nunca fixado: um
 * `-03:00` hardcoded erraria em todo horario de verao e em toda mudanca
 * historica de fuso — e erraria em SILENCIO, so no dia da virada.
 */
export function editorialDayWindowUtc(nowIso: string, timeZone: string): DayWindowUtc {
  const now = new Date(nowIso)
  const { y, m, d } = localParts(now, timeZone)

  const startOfLocalDay = (year: number, month: number, day: number): Date => {
    // Primeira aproximacao tratando a data local como se fosse UTC, depois
    // corrigida pelo deslocamento REAL naquele instante. A segunda passada
    // existe porque, perto da virada de horario de verao, o deslocamento da
    // primeira estimativa pode ser o do dia anterior.
    const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
    const firstPass = new Date(guess.getTime() - offsetMs(guess, timeZone))
    return new Date(guess.getTime() - offsetMs(firstPass, timeZone))
  }

  const start = startOfLocalDay(y, m, d)
  const nextLocal = new Date(Date.UTC(y, m - 1, d + 1))
  const next = startOfLocalDay(
    nextLocal.getUTCFullYear(),
    nextLocal.getUTCMonth() + 1,
    nextLocal.getUTCDate(),
  )

  return { startUtcIso: start.toISOString(), nextStartUtcIso: next.toISOString() }
}

/** O instante cai na janela `[inicio, proximo)`? */
export function isWithinEditorialDay(instantIso: string, window: DayWindowUtc): boolean {
  const instant = Date.parse(instantIso)
  const start = Date.parse(window.startUtcIso)
  const next = Date.parse(window.nextStartUtcIso)
  if (!Number.isFinite(instant) || !Number.isFinite(start) || !Number.isFinite(next)) return false
  return instant >= start && instant < next
}

/** Resumo SEGURO para preflight e readiness. Sem valores de credencial. */
export function describeAutoPublish(config: AutoPublishConfig): string {
  const daily = config.dailyLimit === null ? 'sem teto' : String(config.dailyLimit)
  const author = config.perAuthorLimit === null ? 'sem teto' : String(config.perAuthorLimit)
  return `${config.enabled ? 'habilitada' : 'DESABILITADA'}; diario ${daily}; por autor ${author}; fuso ${config.timeZone}`
}
