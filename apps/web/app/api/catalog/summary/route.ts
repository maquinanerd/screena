/**
 * GET /api/catalog/summary?ids=movie:1,tv:2 — cartões PÚBLICOS de catálogo
 * (título, href canônico, poster/backdrop) para superfícies pessoais que só
 * guardam ids (Backend C). Sem dado pessoal, sem auth, read-only Postgres.
 * Delegador fino: a resolução vive em src/server/catalog-summary.ts.
 */

import {
  getCatalogSummary,
  parseCatalogSummaryIds,
} from '../../../../src/server/catalog-summary'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const keys = parseCatalogSummaryIds(url.searchParams.get('ids'))
  const items = await getCatalogSummary(keys)
  return Response.json(
    { items },
    { headers: { 'cache-control': 'public, max-age=300' } },
  )
}
