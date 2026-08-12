/**
 * apply.ts — O LAÇO DE ESCRITA do registro de autorização, em UM lugar só.
 *
 * Este módulo é IO-shaped mas NÃO depende do Prisma: ele recebe um executor SQL
 * descrito ESTRUTURALMENTE (`SqlExecutor`). Por isso continua dentro do
 * `pnpm typecheck` principal (que não tem o Prisma Client gerado) e continua
 * testável, enquanto `bin/legal.ts` e os validadores só fornecem a conexão.
 *
 * POR QUE ELE EXISTE. O laço vivia duplicado: uma cópia em `bin/legal.ts` e
 * outra em `scripts/validate-source-authorization-and-attribution.ts`, esta
 * última anunciada no próprio comentário como "cópia fiel do laço do bin". As
 * duas carregavam o MESMO defeito de ordem (ver `supersede` abaixo) — e o
 * validador nunca o exercitou porque partia de um banco onde as licenças a
 * supersedir ainda não tinham decisões vigentes. Duplicata + estado inicial
 * diferente do de produção = defeito invisível. Com um laço só, o que o
 * validador exercita é literalmente o que `pnpm legal sources apply` executa.
 */

import type { AuthorizationEntry } from "./authorization-spec.js";
import {
  assertNoBlockedGrants,
  isPlanClean,
  planAuthorization,
  type AuthorizationPlan,
  type CurrentDecision,
  type CurrentLicense,
  type EntryPlan,
} from "./plan.js";

/**
 * Só os métodos raw que o laço usa, descritos estruturalmente.
 *
 * Aceita tanto o `PrismaClient` completo quanto o `TransactionClient` da
 * transação interativa (que não tem `$transaction`) — sem `import` de Prisma e
 * sem cast em nenhum dos dois lados.
 */
export interface SqlExecutor {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** Quem decidiu e por quê — carimbado em toda linha escrita. */
export interface ApplyIdentity {
  readonly reviewer: string;
  readonly reason: string;
}

const SELECT_CURRENT_LICENSES = `
  SELECT id, source_key, content_type::text AS content_type, rating_source_key, provider_key,
         territory_code, license_status::text AS license_status, display_allowed, logo_allowed,
         score_allowed, review_quote_allowed, requires_attribution, requires_linkback,
         attribution_text, policy_version
    FROM source_licenses WHERE is_current = true`;

const SELECT_CURRENT_DECISIONS = `
  SELECT id, source_license_id, use_case, territory, stage::text AS stage, display_allowed,
         storage_allowed, derivative_allowed, attribution_required, linkback_required, policy_version
    FROM data_usage_decisions WHERE is_current = true`;

/** Projeta o estado VIGENTE (licenças + decisões) para o planejador puro. */
export async function readCurrentState(tx: SqlExecutor): Promise<{
  licenses: readonly CurrentLicense[];
  decisions: readonly CurrentDecision[];
}> {
  const licenses = (
    await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(SELECT_CURRENT_LICENSES)
  ).map(
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

  const decisions = (
    await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(SELECT_CURRENT_DECISIONS)
  ).map(
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

  return { licenses, decisions };
}

/** Insere uma licença nova (is_current=true) e devolve o id. */
async function insertLicense(
  tx: SqlExecutor,
  entry: EntryPlan,
  identity: ApplyIdentity,
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
      true, ${supersedesId === null ? null : BigInt(supersedesId)}, ${identity.reviewer}, now(), 'owner_authorization',
      ${l.policyVersion}, ${l.notes}, now()
    ) RETURNING "id"`;
  return String(rows[0]!.id);
}

/** Insere uma decisão nova (is_current=true) sob a licença informada. */
async function insertDecision(
  tx: SqlExecutor,
  licenseId: string,
  target: EntryPlan["decisions"][number]["target"],
  identity: ApplyIdentity,
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
      ${target.policyVersion}, ${identity.reviewer}, ${identity.reason}, true,
      ${supersedesId === null ? null : BigInt(supersedesId)}, now()
    )`;
}

/**
 * Aplica a autorização DENTRO de uma transação já aberta.
 *
 * Recarrega o estado vigente aqui dentro e replaneja: a decisão de
 * create/supersede/keep precisa enxergar o estado real no momento da escrita,
 * não o do dry-run impresso minutos antes. Idempotente — plano limpo não
 * escreve nada.
 *
 * Devolve o plano efetivamente executado (útil para relatório e para teste).
 */
export async function applyAuthorizationWithin(
  tx: SqlExecutor,
  entries: readonly AuthorizationEntry[],
  identity: ApplyIdentity,
): Promise<AuthorizationPlan> {
  const { licenses, decisions } = await readCurrentState(tx);
  const plan = planAuthorization(entries, licenses, decisions);
  assertNoBlockedGrants(plan);
  if (isPlanClean(plan)) return plan;

  for (const entry of plan.entries) {
    let licenseId: string;

    if (entry.license.action === "keep") {
      licenseId = entry.license.currentId!;
    } else if (entry.license.action === "create") {
      licenseId = await insertLicense(tx, entry, identity, null);
    } else {
      // ============ SUPERSEDE — a ORDEM destas duas desativações não é estilo ============
      //
      // `data_usage_decisions_guard` é `BEFORE INSERT OR UPDATE`, e o teto da
      // licença-mãe é reavaliado sempre que a linha NOVA concede alguma coisa
      // (`display_allowed OR storage_allowed OR derivative_allowed`). Desativar
      // uma decisão NÃO zera esses campos: o `UPDATE ... is_current=false`
      // apresenta ao trigger uma linha que continua concedendo, e o trigger vai
      // reler a licença-mãe. Se a licença já tiver saído de cena, ele barra com
      //
      //   P0001: data_usage_decisions fail-closed: licenca N nao e a vigente (is_current=false)
      //
      // — e a transação inteira volta atrás. Foi exatamente o que derrubou o
      // `legal sources apply --confirm` em produção (2026-08-12), na segunda leva
      // de autorização: na primeira, as licenças-semente não tinham decisões
      // vigentes e o laço abaixo nunca rodava.
      //
      // Então: as DECISÕES saem primeiro, ainda sob a licença vigente (o trigger
      // revalida contra a licença que as autorizou — e passa). Só depois a
      // licença sai. A licença continua saindo ANTES do INSERT da nova, que é o
      // que o índice único parcial (uma vigente por grupo) exige.
      for (const oldId of entry.deactivateDecisionIds) {
        await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(oldId)}`;
      }
      await tx.$executeRaw`UPDATE "source_licenses" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(entry.license.currentId!)}`;
      licenseId = await insertLicense(tx, entry, identity, entry.license.currentId);
    }

    for (const decision of entry.decisions) {
      if (decision.action === "keep") continue;
      if (decision.action === "supersede") {
        // Aqui a licença-mãe é a MESMA (só há `supersede` de decisão quando a
        // licença foi mantida), então ela continua vigente e o trigger passa.
        await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(decision.currentId!)}`;
      }
      await insertDecision(
        tx,
        licenseId,
        decision.target,
        identity,
        decision.action === "supersede" ? decision.currentId : null,
      );
    }
  }

  return plan;
}
