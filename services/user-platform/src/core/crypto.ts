/**
 * Criptografia da user platform — UNICO modulo com material sensivel.
 *
 * Decisoes registradas em docs/product/user-product-decisions.md (secao 8):
 *  - Hash de senha: scrypt via node:crypto (parametros OWASP N=2^15, r=8,
 *    p=1, keylen=64, sal de 16 bytes), formato PHC-like VERSIONADO
 *    (`scrypt$N=32768,r=8,p=1$<salt-hex>$<hash-hex>`) para permitir
 *    migracao futura com re-hash no login.
 *  - Tokens opacos (sessao, verificacao, reset, CSRF): 256 bits aleatorios;
 *    o banco guarda APENAS sha256 hex do token — o valor cru nunca persiste
 *    e NUNCA aparece em log.
 *  - Comparacoes sensiveis usam timingSafeEqual.
 *  - IP bruto nunca persiste: apenas hashIpAddress(ip, salt de servidor).
 *
 * Este modulo roda SOMENTE em worker/servidor (node:crypto). Nada aqui e
 * importavel por client component — travado pela governanca de render.
 */

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/** Parametros scrypt (OWASP cheat sheet, custo interativo). */
export const SCRYPT_PARAMS = {
  N: 32768, // 2^15
  r: 8,
  p: 1,
  keyLength: 64,
  saltBytes: 16,
} as const;

const SCRYPT_MAXMEM = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * 2;

/** Gera hash PHC-like versionado de uma senha. NUNCA logar entrada ou saida. */
export function hashPassword(password: string): string {
  if (password.length === 0) {
    throw new Error("senha vazia nao pode ser hasheada");
  }
  const salt = randomBytes(SCRYPT_PARAMS.saltBytes);
  const derived = scryptSync(password, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

/**
 * Verifica senha contra hash PHC-like. Retorna false (nunca lanca) para hash
 * malformado — fail-closed sem vazar formato via excecao.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return false;
  }
  const params = new Map(
    parts[1]!.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k ?? "", Number(v)] as const;
    }),
  );
  const n = params.get("N");
  const r = params.get("r");
  const p = params.get("p");
  if (!n || !r || !p || !Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  try {
    const salt = Buffer.from(parts[2]!, "hex");
    const expected = Buffer.from(parts[3]!, "hex");
    if (salt.length === 0 || expected.length === 0) {
      return false;
    }
    const derived = scryptSync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Token opaco de 256 bits em hex (64 chars). Entregue UMA vez; nunca persiste cru. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

/** sha256 hex — forma persistida de qualquer token opaco. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Comparacao constante de dois hex strings (tokens/hashes). */
export function constantTimeEqualsHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Hash de IP com sal de servidor (LGPD: IP bruto nunca persiste).
 * O sal vem de env var no runtime — nunca hardcoded.
 */
export function hashIpAddress(ip: string, serverSalt: string): string {
  if (serverSalt.length < 16) {
    throw new Error("sal de servidor para hash de IP deve ter >= 16 chars");
  }
  return createHash("sha256").update(`${serverSalt}:${ip}`, "utf8").digest("hex");
}
