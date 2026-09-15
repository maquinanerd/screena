/**
 * health.ts — QUANDO algo fica vermelho no painel operacional. PURO.
 *
 * ============================================================================
 * TODO VERDE PRECISA PODER FICAR VERMELHO
 * ============================================================================
 * O `screen-cron` ficou amarelo "desde sempre" no EasyPanel. Um alarme que nunca
 * muda de cor nao distingue "tudo bem" de "quebrou" — e enfeite. Por isso cada
 * julgamento aqui e uma funcao com o caso VERMELHO coberto por teste, e nenhum
 * deles tem um estado que fica verde por falta de dado: sem dado, o estado e
 * "nao determinado", que a tela escreve com o motivo.
 */

import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_SILENCE_INTERVALS } from "@screena/db/service-heartbeat";

/** Sem sinal ha mais do que isto = "sem sinal". Tres intervalos do sinal de vida. */
export const SERVICE_SILENCE_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_SILENCE_INTERVALS;

/** O servico esta dando sinal? */
export type Liveness =
  | { readonly kind: "no_ar"; readonly lastSeenAt: Date }
  | { readonly kind: "sem_sinal"; readonly lastSeenAt: Date }
  | { readonly kind: "nunca" };

/** Julga o sinal de vida. Na fronteira exata ainda esta no ar. */
export function evaluateLiveness(lastSeenAt: Date | null, now: Date): Liveness {
  if (lastSeenAt === null) return { kind: "nunca" };
  return now.getTime() - lastSeenAt.getTime() <= SERVICE_SILENCE_MS
    ? { kind: "no_ar", lastSeenAt }
    : { kind: "sem_sinal", lastSeenAt };
}

/** O commit do `main` cuja arvore bate com o digest do servico. */
export interface CommitMatch {
  readonly commitSha: string;
  readonly title: string;
  readonly mainPosition: number | null;
  readonly behindHeadBy: number | null;
  readonly behindHeadSha: string | null;
}

/** O que se sabe do `main`. */
export interface MainReference {
  readonly headSha: string | null;
  readonly readAt: Date | null;
}

/** O veredito de versao de um servico. */
export type VersionVerdict =
  | { readonly kind: "em_dia"; readonly commitSha: string }
  | { readonly kind: "atras"; readonly commitSha: string; readonly behindBy: number }
  | { readonly kind: "distancia_pendente"; readonly commitSha: string; readonly reason: string }
  | { readonly kind: "sem_correspondencia"; readonly reason: string }
  | { readonly kind: "nao_determinado"; readonly reason: string };

/** Traduz o `digest_error` gravado pelo servico. */
function digestReason(digestError: string | null): string {
  if (digestError === "em_calculo") return "a impressão digital ainda está sendo calculada (serviço acabou de subir)";
  if (digestError === "raiz_do_repositorio_nao_encontrada") {
    return "o serviço não achou a raiz do repositório no disco para calcular a impressão digital";
  }
  if (digestError !== null) return `o serviço não conseguiu calcular a impressão digital (${digestError})`;
  return "o serviço não gravou impressão digital";
}

/**
 * Julga a versao. A distancia so vale se foi medida contra a cabeca ATUAL: uma
 * distancia de uma leitura antiga afirmaria "1 commit atras" de um main que ja
 * andou.
 */
export function evaluateVersion(input: {
  readonly sourceDigest: string | null;
  readonly digestError: string | null;
  readonly main: MainReference;
  readonly match: CommitMatch | null;
}): VersionVerdict {
  if (input.sourceDigest === null) return { kind: "nao_determinado", reason: digestReason(input.digestError) };
  if (input.main.headSha === null) {
    return { kind: "nao_determinado", reason: "a fila deploy_reference ainda não leu o main do GitHub" };
  }
  if (input.match === null) {
    return {
      kind: "sem_correspondencia",
      reason:
        "nenhum commit do main lido tem esta árvore de código: build fora do main, commit mais antigo que a janela lida, ou arquivo alterado dentro do container",
    };
  }
  if (input.match.commitSha === input.main.headSha) return { kind: "em_dia", commitSha: input.match.commitSha };
  if (input.match.behindHeadBy === null || input.match.behindHeadSha !== input.main.headSha) {
    return {
      kind: "distancia_pendente",
      commitSha: input.match.commitSha,
      reason: "a distância até a cabeça atual ainda não foi comparada (próximo ciclo da deploy_reference)",
    };
  }
  if (input.match.behindHeadBy === 0) return { kind: "em_dia", commitSha: input.match.commitSha };
  return { kind: "atras", commitSha: input.match.commitSha, behindBy: input.match.behindHeadBy };
}

/** O veredito de versao pede vermelho? */
export function isVersionRed(verdict: VersionVerdict): boolean {
  return verdict.kind === "atras" || verdict.kind === "sem_correspondencia";
}

/** O julgamento de cota de um fornecedor. */
export interface QuotaJudgement {
  readonly red: boolean;
  readonly reasons: readonly string[];
}

/**
 * Julga a cota do dia.
 *
 * O vermelho mais importante e o do meio: o FORNECEDOR recusou por cota com o
 * NOSSO contador ainda abaixo do teto. E o unico sinal de que o contador
 * subconta — e ele ja subcontou neste projeto.
 */
export function evaluateQuota(input: {
  readonly dailyLimit: number | null;
  readonly spentToday: number | null;
  readonly providerRefusalsToday: number | null;
}): QuotaJudgement {
  const reasons: string[] = [];
  let red = false;
  if (input.spentToday === null) {
    reasons.push("gasto de hoje não determinado");
  } else if (input.dailyLimit !== null && input.spentToday >= input.dailyLimit) {
    red = true;
    reasons.push("o teto do dia foi atingido pelo nosso contador");
  }
  if (input.providerRefusalsToday !== null && input.providerRefusalsToday > 0) {
    red = true;
    if (input.dailyLimit !== null && input.spentToday !== null && input.spentToday < input.dailyLimit) {
      reasons.push(
        `o fornecedor recusou por cota ${String(input.providerRefusalsToday)} vez(es) hoje com o nosso contador em ${String(input.spentToday)} de ${String(input.dailyLimit)}: o contador está subcontando`,
      );
    } else {
      reasons.push(`o fornecedor recusou por cota ${String(input.providerRefusalsToday)} vez(es) hoje`);
    }
  }
  return { red, reasons };
}
