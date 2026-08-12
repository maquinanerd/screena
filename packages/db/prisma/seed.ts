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

  // ============ source_licenses: CRIA se faltar, NUNCA sobrescreve ============
  //
  // A semente e o DEFAULT SEGURO da Fase 1 (license_status='unknown',
  // display_allowed=false): serve para que uma fonte nunca exista sem licenca.
  // Ela NAO e autoridade sobre uma licenca que ja existe.
  //
  // Ate 2026-08-12 este laco fazia `update` IN PLACE na licenca VIGENTE — mesmo
  // id, mesmo is_current, mesmas decisoes penduradas. Rodar `db:seed` depois de
  // `pnpm legal sources apply` REBAIXAVA a licenca autorizada pelo proprietario
  // de volta para `unknown`, deixando as decisoes `rating_display` concedendo
  // display sob licenca nao-exibivel — linhas que o guarda
  // `data_usage_decisions_guard` recusaria criar hoje, e que travavam o proprio
  // apply seguinte num impasse (a decisao nao sai porque a licenca-mae e
  // unknown; a licenca nao e substituida porque a decisao nao sai).
  //
  // Nao era caso isolado: repetia a cada execucao do seed, por qualquer pessoa
  // seguindo o runbook. Agora o seed CRIA quando falta e PULA quando existe,
  // logando o motivo. Trava de banco correspondente (recusa o rebaixamento na
  // origem, independente de quem tente): trigger
  // `source_licenses_no_downgrade_guard`, migration 20260812120000.
  const licenseReport = { criadas: 0, puladas: 0 };
  for (const license of SOURCE_LICENSE_SEED) {
    const existing = await prisma.sourceLicense.findFirst({
      where: {
        sourceKey: license.sourceKey,
        contentType: license.contentType,
        providerKey: null,
        territoryCode: null,
        isCurrent: true,
      },
    });
    if (!existing) {
      await prisma.sourceLicense.create({ data: license });
      licenseReport.criadas += 1;
      continue;
    }

    licenseReport.puladas += 1;
    // Log nominal: quem le a saida do seed precisa ver O QUE foi preservado e
    // por que, senao "pulado" vira ruido e o operador nao percebe que existe
    // autorizacao viva ali.
    const maisPermissiva =
      existing.licenseStatus !== license.licenseStatus ||
      existing.displayAllowed !== license.displayAllowed ||
      existing.scoreAllowed !== license.scoreAllowed ||
      existing.logoAllowed !== license.logoAllowed ||
      existing.reviewQuoteAllowed !== license.reviewQuoteAllowed ||
      existing.requiresAttribution !== license.requiresAttribution ||
      existing.requiresLinkback !== license.requiresLinkback;
    const decidida = existing.decisionOrigin !== null || existing.policyVersion !== null;
    const motivo = decidida
      ? `decidida fora do seed (decision_origin=${existing.decisionOrigin ?? "null"}, policy_version=${existing.policyVersion ?? "null"})`
      : maisPermissiva
        ? "difere da semente conservadora"
        : "ja identica a semente";
    console.log(
      `[seed] source_licenses ${license.sourceKey}/${license.contentType}: PULADA (id=${existing.id}, ` +
        `license_status=${existing.licenseStatus}, display_allowed=${existing.displayAllowed}) — ${motivo}. ` +
        `A semente cria quando falta; nunca sobrescreve licenca vigente.`,
    );
  }

  const counts = {
    languages: LANGUAGE_SEED.length,
    countries: COUNTRY_SEED.length,
    ratingSources: RATING_SOURCE_SEED.length,
    apiProviders: API_PROVIDER_SEED.length,
    sourceLicenses: `${licenseReport.criadas} criada(s), ${licenseReport.puladas} preservada(s)`,
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
