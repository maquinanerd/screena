/**
 * health.ts — checagem de saúde SERVER-ONLY. Isola o acesso a `@screena/db`
 * (PostgreSQL) na camada `src/server/**`, como exige a governança de layering
 * do render (web-render-layering.test.ts / check-render-purity.mjs). A rota
 * `app/api/health` consome esta função, nunca o client Prisma diretamente.
 *
 * PUREZA (invariantes 3/4): lê apenas PostgreSQL local — sem API externa, sem
 * Gemini.
 */
import { getPrismaClient } from "@screena/db/server";

/** `true` quando o PostgreSQL responde a um `SELECT 1`. Nunca lança. */
export async function checkDatabase(): Promise<boolean> {
  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
