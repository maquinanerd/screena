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
import type { DecisionBinding } from "./impact.js";
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
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
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

/**
 * Insere uma decisão nova (is_current=true) sob a licença informada.
 *
 * `valid_from` é TRUNCADO ao milissegundo, e isso não é estilo. A coluna é
 * `TIMESTAMP(3)`: gravar `now()` (microssegundos) faz o PostgreSQL ARREDONDAR,
 * e o arredondamento pode subir. Com `now() = 00:03:00.635678` o valor gravado
 * vira `.636` — MAIOR que o `CURRENT_TIMESTAMP` da mesma transação. O guard de
 * escrita testa exatamente `decision.valid_from > CURRENT_TIMESTAMP` e derruba
 * a transação com
 *
 *   P0001: external_ratings fail-closed: decisao N fora da vigencia
 *
 * Isso ficou latente enquanto ninguém escrevia numa linha governada logo depois
 * de criar a decisão. O carregamento de linhas passou a fazer exatamente isso —
 * e a falha seria INTERMITENTE (só quando os microssegundos arredondam para
 * cima), que é a pior forma de descobrir. `date_trunc` sempre desce.
 */
async function insertDecision(
  tx: SqlExecutor,
  licenseId: string,
  target: EntryPlan["decisions"][number]["target"],
  identity: ApplyIdentity,
  supersedesId: string | null,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
    INSERT INTO "data_usage_decisions" (
      "source_license_id", "use_case", "territory", "stage", "display_allowed", "storage_allowed",
      "derivative_allowed", "attribution_required", "linkback_required", "valid_from",
      "policy_version", "decided_by", "reason", "is_current", "supersedes_id", "updated_at"
    ) VALUES (
      ${BigInt(licenseId)}, ${target.useCase}, ${target.territory}, ${target.stage}::"DataUsageStage",
      ${target.displayAllowed}, ${target.storageAllowed}, ${target.derivativeAllowed},
      ${target.attributionRequired}, ${target.linkbackRequired}, date_trunc('milliseconds', now()),
      ${target.policyVersion}, ${identity.reviewer}, ${identity.reason}, true,
      ${supersedesId === null ? null : BigInt(supersedesId)}, now()
    ) RETURNING "id"`;
  return String(rows[0]!.id);
}

/**
 * As DUAS tabelas cujo dado fica pendurado numa decisão de uso.
 *
 * Elas são o motivo pelo qual `supersede` nunca foi uma operação segura: cada
 * linha guarda o ID de uma LINHA de `data_usage_decisions`, não "a decisão
 * vigente daquele uso". Superseder a licença troca o id embaixo delas.
 */
const BOUND_TABLES = [
  { table: "external_ratings", field: "ratings" },
  { table: "watch_availability", field: "offers" },
] as const;

/**
 * Censo: quantas linhas EXIBÍVEIS estão penduradas em cada decisão, hoje.
 *
 * Uma linha por decisão que tem dado (dezenas, não milhares) — barato o
 * bastante para rodar também no `review`, que é onde o número precisa aparecer.
 * Conta só `display_allowed = true`: é a população que some da tela.
 */
export async function readDecisionBindings(tx: SqlExecutor): Promise<Map<string, DecisionBinding>> {
  const bindings = new Map<string, DecisionBinding>();
  for (const { table, field } of BOUND_TABLES) {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string; n: number }>>(
      `SELECT "data_usage_decision_id"::text AS id, count(*)::int AS n
         FROM "${table}"
        WHERE "display_allowed" AND "data_usage_decision_id" IS NOT NULL
        GROUP BY 1`,
    );
    for (const row of rows) {
      const current = bindings.get(row.id) ?? { ratings: 0, offers: 0 };
      bindings.set(row.id, { ...current, [field]: Number(row.n) });
    }
  }
  return bindings;
}

/**
 * Linhas exibíveis cujo `approved_payload_hash` NÃO bate mais o payload atual.
 *
 * Elas são a única forma de o carregamento abaixo abortar a transação: o guard
 * de escrita reconfere o fingerprint a cada UPDATE, e repontuar a decisão é um
 * UPDATE. O estado é quase impossível (o próprio guard impede que um campo do
 * fingerprint mude sem reaprovação) — mas se existir, o operador precisa saber
 * ANTES, no `review`, e não descobrir com o apply caindo pela metade.
 */
export async function readStaleApprovals(tx: SqlExecutor): Promise<{ ratings: number; offers: number }> {
  const [ratings] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "external_ratings" r
      WHERE r."display_allowed"
        AND (r."approved_payload_hash" IS NULL
             OR r."approved_payload_hash" <> external_rating_payload_fingerprint_v1(
                  r."entity_type", r."entity_id", r."rating_source", r."metric", r."score_type",
                  r."rating_label", r."rating_value", r."rating_scale", r."rating_count",
                  r."rating_url", r."provider_api", r."license_status", r."requires_attribution",
                  r."requires_linkback", r."attribution_text", r."attribution_url"))`,
  );
  const [offers] = await tx.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "watch_availability" w
      WHERE w."display_allowed"
        AND (w."approved_payload_hash" IS NULL
             OR w."approved_payload_hash" <> watch_offer_payload_fingerprint_v1(
                  w."provider_api", w."external_offer_id", w."entity_type", w."entity_id",
                  w."country_code", w."offer_type", w."provider_key", w."provider_name",
                  w."package", w."quality", w."price", w."currency", w."deep_link", w."web_url",
                  w."available_from", w."available_until", w."license_status",
                  w."requires_attribution", w."requires_linkback", w."attribution_text",
                  w."attribution_url"))`,
  );
  return { ratings: Number(ratings?.n ?? 0), offers: Number(offers?.n ?? 0) };
}

/**
 * CARREGA as linhas da decisão que sai para a decisão que entra.
 *
 * Repontua TODAS as linhas (não só as exibíveis): o campo diz "sob qual decisão
 * esta linha foi ligada", e deixar uma linha oculta apontando para uma decisão
 * morta congelaria a linha — o guard recusaria qualquer escrita futura nela.
 *
 * Roda DEPOIS do INSERT da decisão nova, na MESMA transação: o guard de escrita
 * revalida o destino, e o destino só existe a partir dali.
 */
async function carryBoundRows(tx: SqlExecutor, fromDecisionId: string, toDecisionId: string): Promise<void> {
  for (const { table } of BOUND_TABLES) {
    await tx.$executeRawUnsafe(
      `UPDATE "${table}" SET "data_usage_decision_id" = $1, "updated_at" = now()
        WHERE "data_usage_decision_id" = $2`,
      BigInt(toDecisionId),
      BigInt(fromDecisionId),
    );
  }
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

    // Ids das decisões NOVAS, por índice em `entry.decisions` — é assim que o
    // plano endereça o destino de cada carregamento (`DecisionCarry`).
    const newDecisionIds = new Map<number, string>();
    for (const [index, decision] of entry.decisions.entries()) {
      if (decision.action === "keep") continue;
      if (decision.action === "supersede") {
        // Aqui a licença-mãe é a MESMA (só há `supersede` de decisão quando a
        // licença foi mantida), então ela continua vigente e o trigger passa.
        await tx.$executeRaw`UPDATE "data_usage_decisions" SET "is_current" = false, "updated_at" = now() WHERE "id" = ${BigInt(decision.currentId!)}`;
      }
      const newId = await insertDecision(
        tx,
        licenseId,
        decision.target,
        identity,
        decision.action === "supersede" ? decision.currentId : null,
      );
      newDecisionIds.set(index, newId);
    }

    // ============ O CARREGAMENTO — o que faltava em 2026-08-20 ============
    //
    // Toda decisão que muda de id (porque a licença foi supersedida, ou porque
    // ela mesma ganhou versão nova) deixa para trás as notas e as ofertas que
    // apontavam para o id antigo. Aqui elas passam a apontar para a decisão
    // nova — na MESMA transação, e SÓ quando o destino concede o mesmo uso
    // (`planCarry`/`planCarryInPlace` já decidiram isso, olhando exatamente os
    // campos que o guard de escrita exige; tentar carregar para um destino que
    // o guard recusa abortaria a transação inteira).
    //
    // Quando NENHUMA decisão nova assume (licença/decisão mais restritiva), as
    // linhas ficam onde estão e somem da tela — que é o comportamento correto.
    // O que não pode acontecer é isso ser SURPRESA: `review` imprime a contagem
    // antes (ver `impact.ts` e `renderPlan`).
    for (const carry of entry.carries) {
      if (carry.verdict !== "carry" || carry.toDecisionIndex === null) continue;
      const toId = newDecisionIds.get(carry.toDecisionIndex);
      if (toId === undefined) continue;
      await carryBoundRows(tx, carry.fromDecisionId, toId);
    }
  }

  return plan;
}
