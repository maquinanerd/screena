/**
 * ops-actions-guard.test.ts — O que as acoes do painel operacional PODEM escrever.
 *
 * ============================================================================
 * A REGRA
 * ============================================================================
 * O painel enfileira trabalho e grava auditoria. Ele nao apaga nada, nao muda
 * licenca nem `display_allowed`, nao altera cadencia nem teto, nao para nem
 * implanta servico e nao exporta e-mail. Esta guarda le as DUAS pontas da escrita:
 *
 *   apps/admin/src/server/ops-actions.ts                  (a Server Action)
 *   services/sync/src/scheduler/runtime/admin-actions.ts  (o unico SQL de escrita)
 *
 * e reprova se aparecer um verbo, uma tabela ou um campo fora da lista. Le pela
 * porta unica (`tests/support/source-text.ts`): o comentario que EXPLICA a regra
 * nao pode fazer a guarda casar.
 *
 * Se um dia falhar, a correcao e remover a escrita indevida — nunca relaxar a regra.
 */

import { describe, expect, it } from "vitest";

import { ADMIN_ACTION_KINDS } from "../../services/sync/src/scheduler/admin-action-plan";
import { readSourceWithoutComments } from "../support/source-text";

const OPS_ACTIONS = "apps/admin/src/server/ops-actions.ts";
const ADMIN_ACTIONS = "services/sync/src/scheduler/runtime/admin-actions.ts";
const USERS_READS = "apps/admin/src/server/ops/users.ts";
const MIGRATION = "packages/db/prisma/migrations/20260915120000_admin_operational_panel/migration.sql";

/** As tabelas em que um INSERT cru aparece. */
export function insertTargets(code: string): string[] {
  return [...code.matchAll(/INSERT\s+INTO\s+"?([a-z_]+)"?/g)].map((match) => match[1] as string);
}

/** Verbos SQL de alteracao/destruicao (maiusculos, como o SQL do repositorio e escrito). */
export function destructiveSqlVerbs(code: string): string[] {
  return [...code.matchAll(/\b(UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE|CREATE)\b/g)].map((match) => match[1] as string);
}

/** Metodos de escrita do Prisma e SQL cru. */
export function prismaWrites(code: string): string[] {
  const needles = [".create(", ".update(", ".delete(", ".upsert(", "Many(", "$executeRaw", "$queryRaw"];
  return needles.filter((needle) => code.includes(needle));
}

describe("detectores (nao sao vacuos)", () => {
  it("pegam INSERT fora da lista, UPDATE, DELETE e escrita do Prisma", () => {
    expect(insertTargets('INSERT INTO source_licenses (x) VALUES (1)')).toEqual(["source_licenses"]);
    expect(destructiveSqlVerbs("UPDATE catalog_jobs SET status = 'cancelled'")).toEqual(["UPDATE"]);
    expect(destructiveSqlVerbs("DELETE FROM users")).toEqual(["DELETE"]);
    expect(prismaWrites("await prisma.sourceLicense.update({ data })")).toEqual([".update("]);
  });

  it("CONTROLE NEGATIVO: leitura e ON CONFLICT DO NOTHING nao sao escrita destrutiva", () => {
    expect(destructiveSqlVerbs("SELECT id FROM catalog_jobs WHERE status = 'pending'")).toEqual([]);
    expect(destructiveSqlVerbs("INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING RETURNING id")).toEqual([]);
  });
});

describe("a Server Action do painel", () => {
  const code = readSourceWithoutComments(OPS_ACTIONS);

  it('e uma Server Action ("use server") que so exporta funcoes assincronas', () => {
    expect(code).toMatch(/^\s*["']use server["'];/);
    const exports = [...code.matchAll(/export\s+(async\s+function|function|const|let|class|type|interface)\s+(\w+)/g)];
    expect(exports.length).toBeGreaterThan(0);
    for (const match of exports) expect(`${match[2]}: ${match[1]}`).toMatch(/: async\s+function$/);
  });

  it("nao escreve no banco por conta propria: nem metodo do Prisma, nem SQL", () => {
    expect(prismaWrites(code)).toEqual([]);
    expect(insertTargets(code)).toEqual([]);
    expect(destructiveSqlVerbs(code)).toEqual([]);
  });

  it("a escrita sai SO pelo modulo do agendador", () => {
    expect(code).toContain('from "@screena/sync/admin-actions"');
    for (const fn of ["enqueueAdminCatalogRefresh", "requestAdminSchedulerRun", "recordRefusedAdminAction"]) {
      expect(code).toContain(fn);
    }
  });

  it("o custo e REFEITO no servidor: o formulario so traz qual acao e o nonce", () => {
    expect(code).toContain("estimateTitleAction(");
    expect(code).toContain("estimateQueueAction(");
    const keys = [...code.matchAll(/formData\.get\("([a-z]+)"\)/g)].map((match) => match[1]);
    expect(new Set(keys)).toEqual(new Set(["tipo", "id", "acao", "token", "fila", "termo"]));
  });

  it("nao toca licenca, exibicao, cadencia nem teto", () => {
    for (const token of ["displayAllowed", "display_allowed", "licenseStatus", "license_status", "batchLimit", "intervalHours", "RHYTHMS"]) {
      expect(code, token).not.toContain(token);
    }
  });

  it("nada vai para log: nem o termo buscado, nem e-mail", () => {
    expect(code).not.toContain("console.");
    expect(readSourceWithoutComments(USERS_READS)).not.toContain("console.");
  });
});

describe("o SQL de escrita do agendador para o painel", () => {
  const code = readSourceWithoutComments(ADMIN_ACTIONS);

  it("INSERT cru so em admin_action_audits e scheduler_force_requests", () => {
    expect(new Set(insertTargets(code))).toEqual(new Set(["admin_action_audits", "scheduler_force_requests"]));
  });

  it("o job de catalogo entra pela MESMA porta da fila (o adapter do store), nunca por INSERT proprio", () => {
    expect(code).toContain("createPrismaCatalogJobStore(");
    expect(code).toContain(".enqueue(");
    expect(insertTargets(code)).not.toContain("catalog_jobs");
  });

  it("nenhum verbo de alteracao ou destruicao, nenhum $executeRaw", () => {
    expect(destructiveSqlVerbs(code)).toEqual([]);
    expect(code).not.toContain("$executeRaw");
  });

  it("nao nomeia licenca, decisao de uso nem indexacao", () => {
    for (const token of ["display_allowed", "license_status", "source_licenses", "data_usage_decisions", "page_indexability_decisions"]) {
      expect(code, token).not.toContain(token);
    }
  });
});

describe("a auditoria no banco aceita exatamente o que o codigo grava", () => {
  const sql = readSourceWithoutComments(MIGRATION);

  function checkList(column: string): string[] {
    const match = new RegExp(`"${column}" IN \\(([^)]*)\\)`).exec(sql);
    if (match === null) throw new Error(`CHECK de ${column} nao encontrado`);
    return [...(match[1] as string).matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1] as string);
  }

  it("action_kind do CHECK = ADMIN_ACTION_KINDS", () => {
    expect(checkList("action_kind")).toEqual([...ADMIN_ACTION_KINDS]);
  });

  it("outcome do CHECK = os desfechos que o modulo grava", () => {
    expect(checkList("outcome")).toEqual(["enqueued", "already_enqueued", "refused", "failed"]);
  });

  it("o nonce e UNIQUE: o mesmo formulario enviado duas vezes e uma acao so", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "admin_action_audits_request_token_key"');
  });

  it("no maximo UM pedido aberto por alvo no screen-cron (fila e titulo)", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "scheduler_force_requests_open_queue_key"[^;]*\("queue"\)[^;]*WHERE "kind" = 'queue' AND "status" IN \('pending', 'running'\);/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "scheduler_force_requests_open_title_key"[^;]*\("kind", "entity_type", "entity_id"\)[^;]*WHERE "kind" <> 'queue' AND "status" IN \('pending', 'running'\);/,
    );
  });

  /**
   * Indices cuja definicao converte tipo com `::`. O PostgreSQL exige IMMUTABLE em
   * expressao de indice, e o cast de enum para texto nao e: o `migrate deploy`
   * morreu com 42P17 num indice assim. Typecheck e vitest nao enxergam SQL de
   * migration — so um PostgreSQL real ou esta leitura enxergam.
   */
  function castsInIndexDefinitions(source: string): string[] {
    return [...source.matchAll(/CREATE (?:UNIQUE )?INDEX ("[^"]+")[^;]*;/g)]
      .filter((match) => match[0].includes("::"))
      .map((match) => match[1] as string);
  }

  it("nenhum indice da migration converte tipo (42P17 no migrate deploy)", () => {
    expect(castsInIndexDefinitions(sql)).toEqual([]);
  });

  it("CONTROLE NEGATIVO: o indice que derrubou o migrate deploy e detectado", () => {
    const broken = `CREATE UNIQUE INDEX "x_open_target_key" ON "t"("kind", COALESCE("entity_type"::text, '')) WHERE "status" IN ('pending');`;
    expect(castsInIndexDefinitions(broken)).toEqual(['"x_open_target_key"']);
    expect(castsInIndexDefinitions(`CREATE INDEX "ok" ON "t"("a", "b");`)).toEqual([]);
  });
});
