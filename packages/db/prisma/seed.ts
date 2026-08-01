/**
 * seed.ts — Runner de seed da Screena (Fase 1).
 *
 * Aplica os dados de semente canonicos (de @screena/db -> src/seed-data.ts) no
 * PostgreSQL de forma IDEMPOTENTE (upsert por chave natural). NAO chama nenhuma
 * API externa, nao gera catalogo real e nao publica nada.
 *
 * Execucao (requer DATABASE_URL apontando para um Postgres com a migration
 * inicial aplicada):  pnpm --filter @screena/db db:seed
 *
 * Este arquivo e EXCLUIDO do typecheck do repositorio (depende do Prisma Client
 * gerado) e validado em tempo de execucao via tsx, na fase em que houver banco.
 */

import { PrismaClient } from "@prisma/client";
import {
  API_PROVIDER_SEED,
  COUNTRY_SEED,
  LANGUAGE_SEED,
  RATING_SOURCE_SEED,
  SOURCE_LICENSE_SEED,
} from "../src/seed-data.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const lang of LANGUAGE_SEED) {
    await prisma.language.upsert({ where: { code: lang.code }, update: lang, create: lang });
  }

  for (const country of COUNTRY_SEED) {
    await prisma.country.upsert({ where: { code: country.code }, update: country, create: country });
  }

  for (const source of RATING_SOURCE_SEED) {
    await prisma.ratingSource.upsert({ where: { key: source.key }, update: source, create: source });
  }

  for (const provider of API_PROVIDER_SEED) {
    await prisma.apiProvider.upsert({ where: { key: provider.key }, update: provider, create: provider });
  }

  // source_licenses nao tem chave natural unica simples (unique funcional
  // sourceKey+contentType+COALESCE(providerKey,'')+COALESCE(territoryCode,''));
  // upsert manual por sourceKey + contentType + providerKey null (linhas de
  // seed sao sempre licencas de rating globais, sem provider/territorio).
  for (const license of SOURCE_LICENSE_SEED) {
    const existing = await prisma.sourceLicense.findFirst({
      where: { sourceKey: license.sourceKey, contentType: license.contentType, providerKey: null },
    });
    if (existing) {
      await prisma.sourceLicense.update({ where: { id: existing.id }, data: license });
    } else {
      await prisma.sourceLicense.create({ data: license });
    }
  }

  const counts = {
    languages: LANGUAGE_SEED.length,
    countries: COUNTRY_SEED.length,
    ratingSources: RATING_SOURCE_SEED.length,
    apiProviders: API_PROVIDER_SEED.length,
    sourceLicenses: SOURCE_LICENSE_SEED.length,
  };
  console.log("Seed aplicado (Fase 1):", counts);
}

main()
  .catch((error) => {
    console.error("Falha no seed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
