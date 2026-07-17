/**
 * report.ts — Renderização PURA do plano de autorização.
 *
 * Mostra fonte, papel, registro vigente vs. nova versão, permissões, território,
 * atribuição, linkback e usos BLOQUEADOS — para revisão humana antes do apply.
 * Nunca imprime segredo (não há segredo aqui; é só governança de licença).
 */

import { AUTHORIZATION_BATCH, DECIDED_BY } from "./authorization-spec.js";
import type { AuthorizationPlan, EntryPlan } from "./plan.js";

function permsLine(e: EntryPlan): string {
  const l = e.license.target;
  return [
    `status=${l.licenseStatus}`,
    `display=${l.displayAllowed}`,
    `score=${l.scoreAllowed}`,
    `logo=${l.logoAllowed}`,
    `review_quote=${l.reviewQuoteAllowed}`,
    `attr=${l.requiresAttribution}`,
    `linkback=${l.requiresLinkback}`,
    `territorio=${l.territory ?? "global"}`,
  ].join(" ");
}

/** Relatório em texto para leitura humana. */
export function renderPlan(plan: AuthorizationPlan, mode: "dry-run" | "apply"): string {
  const lines: string[] = [];
  lines.push(`# legal sources — modo: ${mode}`);
  lines.push(`# leva: ${AUTHORIZATION_BATCH} · responsavel: ${DECIDED_BY}`);
  lines.push("");

  for (const entry of plan.entries) {
    const l = entry.license;
    lines.push(`## ${entry.label}  [${entry.role}]`);
    lines.push(`  licenca(${l.target.sourceKey}/${l.target.contentType}): ${l.action.toUpperCase()}${l.currentId ? ` (vigente #${l.currentId})` : ""}`);
    lines.push(`    ${permsLine(entry)}`);
    lines.push(`    atribuicao: "${l.target.attributionText}"`);
    lines.push(`    policy: ${l.target.policyVersion}`);
    for (const d of entry.decisions) {
      lines.push(
        `  decisao(${d.target.useCase}/${d.target.territory ?? "global"}): ${d.action.toUpperCase()}` +
          ` [stage=${d.target.stage} display=${d.target.displayAllowed} storage=${d.target.storageAllowed} derivative=${d.target.derivativeAllowed}]`,
      );
    }
    if (entry.deactivateDecisionIds.length > 0) {
      lines.push(`    (desativa ${entry.deactivateDecisionIds.length} decisao(oes) da licenca antiga)`);
    }
    lines.push("");
  }

  const s = plan.summary;
  lines.push("## Resumo");
  lines.push(
    `  licencas: create=${s.licensesCreate} supersede=${s.licensesSupersede} keep=${s.licensesKeep}`,
  );
  lines.push(
    `  decisoes: create=${s.decisionsCreate} supersede=${s.decisionsSupersede} keep=${s.decisionsKeep}`,
  );
  lines.push("");
  lines.push("## Usos BLOQUEADOS (esta ferramenta nunca libera)");
  lines.push("  logos · citacao integral de critica · sublicenciamento · revenda de datasets");
  lines.push("  API publica com dados de terceiros · treinamento de modelos · obra derivada · Cinerie Score");

  if (mode === "dry-run") {
    lines.push("");
    lines.push("DRY-RUN: nada foi escrito. Use --confirm --reviewer=<quem> --policy-version=<leva> para aplicar.");
  }
  return lines.join("\n");
}
