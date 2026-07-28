/**
 * editorial-transition-policy.ts — Adaptador do admin para a FONTE UNICA de
 * transicao editorial. PURO (sem rede/DB/IO/import de runtime).
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * Ate aqui o admin escrevia `review_status` com QUALQUER valor do enum, de forma
 * isolada. Isso criava uma SEGUNDA VERDADE sobre o mesmo campo: a maquina de
 * estados de `services/news-ingestion/src/lifecycle.ts` dizia que
 * `blocked -> published` e proibido (uma materia retratada nunca volta ao ar sem
 * nova revisao) e que `draft -> published` pula a revisao humana — e o admin
 * permitia ambos com um clique. Duas verdades sobre a mesma coluna nao e
 * flexibilidade: e a garantia de que a mais fraca sera usada.
 *
 * Este modulo NAO reimplementa a tabela de transicoes. Ele importa
 * `canTransition` de `@screena/news-ingestion` e apenas TRADUZ o veredito para o
 * vocabulario de outcome do admin (que precisa virar query string segura). Se a
 * allowlist mudar la, o admin muda junto, sem edicao aqui.
 *
 * `tests/admin/editorial-lifecycle-single-source.test.ts` trava textualmente que
 * nao existe allowlist duplicada dentro de `apps/admin`.
 */

import { canTransition, type EditorialReviewStatus } from "@screena/news-ingestion";

import type { ReviewStatusValue } from "./editorial-action-policy";

/**
 * Motivo de RECUSA de uma transicao — subconjunto de `EditorialActionOutcome`.
 *  - `unchanged_state`      — origem e destino iguais; nada a fazer.
 *  - `forbidden_transition` — a fonte unica recusa (ex.: `draft -> published`).
 */
export type TransitionRejectionOutcome = "unchanged_state" | "forbidden_transition";

/**
 * Uniao DISCRIMINADA de proposito: quando `allowed` e `true` nao existe motivo
 * de recusa para o chamador propagar por engano, e quando e `false` o motivo ja
 * vem estreitado para os outcomes que o feedback do admin sabe traduzir.
 */
export type TransitionVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly outcome: TransitionRejectionOutcome };

/**
 * `ReviewStatusValue` (espelho do enum do Prisma no admin) e
 * `EditorialReviewStatus` (subset usado pelo lifecycle) sao a MESMA lista de
 * strings. Esta funcao existe para tornar essa igualdade uma afirmacao
 * verificavel pelo compilador: se um dos dois lados ganhar ou perder um estado,
 * a atribuicao abaixo para de compilar — em vez de divergir em silencio.
 */
function asLifecycleStatus(status: ReviewStatusValue): EditorialReviewStatus {
  const narrowed: EditorialReviewStatus = status;
  return narrowed;
}

/**
 * Avalia uma mudanca de `review_status` contra a fonte unica do ciclo de vida.
 *
 * `from` vem do BANCO (estado lido), nunca do cliente. `to` ja passou pela
 * validacao de enum da politica de acao. O caso `from === to` e separado de
 * proposito: a fonte unica o recusa com a mesma severidade de uma transicao
 * proibida, mas para o operador do admin "voce escolheu o estado atual" e
 * "voce tentou pular a revisao humana" sao coisas diferentes, e a mensagem
 * precisa dizer qual foi.
 */
export function evaluateReviewStatusTransition(
  from: ReviewStatusValue,
  to: ReviewStatusValue,
): TransitionVerdict {
  if (from === to) return { allowed: false, outcome: "unchanged_state" };

  const verdict = canTransition(asLifecycleStatus(from), asLifecycleStatus(to));
  return verdict.allowed ? { allowed: true } : { allowed: false, outcome: "forbidden_transition" };
}
