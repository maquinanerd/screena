/**
 * exit.ts — Codigos de saida da CLI `pnpm ratings`. PURO.
 *
 * Codigos estaveis para que um runbook/systemd distinga "nao rodou" de "rodou e
 * nao achou nada" de "rodou e foi barrado pela governanca". Um `exit 1`
 * generico obrigaria o operador a ler log para saber se houve incidente.
 */
export const EXIT_CODES = {
  /** Tudo certo. */
  ok: 0,
  /** Erro de uso (flag invalida, comando desconhecido). */
  usage: 2,
  /** Falta ambiente (DATABASE_URL, chave de API). */
  environment: 3,
  /** Gate de producao: o comando recusou rodar neste ambiente. */
  blocked: 4,
  /** Falha do fornecedor (rede/HTTP/circuito aberto) apos as retentativas. */
  provider: 5,
  /** A governanca barrou a mutacao (fail-closed) — nao e bug, e a trava. */
  governance: 6,
  /** Erro inesperado. */
  unexpected: 1,
} as const

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES]
