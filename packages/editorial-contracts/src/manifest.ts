/**
 * manifest.ts — Identidade VERIFICAVEL dos contratos. PURO.
 *
 * O MNScr vive em outro repositorio e nao pode depender dos tipos TypeScript
 * daqui. O que atravessa a fronteira e JSON Schema + um hash — e o hash e o que
 * transforma "acho que estamos na mesma versao" em uma checagem.
 *
 * DETERMINISMO E O REQUISITO CENTRAL. O mesmo contrato precisa produzir o mesmo
 * hash em qualquer maquina, em qualquer ordem de chaves, em qualquer versao de
 * Node. Por isso a serializacao e canonica (chaves ordenadas) e o hash e
 * calculado sobre ela — nunca sobre `JSON.stringify` direto, cuja ordem depende
 * da ordem de insercao.
 */

import { createHash } from 'node:crypto'

import { z } from 'zod'

import { editorialDraftV1 } from './editorial-draft-v1.js'
import {
  editorialPublicationRequestV1,
  EDITORIAL_PUBLICATION_REQUEST_NAME,
  EDITORIAL_PUBLICATION_REQUEST_SUPERSEDED,
  EDITORIAL_PUBLICATION_REQUEST_VERSION,
} from './editorial-publication-request-v1.js'
import { publicationEventV1 } from './publication-event-v1.js'
import { cinerieEditorialContextV1 } from './cinerie-editorial-context-v1.js'

/**
 * Compatibilidade declarada de um contrato.
 *
 * `stable` — pode ser consumido; mudancas serao aditivas.
 * `additive` — ganhou campos opcionais; consumidor antigo continua valendo.
 * `breaking` — exige nova versao no NOME. Nunca reaproveitar o mesmo nome.
 */
export const CONTRACT_COMPATIBILITY = ['stable', 'additive', 'breaking'] as const
export type ContractCompatibility = (typeof CONTRACT_COMPATIBILITY)[number]

export interface ContractDescriptor {
  readonly contractName: string
  readonly contractVersion: string
  readonly compatibility: ContractCompatibility
  /** Direcao do fluxo, para o consumidor entender o papel dele. */
  readonly direction: 'inbound' | 'outbound'
  readonly schema: z.ZodType
}

/**
 * Contratos publicados.
 *
 * `cinerie-editorial-context-v1` e OUTBOUND: o Cinerie o produz para o MNScr.
 * Os dois primeiros sao INBOUND: o MNScr os produz para o Cinerie.
 */
export const CONTRACTS: readonly ContractDescriptor[] = [
  {
    contractName: 'editorial-draft-v1',
    contractVersion: 'editorial-draft-v1',
    compatibility: 'stable',
    direction: 'inbound',
    schema: editorialDraftV1,
  },
  {
    contractName: EDITORIAL_PUBLICATION_REQUEST_NAME,
    // Versao SEMANTICA, separada do nome. `1.1.0` acrescenta campo opcional;
    // uma quebra incompativel cria outro NOME (`-v2`), nunca outro numero aqui.
    contractVersion: EDITORIAL_PUBLICATION_REQUEST_VERSION,
    compatibility: 'stable',
    direction: 'inbound',
    schema: editorialPublicationRequestV1,
  },
  {
    contractName: 'publication-event-v1',
    contractVersion: 'publication-event-v1',
    compatibility: 'additive',
    direction: 'outbound',
    schema: publicationEventV1,
  },
  {
    contractName: 'cinerie-editorial-context-v1',
    contractVersion: 'cinerie-editorial-context-v1',
    compatibility: 'stable',
    direction: 'outbound',
    schema: cinerieEditorialContextV1,
  },
]

/* ------------------------------------------------------------------ */
/* Serializacao canonica                                               */
/* ------------------------------------------------------------------ */

/**
 * Ordena as chaves recursivamente.
 *
 * `JSON.stringify` preserva a ordem de INSERCAO. Duas execucoes que montem o
 * mesmo objeto por caminhos diferentes produziriam bytes diferentes e, portanto,
 * hashes diferentes — e o consumidor recusaria um contrato identico.
 *
 * Arrays NAO sao ordenados: neles a ordem e semantica.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]))
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/** sha256 da serializacao canonica, no formato `sha256:<hex>`. */
export function contractHashOf(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

/* ------------------------------------------------------------------ */
/* JSON Schema                                                         */
/* ------------------------------------------------------------------ */

/**
 * JSON Schema de um contrato.
 *
 * Gerado do proprio Zod, nao escrito a mao: um schema escrito a mao vira uma
 * SEGUNDA fonte de verdade, e as duas divergem no primeiro campo novo — com o
 * agravante de que a divergencia so aparece no consumidor.
 */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
}

export interface ContractManifestEntry {
  readonly contractName: string
  readonly contractVersion: string
  readonly schemaHash: string
  readonly compatibility: ContractCompatibility
  readonly direction: 'inbound' | 'outbound'
}

/**
 * Manifesto: o que o endpoint de descoberta publica.
 *
 * SO identidade. Nem o schema completo entra aqui — o manifesto e para comparar
 * versao e hash antes de enviar, e mante-lo pequeno significa que o consumidor
 * pode chama-lo a cada boot sem custo.
 */
export function buildContractManifest(): ContractManifestEntry[] {
  return CONTRACTS.map((contract) => ({
    contractName: contract.contractName,
    contractVersion: contract.contractVersion,
    schemaHash: contractHashOf(jsonSchemaOf(contract.schema)),
    compatibility: contract.compatibility,
    direction: contract.direction,
  }))
}

export function findContract(contractName: string): ContractDescriptor | null {
  return CONTRACTS.find((contract) => contract.contractName === contractName) ?? null
}

/** Hash publicado de um contrato, ou `null` se ele nao existe. */
export function contractSchemaHash(contractName: string): string | null {
  const contract = findContract(contractName)
  return contract === null ? null : contractHashOf(jsonSchemaOf(contract.schema))
}

/* ------------------------------------------------------------------ */
/* Compatibilidade                                                     */
/* ------------------------------------------------------------------ */

/**
 * Versoes ANTERIORES que continuam aceitas, por contrato.
 *
 * Existe para que "campo opcional novo" seja de fato aditivo. Sem isto, subir a
 * versao derruba todo emissor em voo no instante do deploy — e foi esse medo,
 * dito em `blocks.ts`, que manteve `marks` fora da entrada por meses.
 *
 * O hash e ESCRITO, nunca recalculado: o schema antigo nao existe mais aqui, e
 * recalcular produziria o hash do schema novo com o rotulo do velho.
 *
 * Uma entrada aqui e um COMPROMISSO: enquanto ela existir, o CMS precisa saber
 * ler pedidos daquele formato. Tirar uma linha e uma quebra deliberada, e deve
 * vir depois de conferir que ninguem mais emite naquela versao.
 */
export const SUPERSEDED_CONTRACTS: Readonly<
  Record<string, readonly { readonly version: string; readonly schemaHash: string }[]>
> = {
  [EDITORIAL_PUBLICATION_REQUEST_NAME]: EDITORIAL_PUBLICATION_REQUEST_SUPERSEDED,
}

export type CompatibilityVerdict =
  | { readonly compatible: true }
  | { readonly compatible: false; readonly reason: 'unknown_contract' | 'version_mismatch' | 'hash_mismatch' }

/**
 * O produtor esta falando a MESMA lingua?
 *
 * FAIL-CLOSED. Divergencia de versao ou de hash recusa o pedido em vez de tentar
 * interpretar: um schema diferente pode ter o mesmo nome de campo com outra
 * semantica, e "quase compativel" e como se publica materia errada.
 */
export function checkContractCompatibility(input: {
  readonly contractName: string
  readonly declaredVersion: string
  readonly declaredHash: string
}): CompatibilityVerdict {
  const contract = findContract(input.contractName)
  if (contract === null) return { compatible: false, reason: 'unknown_contract' }

  if (contract.contractVersion === input.declaredVersion) {
    const expected = contractHashOf(jsonSchemaOf(contract.schema))
    if (expected !== input.declaredHash) return { compatible: false, reason: 'hash_mismatch' }
    return { compatible: true }
  }

  // VERSAO SUPERADA. O par (versao, hash) precisa bater INTEIRO com um dos
  // declarados: aceitar a versao e ignorar o hash devolveria a ambiguidade que
  // a checagem existe para matar — dois schemas diferentes sob o mesmo rotulo.
  const superada = (SUPERSEDED_CONTRACTS[input.contractName] ?? []).find(
    (anterior) => anterior.version === input.declaredVersion,
  )
  if (superada === undefined) return { compatible: false, reason: 'version_mismatch' }
  if (superada.schemaHash !== input.declaredHash) {
    return { compatible: false, reason: 'hash_mismatch' }
  }
  return { compatible: true }
}
