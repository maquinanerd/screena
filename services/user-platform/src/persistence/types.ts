/**
 * types.ts — CONTRATOS de persistencia da user platform (Backend C, C7A).
 *
 * SO CONTRATOS. Nenhum PrismaClient, nenhum SQL, nenhum IO, nenhuma
 * implementacao — os adapters concretos sao C7B. Este modulo existe para que a
 * fronteira transacional tenha um vocabulario estavel ANTES de existir adapter.
 *
 * Direcao da dependencia: persistence -> dominio (nunca o contrario). Os
 * dominios puros continuam sem saber que persistencia existe.
 */

/**
 * Escopo transacional OPACO. O adapter (C7B) o liga ao client concreto; este
 * contrato NAO conhece Prisma. O marcador nominal impede passar um objeto
 * qualquer no lugar de um escopo real.
 */
export interface TransactionScope {
  readonly transactional: true;
}

/**
 * Por que a escrita nao pode ser aplicada. Espelha as pre-condicoes que os
 * planos de dominio ja declaram — nao inventa taxonomia nova.
 */
export type PersistenceConflictReason =
  /** O snapshot vigente lido nao e mais o vigente (optimistic concurrency). */
  | "expected_current_mismatch"
  /** Mesma idempotencyKey ja existe com CONTEUDO divergente. */
  | "idempotency_content_mismatch"
  /** A pre-imagem usada no compare-and-swap nao bate mais (ratings/reviews). */
  | "stale_preimage"
  /** Uma constraint UNIQUE barrou a escrita (ex.: dois vigentes concorrentes). */
  | "unique_violation";

export interface PersistenceConflict {
  readonly reason: PersistenceConflictReason;
  /** Detalhe SEGURO para log interno (nunca PII, nunca segredo). */
  readonly detail?: string;
}

/**
 * Resultado da EXECUCAO de um plano ja decidido pelo dominio. A persistencia
 * NUNCA decide regra de negocio: ela aplica, nao aplica (noop) ou reporta
 * conflito.
 */
export type PersistenceOutcome<T> =
  | { readonly kind: "applied"; readonly value: T }
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "conflict"; readonly conflict: PersistenceConflict };

/** Identificador de linha recem-escrita (null quando o plano nao inseriu). */
export interface WrittenRowRef {
  readonly id: bigint | null;
}
