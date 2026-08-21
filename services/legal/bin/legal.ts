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
 *   pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-08-v2" --confirm
 */

import { disconnectPrisma, getPrismaClient, type PrismaClient } from "@screena/db/server";

import {
  applyAuthorizationWithin,
  readCurrentState,
  readDecisionBindings,
  readStaleApprovals,
} from "../src/apply.js";
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
import {
  applyRemediationWithin,
  planRemediation,
  readLegacyGrants,
  renderRemediationPlan,
  renderRemediationRecord,
} from "../src/remediation.js";
import { planAuthorizationImpact } from "../src/impact.js";
import {
  applyRebindWithin,
  isRebindClean,
  readRebindPlan,
  renderRebindPlan,
} from "../src/rebind.js";
import { renderPlan } from "../src/report.js";
import {
  parseLegalArgs,
  renderLegalHelp,
  type ApplyArgs,
  type RebindArgs,
  type RemediateArgs,
} from "../src/cli/args.js";

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

/**
 * `sources remediate` — REPARO DE DADO, nunca uma leva.
 *
 * Dry-run por default. Recusa por inteiro se houver linha corrompida fora da
 * impressao digital diagnosticada: reparar so a parte conhecida deixaria o
 * resto invisivel. O `apply` NAO chama isto — ele continua falhando alto
 * diante de estado corrompido.
 */
async function runRemediation(prisma: PrismaClient, args: RemediateArgs): Promise<void> {
  const grants = await readLegacyGrants(prisma);
  const plan = planRemediation(grants);

  console.log(
    args.json
      ? JSON.stringify(plan, null, 2)
      : renderRemediationPlan(plan, args.confirm && plan.refused.length === 0 ? "apply" : "dry-run"),
  );

  if (plan.refused.length > 0) {
    console.error(
      `erro: ${plan.refused.length} linha(s) concedendo sob licenca nao-exibivel NAO batem a impressao digital. Nada foi escrito.`,
    );
    process.exitCode = EXIT.unexpected;
    return;
  }

  if (!args.confirm) {
    console.log("REGISTRO — cole em docs/legal/ antes de rodar com --confirm:\n");
    console.log(renderRemediationRecord(plan, new Date().toISOString().slice(0, 10)));
    console.log("\n(dry-run: nada foi escrito. Use --confirm --reviewer=<quem> para aplicar.)");
    process.exitCode = EXIT.ok;
    return;
  }

  if (plan.remediable.length === 0) {
    process.exitCode = EXIT.ok;
    return;
  }

  const retired = await prisma.$transaction(async (tx) => applyRemediationWithin(tx, plan));
  console.log(`\n${retired} decisao(oes) legada(s) aposentada(s) por ${args.reviewer}.`);
  console.log("stage, use_case, territorio, policy_version, decided_by, reason e valid_from preservados.");
  console.log("display_allowed/storage_allowed/derivative_allowed ZERADOS — registro nominal em docs/legal/.");
}

/**
 * `sources rebind` — CONSERTO DE PONTEIRO, nunca uma leva.
 *
 * Dry-run por default. Reponta so as linhas exibiveis cuja decisao de uso
 * deixou de resolver (o rastro que todo `supersede` anterior a esta correcao
 * deixou), e so quando existe decisao vigente que as assuma. `display_allowed`
 * nao e tocado em nenhuma hipotese.
 */
async function runRebind(prisma: PrismaClient, args: RebindArgs): Promise<void> {
  const plan = await readRebindPlan(prisma);
  console.log(
    args.json
      ? JSON.stringify(plan, null, 2)
      : renderRebindPlan(plan, args.confirm ? "apply" : "dry-run"),
  );

  if (!args.confirm) {
    process.exitCode = EXIT.ok;
    return;
  }

  if (isRebindClean(plan)) {
    console.log("\nnada a repontuar: todas as linhas exibiveis resolvem a licenca vigente (idempotente).");
    process.exitCode = EXIT.ok;
    return;
  }

  const done = await prisma.$transaction(async (tx) => applyRebindWithin(tx));
  console.log(`\n${done.ratings} nota(s) e ${done.offers} oferta(s) repontuadas por ${args.reviewer}.`);
  console.log("display_allowed, reviewed_by e approved_payload_hash NAO foram tocados.");

  // Conferencia na mesma execucao: o numero prometido tem de ter acontecido.
  const after = await readRebindPlan(prisma);
  console.log(
    `verificacao: notas na tela=${after.ratings.healthy} (orfas=${after.ratings.orphaned}) · ` +
      `ofertas na tela=${after.offers.healthy} (orfas=${after.offers.orphaned})`,
  );
  process.exitCode = EXIT.ok;
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
    if (args.sub === "remediate") {
      await runRemediation(prisma, args);
      return;
    }

    if (args.sub === "rebind") {
      await runRebind(prisma, args);
      return;
    }

    const { entries, licenses, decisions } = await loadState(prisma);
    const plan = planAuthorization(entries, licenses, decisions);
    assertNoBlockedGrants(plan);

    // O QUE ESTA LEVA FAZ COM O DADO QUE JA ESTA NA TELA — lido ANTES de
    // qualquer escrita, e impresso tanto no `review` quanto no dry-run do
    // `apply`. Um plano que nao diz quantas linhas vai ocultar nao e um plano.
    const impact = planAuthorizationImpact(plan, await readDecisionBindings(prisma));
    const staleApprovals = await readStaleApprovals(prisma);

    const applying = args.sub === "apply" && args.confirm;
    console.log(
      args.json
        ? JSON.stringify({ plan, impact, staleApprovals }, null, 2)
        : renderPlan(plan, applying ? "apply" : "dry-run", { impact, staleApprovals }),
    );

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
