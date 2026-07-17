#!/usr/bin/env node
/**
 * bin/legal.ts — CLI `pnpm legal`. Worker-only/offline — NUNCA no render.
 *
 * Coberto por `typecheck:catalog-runtime` (depende do Prisma Client gerado). O
 * núcleo PURO (spec, plan, report, parser) vive em ../src/** e é testado sem
 * banco. Aqui fica só o IO: Prisma, transação, saída.
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
  type EntryPlan,
} from "../src/plan.js";
import { renderPlan } from "../src/report.js";
import { parseLegalArgs, renderLegalHelp, type ApplyArgs } from "../src/cli/args.js";

/**
 * Só os métodos raw que os helpers usam. O `tx` da transação interativa do
 * Prisma é um `TransactionClient` (não o `PrismaClient` completo — não tem
 * `$transaction`); tipar estruturalmente aceita ambos sem cast.
 */
type RawExecutor = Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "$queryRawUnsafe">;

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
  const licenses = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, source_key, content_type::text AS content_type, rating_source_key, provider_key,
            territory_code, license_status::text AS license_status, display_allowed, logo_allowed,
            score_allowed, review_quote_allowed, requires_attribution, requires_linkback,
            attribution_text, policy_version
       FROM source_licenses WHERE is_current = true`,
  )).map(
    (r): CurrentLicense => ({
      id: String(r.id),
      sourceKey: r.source_key as string,
      contentType: r.content_type as string,
      ratingSourceKey: (r.rating_source_key as string | null) ?? null,
      providerKey: (r.provider_key as string | null) ?? null,
      territory: (r.territory_code as string | null) ?? null,
      licenseStatus: r.license_status as string,
      displayAllowed: r.display_allowed as boolean,
      logoAllowed: r.logo_allowed as boolean,
      scoreAllowed: r.score_allowed as boolean,
      reviewQuoteAllowed: r.review_quote_allowed as boolean,
      requiresAttribution: r.requires_attribution as boolean,
      requiresLinkback: r.requires_linkback as boolean,
      attributionText: (r.attribution_text as string | null) ?? null,
      policyVersion: (r.policy_version as string | null) ?? null,
    }),
  );

  const decisions = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, source_license_id, use_case, territory, stage::text AS stage, display_allowed,
            storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version
       FROM data_usage_decisions WHERE is_current = true`,
  )).map(
    (r): CurrentDecision => ({
      id: String(r.id),
      sourceLicenseId: String(r.source_license_id),
      useCase: r.use_case as string,
      territory: (r.territory as string | null) ?? null,
      stage: r.stage as string,
      displayAllowed: r.display_allowed as boolean,
      storageAllowed: r.storage_allowed as boolean,
      derivativeAllowed: r.derivative_allowed as boolean,
      attributionRequired: r.attribution_required as boolean,
      linkbackRequired: r.linkback_required as boolean,
      policyVersion: (r.policy_version as string | null) ?? null,
    }),
  );

  const providers = (await prisma.$queryRawUnsafe<Array<{ slug: string; canonical_name: string }>>(
    `SELECT slug, canonical_name FROM watch_providers ORDER BY slug ASC`,
  )).map((p) => ({ slug: p.slug, canonicalName: p.canonical_name }));

  const entries = [...STATIC_AUTHORIZATION, ...streamingProviderEntries(providers)];
  return { entries, licenses, decisions };
}

/** Insere uma licença nova (is_current=true) e devolve o id. */
async function insertLicense(
  tx: RawExecutor,
  entry: EntryPlan,
  reviewer: string,
  supersedesId: string | null,
): Promise<string> {
  const l = entry.license.target;
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "source_licenses" (
      "source_key", "content_type", "rating_source_key", "provider_key", "territory_code",
      "license_status", "display_allowed", "logo_allowed", "score_allowed", "review_quote_allowed",
      "requires_attribution", "requires_linkback", "attribution_text",
      "is_current", "supersedes_id", "decided_by", "decided_at", "decision_origin",
      "policy_version", "notes", "updated_at"
    ) VALUES (
      ${l.sourceKey}, ${l.contentType}::"SourceLicenseContentType", ${l.ratingSourceKey}, ${l.providerKey}, ${l.territory},
      ${l.licenseStatus}::"LicenseStatus", ${l.displayAllowed}, ${l.logoAllowed}, ${l.scoreAllowed}, ${l.reviewQuoteAllowed},
      ${l.requiresAttribution}, ${l.requiresLinkback}, ${l.attributionText},
      true, ${supersedesId === null ? null : BigInt(supersedesId)}, ${reviewer}, now(), 'owner_authorization',
      ${l.policyVersion}, ${l.notes}, now()
    ) RETURNING "id"`;
  return String(rows[0]!.id);
}

/** Insere uma decisão nova (is_current=true). */
async function insertDecision(
  tx: RawExecutor,
  licenseId: string,
  target: EntryPlan["decisions"][number]["target"],
  reviewer: string,
  supersedesId: string | null,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "data_usage_decisions" (
      "source_license_id", "use_case", "territory", "stage", "display_allowed", "storage_allowed",
      "derivative_allowed", "attribution_required", "linkback_required", "valid_from",
      "policy_version", "decided_by", "reason", "is_current", "supersedes_id", "updated_at"
    ) VALUES (
      ${BigInt(licenseId)}, ${target.useCase}, ${target.territory}, ${target.stage}::"DataUsageStage",
      ${target.displayAllowed}, ${target.storageAllowed}, ${target.derivativeAllowed},
      ${target.attributionRequired}, ${target.linkbackRequired}, now(),
      ${target.policyVersion}, ${reviewer}, ${AUTHORIZATION_REASON}, true,
      ${supersedesId === null ? null : BigInt(supersedesId)}, now()
    )`;
}

/** Aplica o plano numa transação. Idempotente: só escreve o que muda. */
async function applyPlan(prisma: PrismaClient, entries: readonly AuthorizationEntry[], args: ApplyArgs): Promise<void> {
  const reviewer = args.reviewer as string;
  await prisma.$transaction(async (tx) => {
    // Recarrega o estado DENTRO da transação e replaneja: garante que a decisão
    // de create/supersede/keep vê o estado real no momento da escrita.
    const licenses = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, source_key, content_type::text AS content_type, rating_source_key, provider_key,
              territory_code, license_status::text AS license_status, display_allowed, logo_allowed,
              score_allowed, review_quote_allowed, requires_attribution, requires_linkback,
              attribution_text, policy_version FROM source_licenses WHERE is_current = true`,
    )).map((r): CurrentLicense => ({
      id: String(r.id), sourceKey: r.source_key as string, contentType: r.content_type as string,
      ratingSourceKey: (r.rating_source_key as string | null) ?? null, providerKey: (r.provider_key as string | null) ?? null,
      territory: (r.territory_code as string | null) ?? null, licenseStatus: r.license_status as string,
      displayAllowed: r.display_allowed as boolean, logoAllowed: r.logo_allowed as boolean, scoreAllowed: r.score_allowed as boolean,
      reviewQuoteAllowed: r.review_quote_allowed as boolean, requiresAttribution: r.requires_attribution as boolean,
      requiresLinkback: r.requires_linkback as boolean, attributionText: (r.attribution_text as string | null) ?? null,
      policyVersion: (r.policy_version as string | null) ?? null,
    }));
    const decisions = (await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, source_license_id, use_case, territory, stage::text AS stage, display_allowed,
              storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version
         FROM data_usage_decisions WHERE is_current = true`,
    )).map((r): CurrentDecision => ({
      id: String(r.id), sourceLicenseId: String(r.source_license_id), useCase: r.use_case as string,
      territory: (r.territory as string | null) ?? null, stage: r.stage as string, displayAllowed: r.display_allowed as boolean,
      storageAllowed: r.storage_allowed as boolean, derivativeAllowed: r.derivative_allowed as boolean,
      attributionRequired: r.attribution_required as boolean, linkbackRequired: r.linkback_required as boolean,
      policyVersion: (r.policy_version as string | null) ?? null,
    }));

    const plan = planAuthorization(entries, licenses, decisions);
    assertNoBlockedGrants(plan);

    for (const entry of plan.entries) {
      let licenseId: string;
      if (entry.license.action === "keep") {
        licenseId = entry.license.currentId!;
      } else if (entry.license.action === "create") {
        licenseId = await insertLicense(tx, entry, reviewer, null);
      } else {
        // supersede: desativa a antiga (e suas decisões) ANTES de inserir a nova
        // — o índice único parcial só admite uma vigente por grupo.
        await tx.$executeRaw`UPDATE "source_licenses" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(entry.license.currentId!)}`;
        for (const oldId of entry.deactivateDecisionIds) {
          await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(oldId)}`;
        }
        licenseId = await insertLicense(tx, entry, reviewer, entry.license.currentId);
      }

      for (const decision of entry.decisions) {
        if (decision.action === "keep") continue;
        if (decision.action === "supersede") {
          await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(decision.currentId!)}`;
        }
        await insertDecision(tx, licenseId, decision.target, reviewer, decision.action === "supersede" ? decision.currentId : null);
      }
    }
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
