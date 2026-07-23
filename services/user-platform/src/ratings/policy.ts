/**
 * policy.ts — Politica pura da AVALIACAO DE USUARIO (Backend C, unidade C5A).
 *
 * PURO: sem rede, sem DB, sem relogio. Concentra (1) o gate de mutacao por
 * estado da conta (delegado a privacy — nao duplica regra) e (2) a validacao do
 * par (value, scale) na escala fixa 5, passo 0.5.
 *
 * OPTIMISTIC LOCKING — LACUNA REGISTRADA: o schema de `user_ratings` NAO possui
 * coluna `version` (diferente de `user_watch_states`, decisoes de produto
 * secao 3). Portanto NAO existe Expected-Version para nota de usuario e nao
 * inventamos coluna. A pre-imagem (`UserRatingSnapshot`) e suficiente para a
 * persistencia futura aplicar escrita condicional dentro de transacao, guardada
 * pelo indice unico (user_id, entity_type, entity_id). Se um dia o schema
 * ganhar `version`, o gate de versao entra AQUI (ponto unico), nunca espalhado.
 */

import { collect, type DomainResult, type ValidationResult } from "../core/result.js";
import type { UserStatus } from "../core/types.js";
import { assertCanMutate } from "../privacy/deletion.js";
import { USER_RATING_MIN, USER_RATING_SCALE, USER_RATING_STEP } from "./types.js";

/**
 * Toda mutacao de nota exige conta `active`. disabled / pending_deletion /
 * deleted — e qualquer estado desconhecido — sao BLOQUEADOS (fail-closed).
 * Delegado a privacy/deletion.assertCanMutate: mesma fonte de status do resto
 * do produto, sem regra divergente.
 */
export function assertRatingMutationAllowed(accountStatus: UserStatus): DomainResult<true> {
  return assertCanMutate(accountStatus);
}

/**
 * Valida o par (value, scale) de uma nota de usuario, acumulando TODAS as
 * violacoes (estilo packages/schemas). Regras:
 *  - scale === 5 (escala fixa; NUNCA 10/100 de fonte externa);
 *  - value finito (rejeita NaN / Infinity / -Infinity e nao-numeros);
 *  - value >= 0.5 e value <= 5;
 *  - value * 2 inteiro (passo de 0.5).
 * NUNCA arredonda, trunca nem converte escala.
 */
export function validateUserRatingValue(value: number, scale: number): ValidationResult {
  const errors: string[] = [];

  if (scale !== USER_RATING_SCALE) {
    errors.push(
      `escala invalida: nota de usuario usa escala fixa ${USER_RATING_SCALE}, recebido ${String(scale)}. Nunca reescale para escala de fonte externa.`,
    );
  }

  if (!Number.isFinite(value)) {
    errors.push("valor invalido: a nota deve ser um numero finito.");
    return collect(errors);
  }

  if (value < USER_RATING_MIN) {
    errors.push(`valor invalido: a nota minima e ${USER_RATING_MIN} (recebido ${String(value)}).`);
  }

  if (value > USER_RATING_SCALE) {
    errors.push(`valor invalido: a nota maxima e ${USER_RATING_SCALE} (recebido ${String(value)}).`);
  }

  if (!Number.isInteger(value * 2)) {
    errors.push(
      `valor invalido: a nota deve andar em passos de ${USER_RATING_STEP} (recebido ${String(value)}).`,
    );
  }

  return collect(errors);
}
