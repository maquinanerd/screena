/**
 * ports.ts — PORTAS de persistencia (Backend C, C7A).
 *
 * SO INTERFACES. Cada porta espelha um DOMINIO real e recebe os PLANOS que o
 * dominio ja produziu — deliberadamente NAO ha `BaseRepository` nem
 * `Repository<T>` generico: um CRUD generico apagaria justamente as
 * pre-condicoes (vigencia, idempotencia, compare-and-swap) que tornam a escrita
 * segura.
 *
 * Implementacao concreta = C7B. Aqui nao ha PrismaClient, SQL, rede nem HTTP.
 */

import type {
  CurrentSnapshotSummary,
  FeedbackPlan,
  RecommendationContext,
  SnapshotPublicationPlan,
  StoredFeedback,
} from "../recommendations/index.js";
import type { PersistenceOutcome, TransactionScope, WrittenRowRef } from "./types.js";

/**
 * Executa um trabalho dentro de UMA transacao. Os planos de C6B descrevem
 * operacoes que so sao seguras se aplicadas atomicamente (rebaixar o vigente e
 * inserir o novo).
 */
export interface TransactionRunner {
  runInTransaction<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T>;
}

/**
 * Snapshot de recomendacao. O vigente e por (usuario, CONTEXTO) — o indice
 * unico parcial `(user_id, context) WHERE is_current` e a trava final.
 */
export interface RecommendationSnapshotStore {
  /**
   * Le o resumo do snapshot VIGENTE. `fingerprint` pode vir `null` (linha
   * legada): quem consome DEVE tratar null como NAO-equivalente (forca replace),
   * nunca como igual.
   */
  readCurrent(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint; readonly context: RecommendationContext },
  ): Promise<CurrentSnapshotSummary | null>;

  /**
   * Aplica um plano JA decidido pelo dominio (`create`/`replace`/`renew`/
   * `invalidate`). Planos `noop`/`conflict`/`invalid`/`forbidden` nao escrevem.
   */
  applyPublication(
    scope: TransactionScope,
    plan: SnapshotPublicationPlan,
  ): Promise<PersistenceOutcome<WrittenRowRef>>;
}

/** Feedback explicito de recomendacao (idempotente por usuario + chave). */
export interface RecommendationFeedbackStore {
  /** Pre-imagem por chave de idempotencia (escopo do usuario). */
  readByIdempotencyKey(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint; readonly idempotencyKey: string },
  ): Promise<StoredFeedback | null>;

  /** Aplica o plano de feedback; `noop`/`conflict` nao escrevem. */
  applyFeedback(
    scope: TransactionScope,
    plan: FeedbackPlan,
  ): Promise<PersistenceOutcome<WrittenRowRef>>;

  /**
   * Feedbacks ATIVOS do usuario, para o dominio derivar exclusoes. A janela
   * temporal e decidida no dominio (`now` injetado), nao pelo relogio do banco.
   */
  listActiveForUser(
    scope: TransactionScope,
    input: { readonly ownerUserId: bigint },
  ): Promise<readonly StoredFeedback[]>;
}
