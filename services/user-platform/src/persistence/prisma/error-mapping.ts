/**
 * error-mapping.ts — erro do driver -> CONFLITO TIPADO (Backend C, C7B1).
 *
 * Traduz o minimo necessario: violacao de unicidade (P2002) e de chave
 * estrangeira (P2003). Tudo o mais e ERRO DE VERDADE e sobe intacto — inventar
 * uma categoria para um erro que o contrato nao representa seria transformar
 * falha de infraestrutura em resultado de negocio.
 *
 * O que NUNCA sai deste modulo: nome de constraint, nome de indice, nome de
 * tabela, coluna, SQL, host, banco, codigo do driver, e-mail ou hash. A saida e
 * exclusivamente o ALVO SEMANTICO das unioes fechadas de `types.ts`. Por isso a
 * classificacao devolve `undefined` quando nao reconhece o alvo, em vez de
 * repassar o texto do driver: `unique_violation` sem alvo continua sendo um
 * conflito valido pelo contrato (o campo `target` e opcional).
 */

import type { UniqueConflictTarget } from "../types.js";

/** Violacao de unicidade. */
const UNIQUE_VIOLATION = "P2002";
/** Violacao de chave estrangeira. */
const FOREIGN_KEY_VIOLATION = "P2003";

/**
 * Le o codigo do erro do Prisma sem depender da CLASSE
 * `PrismaClientKnownRequestError`: a checagem estrutural sobrevive a duas copias
 * de `@prisma/client` no mesmo processo (caso classico em monorepo, em que
 * `instanceof` falha), e nao acopla o adapter ao runtime do driver.
 */
function driverCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isUniqueViolation(error: unknown): boolean {
  return driverCode(error) === UNIQUE_VIOLATION;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return driverCode(error) === FOREIGN_KEY_VIOLATION;
}

/**
 * Normaliza `meta.target` para uma unica string minuscula.
 *
 * A forma de `meta.target` NAO e estavel entre versoes/drivers do Prisma: pode
 * vir como lista de campos do modelo (`["emailNormalized"]`), lista de colunas
 * (`["email_normalized"]`) ou nome da constraint
 * (`"users_email_normalized_key"`). Reduzir tudo a um texto minusculo e casar
 * por SUBSTRING cobre as tres formas sem que o adapter dependa de qual delas o
 * driver escolheu — e sem que nenhuma delas escape para fora deste modulo.
 */
function uniqueTargetText(error: unknown): string {
  if (error === null || typeof error !== "object") {
    return "";
  }
  const meta = (error as { meta?: unknown }).meta;
  if (meta === null || typeof meta !== "object") {
    return "";
  }
  const target = (meta as { target?: unknown }).target;
  const parts = Array.isArray(target)
    ? target.filter((part): part is string => typeof part === "string")
    : typeof target === "string"
      ? [target]
      : [];
  return parts.join(",").toLowerCase();
}

/**
 * Classifica a unique violada na tabela `users`.
 *
 * ORDEM E SEMANTICA, NAO ESTILO: `email_normalized` (e o `emailNormalized` do
 * modelo) CONTEM a substring `email`. Testar `email` primeiro classificaria toda
 * colisao de e-mail normalizado como colisao de e-mail bruto — dois uniques
 * diferentes reportados como o mesmo alvo. O caso mais especifico vem primeiro.
 */
export function classifyIdentityUniqueTarget(error: unknown): UniqueConflictTarget | undefined {
  const text = uniqueTargetText(error);
  if (text.includes("email_normalized") || text.includes("emailnormalized")) {
    return "identity.emailNormalized";
  }
  if (text.includes("handle")) {
    return "identity.handle";
  }
  if (text.includes("email")) {
    return "identity.email";
  }
  return undefined;
}

/**
 * Classifica a unique violada em `user_password_credentials`. A tabela tem UM
 * unico unique alem da PK (`user_id`), que materializa a relacao 1:1 — por isso
 * ha um alvo so.
 */
export function classifyCredentialUniqueTarget(error: unknown): UniqueConflictTarget | undefined {
  const text = uniqueTargetText(error);
  if (text.includes("user_id") || text.includes("userid")) {
    return "credential.user";
  }
  return undefined;
}
