/**
 * rebind.ts — RE-RESOLVE a licenca das linhas que ficaram orfas, sem tocar em
 * `display_allowed` e sem recoletar nada de API.
 *
 * O QUE ELE CONSERTA. `external_ratings.data_usage_decision_id` e
 * `watch_availability.data_usage_decision_id` apontam para uma LINHA de
 * `data_usage_decisions`. Todo `supersede` de licenca fazia essa linha sair de
 * cena (`is_current=false`) e nascer outra, com id novo — deixando as notas e as
 * ofertas apontando para um id morto. `display_allowed` continua `true` no
 * banco; a pagina, que exige `is_current` na decisao E na licenca-mae, mostra
 * vazio. Foi o que esvaziou a coluna direita do site em 2026-08-20.
 *
 * O `apply` deixou de produzir esse estado (ver o carregamento em `apply.ts`),
 * mas quem ja ficou orfao continua orfao: nenhum comando reponta linha
 * existente. Este e esse comando.
 *
 * DISCIPLINA:
 *  - NAO liga nem desliga `display_allowed`. A permissao nao mudou; o ponteiro
 *    mudou.
 *  - NAO mexe em `reviewed_at`/`reviewed_by`/`approved_payload_hash`. A revisao
 *    humana daquela linha continua sendo a mesma.
 *  - So toca linha cuja decisao atual NAO resolve mais (idempotente: rodar de
 *    novo com tudo certo nao escreve nada).
 *  - So reponta quando existe decisao vigente que assume a linha. Sem destino,
 *    a linha fica como esta e o relatorio a conta como irrecuperavel — nunca
 *    aponta para "qualquer decisao".
 *
 * A resolucao do destino e a MESMA dos promotores governados
 * (`services/ratings/src/persistence/ratings-review-store.ts` e
 * `services/streaming/src/persistence/watch-review-store.ts`): mesma fonte
 * editorial, mesmo fornecedor tecnico, mesmo territorio, territorial vencendo a
 * global. Reponta como o promotor teria ligado — nunca mais frouxo.
 */

import type { SqlExecutor } from "./apply.js";

/** `license_status` que permitem exibicao. */
const DISPLAYABLE = `('official', 'licensed', 'third_party')`;

/**
 * A decisao vigente que autoriza exibir ESTA nota, hoje.
 *
 * Espelho literal de `CURRENT_DECISION_SQL` do ratings-review-store.
 */
const RATING_TARGET = `(
  SELECT d."id"
    FROM "data_usage_decisions" d
    JOIN "source_licenses" l ON l."id" = d."source_license_id"
   WHERE d."use_case" = 'rating_display'
     AND d."is_current"
     AND d."stage" = 'approved_for_display'
     AND d."display_allowed"
     AND d."valid_from" <= now()
     AND (d."valid_until" IS NULL OR d."valid_until" > now())
     AND (d."territory" IS NULL OR d."territory" = 'BR')
     AND l."is_current"
     AND l."content_type" = 'rating'
     AND l."rating_source_key" = r."rating_source"
     AND l."display_allowed"
     AND l."score_allowed"
     AND l."license_status" IN ${DISPLAYABLE}
   ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
   LIMIT 1
)`;

/**
 * O ponteiro ATUAL desta nota ainda a coloca na tela?
 *
 * Espelho do gate de leitura (`apps/web/src/server/entity-ratings.ts`), nao do
 * resolvedor de escrita: a definicao de "quebrou" e "sumiu da pagina". Frescor
 * (`RATING_STALE_POLICY`) e `score_type` ficam de fora de proposito — nao tem
 * relacao nenhuma com licenca, e uma nota velha nao e uma nota orfa.
 */
const RATING_POINTER_OK = `EXISTS (
  SELECT 1
    FROM "data_usage_decisions" d
    JOIN "source_licenses" l ON l."id" = d."source_license_id"
   WHERE d."id" = r."data_usage_decision_id"
     AND d."use_case" = 'rating_display'
     AND d."is_current"
     AND d."stage" = 'approved_for_display'
     AND d."display_allowed"
     AND d."valid_from" <= now()
     AND (d."valid_until" IS NULL OR d."valid_until" > now())
     AND (d."territory" IS NULL OR d."territory" = 'BR')
     AND l."is_current"
     AND l."content_type" = 'rating'
     AND l."rating_source_key" = r."rating_source"
     AND l."display_allowed"
     AND l."score_allowed"
     AND l."license_status" IN ${DISPLAYABLE}
)`;

/**
 * A decisao vigente que autoriza exibir ESTA oferta, hoje.
 *
 * Espelho literal do resolvedor do watch-review-store, PROVENIENCIA INCLUSA
 * (`l.source_key = p.slug` E `l.provider_key = w.provider_api`): existe uma
 * licenca de `watch_availability` por FORNECEDOR TECNICO, e sem esse filtro o
 * `ORDER BY` escolheria a mais recente entre as duas — creditando a origem
 * errada em silencio.
 */
const WATCH_TARGET = `(
  SELECT d."id"
    FROM "data_usage_decisions" d
    JOIN "source_licenses" l ON l."id" = d."source_license_id"
    JOIN "watch_provider_aliases" a
      ON a."provider_api" = w."provider_api" AND a."external_key" = w."provider_key"
    JOIN "watch_providers" p ON p."id" = a."provider_id"
   WHERE d."use_case" = 'watch_offer_display'
     AND d."is_current"
     AND d."stage" = 'approved_for_display'
     AND d."display_allowed"
     AND d."valid_from" <= now()
     AND (d."valid_until" IS NULL OR d."valid_until" > now())
     AND (d."territory" IS NULL OR d."territory" = w."country_code")
     AND l."is_current"
     AND l."content_type" = 'watch_availability'
     AND l."source_key" = p."slug"
     AND l."provider_key" = w."provider_api"
     AND l."display_allowed"
     AND l."license_status" IN ${DISPLAYABLE}
   ORDER BY (d."territory" IS NOT NULL) DESC, d."id" DESC
   LIMIT 1
)`;

/** Espelho do gate de leitura de ofertas (`licensedWatchWhere`). */
const WATCH_POINTER_OK = `EXISTS (
  SELECT 1
    FROM "data_usage_decisions" d
    JOIN "source_licenses" l ON l."id" = d."source_license_id"
   WHERE d."id" = w."data_usage_decision_id"
     AND d."use_case" = 'watch_offer_display'
     AND d."is_current"
     AND d."stage" = 'approved_for_display'
     AND d."display_allowed"
     AND d."valid_from" <= now()
     AND (d."valid_until" IS NULL OR d."valid_until" > now())
     AND (d."territory" IS NULL OR d."territory" = w."country_code")
     AND l."is_current"
     AND l."content_type" = 'watch_availability'
     AND l."display_allowed"
     AND l."license_status" IN ${DISPLAYABLE}
)`;

/** Uma das duas superficies governadas por decisao de uso. */
interface Surface {
  readonly kind: "ratings" | "offers";
  readonly table: string;
  readonly alias: string;
  readonly pointerOk: string;
  readonly target: string;
}

const SURFACES: readonly Surface[] = [
  { kind: "ratings", table: "external_ratings", alias: "r", pointerOk: RATING_POINTER_OK, target: RATING_TARGET },
  { kind: "offers", table: "watch_availability", alias: "w", pointerOk: WATCH_POINTER_OK, target: WATCH_TARGET },
];

/** Contagem de uma superficie. */
export interface RebindSurfaceCounts {
  /** Exibiveis cuja decisao atual NAO resolve mais (sumiram da tela). */
  readonly orphaned: number;
  /** Dessas, quantas tem decisao vigente que as assume. */
  readonly recoverable: number;
  /** Dessas, quantas NAO tem destino (ficam como estao). */
  readonly unrecoverable: number;
  /** Exibiveis e corretamente ligadas (o comando NAO toca nelas). */
  readonly healthy: number;
}

export interface RebindPlan {
  readonly ratings: RebindSurfaceCounts;
  readonly offers: RebindSurfaceCounts;
}

export interface RebindOutcome {
  readonly ratings: number;
  readonly offers: number;
}

async function countOne(tx: SqlExecutor, sql: string): Promise<number> {
  const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(sql);
  return Number(rows[0]?.n ?? 0);
}

async function surfaceCounts(tx: SqlExecutor, s: Surface): Promise<RebindSurfaceCounts> {
  const from = `FROM "${s.table}" ${s.alias} WHERE ${s.alias}."display_allowed"`;
  const orphaned = await countOne(tx, `SELECT count(*)::int AS n ${from} AND NOT ${s.pointerOk}`);
  const recoverable = await countOne(
    tx,
    `SELECT count(*)::int AS n ${from} AND NOT ${s.pointerOk} AND ${s.target} IS NOT NULL`,
  );
  const healthy = await countOne(tx, `SELECT count(*)::int AS n ${from} AND ${s.pointerOk}`);
  return { orphaned, recoverable, unrecoverable: orphaned - recoverable, healthy };
}

/** Diagnostico read-only. E o dry-run do comando. */
export async function readRebindPlan(tx: SqlExecutor): Promise<RebindPlan> {
  const ratings = await surfaceCounts(tx, SURFACES[0]!);
  const offers = await surfaceCounts(tx, SURFACES[1]!);
  return { ratings, offers };
}

/** `true` quando nao ha nada a repontuar. */
export function isRebindClean(plan: RebindPlan): boolean {
  return plan.ratings.recoverable === 0 && plan.offers.recoverable === 0;
}

/**
 * Reponta as linhas orfas para a decisao vigente. Uma instrucao por tabela,
 * dentro da transacao que o chamador abriu.
 *
 * Se o guard de escrita recusar QUALQUER linha (o unico caminho plausivel e
 * `approved_payload_hash` divergente), a transacao inteira volta atras e a
 * mensagem do banco sobe — meio conserto seria pior que nenhum.
 */
export async function applyRebindWithin(tx: SqlExecutor): Promise<RebindOutcome> {
  const out: Record<Surface["kind"], number> = { ratings: 0, offers: 0 };
  for (const s of SURFACES) {
    const affected = await tx.$executeRawUnsafe(
      `UPDATE "${s.table}" ${s.alias}
          SET "data_usage_decision_id" = ${s.target},
              "updated_at" = now()
        WHERE ${s.alias}."display_allowed"
          AND NOT ${s.pointerOk}
          AND ${s.target} IS NOT NULL`,
    );
    out[s.kind] = Number(affected);
  }
  return out;
}

function surfaceLine(name: string, c: RebindSurfaceCounts): string[] {
  return [
    `  ${name}:`,
    `    orfas (exibiveis, fora da tela):   ${c.orphaned}`,
    `    com decisao vigente que as assume: ${c.recoverable}  <- serao repontuadas`,
    `    sem destino (ficam como estao):    ${c.unrecoverable}`,
    `    ja corretas (nao serao tocadas):   ${c.healthy}`,
  ];
}

/** Relatorio em texto. */
export function renderRebindPlan(plan: RebindPlan, mode: "dry-run" | "apply"): string {
  const lines: string[] = [];
  lines.push(`# legal sources rebind — modo: ${mode}`);
  lines.push("# re-resolve a licenca das linhas existentes. NAO toca display_allowed, NAO recoleta API.");
  lines.push("");
  lines.push("## Diagnostico");
  lines.push(...surfaceLine("notas (external_ratings)", plan.ratings));
  lines.push(...surfaceLine("ofertas (watch_availability)", plan.offers));
  lines.push("");
  lines.push("## Depois do conserto (previsto)");
  lines.push(
    `  notas na tela:   ${plan.ratings.healthy} + ${plan.ratings.recoverable} = ${plan.ratings.healthy + plan.ratings.recoverable}`,
  );
  lines.push(
    `  ofertas na tela: ${plan.offers.healthy} + ${plan.offers.recoverable} = ${plan.offers.healthy + plan.offers.recoverable}`,
  );
  if (plan.ratings.unrecoverable > 0 || plan.offers.unrecoverable > 0) {
    lines.push("");
    lines.push(
      `  ${plan.ratings.unrecoverable} nota(s) e ${plan.offers.unrecoverable} oferta(s) NAO tem decisao vigente que as assuma.`,
    );
    lines.push("  Elas continuam fora da tela. Isso e licenca faltando, nao ponteiro quebrado —");
    lines.push("  rode o review das fontes e veja se a fonte/provedor delas tem licenca vigente.");
  }
  if (mode === "dry-run") {
    lines.push("");
    lines.push("DRY-RUN: nada foi escrito. Use --confirm --reviewer=<quem> para aplicar.");
  }
  return lines.join("\n");
}
