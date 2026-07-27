/**
 * identity.ts — Identidade de um item recebido: normalizacao de URL e
 * fingerprints. PURO e determinista (sem rede, DB, IO, relogio ou aleatorio).
 *
 * E a base da deduplicacao. Se a normalizacao nao for estavel, o mesmo item
 * recebido duas vezes gera duas identidades e vira duplicata no catalogo — por
 * isso cada transformacao aqui e explicita e testada.
 */

import { createHash } from 'node:crypto'

/**
 * Parametros de rastreamento removidos da URL antes de compara-la.
 *
 * Feeds e redes sociais anexam esses parametros por canal, entao o MESMO artigo
 * chega com URLs diferentes (`?utm_source=rss` vs `?utm_source=twitter`). Sem
 * remove-los a deduplicacao por URL nao pega nada.
 */
const TRACKING_PARAM_PREFIXES = ['utm_', 'mc_', 'pk_', 'ns_', 'at_'] as const

const TRACKING_PARAM_EXACT: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'igshid',
  'ref',
  'ref_src',
  'source',
  'cmpid',
  'amp',
  'feature',
  'spm',
  'yclid',
  '_ga',
  '_gl',
])

/** Esquemas aceitos. Qualquer outro (javascript:, data:, ftp:) e recusado. */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase()
  if (TRACKING_PARAM_EXACT.has(key)) return true
  return TRACKING_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix))
}

/**
 * Normaliza uma URL de artigo para uso como chave de deduplicacao.
 *
 * Aplica, nesta ordem: valida o esquema (so http/https), forca host minusculo,
 * remove `www.`, descarta a porta default, descarta o fragmento, remove
 * parametros de rastreamento, ORDENA os parametros restantes e remove a barra
 * final do caminho (exceto na raiz).
 *
 * A ordenacao dos parametros importa: `?a=1&b=2` e `?b=2&a=1` sao a mesma
 * pagina e precisam produzir a mesma chave.
 *
 * Retorna `null` quando a URL e invalida ou de esquema nao permitido — isso e
 * uma barreira de seguranca real, nao so higiene: uma `javascript:` guardada
 * aqui poderia acabar renderizada como link de fonte.
 */
export function normalizeArticleUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
  if (url.hostname === '') return null

  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  // `URL` ja omite a porta default do esquema; isto cobre o caso explicito.
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = ''
  }

  const kept: [string, string][] = []
  for (const [name, value] of url.searchParams.entries()) {
    if (isTrackingParam(name)) continue
    kept.push([name, value])
  }
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  url.search = ''
  for (const [name, value] of kept) url.searchParams.append(name, value)

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  return url.toString()
}

/**
 * Dobra um texto para fins de fingerprint: minusculo, sem acento, pontuacao
 * colapsada em espaco, espacos colapsados.
 *
 * Deliberadamente mais agressiva que a dobra da BUSCA: aqui o objetivo e
 * detectar que dois textos sao o MESMO conteudo apesar de diferencas
 * tipograficas (aspas curvas vs retas, travessao vs hifen, espaco duplo).
 */
export function foldForFingerprint(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** sha-256 hex minusculo (64 chars) — o formato exigido pelo CHECK do banco. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * Fingerprint de CONTEUDO: hash da dobra de titulo + trecho.
 *
 * Retorna `null` quando nao ha texto util. `null` NUNCA casa com `null` na
 * deduplicacao — ausencia de fingerprint nao e evidencia de igualdade.
 */
export function contentFingerprint(
  title: string | null | undefined,
  excerpt?: string | null,
): string | null {
  const parts = [title ?? '', excerpt ?? ''].map(foldForFingerprint).filter((p) => p !== '')
  if (parts.length === 0) return null
  // Separador '|': foldForFingerprint so devolve [a-z0-9] e espacos simples,
  // entao '|' NUNCA aparece dentro de uma parte -- duas entradas diferentes
  // nao colidem por deslocamento de campo. Deliberadamente NAO usamos 0x00:
  // byte de controle cru e invisivel em diff e barrado por
  // tests/governance/no-raw-control-bytes.
  return sha256Hex(parts.join('|'))
}

/**
 * Fingerprint do PAYLOAD cru recebido, para detectar "nada mudou" e evitar
 * reescrita desnecessaria (mesma disciplina do `payload_hash` da ingestao).
 */
export function payloadFingerprint(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null
  return sha256Hex(stableStringify(payload))
}

/**
 * JSON estavel: chaves ordenadas recursivamente. `JSON.stringify` preserva a
 * ordem de insercao, entao o MESMO objeto vindo com chaves em ordem diferente
 * produziria hashes diferentes e derrotaria a comparacao "sem mudanca".
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/**
 * Host canonico de uma fonte, no formato exigido pelo CHECK
 * `editorial_sources_domain_normalized`: minusculo, sem esquema, sem `www.`,
 * sem caminho. `null` quando nao da para extrair.
 */
export function normalizeSourceDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host === '' ? null : host
  } catch {
    return null
  }
}
