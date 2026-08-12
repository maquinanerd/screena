#!/usr/bin/env node
/**
 * bin/legal.ts — CLI `pnpm legal`. Worker-only/offline — NUNCA no render.
 *
 * Coberto por `typecheck:catalog-runtime` (depende do Prisma Client gerado). O
 * núcleo PURO (spec, plan, report, parser) vive em ../src/** e é testado sem
 * banco; o LAÇO DE ESCRITA vive em ../src/apply.ts, parametrizado por um
 * executor SQL estrutural (sem Prisma) para que validador e CLI executem
 * literalmente o mesmo código. Aqui fica só o wiring: Prisma, transação, saída.
 *
 * Materializa a autorização declarada em `../src/authorization-spec.ts`
 * (tradução da decisão do proprietário) em `source_licenses` +
 * `data_usage_decisions`, de forma idempotente e com histórico (`supersedes_id`;
 * nenhuma linha antiga é apagada). NUNCA promove dado, NUNCA liga logo/citação/
 * derivada, NUNCA cria decisão de Cinerie Score.
 *
 * Uso (a partir da raiz):
 *   pnpm legal sources review
 *   pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-07-v1" --confirm
 */

import { disconnectPrisma, getPrismaClient, type PrismaClient } from "@screena/db/server";

import { applyAuthorizationWithin, readCurrentState } from "../src/apply.js";
import {
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
  AUTHORIZATION_REASON,
  type AuthorizationEntry,
} from "../src/authorization-spec.js";
import {
  assertNoBlockedGrants,
  isPlanClean,
  planAuthorization,
  type CurrentDecision,
  type CurrentLicense,
} from "../src/plan.js";
import { renderPlan } from "../src/report.js";
import { parseLegalArgs, renderLegalHelp, type ApplyArgs } from "../src/cli/args.js";

const EXIT = { ok: 0, unexpected: 1, usage: 2, environment: 3 } as const;

function fatal(message: string, code: number): never {
  console.error(`erro: ${message}`);
  process.exit(code);
}

function openPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") {
    fatal("DATABASE_URL ausente (worker-only; le/escreve PostgreSQL)", EXIT.environment);
  }
  return getPrismaClient();
}

/** Lê o estado vigente + provedores reais e monta a lista de entradas. */
async function loadState(prisma: PrismaClient): Promise<{
  entries: readonly AuthorizationEntry[];
  licenses: readonly CurrentLicense[];
  decisions: readonly CurrentDecision[];
}> {
  const { licenses, decisions } = await readCurrentState(prisma);

  const providers = (await prisma.$queryRawUnsafe<Array<{ slug: string; canonical_name: string }>>(
    `SELECT slug, canonical_name FROM watch_providers ORDER BY slug ASC`,
  )).map((p) => ({ slug: p.slug, canonicalName: p.canonical_name }));

  const entries = [...STATIC_AUTHORIZATION, ...streamingProviderEntries(providers)];
  return { entries, licenses, decisions };
}

/**
 * Aplica o plano numa transação. Idempotente: só escreve o que muda.
 *
 * O laço em si vive em `../src/apply.ts` — um lugar só, compartilhado com os
 * validadores de banco real. Aqui fica apenas a transação.
 */
async function applyPlan(prisma: PrismaClient, entries: readonly AuthorizationEntry[], args: ApplyArgs): Promise<void> {
  const identity = { reviewer: args.reviewer as string, reason: AUTHORIZATION_REASON };
  await prisma.$transaction(async (tx) => {
    await applyAuthorizationWithin(tx, entries, identity);
  });
}

async function main(): Promise<void> {
  const parsed = parseLegalArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`erro de uso: ${parsed.error}\n`);
    console.error(renderLegalHelp());
    process.exit(EXIT.usage);
  }
  const args = parsed.args;
  if (args.command === "help") {
    console.log(renderLegalHelp());
    process.exit(EXIT.ok);
  }

  const prisma = openPrisma();
  try {
    const { entries, licenses, decisions } = await loadState(prisma);
    const plan = planAuthorization(entries, licenses, decisions);
    assertNoBlockedGrants(plan);

    const applying = args.sub === "apply" && args.confirm;
    console.log(args.json ? JSON.stringify(plan, null, 2) : renderPlan(plan, applying ? "apply" : "dry-run"));

    if (args.sub === "review" || !args.confirm) {
      process.exitCode = EXIT.ok;
      return;
    }

    if (isPlanClean(plan)) {
      console.log("\nnada a aplicar: o estado ja corresponde ao spec (idempotente).");
      process.exitCode = EXIT.ok;
      return;
    }

    await applyPlan(prisma, entries, args as ApplyArgs);
    console.log(`\naplicado por ${args.reviewer} (leva ${args.policyVersion}). Historico preservado.`);
    process.exitCode = EXIT.ok;
  } catch (error) {
    console.error(`erro inesperado: ${(error as Error).message}`);
    process.exitCode = EXIT.unexpected;
  } finally {
    await disconnectPrisma();
  }
}

void main();
