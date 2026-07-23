/**
 * Toolkit de parsing ESTRITO da fronteira de contratos (Backend C).
 *
 * PURO: sem rede, sem DB, sem relogio, sem crypto. Transforma entrada NAO
 * CONFIAVEL (`unknown`, vinda de JSON/form no futuro) em objetos validados,
 * com allow-list explicita de campos — nunca por spread, Object.assign ou
 * serializacao automatica. E a primeira barreira contra mass-assignment,
 * campos administrativos e prototype pollution.
 *
 * Regras:
 *  - so aceita objeto simples (nao array, nao null, nao primitivo);
 *  - rejeita chaves proprias perigosas (__proto__, constructor, prototype);
 *  - em modo estrito, rejeita QUALQUER chave fora da allow-list;
 *  - le campos apenas pela allow-list (nunca copia o objeto inteiro).
 *
 * Mensagens de erro sao genericas e NUNCA ecoam o valor recebido (nada de
 * senha/token vazando em mensagem).
 */

import { type DomainResult, err, ok } from "../core/result.js";

/** Chaves proprias proibidas em qualquer corpo (defesa contra prototype pollution). */
const FORBIDDEN_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

/**
 * Converte entrada desconhecida em um Record simples e seguro. Fail-closed:
 * primitivo, null, array ou objeto com chave perigosa sao rejeitados.
 */
export function asRecord(input: unknown): DomainResult<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err("validation_failed", "corpo da requisicao invalido.", [
      "esperado um objeto JSON",
    ]);
  }
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return err("validation_failed", "corpo da requisicao invalido.", [
        "corpo contem chave proibida",
      ]);
    }
  }
  return ok(input as Record<string, unknown>);
}

/**
 * Em MODO ESTRITO, garante que o objeto so tem chaves da allow-list. Qualquer
 * chave extra (ex.: `status`, `role`, `isAdmin`, `userId`, `tokenHash`,
 * `passwordHash`) e rejeitada — isto barra mass-assignment e escalada.
 */
export function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
): DomainResult<true> {
  const allowed = new Set(allowedKeys);
  const extras = Object.keys(obj).filter((k) => !allowed.has(k));
  if (extras.length > 0) {
    return err("validation_failed", "corpo da requisicao invalido.", [
      "campo(s) nao permitido(s) no corpo",
    ]);
  }
  return ok(true);
}

/** Le uma string OBRIGATORIA, com trim opcional e limites de tamanho. */
export function requireString(
  obj: Record<string, unknown>,
  key: string,
  opts: { readonly trim?: boolean; readonly min?: number; readonly max: number },
): DomainResult<string> {
  const raw = obj[key];
  if (typeof raw !== "string") {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" e obrigatorio`]);
  }
  const value = opts.trim ? raw.trim() : raw;
  if (value.length === 0) {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" nao pode ser vazio`]);
  }
  if (opts.min !== undefined && value.length < opts.min) {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" muito curto`]);
  }
  if (value.length > opts.max) {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" excede o tamanho maximo`]);
  }
  return ok(value);
}

/**
 * Le uma string OPCIONAL (ausente ou null => undefined). Quando presente, deve
 * ser string; aplica trim/limite. String vazia apos trim vira undefined.
 */
export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  opts: { readonly trim?: boolean; readonly max: number },
): DomainResult<string | undefined> {
  const raw = obj[key];
  if (raw === undefined || raw === null) {
    return ok(undefined);
  }
  if (typeof raw !== "string") {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" deve ser texto`]);
  }
  const value = opts.trim ? raw.trim() : raw;
  if (value.length === 0) {
    return ok(undefined);
  }
  if (value.length > opts.max) {
    return err("validation_failed", "dados invalidos.", [`campo "${key}" excede o tamanho maximo`]);
  }
  return ok(value);
}

/**
 * Aceita um corpo VAZIO (para operacoes cuja identidade/sessao vem do contexto
 * autenticado, nunca do body): {}, null ou undefined. QUALQUER chave presente
 * e rejeitada (ex.: `sessionId`, `userId`, `tokenHash`, `rotatedFromId`).
 */
export function expectEmptyBody(input: unknown): DomainResult<true> {
  if (input === null || input === undefined) {
    return ok(true);
  }
  const record = asRecord(input);
  if (!record.ok) {
    return record;
  }
  return rejectUnknownKeys(record.value, []);
}
