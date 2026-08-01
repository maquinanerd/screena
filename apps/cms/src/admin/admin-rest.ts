/**
 * admin-rest.ts — Leituras do painel contra a PROPRIA REST API do CMS.
 *
 * Mesma origem, mesmo servidor, mesma sessao: o navegador ja carrega o cookie do
 * Payload, e o access control da collection vale igual. Nao ha API externa aqui
 * — e nao pode haver: componente de admin que fala com terceiro vaza o que a
 * redacao esta editando.
 *
 * Tudo neste modulo e LEITURA. A unica escrita do painel continua sendo o
 * `submit()` do formulario, que passa pelos hooks de governanca.
 */

import type { AuthorFacts, MediaFacts } from './publish-gate-preview.js'

/** Base da REST API do Payload. Relativa de proposito: mesma origem, sempre. */
export function apiBase(routes?: { readonly api?: string }): string {
  const base = routes?.api ?? '/api'
  return base.endsWith('/') ? base.slice(0, -1) : base
}

async function readJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    // O cookie da sessao do painel e o que autentica. Sem isto a leitura sai
    // anonima e o access control recusa — corretamente.
    credentials: 'include',
    headers: { accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`leitura falhou (${String(response.status)})`)
  return response.json()
}

function docsOf(payload: unknown): readonly Record<string, unknown>[] {
  if (payload === null || typeof payload !== 'object') return []
  const docs = (payload as { docs?: unknown }).docs
  return Array.isArray(docs) ? (docs as Record<string, unknown>[]) : []
}

/**
 * Busca por lista de ids.
 *
 * `limit` acompanha a quantidade pedida: o default do Payload e 10, e uma
 * materia com 12 imagens no corpo teria as duas ultimas silenciosamente
 * ausentes — que a previsao leria como "midia nao verificavel" e anunciaria um
 * bloqueio que nao existe.
 */
function buildQuery(base: string, collection: string, ids: readonly string[]): string {
  const params = new URLSearchParams({
    limit: String(Math.max(ids.length, 1)),
    depth: '0',
  })
  for (const id of ids) params.append('where[id][in]', id)
  return `${base}/${collection}?${params.toString()}`
}

export async function fetchAuthorFacts(
  base: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<readonly AuthorFacts[]> {
  if (ids.length === 0) return []
  const payload = await readJson(buildQuery(base, 'authors', ids), signal)
  return docsOf(payload).map((doc) => ({
    id: String(doc.id),
    active: doc.active === true,
  }))
}

export async function fetchMediaFacts(
  base: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<readonly MediaFacts[]> {
  if (ids.length === 0) return []
  const payload = await readJson(buildQuery(base, 'media', ids), signal)
  return docsOf(payload).map((doc) => ({
    id: String(doc.id),
    licenseStatus: String(doc.licenseStatus ?? 'unknown'),
    allowedForEditorial: doc.allowedForEditorial === true,
    allowedForHero: doc.allowedForHero === true,
  }))
}

/**
 * Ja existe outra materia com esta slug NESTE idioma?
 *
 * A unicidade real e do par (idioma, slug) no lado publico. Aqui a checagem e
 * so um AVISO antecipado: nao bloqueia nada, nao escreve nada, e uma colisao
 * verdadeira ainda seria decidida na projecao.
 */
export async function slugIsTaken(
  base: string,
  input: { readonly slug: string; readonly language: string; readonly selfId: string | null },
  signal?: AbortSignal,
): Promise<boolean> {
  if (input.slug.trim() === '') return false
  const params = new URLSearchParams({ limit: '1', depth: '0' })
  params.append('where[slug][equals]', input.slug)
  params.append('where[language][equals]', input.language)
  if (input.selfId !== null) params.append('where[id][not_equals]', input.selfId)
  const payload = await readJson(`${base}/articles?${params.toString()}`, signal)
  return docsOf(payload).length > 0
}
