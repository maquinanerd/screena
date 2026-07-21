/**
 * Governanca — Backend C / C7A: fundacao de persistencia.
 *
 * Trava, por leitura da FONTE REAL (schema.prisma + migration SQL), que:
 *  - o que o Prisma declara para C7A existe de fato no SQL (sem drift);
 *  - o snapshot vigente e por (usuario, CONTEXTO), nao so por usuario;
 *  - a tabela de feedback NAO carrega texto livre, PII, nota nem moderacao;
 *  - o Cinerie Score nao foi acoplado a recomendacao pessoal;
 *  - apps/ nao fala diretamente com as tabelas da user platform.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const schema = readFileSync(path.join(ROOT, "packages", "db", "prisma", "schema.prisma"), "utf8");

const MIGRATION_DIR = path.join(ROOT, "packages", "db", "prisma", "migrations");
const C7A_MIGRATION = "20260721120000_user_product_persistence_foundation";
const migrationSql = readFileSync(path.join(MIGRATION_DIR, C7A_MIGRATION, "migration.sql"), "utf8");

describe("C7A: schema Prisma e migration SQL alinhados", () => {
  it("(1) a migration de C7A existe e e a unica nova", () => {
    const dirs = readdirSync(MIGRATION_DIR).filter((e) =>
      statSync(path.join(MIGRATION_DIR, e)).isDirectory(),
    );
    expect(dirs).toContain(C7A_MIGRATION);
  });

  it("(2) as 4 colunas novas do snapshot estao no Prisma E no SQL", () => {
    for (const [prismaField, sqlColumn] of [
      ["context", '"context"'],
      ["policyVersion", '"policy_version"'],
      ["fingerprint", '"fingerprint"'],
      ["expiresAt", '"expires_at"'],
    ] as const) {
      expect(schema, `campo ${prismaField} ausente no schema`).toContain(prismaField);
      expect(migrationSql, `coluna ${sqlColumn} ausente no SQL`).toContain(sqlColumn);
    }
  });

  it("(3) os 3 enums novos existem no Prisma E no SQL", () => {
    for (const name of [
      "RecommendationContext",
      "RecommendationFeedbackType",
      "RecommendationFeedbackSource",
    ]) {
      expect(schema).toContain(`enum ${name} {`);
      expect(migrationSql).toContain(`CREATE TYPE "${name}"`);
    }
  });

  it("(4) a tabela de feedback existe no Prisma (@@map) E no SQL", () => {
    expect(schema).toContain('@@map("user_recommendation_feedback")');
    expect(migrationSql).toContain('CREATE TABLE "user_recommendation_feedback"');
  });

  it("(5) o vigente e por (user_id, context) — indice unico PARCIAL", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "user_recommendation_snapshots_current_unique"[\s\S]*?"user_id",\s*"context"[\s\S]*?WHERE "is_current" = true/,
    );
  });

  it("(6) idempotencia do feedback: UNIQUE (user_id, idempotency_key)", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "user_recommendation_feedback_user_id_idempotency_key_key"[\s\S]*?"user_id",\s*"idempotency_key"/,
    );
  });

  it("(7) a migration e aditiva: sem DROP TABLE/COLUMN, TRUNCATE, DELETE ou rename", () => {
    for (const banned of [
      "DROP TABLE",
      "DROP COLUMN",
      "TRUNCATE",
      "DELETE FROM",
      "RENAME",
      "DROP TYPE",
    ]) {
      expect(migrationSql.toUpperCase(), `${banned} nao pode aparecer`).not.toContain(banned);
    }
  });
});

describe("C7A: feedback nao guarda texto livre, PII, nota nem moderacao", () => {
  /** Bloco DDL da tabela de feedback (do CREATE TABLE ate o fecho `);`). */
  const feedbackDdl = (() => {
    const start = migrationSql.indexOf('CREATE TABLE "user_recommendation_feedback"');
    const end = migrationSql.indexOf("\n);", start);
    return migrationSql.slice(start, end);
  })();

  it("(1) o bloco DDL foi localizado (guarda nao vacua)", () => {
    expect(feedbackDdl.length).toBeGreaterThan(200);
  });

  it("(2) nenhuma coluna de texto livre / PII / segredo", () => {
    for (const banned of [
      "comment",
      "note",
      "reason_text",
      "body",
      "title",
      "description",
      "email",
      "password",
      "token",
      "ip_address",
      "ip_hash",
      "session",
    ]) {
      expect(feedbackDdl.toLowerCase(), `coluna proibida: ${banned}`).not.toContain(`"${banned}"`);
    }
  });

  it("(3) nenhuma coluna de nota/rating nem de moderacao", () => {
    for (const banned of [
      "rating",
      "score",
      "value",
      "moderation_status",
      "review_id",
      "cinerie",
    ]) {
      expect(feedbackDdl.toLowerCase(), `coluna proibida: ${banned}`).not.toContain(`"${banned}"`);
    }
  });

  it("(4) o feedback e apagado junto com o usuario (LGPD) e restringe a entidade", () => {
    expect(migrationSql).toMatch(
      /"user_recommendation_feedback_user_id_fkey"[\s\S]*?REFERENCES "users"\("id"\) ON DELETE CASCADE/,
    );
    expect(migrationSql).toMatch(
      /"user_recommendation_feedback_entity_fkey"[\s\S]*?REFERENCES "entities"[\s\S]*?ON DELETE RESTRICT/,
    );
  });

  it("(5) person nunca recebe feedback de recomendacao", () => {
    expect(migrationSql).toContain(
      `CONSTRAINT "user_recommendation_feedback_entity_type_allowed" CHECK ("entity_type" <> 'person')`,
    );
  });
});

describe("C7A.1: identidade idempotente dos eventos de tracking", () => {
  const C7A1_MIGRATION = "20260721140000_tracking_event_idempotency_scope";
  const trackingSql = readFileSync(
    path.join(MIGRATION_DIR, C7A1_MIGRATION, "migration.sql"),
    "utf8",
  );

  /** Bloco do model ViewingEvent no schema.prisma. */
  const viewingEventModel = (() => {
    const start = schema.indexOf("model ViewingEvent {");
    const end = schema.indexOf("\n}", start);
    return schema.slice(start, end);
  })();

  it("(1) o model ViewingEvent foi localizado (guarda nao vacua)", () => {
    expect(viewingEventModel).toContain('@@map("user_viewing_events")');
  });

  it("(2) a unique do Prisma INCLUI eventType (nao pode voltar ao par antigo)", () => {
    // Falha se alguem reverter para @@unique([userId, idempotencyKey]).
    expect(viewingEventModel).toContain("@@unique([userId, idempotencyKey, eventType])");
    expect(viewingEventModel).not.toMatch(/@@unique\(\[userId,\s*idempotencyKey\]\)/);
  });

  it("(3) a migration troca a UNIQUE antiga pela nova, com as 3 colunas na ordem", () => {
    expect(trackingSql).toContain('DROP INDEX "user_viewing_events_user_id_idempotency_key_key"');
    expect(trackingSql).toMatch(
      /CREATE UNIQUE INDEX "user_viewing_events_user_id_idempotency_key_event_type_key"[\s\S]*?"user_id",\s*"idempotency_key",\s*"event_type"/,
    );
  });

  it("(4) a migration NAO toca dados, colunas, tabelas nem enums", () => {
    for (const banned of [
      "DROP TABLE",
      "DROP COLUMN",
      "DROP TYPE",
      "TRUNCATE",
      "DELETE FROM",
      "UPDATE ",
      "INSERT INTO",
      "ALTER TYPE",
      "ALTER COLUMN",
      "RENAME",
    ]) {
      expect(trackingSql.toUpperCase(), `${banned} nao pode aparecer`).not.toContain(banned);
    }
  });

  it("(5) a migration e 100% ASCII (cliente pode rodar em WIN1252)", () => {
    // Um emoji no SQL fez o `migrate deploy` FALHAR de verdade nesta unidade.
    const offenders = [...trackingSql].filter((ch) => ch.charCodeAt(0) > 127);
    expect(offenders).toEqual([]);
  });
});

describe("C7A: Cinerie Score nao acoplado a recomendacao pessoal", () => {
  it("(1) nenhuma tabela/coluna de recomendacao referencia Cinerie Score", () => {
    const recoDdl = migrationSql.toLowerCase();
    for (const banned of ["cinerie", "external_rating", "source_license"]) {
      expect(recoDdl).not.toContain(banned);
    }
  });
});

describe("C7A: apps/ nao fala com as tabelas da user platform", () => {
  it("(1) nenhum arquivo de apps/ referencia tabelas user_* nem os models novos", () => {
    const appsDir = path.join(ROOT, "apps");
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          const content = readFileSync(full, "utf8");
          if (
            /user_recommendation_feedback|user_recommendation_snapshots|recommendationFeedback|recommendationSnapshots/.test(
              content,
            )
          ) {
            offenders.push(path.relative(ROOT, full));
          }
        }
      }
    }
    walk(appsDir);
    expect(offenders).toEqual([]);
  });
});
