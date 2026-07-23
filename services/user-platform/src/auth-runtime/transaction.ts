/**
 * Aborto DELIBERADO de transacao (Backend C, C7C).
 *
 * Existe por causa de um caso concreto, provado em PostgreSQL real pelos checks
 * 129-132: na confirmacao, o token e consumido ANTES de a politica de status ser
 * aplicada (o consumo e que revela de quem e o token). Se a politica recusar
 * depois disso, retornar normalmente comitaria o consumo e QUEIMARIA o link de
 * uma conta que nao foi verificada — o usuario perderia o e-mail sem ganhar
 * nada. A unica forma de desfazer o consumo e abortar.
 *
 * A excecao carrega apenas um ROTULO categorico. Nunca `userId`, e-mail, token,
 * hash ou mensagem do banco: ela sobe pela pilha e pode acabar num log de erro
 * nao tratado, que e o pior lugar possivel para um segredo.
 */

/** Sinal de aborto. Capturado logo fora da transacao, nunca vaza para a borda. */
export class AuthTransactionAbort extends Error {
  /** Rotulo categorico do motivo (audit). Sem PII, sem segredo. */
  readonly reason: string;

  constructor(reason: string) {
    super("transacao de autenticacao abortada deliberadamente");
    this.name = "AuthTransactionAbort";
    this.reason = reason;
  }
}

/** true quando o erro e o sinal de aborto (e nao uma falha real). */
export function isAuthTransactionAbort(error: unknown): error is AuthTransactionAbort {
  return error instanceof AuthTransactionAbort;
}
