/**
 * GET /readyz — READINESS do CMS.
 *
 * Responde "posso receber trafego": configuracao valida, banco editorial
 * acessivel, migrations aplicadas, storage de upload pronto e collections
 * registradas.
 *
 * 503 quando nao esta pronto — nao 500. O servico nao quebrou; ele ainda nao
 * pode atender, e 503 e o status que faz o orquestrador tirar do balanceador em
 * vez de marcar o deploy como falho.
 *
 * NADA aqui expoe segredo, URL de banco, usuario, caminho de storage ou
 * conteudo editorial: um readiness costuma ficar aberto num painel.
 */

import { evaluateCmsReadiness, readinessHttpStatus } from '../../src/readiness.js'
import { collectCmsReadinessFacts } from '../../src/readiness-collector.js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(): Promise<Response> {
  const startedAt = Date.now()
  const facts = await collectCmsReadinessFacts()
  const report = evaluateCmsReadiness(facts)

  return Response.json(
    {
      status: report.ready ? 'ready' : 'not_ready',
      service: 'cinerie-cms',
      checks: report.checks,
      checkDurationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: readinessHttpStatus(report), headers: { 'cache-control': 'no-store' } },
  )
}
