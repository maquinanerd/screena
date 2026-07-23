/**
 * Regras puras de IDENTIDADE da user platform (Backend C).
 *
 * PURO: sem rede, sem DB, sem fs, sem relogio. Normalizacao e validacao de
 * email e handle. NUNCA carrega segredo — email/handle sao identificadores,
 * nao credenciais.
 *
 * Precedencia (docs/product/user-product-decisions.md + schema):
 *  - `email_normalized` = lower(trim(email)) e a chave anti-enumeracao usada
 *    em TODA comparacao de login;
 *  - normalizacao NAO e destrutiva por provedor: nao remove pontos do Gmail,
 *    nao corta "+tag", nao altera a parte local alem de trim+lowercase. Duas
 *    contas com local-parts diferentes continuam distintas;
 *  - identificador PUBLICO (handle) e separado do identificador de
 *    autenticacao (email); o handle e opcional e nunca serve para login.
 */

import { collect, type ValidationResult } from "../core/result.js";

/** Tamanho maximo pratico de email (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254;

/**
 * Formato minimo exigido: parte local sem espaco/@, um unico "@", dominio com
 * ao menos um ponto e TLD de 2+ chars. A entrega real e verificada pelo fluxo
 * de token, nunca por regex — por isso NAO tentamos um validador RFC completo.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normaliza email para comparacao/armazenamento canonico: SOMENTE trim +
 * lowercase. Deliberadamente NAO aplica regra de provedor (pontos do Gmail,
 * "+tag", etc.) — isso mudaria a identidade da conta.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Valida o FORMATO de um email (nao verifica entrega nem existencia). */
export function validateEmailFormat(email: string): ValidationResult {
  const errors: string[] = [];
  const normalized = normalizeEmail(email);

  if (normalized.length === 0) {
    errors.push("email nao pode ser vazio.");
  } else {
    if (normalized.length > EMAIL_MAX_LENGTH) {
      errors.push(`email excede o tamanho maximo de ${EMAIL_MAX_LENGTH} caracteres.`);
    }
    if (!EMAIL_PATTERN.test(normalized)) {
      errors.push("email em formato invalido.");
    }
  }

  return collect(errors);
}

/**
 * Handle publico: minusculas/digitos, underscore apenas no miolo (nunca nas
 * pontas). Comprimentos validos: 1 ou 3..30 caracteres.
 */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?$/;

/** Valida o formato de um handle de usuario (identificador publico opcional). */
export function validateHandle(handle: string): ValidationResult {
  const errors: string[] = [];

  if (handle.length === 0) {
    errors.push("handle nao pode ser vazio.");
  } else if (!HANDLE_PATTERN.test(handle)) {
    errors.push(
      "handle invalido: use apenas [a-z0-9_], sem underscore nas pontas, tamanho 1 ou 3..30.",
    );
  }

  return collect(errors);
}
