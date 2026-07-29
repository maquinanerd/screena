/**
 * contracts.ts — Descoberta de contratos para consumidores externos.
 *
 * O MNScr vive em outro repositorio e nao pode depender dos tipos TypeScript
 * daqui. Antes de mandar um pedido de publicacao ele consulta este endpoint e
 * compara versao e hash com o que ele tem — e desiste se divergirem.
 *
 * O QUE SAI: nome, versao, hash, compatibilidade e direcao. Mais nada.
 * O QUE NAO SAI: schema completo, configuracao, caminho, banco, segredo, chave.
 *
 * A resposta e pequena de proposito: o consumidor pode chama-la a cada boot sem
 * custo, e um manifesto enxuto tem menos superficie para vazar alguma coisa.
 */

import type { Endpoint, PayloadRequest } from 'payload'

import { buildContractManifest, findContract, jsonSchemaOf } from '@screena/editorial-contracts'

import { serviceHasScope } from '../access.js'
import { toActor } from '../actor.js'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Autenticado, mas com escopo AMPLO.
 *
 * Qualquer conta tecnica ativa pode descobrir contratos: o produtor de rascunho,
 * o de publicacao e o worker todos precisam saber com que versao estao falando.
 * Exigir um escopo especifico aqui criaria o pior tipo de falha — o consumidor
 * descobriria a incompatibilidade so na hora de enviar, com o conteudo pronto.
 *
 * Anonimo continua recusado: o manifesto revela a superficie de integracao, e
 * isso nao precisa ser publico.
 */
function requireAnyServiceAccount(req: PayloadRequest): Response | null {
  const actor = toActor(req.user)
  if (actor.kind === 'anonymous') return json({ error: 'unauthenticated' }, 401)
  const allowed =
    serviceHasScope(actor, 'draft_ingest') ||
    serviceHasScope(actor, 'editorial_auto_publish') ||
    serviceHasScope(actor, 'publication_projection')
  if (!allowed) return json({ error: 'forbidden_scope' }, 403)
  return null
}

export const contractsManifestEndpoint: Endpoint = {
  path: '/internal/contracts',
  method: 'get',
  handler: (req: PayloadRequest): Response => {
    const denied = requireAnyServiceAccount(req)
    if (denied !== null) return denied

    return json(
      {
        contracts: buildContractManifest(),
        // Identidade do build, para correlacionar um comportamento com uma
        // imagem. Nunca inventa um valor: sem a env, e `unknown`.
        buildIdentifier: (process.env.CINERIE_BUILD_SHA ?? 'unknown').slice(0, 40),
      },
      200,
    )
  },
}

/**
 * Schema COMPLETO de um contrato.
 *
 * Separado do manifesto porque tem outro peso e outra frequencia: o consumidor
 * busca o schema uma vez, ao gerar os tipos dele, e consulta o manifesto a cada
 * boot. Juntar os dois faria toda checagem de compatibilidade trafegar centenas
 * de KB.
 */
export const contractSchemaEndpoint: Endpoint = {
  path: '/internal/contracts/:contractName',
  method: 'get',
  handler: (req: PayloadRequest): Response => {
    const denied = requireAnyServiceAccount(req)
    if (denied !== null) return denied

    const raw = (req.routeParams as { contractName?: unknown } | undefined)?.contractName
    const contractName = typeof raw === 'string' ? raw.trim() : ''
    const contract = findContract(contractName)
    if (contract === null) return json({ error: 'unknown_contract' }, 404)

    const entry = buildContractManifest().find(
      (candidate) => candidate.contractName === contractName,
    )

    return json(
      {
        contractName: contract.contractName,
        contractVersion: contract.contractVersion,
        schemaHash: entry?.schemaHash ?? null,
        compatibility: contract.compatibility,
        direction: contract.direction,
        // O JSON Schema e gerado do proprio Zod: nao ha uma segunda fonte de
        // verdade escrita a mao para divergir no primeiro campo novo.
        jsonSchema: jsonSchemaOf(contract.schema),
      },
      200,
    )
  },
}

export const contractEndpoints: Endpoint[] = [
  contractsManifestEndpoint,
  contractSchemaEndpoint,
]
