/**
 * Testes de governanca — Backend C: espelhamento enum Postgres <-> TS.
 *
 * O nucleo puro da user platform declara unions em
 * services/user-platform/src/core/types.ts espelhando os enums do
 * schema.prisma. Divergencia (valor a mais, a menos ou fora de ordem) e bug:
 * este teste compara VALOR A VALOR o schema com as constantes exportadas,
 * na mesma disciplina do editorial-enums-schema-mirror do admin.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_AUDIT_ACTIONS,
  AUTH_TOKEN_PURPOSES,
  CONSENT_KINDS,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_STATUSES,
  IMPORT_JOB_STATUSES,
  IMPORT_SOURCES,
  PROFILE_VISIBILITIES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REVIEW_MODERATION_STATUSES,
  SYSTEM_LIST_KEYS,
  THROTTLE_SCOPES,
  USER_LIST_KINDS,
  USER_ROLES,
  USER_STATUSES,
  VIEWING_EVENT_TYPES,
  VISIBILITIES,
  WATCH_STATES,
} from "../../services/user-platform/src/core/types";

const schema = readFileSync(
  path.join(process.cwd(), "packages", "db", "prisma", "schema.prisma"),
  "utf8",
);

/** Extrai os valores de um enum do schema.prisma na ordem declarada. */
function schemaEnumValues(enumName: string): string[] {
  const re = new RegExp(`enum ${enumName} \\{([\\s\\S]*?)\\}`);
  const match = schema.match(re);
  if (!match) {
    return [];
  }
  return match[1]!
    // Split por \r?\n: o schema e CRLF; deixar o \r na linha faria o strip de
    // comentario (`//.*$`) falhar (em regex JS `.` nao casa \r e `$` nao ancora
    // antes de \r), e o comentario vazaria para dentro do valor do enum.
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0);
}

const MIRRORS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  ["UserStatus", USER_STATUSES],
  ["UserRole", USER_ROLES],
  ["ProfileVisibility", PROFILE_VISIBILITIES],
  ["Visibility", VISIBILITIES],
  ["WatchState", WATCH_STATES],
  ["ViewingEventType", VIEWING_EVENT_TYPES],
  ["ReviewModerationStatus", REVIEW_MODERATION_STATUSES],
  ["AuthTokenPurpose", AUTH_TOKEN_PURPOSES],
  ["ThrottleScope", THROTTLE_SCOPES],
  ["AuthAuditAction", AUTH_AUDIT_ACTIONS],
  ["UserListKind", USER_LIST_KINDS],
  ["SystemListKey", SYSTEM_LIST_KEYS],
  ["ConsentKind", CONSENT_KINDS],
  ["DataRequestKind", DATA_REQUEST_KINDS],
  ["DataRequestStatus", DATA_REQUEST_STATUSES],
  ["ImportSource", IMPORT_SOURCES],
  ["ImportJobStatus", IMPORT_JOB_STATUSES],
  ["ReportReason", REPORT_REASONS],
  ["ReportStatus", REPORT_STATUSES],
];

describe("user platform: enums TS espelham o schema Postgres (valor a valor)", () => {
  it("(1) todos os 19 enums da user platform existem no schema", () => {
    for (const [name] of MIRRORS) {
      expect(schemaEnumValues(name), `enum ${name} ausente do schema`).not.toEqual([]);
    }
  });

  for (const [name, tsValues] of MIRRORS) {
    it(`(espelho) ${name}: schema e core/types.ts identicos`, () => {
      expect([...tsValues]).toEqual(schemaEnumValues(name));
    });
  }
});
