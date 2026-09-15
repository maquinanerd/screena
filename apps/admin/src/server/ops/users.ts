/**
 * users.ts — Usuarios, avaliacoes e volumes. SERVER-ONLY, SO LEITURA.
 *
 * ============================================================================
 * E-MAIL: NA TELA SIM; EM URL, LOG E EXPORTACAO, NAO
 * ============================================================================
 * O painel e do dono e mostra e-mail. Por isso mesmo:
 *   - a busca por e-mail chega por POST (Server Action), nunca por query string —
 *     URL vai para historico do navegador, log de proxy e cabecalho Referer;
 *   - nada aqui escreve log, e erro de consulta vira motivo SEGURO (`measure`),
 *     nunca a mensagem crua que poderia repetir o termo buscado;
 *   - nao ha listagem sem limite nem botao de exportar.
 *
 * ============================================================================
 * "NAO IMPLEMENTADO" E DIFERENTE DE ZERO
 * ============================================================================
 * Origem do cadastro nao tem coluna; review de usuario tem tabela e nao tem rota;
 * seguir e comentar nao existem no schema. A tela escreve isso por extenso.
 */

import { escapeLike } from "../../lib/ops/log-filters";
import { measure, type Measured } from "../../lib/ops/measure";
import { DAY_MS, isoDay, lastUtcDays, num, numOrNull, opsDb, utcDayStart } from "./db";

/** O que nao existe, e por que. */
export const USER_FEATURE_GAPS: ReadonlyArray<{ readonly label: string; readonly state: string; readonly why: string }> = [
  { label: "Origem do cadastro", state: "não implementado", why: "não há coluna de origem em users" },
  {
    label: "Último acesso (coluna própria)",
    state: "não implementado",
    why: "a coluna de último uso do login nunca é gravada; a tela usa o último login bem-sucedido (user_auth_audit_logs) e a última ação registrada",
  },
  { label: "Reviews de usuário", state: "não implementado", why: "a tabela user_reviews existe, sem rota nem escrita" },
  { label: "Recomendações", state: "não implementado", why: "as tabelas existem, sem rota" },
  { label: "Seguir", state: "não existe", why: "não há tabela no schema" },
  { label: "Comentários", state: "não existe", why: "não há tabela no schema" },
  { label: "Papel admin/moderador", state: "coluna sem uso", why: "users.role existe; nada grava nem confere" },
];

/** Totais de usuarios. */
export interface UsersOverview {
  readonly total: number;
  readonly verified: number;
  readonly byStatus: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly byRole: ReadonlyArray<{ readonly role: string; readonly count: number }>;
}

export async function readUsersOverview(now: Date): Promise<Measured<UsersOverview>> {
  return measure(
    "users",
    async () => {
      const rows = await opsDb().$queryRaw<Array<{ status: string; role: string; verified: boolean; n: unknown }>>`
        SELECT status::text AS status, role::text AS role, (email_verified_at IS NOT NULL) AS verified, COUNT(*) AS n
          FROM users
         GROUP BY 1, 2, 3`;
      const byStatus = new Map<string, number>();
      const byRole = new Map<string, number>();
      let total = 0;
      let verified = 0;
      for (const row of rows) {
        const n = num(row.n);
        total += n;
        if (row.verified) verified += n;
        byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + n);
        byRole.set(row.role, (byRole.get(row.role) ?? 0) + n);
      }
      return {
        total,
        verified,
        byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
        byRole: [...byRole.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
      };
    },
    () => now,
  );
}

/** Cadastros por dia (UTC). Dia sem cadastro e ZERO de verdade: a fonte e a propria tabela. */
export async function readSignupsPerDay(now: Date, days: number): Promise<Measured<ReadonlyArray<{ readonly day: string; readonly count: number }>>> {
  return measure(
    "users.created_at",
    async () => {
      const since = new Date(utcDayStart(now).getTime() - (days - 1) * DAY_MS).toISOString();
      const rows = await opsDb().$queryRaw<Array<{ day: Date; n: unknown }>>`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS n
          FROM users
         WHERE created_at >= ${since}::timestamptz AT TIME ZONE 'UTC'
         GROUP BY 1
         ORDER BY 1`;
      const byDay = new Map(rows.map((row) => [isoDay(row.day), num(row.n)]));
      return lastUtcDays(now, days).map((day) => ({ day, count: byDay.get(day) ?? 0 }));
    },
    () => now,
  );
}

/** Ativos = login bem-sucedido OU acao registrada (nota, lista, acompanhamento, diario). */
export interface ActiveUsers {
  readonly last7: number;
  readonly last30: number;
}

export async function readActiveUsers(now: Date): Promise<Measured<ActiveUsers>> {
  return measure(
    "user_auth_audit_logs (login_succeeded) + user_ratings + user_list_items + user_watch_states + user_episode_progress + user_viewing_events",
    async () => {
      const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
      const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const rows = await opsDb().$queryRaw<Array<{ last7: unknown; last30: unknown }>>`
        WITH activity AS (
          SELECT user_id, created_at AS at FROM user_auth_audit_logs
           WHERE action = 'login_succeeded' AND user_id IS NOT NULL
             AND created_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
          UNION ALL
          SELECT user_id, updated_at FROM user_ratings
           WHERE updated_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
          UNION ALL
          SELECT l.owner_id, i.added_at FROM user_list_items i JOIN user_lists l ON l.id = i.list_id
           WHERE i.added_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
          UNION ALL
          SELECT user_id, last_activity_at FROM user_watch_states
           WHERE last_activity_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
          UNION ALL
          SELECT user_id, updated_at FROM user_episode_progress
           WHERE updated_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
          UNION ALL
          SELECT user_id, occurred_at FROM user_viewing_events
           WHERE occurred_at >= ${since30}::timestamptz AT TIME ZONE 'UTC'
        ), per_user AS (
          SELECT user_id, MAX(at) AS last_at FROM activity GROUP BY user_id
        )
        SELECT COUNT(*) FILTER (WHERE last_at >= ${since7}::timestamptz AT TIME ZONE 'UTC') AS last7,
               COUNT(*) AS last30
          FROM per_user`;
      const row = rows[0];
      return { last7: num(row?.last7), last30: num(row?.last30) };
    },
    () => now,
  );
}

/** Um usuario na tela. */
export interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly handle: string | null;
  readonly status: string;
  readonly verified: boolean;
  readonly createdAt: Date;
  readonly lastLoginAt: Date | null;
  readonly lastActionAt: Date | null;
}

interface RawUser {
  readonly id: string;
  readonly email: string;
  readonly handle: string | null;
  readonly status: string;
  readonly verified: boolean;
  readonly created_at: Date;
  readonly last_login_at: Date | null;
  readonly last_action_at: Date | null;
}

function toUser(row: RawUser): UserRow {
  return {
    id: row.id,
    email: row.email,
    handle: row.handle,
    status: row.status,
    verified: row.verified,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActionAt: row.last_action_at,
  };
}

/** Os usuarios mais novos (limite duro). */
export async function readNewestUsers(now: Date, limit = 50): Promise<Measured<readonly UserRow[]>> {
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  return measure(
    "users + user_auth_audit_logs + tabelas de atividade",
    async () => {
      const rows = await opsDb().$queryRaw<RawUser[]>`
        SELECT u.id::text AS id, u.email, u.handle, u.status::text AS status,
               (u.email_verified_at IS NOT NULL) AS verified, u.created_at,
               (SELECT MAX(a.created_at) FROM user_auth_audit_logs a
                 WHERE a.user_id = u.id AND a.action = 'login_succeeded') AS last_login_at,
               GREATEST(
                 (SELECT MAX(r.updated_at) FROM user_ratings r WHERE r.user_id = u.id),
                 (SELECT MAX(w.last_activity_at) FROM user_watch_states w WHERE w.user_id = u.id),
                 (SELECT MAX(p.updated_at) FROM user_episode_progress p WHERE p.user_id = u.id),
                 (SELECT MAX(v.occurred_at) FROM user_viewing_events v WHERE v.user_id = u.id)
               ) AS last_action_at
          FROM users u
         ORDER BY u.created_at DESC, u.id DESC
         LIMIT ${take}`;
      return rows.map(toUser);
    },
    () => now,
  );
}

/** Resultado da busca por e-mail. */
export type EmailSearchResult =
  | { readonly ok: true; readonly rows: readonly UserRow[]; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: string };

const EMAIL_SEARCH_LIMIT = 20;

/**
 * Busca por trecho de e-mail. Minimo 3 caracteres e limite de 20 linhas: e uma
 * busca, nao uma listagem — e muito menos uma exportacao.
 */
export async function searchUsersByEmail(rawTerm: unknown): Promise<EmailSearchResult> {
  const term = typeof rawTerm === "string" ? rawTerm.trim().toLowerCase() : "";
  if (term.length < 3) return { ok: false, reason: "digite ao menos 3 caracteres do e-mail" };
  if (term.length > 120) return { ok: false, reason: "termo longo demais" };
  const pattern = `%${escapeLike(term)}%`;
  const measured = await measure("users (busca por e-mail)", async () => {
    const rows = await opsDb().$queryRaw<RawUser[]>`
      SELECT u.id::text AS id, u.email, u.handle, u.status::text AS status,
             (u.email_verified_at IS NOT NULL) AS verified, u.created_at,
             (SELECT MAX(a.created_at) FROM user_auth_audit_logs a
               WHERE a.user_id = u.id AND a.action = 'login_succeeded') AS last_login_at,
             GREATEST(
               (SELECT MAX(r.updated_at) FROM user_ratings r WHERE r.user_id = u.id),
               (SELECT MAX(w.last_activity_at) FROM user_watch_states w WHERE w.user_id = u.id),
               (SELECT MAX(p.updated_at) FROM user_episode_progress p WHERE p.user_id = u.id),
               (SELECT MAX(v.occurred_at) FROM user_viewing_events v WHERE v.user_id = u.id)
             ) AS last_action_at
        FROM users u
       WHERE u.email_normalized LIKE ${pattern} ESCAPE '\\'
       ORDER BY u.created_at DESC, u.id DESC
       LIMIT ${EMAIL_SEARCH_LIMIT + 1}`;
    return rows.map(toUser);
  });
  if (!measured.ok) return { ok: false, reason: measured.reason };
  return {
    ok: true,
    rows: measured.value.slice(0, EMAIL_SEARCH_LIMIT),
    truncated: measured.value.length > EMAIL_SEARCH_LIMIT,
  };
}

/** As notas dadas por usuarios. */
export interface UserRatingsPanel {
  readonly count: number;
  readonly average: number | null;
  readonly distribution: ReadonlyArray<{ readonly value: number; readonly count: number }>;
  readonly mostRated: ReadonlyArray<{ readonly kind: string; readonly id: string; readonly title: string | null; readonly count: number; readonly average: number | null }>;
  readonly latest: ReadonlyArray<{ readonly userId: string; readonly handle: string | null; readonly kind: string; readonly id: string; readonly title: string | null; readonly value: number | null; readonly updatedAt: Date }>;
}

export async function readUserRatings(now: Date): Promise<Measured<UserRatingsPanel>> {
  return measure(
    "user_ratings",
    async () => {
      const db = opsDb();
      const totals = await db.$queryRaw<Array<{ n: unknown; avg: unknown }>>`
        SELECT COUNT(*) AS n, AVG(value) AS avg FROM user_ratings`;
      const distribution = await db.$queryRaw<Array<{ value: unknown; n: unknown }>>`
        SELECT value, COUNT(*) AS n FROM user_ratings GROUP BY value ORDER BY value`;
      const mostRated = await db.$queryRaw<Array<{ kind: string; id: string; n: unknown; avg: unknown; title: string | null }>>`
        SELECT r.entity_type::text AS kind, r.entity_id::text AS id, COUNT(*) AS n, AVG(r.value) AS avg,
               COALESCE(MAX(t.title), MAX(m.title_original), MAX(s.name_original)) AS title
          FROM user_ratings r
          LEFT JOIN entity_translations t
            ON t.entity_type = r.entity_type AND t.entity_id = r.entity_id AND t.language_code = 'pt-BR'
          LEFT JOIN movies m ON r.entity_type = 'movie' AND m.id = r.entity_id
          LEFT JOIN tv_shows s ON r.entity_type = 'tv' AND s.id = r.entity_id
         GROUP BY r.entity_type, r.entity_id
         ORDER BY n DESC, avg DESC NULLS LAST
         LIMIT 10`;
      const latest = await db.$queryRaw<Array<{ user_id: string; handle: string | null; kind: string; id: string; value: unknown; updated_at: Date; title: string | null }>>`
        SELECT r.user_id::text AS user_id, u.handle, r.entity_type::text AS kind, r.entity_id::text AS id,
               r.value, r.updated_at,
               COALESCE(t.title, m.title_original, s.name_original) AS title
          FROM user_ratings r
          JOIN users u ON u.id = r.user_id
          LEFT JOIN entity_translations t
            ON t.entity_type = r.entity_type AND t.entity_id = r.entity_id AND t.language_code = 'pt-BR'
          LEFT JOIN movies m ON r.entity_type = 'movie' AND m.id = r.entity_id
          LEFT JOIN tv_shows s ON r.entity_type = 'tv' AND s.id = r.entity_id
         ORDER BY r.updated_at DESC, r.id DESC
         LIMIT 20`;
      return {
        count: num(totals[0]?.n),
        average: numOrNull(totals[0]?.avg),
        distribution: distribution.map((row) => ({ value: num(row.value), count: num(row.n) })),
        mostRated: mostRated.map((row) => ({ kind: row.kind, id: row.id, title: row.title, count: num(row.n), average: numOrNull(row.avg) })),
        latest: latest.map((row) => ({
          userId: row.user_id,
          handle: row.handle,
          kind: row.kind,
          id: row.id,
          title: row.title,
          value: numOrNull(row.value),
          updatedAt: row.updated_at,
        })),
      };
    },
    () => now,
  );
}

/** Volumes de uso. */
export interface UserVolumes {
  readonly systemLists: ReadonlyArray<{ readonly key: string; readonly lists: number; readonly items: number }>;
  readonly customLists: number;
  readonly customListItems: number;
  readonly watchStates: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly episodesWatched: number;
  readonly episodeProgressRows: number;
  readonly viewingEvents: number;
  readonly importJobs: ReadonlyArray<{ readonly source: string; readonly status: string; readonly count: number }>;
}

export async function readUserVolumes(now: Date): Promise<Measured<UserVolumes>> {
  return measure(
    "user_lists + user_list_items + user_watch_states + user_episode_progress + user_viewing_events + user_import_jobs",
    async () => {
      const db = opsDb();
      const system = await db.$queryRaw<Array<{ key: string; lists: unknown; items: unknown }>>`
        SELECT l.system_key::text AS key, COUNT(DISTINCT l.id) AS lists, COUNT(i.id) AS items
          FROM user_lists l
          LEFT JOIN user_list_items i ON i.list_id = l.id
         WHERE l.kind = 'system' AND l.deleted_at IS NULL
         GROUP BY l.system_key
         ORDER BY 1`;
      const custom = await db.$queryRaw<Array<{ lists: unknown; items: unknown }>>`
        SELECT COUNT(DISTINCT l.id) AS lists, COUNT(i.id) AS items
          FROM user_lists l
          LEFT JOIN user_list_items i ON i.list_id = l.id
         WHERE l.kind = 'custom' AND l.deleted_at IS NULL`;
      const states = await db.$queryRaw<Array<{ status: string; n: unknown }>>`
        SELECT status::text AS status, COUNT(*) AS n FROM user_watch_states GROUP BY 1 ORDER BY 2 DESC`;
      const progress = await db.$queryRaw<Array<{ watched: unknown; total: unknown }>>`
        SELECT COUNT(*) FILTER (WHERE watched) AS watched, COUNT(*) AS total FROM user_episode_progress`;
      const events = await db.$queryRaw<Array<{ n: unknown }>>`SELECT COUNT(*) AS n FROM user_viewing_events`;
      const imports = await db.$queryRaw<Array<{ source: string; status: string; n: unknown }>>`
        SELECT source::text AS source, status::text AS status, COUNT(*) AS n
          FROM user_import_jobs GROUP BY 1, 2 ORDER BY 1, 2`;
      return {
        systemLists: system.map((row) => ({ key: row.key, lists: num(row.lists), items: num(row.items) })),
        customLists: num(custom[0]?.lists),
        customListItems: num(custom[0]?.items),
        watchStates: states.map((row) => ({ status: row.status, count: num(row.n) })),
        episodesWatched: num(progress[0]?.watched),
        episodeProgressRows: num(progress[0]?.total),
        viewingEvents: num(events[0]?.n),
        importJobs: imports.map((row) => ({ source: row.source, status: row.status, count: num(row.n) })),
      };
    },
    () => now,
  );
}
