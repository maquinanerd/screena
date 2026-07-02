/**
 * health.ts — Diagnostico de saude do admin. SERVER-ONLY, SOMENTE LEITURA.
 *
 * Verifica se o PostgreSQL respondeu e devolve contagens basicas. NUNCA expoe
 * segredos: nao imprime DATABASE_URL, tokens nem a mensagem crua do erro (que
 * poderia vazar host/credenciais) — apenas um rotulo generico/seguro. Nao chama
 * nenhuma API externa.
 */

import { cache } from "react";
import { getPrismaClient } from "@screena/db/server";

export interface HealthCounts {
  articleTranslations: number;
  contentBlocks: number;
  movies: number;
  tvShows: number;
  people: number;
}

export interface HealthData {
  dbOk: boolean;
  /** Rotulo seguro (nome da classe do erro), nunca a mensagem crua. */
  errorLabel: string | null;
  counts: HealthCounts | null;
}

export const getHealthData = cache(async (): Promise<HealthData> => {
  const prisma = getPrismaClient();

  try {
    // Ping minimo de conexao (SELECT constante; sem tocar dados).
    await prisma.$queryRaw`SELECT 1`;

    const [articleTranslations, contentBlocks, movies, tvShows, people] = await Promise.all([
      prisma.articleTranslation.count(),
      prisma.contentBlock.count(),
      prisma.movie.count(),
      prisma.tvShow.count(),
      prisma.person.count(),
    ]);

    return {
      dbOk: true,
      errorLabel: null,
      counts: { articleTranslations, contentBlocks, movies, tvShows, people },
    };
  } catch (error) {
    // Nunca vazar detalhe sensivel: so o nome da classe do erro.
    const errorLabel = error instanceof Error ? error.name : "erro desconhecido";
    return { dbOk: false, errorLabel, counts: null };
  }
});
