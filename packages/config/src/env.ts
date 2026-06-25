/**
 * env.ts — Leitura segura de variaveis de ambiente.
 *
 * REGRA CANONICA: API keys e segredos vivem SOMENTE em variaveis de ambiente,
 * nunca no frontend nem hardcoded no codigo. Este modulo nao le o ambiente no
 * import — a leitura acontece apenas quando getEnv/requireEnv sao chamadas.
 * Assim o modulo permanece puro e seguro para tree-shaking e testes.
 */

/**
 * Le uma variavel de ambiente pelo nome.
 *
 * Retorna o valor (incluindo string vazia, se assim definida) ou `undefined`
 * quando a variavel nao existe. A leitura ocorre apenas na chamada — nunca no
 * carregamento do modulo.
 *
 * @param name Nome da variavel de ambiente.
 * @returns O valor da variavel, ou `undefined` se ausente.
 */
export function getEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Le uma variavel de ambiente obrigatoria pelo nome.
 *
 * Lanca `Error` quando a variavel esta ausente (`undefined`), forcando falha
 * explicita em configuracoes incompletas em vez de comportamento silencioso.
 * Uma string vazia e considerada presente e e retornada como esta.
 *
 * @param name Nome da variavel de ambiente.
 * @returns O valor da variavel.
 * @throws {Error} Se a variavel nao estiver definida no ambiente.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: "${name}". ` +
        "Defina-a no ambiente (nunca no frontend nem hardcoded).",
    );
  }
  return value;
}
