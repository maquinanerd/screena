/**
 * Resolucao do TTL efetivo de um token de uso unico (Backend C, C7C).
 *
 * PURO. Existe para que haja UMA definicao de "quanto tempo o link vale",
 * compartilhada pelos dois fluxos (verificacao e recuperacao).
 *
 * O runtime recebe o prazo por variavel de ambiente
 * (`EMAIL_VERIFICATION_EXPIRATION_MINUTES` / `PASSWORD_RESET_EXPIRATION_MINUTES`)
 * e o repassa aos construtores de token. Sem este parametro, o runtime teria de
 * calcular `expiresAt` sozinho — e ai existiriam duas formulas de validade, uma
 * no dominio e outra na composicao, livres para divergir em silencio.
 *
 * FAIL-SAFE, nao fail-open: valor ausente ou fora de forma cai no DEFAULT do
 * dominio, nunca em "sem expiracao". Um TTL invalido virando `NaN` produziria
 * `expiresAt` invalido, e o banco (`expires_at > created_at`) recusaria a
 * insercao — mas o erro apareceria longe da causa. A validacao de verdade e da
 * configuracao (`auth-runtime/config.ts`), que rejeita o valor na subida do
 * processo; isto aqui e a ultima rede.
 */

/**
 * Devolve `candidate` quando ele e um inteiro positivo finito; caso contrario,
 * o default do dominio (em horas) convertido para minutos.
 */
export function resolveTtlMinutes(candidate: number | undefined, defaultHours: number): number {
  if (
    candidate !== undefined &&
    Number.isFinite(candidate) &&
    Number.isInteger(candidate) &&
    candidate > 0
  ) {
    return candidate;
  }
  return defaultHours * 60;
}
