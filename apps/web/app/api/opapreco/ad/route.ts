import { requestAdDecision } from '@screena/opapreco'

import { readOpaPrecoConfig, resolveOfferImage } from '../../../../src/lib/opapreco/config'
import { buildFixtureAdResponse } from '../../../../src/lib/opapreco/fixtures'
import { normalizeAdResponse } from '../../../../src/lib/opapreco/normalize'
import { OP_SLOTS, isOpSlotId } from '../../../../src/lib/opapreco/slots'
import type { OpSlotTags, OpVertical, OpViewport } from '../../../../src/lib/opapreco/slots'
import { SITE_URL } from '../../../../src/lib/site'

/**
 * `GET /api/opapreco/ad` — a decisao de anuncio de UM slot, pedida pelo
 * navegador depois do render (ver `app/_components/opapreco/ad-slot-client.tsx`).
 *
 * E aqui, e nao na pagina, que se fala com o ad server da OpaPreco: a
 * invariante 3 proibe API externa no render de pagina indexavel. A conversa
 * tem teto de 1,5 s (`@screena/opapreco`); 204, erro, demora ou resposta fora do
 * contrato viram 204 para o navegador, e o slot colapsa sem mensagem.
 *
 * `no-store` porque a resposta e por pagina e por viewport, e uma oferta
 * guardada podia passar das 6 h de verificacao que a SPEC permite.
 */
export const dynamic = 'force-dynamic'

const VIEWPORTS: readonly OpViewport[] = ['mobile', 'tablet', 'desktop']
const VERTICALS: readonly OpVertical[] = ['home', 'movie', 'series', 'news', 'person', 'mixed']

function empty(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

/** Texto curto de tag: sem controle, sem quebra, ate `max` caracteres. */
function tag(value: string | null, max: number): string | undefined {
  if (value === null) return undefined
  const text = value.replace(/\p{Cc}/gu, '').trim()
  return text === '' ? undefined : text.slice(0, max)
}

function logEmpty(slot: string, reason: string): void {
  console.warn(JSON.stringify({ event: 'opapreco_ad_unavailable', slot, reason }))
}

export async function GET(request: Request): Promise<Response> {
  const config = readOpaPrecoConfig()
  if (config.mode === 'off') return empty()

  const params = new URL(request.url).searchParams
  const slot = params.get('slot')
  if (!isOpSlotId(slot)) return empty()
  const viewport = params.get('viewport') as OpViewport | null
  if (viewport === null || !VIEWPORTS.includes(viewport)) return empty()
  // Lateral so >= 1024px (SPEC §6): nem pergunta ao ad server.
  if (OP_SLOTS[slot].reserve[viewport] === null) return empty()

  const width = Number(params.get('containerWidth'))
  const containerWidth = Number.isFinite(width) ? Math.max(0, Math.min(4000, Math.round(width))) : 0
  const rawPath = params.get('path') ?? '/'
  const path = rawPath.startsWith('/') && !rawPath.startsWith('//') ? rawPath.slice(0, 512) : '/'
  const verticalParam = params.get('vertical') as OpVertical | null
  const genres = tag(params.get('genres'), 200)
  const tags: OpSlotTags = {
    ...(verticalParam !== null && VERTICALS.includes(verticalParam) ? { vertical: verticalParam } : {}),
    ...(tag(params.get('entity'), 160) !== undefined ? { entity: tag(params.get('entity'), 160) } : {}),
    ...(tag(params.get('category'), 80) !== undefined ? { category: tag(params.get('category'), 80) } : {}),
    ...(genres !== undefined ? { genres: genres.split(',').map((genre) => genre.trim()).filter(Boolean) } : {}),
  }

  const now = Date.now()
  let raw: unknown
  if (config.mode === 'fixtures') {
    raw = buildFixtureAdResponse(slot, viewport, tags, now)
  } else {
    const outcome = await requestAdDecision({
      adServerUrl: config.adServerUrl,
      publisher: config.publisher,
      query: {
        slot,
        url: `${SITE_URL}${path}`,
        viewport,
        containerWidth: String(containerWidth),
        vertical: tags.vertical ?? '',
        entity: tags.entity ?? '',
        category: tags.category ?? '',
        genres: tags.genres?.join(',') ?? '',
      },
    })
    if (outcome.kind === 'empty') return empty()
    if (outcome.kind === 'error') {
      logEmpty(slot, outcome.reason)
      return empty()
    }
    raw = outcome.body
  }

  const decision = normalizeAdResponse(raw, {
    slot,
    viewport,
    now,
    resolveImage: (src) => resolveOfferImage(src, config),
  })
  if (decision === null) {
    logEmpty(slot, 'fora_do_contrato')
    return empty()
  }
  return Response.json(decision, { headers: { 'Cache-Control': 'no-store' } })
}
