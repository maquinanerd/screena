/**
 * common.ts — Primitivas compartilhadas pelos contratos editoriais. PURO.
 *
 * Tudo aqui e determinista: sem rede, sem banco, sem IO, sem `Date.now()`.
 * Os limites sao parte do CONTRATO, nao um detalhe de implementacao: um draft
 * sem teto de tamanho e um vetor de exaustao de recurso no endpoint interno, e
 * um bloco que aceita HTML livre e um vetor de injecao no render publico.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Limites duros (parte do contrato)                                   */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  /** Blocos no corpo de um draft. */
  blocks: 200,
  /** Fontes externas citadas. */
  externalSources: 50,
  /** Claims (afirmacoes com evidencia). */
  claims: 100,
  /** Entidades sugeridas ao revisor. */
  entitySuggestions: 100,
  /** Itens de midia candidata (candidata != aprovada). */
  mediaCandidates: 50,
  /** Referencias de contexto interno usadas. */
  internalContext: 100,
  title: 300,
  subtitle: 400,
  summary: 2_000,
  slug: 200,
  shortText: 500,
  /** Texto de um unico bloco de paragrafo/citacao. */
  blockText: 5_000,
  url: 2_048,
  hash: 128,
  id: 200,
} as const

/* ------------------------------------------------------------------ */
/* Higiene de texto                                                    */
/* ------------------------------------------------------------------ */

/**
 * Padroes recusados em QUALQUER texto editorial do contrato.
 *
 * O corpo nunca e HTML livre (secao 11 do escopo). Recusamos no contrato, e nao
 * so na renderizacao, porque o mesmo draft alimenta painel, projecao publica e
 * futuros consumidores — sanitizar em um deles nao protege os outros.
 */
const FORBIDDEN_MARKUP: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /<\s*script\b/i, label: 'tag <script>' },
  { pattern: /<\s*iframe\b/i, label: 'tag <iframe>' },
  { pattern: /<\s*object\b/i, label: 'tag <object>' },
  { pattern: /<\s*embed\b/i, label: 'tag <embed>' },
  { pattern: /<\s*style\b/i, label: 'tag <style>' },
  { pattern: /<\s*\/?[a-z][a-z0-9-]*\s*[^>]*>/i, label: 'markup HTML' },
  { pattern: /javascript\s*:/i, label: 'esquema javascript:' },
  { pattern: /data\s*:\s*text\/html/i, label: 'data: URI de HTML' },
  { pattern: /\bon[a-z]+\s*=\s*["']/i, label: 'handler inline (onX=)' },
]

/** Primeiro padrao proibido encontrado, ou `null` quando o texto e limpo. */
export function findForbiddenMarkup(value: string): string | null {
  for (const { pattern, label } of FORBIDDEN_MARKUP) {
    if (pattern.test(value)) return label
  }
  return null
}

/** Texto editorial simples: sem markup, sem script, com teto de tamanho. */
export function plainText(max: number) {
  return z
    .string()
    .min(1, 'texto vazio')
    .max(max, `texto acima do limite de ${max} caracteres`)
    .superRefine((value, ctx) => {
      const found = findForbiddenMarkup(value)
      if (found !== null) {
        ctx.addIssue({ code: 'custom', message: `conteudo proibido no texto: ${found}` })
      }
    })
}

/** Igual a `plainText`, porem opcional (ausente ou string limpa). */
export function optionalPlainText(max: number) {
  return plainText(max).optional()
}

/* ------------------------------------------------------------------ */
/* Primitivas de identidade e tempo                                    */
/* ------------------------------------------------------------------ */

/** Identificador estavel: sem espaco, sem markup, com teto. */
export const stableId = z
  .string()
  .min(1, 'id vazio')
  .max(LIMITS.id)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'id fora do formato permitido')

/** Slug proposto (o slug final e decidido pela redacao, nao pelo writer). */
export const slugProposal = z
  .string()
  .min(1)
  .max(LIMITS.slug)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug deve ser kebab-case minusculo')

/** Hash hexadecimal (sha-256 e o padrao do repositorio, mas nao e imposto aqui). */
/**
 * Hash de SCHEMA: `sha256:<64 hex>`.
 *
 * Deliberadamente distinto do `contentHash` abaixo, que e hex PURO e descreve
 * PAYLOAD. Sao duas coisas diferentes com o mesmo nome informal, e reusar um
 * validador pelo outro produz a recusa mais confusa possivel: "hash deve ser
 * hexadecimal" para um hash que e hexadecimal.
 *
 * Vive aqui, e nao em `manifest.ts`, porque o manifesto IMPORTA os contratos —
 * um contrato importando o manifesto fecharia um ciclo.
 */
export const schemaHash = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'schemaHash deve ser sha256:<64 hexadecimais>')

export const contentHash = z
  .string()
  .min(16)
  .max(LIMITS.hash)
  .regex(/^[a-f0-9]+$/i, 'hash deve ser hexadecimal')

/**
 * Instante ISO-8601 com timezone explicito.
 *
 * Validado por `Date.parse` + exigencia de offset: uma data sem timezone e
 * ambigua entre servicos que rodam em fusos diferentes, e o repositorio ja trata
 * timestamp sem offset como defeito.
 */
export const isoDateTime = z
  .string()
  .min(1)
  .max(64)
  .superRefine((value, ctx) => {
    if (Number.isNaN(Date.parse(value))) {
      ctx.addIssue({ code: 'custom', message: 'instante ISO-8601 invalido' })
      return
    }
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'instante ISO-8601 exige timezone explicito' })
    }
  })

/** URL http(s) absoluta. Nenhum outro esquema e aceito. */
export const httpUrl = z
  .string()
  .min(1)
  .max(LIMITS.url)
  .superRefine((value, ctx) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'URL invalida' })
      return
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', message: 'somente http(s) e aceito' })
    }
  })

/** Idioma BCP-47 simples (ex.: `pt-BR`, `en`, `es`). */
export const languageCode = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'codigo de idioma invalido')

/* ------------------------------------------------------------------ */
/* Proveniencia (secao 6 do ADR 0015)                                  */
/* ------------------------------------------------------------------ */

/**
 * Origem de um fato. O MNScr organiza e redige, mas NAO e fonte primaria: todo
 * fato entregue carrega de onde veio, e `inference` e explicitamente rotulado
 * como inferencia — nunca se disfarca de fato apurado.
 */
export const FACT_ORIGINS = [
  'external_source',
  'cinerie_catalog',
  'cinerie_editorial',
  'licensed_media',
  'human_input',
  'inference',
] as const

export const factOrigin = z.enum(FACT_ORIGINS)
export type FactOrigin = (typeof FACT_ORIGINS)[number]

/** Referencia de proveniencia anexavel a um bloco, claim ou campo. */
export const provenanceRef = z.object({
  origin: factOrigin,
  /** Id do item de origem (source item, entidade, artigo anterior, midia). */
  ref: stableId.optional(),
  /** Confianca declarada pelo produtor, quando aplicavel. */
  confidence: z.number().min(0).max(1).optional(),
})
export type ProvenanceRef = z.infer<typeof provenanceRef>

/* ------------------------------------------------------------------ */
/* Tipos de entidade do catalogo                                       */
/* ------------------------------------------------------------------ */

export const ENTITY_KINDS = [
  'movie',
  'tv',
  'season',
  'episode',
  'person',
  'character',
  'franchise',
] as const

export const entityKind = z.enum(ENTITY_KINDS)
export type EntityKind = (typeof ENTITY_KINDS)[number]

/* ------------------------------------------------------------------ */
/* Resultado de parse                                                  */
/* ------------------------------------------------------------------ */

/** Erro de contrato em forma utilizavel: caminho + mensagem, sem stack. */
export interface ContractIssue {
  readonly path: string
  readonly message: string
}

export type ContractParse<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ContractIssue[] }

/**
 * Executa um schema e devolve um resultado SEGURO para log e resposta HTTP:
 * caminho + mensagem, nunca o valor recebido. Um erro de validacao que ecoa o
 * payload vira vetor de vazamento no log do endpoint interno.
 */
export function parseContract<T>(schema: z.ZodType<T>, input: unknown): ContractParse<T> {
  const result = schema.safeParse(input)
  if (result.success) return { ok: true, value: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.length === 0 ? '(raiz)' : issue.path.join('.'),
      message: issue.message,
    })),
  }
}
