/**
 * PAYLOADS BRUTOS de autenticacao (camada A) — a FORMA esperada da entrada
 * NAO CONFIAVEL que uma futura borda HTTP (JSON/form) entregara.
 *
 * IMPORTANTE: estes tipos sao apenas DOCUMENTACAO da forma esperada. O parser
 * (auth-commands.ts) SEMPRE recebe `unknown` e valida em modo estrito — nunca
 * confia na forma declarada aqui. Um payload pode legitimamente carregar senha
 * ou token bruto (camada A); esses valores NUNCA sao retornados, copiados para
 * DTO publico, colocados em erro nem preservados em metadata.
 *
 * PURO: sem rede, sem DB, sem IO.
 */

/** Cadastro. displayName opcional (decisao de produto: perfil privado por padrao). */
export interface SignupPayload {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
}

/** Login. Sem rememberMe (nao ha politica explicita de sessao longa/curta). */
export interface LoginPayload {
  readonly email: string;
  readonly password: string;
}

/** Pedido de recuperacao de senha (resposta publica sempre generica). */
export interface RequestPasswordRecoveryPayload {
  readonly email: string;
}

/** Consumo de recuperacao: token de uso unico + nova senha. */
export interface ConsumePasswordRecoveryPayload {
  readonly token: string;
  readonly newPassword: string;
}

/** Pedido de (re)envio de verificacao de email (resposta publica generica). */
export interface RequestEmailVerificationPayload {
  readonly email: string;
}

/** Consumo de verificacao de email: token de uso unico. */
export interface ConsumeEmailVerificationPayload {
  readonly token: string;
}

/**
 * Mudanca de senha autenticada. A identidade vem do CONTEXTO autenticado
 * (futuro), NUNCA do corpo — por isso nao ha userId/credentialId aqui.
 */
export interface ChangePasswordPayload {
  readonly currentPassword: string;
  readonly newPassword: string;
}
