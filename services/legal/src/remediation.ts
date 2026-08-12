/**
 * remediation.ts — Aposentadoria das DECISOES LEGADAS que concedem sob licenca
 * nao-exibivel.
 *
 * NAO e comportamento do apply. `legal sources apply` continua falhando alto
 * diante de estado corrompido — que e o certo: estado inesperado deve parar a
 * leva, nao ser contornado em silencio. Isto aqui e um comando de reparo de
 * DADO, invocado a mao, com dry-run por default.
 *
 * O QUE ELE REPARA. Ate 2026-08-12, `db:seed` rodado depois de um apply
 * rebaixava IN PLACE a licenca vigente de cada fonte de rating para
 * `license_status='unknown'`, deixando as decisoes `rating_display` concedendo
 * display sob licenca nao-exibivel. Essas decisoes eram LEGAIS quando nasceram
 * (o guarda `data_usage_decisions_guard` esta armado desde a criacao da tabela);
 * a licenca e que foi rebaixada debaixo delas. Hoje elas nao poderiam ser
 * criadas — e tambem nao podem ser aposentadas, porque o mesmo guarda recusa
 * qualquer UPDATE numa linha que concede sob licenca nao-exibivel. Impasse.
 *
 * COMO ELE REPARA. Zera os tres grants ao aposentar. Perde-se `display_allowed`
 * e `storage_allowed` da linha aposentada (`derivative_allowed` ja era false).
 * NAO se perde o que a decisao significava: `stage` continua
 * `approved_for_display`/`approved_for_internal_use`, e o proprio schema prova
 * que `stage` e a fonte semantica e os booleanos sao derivados dela — os CHECKs
 * `display_requires_stage` e `storage_requires_stage` so permitem o booleano
 * quando o stage o sustenta. Tambem sobrevivem `use_case`, `territory`,
 * `policy_version`, `decided_by`, `reason`, `valid_from`, `created_at`,
 * `supersedes_id` e o `id`.
 *
 * O registro nominal do que foi zerado — a saida do dry-run, linha a linha —
 * vive em `docs/legal/2026-08-12-remediacao-decisoes-legadas.md`.
 *
 * FAIL-CLOSED. So toca linha que bate a IMPRESSAO DIGITAL do rebaixamento pelo
 * seed. Qualquer linha corrompida que NAO bate faz o comando inteiro recusar,
 * dizendo qual condicao falhou — nunca "conserta" o que nao foi diagnosticado.
 */

import type { SqlExecutor } from "./apply.js";

/** `license_status` que sustentam um grant (espelha o guarda de decisoes). */
const PERMISSIVE_STATUS: readonly string[] = ["official", "licensed", "third_party"];

/**
 * A assinatura do rebaixamento pelo seed. As tres primeiras condicoes juntas
 * sao impossiveis por qualquer caminho legitimo: o apply NUNCA escreve
 * `unknown`, e o seed NUNCA escreve `decision_origin`/`policy_version`. Uma
 * linha com as duas coisas so existe por sobrescrita.
 *
 * `blocked` NAO entra: bloqueio e decisao humana deliberada e nao se repara
 * sozinho.
 */
export const FINGERPRINT_CONDITIONS = [
  "licenca vigente (is_current=true)",
  "license_status='unknown' (nunca escrito pelo apply; 'blocked' e decisao humana e NAO e reparado aqui)",
  "policy_version preenchido (o seed nunca escreve policy_version)",
  "decision_origin='owner_authorization' (o seed nunca escreve decision_origin)",
  "ha decisao vigente concedendo (display/storage/derivative) sob ela",
] as const;

/** Uma decisao viva concedendo sob licenca nao-exibivel. */
export interface LegacyGrant {
  readonly decisionId: string;
  readonly licenseId: string;
  readonly sourceKey: string;
  readonly contentType: string;
  readonly licenseStatus: string;
  readonly licensePolicyVersion: string | null;
  readonly licenseDecisionOrigin: string | null;
  readonly useCase: string;
  readonly territory: string | null;
  readonly stage: string;
  readonly displayAllowed: boolean;
  readonly storageAllowed: boolean;
  readonly derivativeAllowed: boolean;
  readonly policyVersion: string;
  readonly decidedBy: string;
  readonly validFrom: string;
}

/** Classificacao de uma linha: reparavel, ou recusada com o motivo. */
export interface RemediationItem {
  readonly grant: LegacyGrant;
  readonly matches: boolean;
  /** Condicoes da impressao digital que a linha NAO cumpre. */
  readonly failedConditions: readonly string[];
}

export interface RemediationPlan {
  readonly items: readonly RemediationItem[];
  readonly remediable: readonly RemediationItem[];
  readonly refused: readonly RemediationItem[];
}

/**
 * Classificacao PURA. `refused` nao vazio => o comando inteiro para: ha estado
 * corrompido fora do diagnostico, e reparar so a parte conhecida deixaria o
 * resto invisivel.
 */
export function planRemediation(grants: readonly LegacyGrant[]): RemediationPlan {
  const items = grants.map((grant): RemediationItem => {
    const failed: string[] = [];
    if (grant.licenseStatus !== "unknown") {
      failed.push(
        `license_status='${grant.licenseStatus}' (esperado 'unknown'${
          grant.licenseStatus === "blocked" ? "; 'blocked' e decisao humana e nao se repara automaticamente" : ""
        })`,
      );
    }
    if ((grant.licensePolicyVersion ?? "").trim() === "") {
      failed.push("policy_version da licenca vazio (a assinatura exige preenchido)");
    }
    if (grant.licenseDecisionOrigin !== "owner_authorization") {
      failed.push(`decision_origin='${grant.licenseDecisionOrigin ?? "null"}' (esperado 'owner_authorization')`);
    }
    return { grant, matches: failed.length === 0, failedConditions: failed };
  });

  return {
    items,
    remediable: items.filter((i) => i.matches),
    refused: items.filter((i) => !i.matches),
  };
}

/** Lista toda decisao VIVA concedendo sob licenca VIGENTE nao-exibivel. */
export async function readLegacyGrants(tx: SqlExecutor): Promise<readonly LegacyGrant[]> {
  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT d.id AS decision_id, l.id AS license_id, l.source_key,
            l.content_type::text AS content_type, l.license_status::text AS license_status,
            l.policy_version AS license_policy_version, l.decision_origin AS license_decision_origin,
            d.use_case, d.territory, d.stage::text AS stage,
            d.display_allowed, d.storage_allowed, d.derivative_allowed,
            d.policy_version, d.decided_by, d.valid_from
       FROM data_usage_decisions d
       JOIN source_licenses l ON l.id = d.source_license_id
      WHERE d.is_current = true
        AND l.is_current = true
        AND (d.display_allowed OR d.storage_allowed OR d.derivative_allowed)
        AND l.license_status NOT IN (${PERMISSIVE_STATUS.map((s) => `'${s}'`).join(", ")})
      ORDER BY l.id, d.id`,
  );

  return rows.map(
    (r): LegacyGrant => ({
      decisionId: String(r.decision_id),
      licenseId: String(r.license_id),
      sourceKey: r.source_key as string,
      contentType: r.content_type as string,
      licenseStatus: r.license_status as string,
      licensePolicyVersion: (r.license_policy_version as string | null) ?? null,
      licenseDecisionOrigin: (r.license_decision_origin as string | null) ?? null,
      useCase: r.use_case as string,
      territory: (r.territory as string | null) ?? null,
      stage: r.stage as string,
      displayAllowed: r.display_allowed as boolean,
      storageAllowed: r.storage_allowed as boolean,
      derivativeAllowed: r.derivative_allowed as boolean,
      policyVersion: r.policy_version as string,
      decidedBy: r.decided_by as string,
      validFrom: new Date(r.valid_from as string | number | Date).toISOString(),
    }),
  );
}

/**
 * Aposenta as decisoes reparaveis DENTRO de uma transacao ja aberta.
 *
 * Zerar os grants no MESMO UPDATE que aposenta nao e cosmetico: o guarda
 * reavalia o teto sempre que a linha NOVA concede algo, e a licenca-mae e
 * `unknown`. Com os tres grants em false, o bloco de teto inteiro e pulado e a
 * aposentadoria passa. `stage` fica intacto de proposito.
 */
export async function applyRemediationWithin(tx: SqlExecutor, plan: RemediationPlan): Promise<number> {
  if (plan.refused.length > 0) {
    throw new Error(
      `remediacao recusada: ${plan.refused.length} linha(s) corrompida(s) fora da impressao digital diagnosticada`,
    );
  }
  for (const item of plan.remediable) {
    await tx.$executeRaw`
      UPDATE "data_usage_decisions"
         SET "display_allowed" = false, "storage_allowed" = false, "derivative_allowed" = false,
             "is_current" = false, "updated_at" = now()
       WHERE "id" = ${BigInt(item.grant.decisionId)}`;
  }
  return plan.remediable.length;
}

/** Tabela markdown pronta para colar no registro de `docs/legal/`. */
export function renderRemediationRecord(plan: RemediationPlan, when: string): string {
  const grants = (g: LegacyGrant): string =>
    [g.displayAllowed ? "display" : null, g.storageAllowed ? "storage" : null, g.derivativeAllowed ? "derivative" : null]
      .filter((x): x is string => x !== null)
      .join(" + ") || "<nenhum>";

  const lines = [
    `### Decisoes aposentadas em ${when}`,
    "",
    "| decisao | licenca | fonte | use_case | territorio | stage (preservado) | concedia (ZERADO) | policy_version | decidida por | valid_from |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...plan.remediable.map(
      ({ grant: g }) =>
        `| ${g.decisionId} | ${g.licenseId} (${g.licenseStatus}) | ${g.sourceKey}/${g.contentType} | ${g.useCase} | ${g.territory ?? "global"} | \`${g.stage}\` | **${grants(g)}** | ${g.policyVersion} | ${g.decidedBy} | ${g.validFrom} |`,
    ),
  ];

  if (plan.refused.length > 0) {
    lines.push(
      "",
      "### RECUSADAS (fora da impressao digital — nada foi tocado)",
      "",
      ...plan.refused.map(
        ({ grant: g, failedConditions }) =>
          `- decisao ${g.decisionId} sob licenca ${g.licenseId} (${g.sourceKey}): ${failedConditions.join("; ")}`,
      ),
    );
  }

  return lines.join("\n");
}

/** Relatorio de terminal do dry-run/apply. */
export function renderRemediationPlan(plan: RemediationPlan, mode: "dry-run" | "apply"): string {
  const head =
    mode === "dry-run"
      ? "REMEDIACAO (DRY-RUN — nada sera escrito)"
      : "REMEDIACAO (--confirm — aposentando as decisoes legadas)";

  const out = [
    "",
    "=".repeat(78),
    head,
    "=".repeat(78),
    "",
    "IMPRESSAO DIGITAL exigida (todas):",
    ...FINGERPRINT_CONDITIONS.map((c, i) => `  ${i + 1}. ${c}`),
    "",
    `linhas concedendo sob licenca nao-exibivel: ${plan.items.length}`,
    `  reparaveis (assinatura bate): ${plan.remediable.length}`,
    `  RECUSADAS (assinatura NAO bate): ${plan.refused.length}`,
    "",
  ];

  for (const { grant: g } of plan.remediable) {
    const concedia = [
      g.displayAllowed ? "display" : null,
      g.storageAllowed ? "storage" : null,
      g.derivativeAllowed ? "derivative" : null,
    ]
      .filter((x): x is string => x !== null)
      .join("+");
    out.push(
      `  [reparar] decisao ${g.decisionId} sob licenca ${g.licenseId} (${g.sourceKey}/${g.contentType}, ${g.licenseStatus})`,
      `            ${g.useCase} / ${g.territory ?? "global"} / stage=${g.stage} (PRESERVADO)`,
      `            concedia ${concedia} -> ZERADO; policy=${g.policyVersion}; por ${g.decidedBy}`,
    );
  }

  for (const { grant: g, failedConditions } of plan.refused) {
    out.push(
      `  [RECUSA]  decisao ${g.decisionId} sob licenca ${g.licenseId} (${g.sourceKey}): ${failedConditions.join("; ")}`,
    );
  }

  if (plan.refused.length > 0) {
    out.push(
      "",
      "NADA sera escrito: ha linha corrompida FORA do diagnostico. Reparar so a",
      "parte conhecida deixaria o resto invisivel. Investigue as recusas antes.",
    );
  } else if (plan.remediable.length === 0) {
    out.push("", "nada a remediar: nenhuma decisao viva concede sob licenca nao-exibivel.");
  }

  out.push("");
  return out.join("\n");
}
