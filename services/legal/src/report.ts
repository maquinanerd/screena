/**
 * report.ts — Renderização PURA do plano de autorização.
 *
 * Mostra fonte, papel, registro vigente vs. nova versão, permissões, território,
 * atribuição, linkback e usos BLOQUEADOS — para revisão humana antes do apply.
 * Nunca imprime segredo (não há segredo aqui; é só governança de licença).
 */

import { AUTHORIZATION_BATCH, DECIDED_BY } from "./authorization-spec.js";
import type { AuthorizationImpact, ImpactedDecision } from "./impact.js";
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

/** Contagem de linhas de dado de uma decisão impactada, em uma linha. */
function impactLine(row: ImpactedDecision): string {
  const what = [
    row.ratings > 0 ? `${row.ratings} nota(s)` : null,
    row.offers > 0 ? `${row.offers} oferta(s)` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(" + ");
  const where = `${row.label} · ${row.useCase}/${row.territory ?? "global"} · decisao #${row.fromDecisionId}`;
  return row.reason === "" ? `${what} — ${where}` : `${what} — ${where} — MOTIVO: ${row.reason}`;
}

/**
 * O QUE ESTA LEVA FAZ COM O DADO QUE JA ESTA NA TELA.
 *
 * Este bloco não existia até 2026-08-20 — e a falta dele custou a coluna
 * direita do site. O `review` daquele dia imprimiu `supersede=72` e mais nada;
 * o número que importava (453 notas e 874 ofertas prestes a sumir) não estava
 * escrito em lugar nenhum. Agora está, e antes de qualquer escrita.
 */
export function renderImpact(
  impact: AuthorizationImpact,
  staleApprovals: { ratings: number; offers: number },
): string {
  const s = impact.summary;
  const lines: string[] = [];
  lines.push("## Impacto nas linhas ja exibiveis");
  lines.push(
    `  CARREGADAS para a licenca nova (continuam na tela): ${s.carriedRatings} nota(s) · ${s.carriedOffers} oferta(s)`,
  );
  lines.push(
    `  OCULTADAS por esta mudanca (saem da tela):          ${s.hiddenRatings} nota(s) · ${s.hiddenOffers} oferta(s)`,
  );

  if (impact.hidden.length > 0) {
    lines.push("");
    lines.push("  ATENCAO — esta leva vai OCULTAR dado que hoje esta publicado:");
    for (const row of impact.hidden) lines.push(`    - ${impactLine(row)}`);
  }

  if (staleApprovals.ratings > 0 || staleApprovals.offers > 0) {
    lines.push("");
    lines.push(
      `  RISCO DE ABORTO: ${staleApprovals.ratings} nota(s) e ${staleApprovals.offers} oferta(s) exibiveis` +
        " estao com approved_payload_hash divergente do payload atual.",
    );
    lines.push(
      "  O guard de escrita reconfere o fingerprint a cada UPDATE — carregar essas linhas derruba",
    );
    lines.push("  a transacao inteira (nada e escrito). Reaprove-as antes de rodar com --confirm.");
  }

  return lines.join("\n");
}

/** Relatório em texto para leitura humana. */
export function renderPlan(
  plan: AuthorizationPlan,
  mode: "dry-run" | "apply",
  impact?: { readonly impact: AuthorizationImpact; readonly staleApprovals: { ratings: number; offers: number } },
): string {
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
  if (impact !== undefined) {
    lines.push("");
    lines.push(renderImpact(impact.impact, impact.staleApprovals));
  }

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
