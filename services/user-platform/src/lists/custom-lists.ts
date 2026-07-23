/**
 * Listas customizadas do usuario — validacao pura de criacao, publicacao
 * e adicao de itens.
 *
 * PURO: nao faz rede, DB nem IO. Contexto de produto (nao violar):
 *  - tudo nasce privado; tornar public/unlisted exige email verificado;
 *  - limites antiabuso fixos (LIST_LIMITS) aplicados na validacao;
 *  - itens de lista referenciam apenas entidades avaliaveis do catalogo
 *    (RATABLE_ENTITY_TYPES) — nunca conteudo externo/pirata.
 *
 * Mensagens de erro em pt-BR, seguras: nao vazam segredo nem permitem
 * enumeracao de contas.
 */

import { collect, type DomainResult, err, ok, type ValidationResult } from "../core/result.js";
import { RATABLE_ENTITY_TYPES, VISIBILITIES, type Visibility } from "../core/types.js";

/** Limites antiabuso das listas customizadas (fonte unica; nao duplicar). */
export const LIST_LIMITS = {
  maxCustomListsPerUser: 100,
  maxItemsPerList: 1000,
  maxTitleLength: 120,
  maxDescriptionLength: 2000,
  maxNoteLength: 1000,
} as const;

const VISIBILITY_SET: ReadonlySet<string> = new Set(VISIBILITIES);
const RATABLE_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(RATABLE_ENTITY_TYPES);

/**
 * Gera slug ascii kebab-case a partir do titulo da lista.
 *
 * Regras: minusculas; remove diacriticos via normalize("NFD"); colapsa
 * qualquer sequencia nao-alfanumerica em um unico '-'; apara '-' das
 * pontas. Se o resultado ficar vazio, devolve "lista" (fallback estavel).
 */
export function slugifyListTitle(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length === 0 ? "lista" : slug;
}

/** Entrada de criacao de lista customizada (campos opcionais permitidos). */
export interface ListCreateInput {
  readonly title: string;
  readonly description?: string;
  readonly visibility?: string;
  readonly ordered?: boolean;
}

/** Contexto antiabuso da criacao (contagem atual vinda do adapter). */
export interface ListCreateContext {
  readonly currentCustomListCount: number;
}

/**
 * Valida a criacao de uma lista customizada.
 *
 * Acumula TODAS as violacoes (estilo packages/schemas): titulo obrigatorio
 * e limitado; descricao limitada; visibilidade dentro do enum; limite
 * antiabuso de listas por usuario.
 */
export function validateListCreate(
  input: ListCreateInput,
  context: ListCreateContext,
): ValidationResult {
  const errors: string[] = [];

  const title = input.title.trim();
  if (title.length === 0) {
    errors.push("titulo da lista e obrigatorio.");
  } else if (title.length > LIST_LIMITS.maxTitleLength) {
    errors.push(`titulo da lista deve ter no maximo ${LIST_LIMITS.maxTitleLength} caracteres.`);
  }

  if (
    input.description !== undefined &&
    input.description.length > LIST_LIMITS.maxDescriptionLength
  ) {
    errors.push(
      `descricao da lista deve ter no maximo ${LIST_LIMITS.maxDescriptionLength} caracteres.`,
    );
  }

  if (input.visibility !== undefined && !VISIBILITY_SET.has(input.visibility)) {
    errors.push(
      `visibilidade invalida: "${input.visibility}" nao pertence a (${VISIBILITIES.join(", ")}).`,
    );
  }

  if (
    !Number.isInteger(context.currentCustomListCount) ||
    context.currentCustomListCount < 0
  ) {
    errors.push("contagem atual de listas invalida.");
  } else if (context.currentCustomListCount >= LIST_LIMITS.maxCustomListsPerUser) {
    errors.push(
      `limite de ${LIST_LIMITS.maxCustomListsPerUser} listas customizadas por usuario atingido.`,
    );
  }

  return collect(errors);
}

/**
 * Decide se a lista pode assumir a visibilidade pedida.
 *
 * Tudo nasce privado; public e unlisted exigem email verificado
 * (anti-spam/anti-abuso). Mensagem clara, sem vazar dados da conta.
 */
export function canPublishList(input: {
  readonly visibility: Visibility;
  readonly emailVerifiedAt: Date | null;
}): DomainResult<true> {
  if (input.visibility === "private") {
    return ok(true);
  }
  if (input.emailVerifiedAt === null) {
    return err(
      "forbidden",
      "verifique seu email antes de tornar uma lista publica ou nao listada.",
    );
  }
  return ok(true);
}

/** Entrada de adicao de item em lista (nota opcional do usuario). */
export interface ListItemAddInput {
  readonly entityType: string;
  readonly note?: string;
}

/** Contexto antiabuso da adicao (contagem atual de itens da lista). */
export interface ListItemAddContext {
  readonly currentItemCount: number;
}

/**
 * Valida a adicao de um item a uma lista.
 *
 * entityType precisa pertencer a RATABLE_ENTITY_TYPES (movie, tv, season,
 * episode); nota limitada; limite antiabuso de itens por lista.
 */
export function validateListItemAdd(
  input: ListItemAddInput,
  context: ListItemAddContext,
): ValidationResult {
  const errors: string[] = [];

  if (!RATABLE_ENTITY_TYPE_SET.has(input.entityType)) {
    errors.push(
      `entityType invalido: "${input.entityType}" nao pertence a (${RATABLE_ENTITY_TYPES.join(", ")}).`,
    );
  }

  if (input.note !== undefined && input.note.length > LIST_LIMITS.maxNoteLength) {
    errors.push(`nota do item deve ter no maximo ${LIST_LIMITS.maxNoteLength} caracteres.`);
  }

  if (!Number.isInteger(context.currentItemCount) || context.currentItemCount < 0) {
    errors.push("contagem atual de itens invalida.");
  } else if (context.currentItemCount >= LIST_LIMITS.maxItemsPerList) {
    errors.push(`limite de ${LIST_LIMITS.maxItemsPerList} itens por lista atingido.`);
  }

  return collect(errors);
}
