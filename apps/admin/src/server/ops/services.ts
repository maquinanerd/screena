/**
 * services.ts — Quais servicos estao no ar e QUAL CODIGO cada um roda. SERVER-ONLY.
 *
 * ============================================================================
 * O METODO, E POR QUE ELE NAO MENTE
 * ============================================================================
 * Nenhum numero desta tela vem de variavel de ambiente de build.
 *
 *   1. Cada servico, ao subir, calcula o SHA-1 de blob git de cada arquivo-fonte
 *      que esta NO DISCO DO CONTAINER e grava um digest em `service_heartbeats`,
 *      com sinal de vida a cada 60 s (`@screena/db/service-heartbeat`).
 *   2. A fila `deploy_reference` le do GitHub os commits do `main` e a arvore de
 *      cada um, e aplica a MESMA regra (`@screena/db/source-fingerprint`).
 *   3. O commit em execucao e o commit do `main` cuja arvore da o MESMO digest.
 *
 * O identificador e o conteudo que o processo carregou. `CINERIE_BUILD_SHA`, o
 * rotulo digitado que existia antes, ficou 38 commits atrasado.
 *
 * Commit que so muda documentacao tem o mesmo digest do anterior: a tela mostra o
 * MAIS NOVO do `main` com aquele digest (mesma ordem da fila deploy_reference).
 */

import { SOURCE_FINGERPRINT_METHOD } from "@screena/db/source-fingerprint";

import {
  evaluateLiveness,
  evaluateVersion,
  isVersionRed,
  SERVICE_SILENCE_MS,
  type CommitMatch,
  type Liveness,
  type VersionVerdict,
} from "../../lib/ops/health";
import { formatRelative } from "../../lib/ops/format";
import { measure, type Measured } from "../../lib/ops/measure";
import { DAY_MS, numOrNull, opsDb } from "./db";

/** Um servico que o painel conhece. */
export interface KnownService {
  readonly key: string;
  readonly label: string;
  readonly image: string;
  /** O servico grava sinal de vida? O CMS nao: banco proprio (ADR 0015). */
  readonly heartbeat: boolean;
  readonly note: string | null;
}

export const KNOWN_SERVICES: readonly KnownService[] = [
  { key: "screen-app", label: "Site público", image: "Dockerfile", heartbeat: true, note: null },
  {
    key: "screen-cron",
    label: "Agendador",
    image: "Dockerfile + comando do agendador",
    heartbeat: true,
    note:
      "Hipótese a conferir (inferência, não medida): o HEALTHCHECK da imagem do Dockerfile consulta a porta 3000, e o agendador escuta na 3005 — explicaria o serviço amarelo desde sempre no EasyPanel.",
  },
  { key: "screen-catalog-worker", label: "Worker de catálogo", image: "Dockerfile.catalog-worker", heartbeat: true, note: null },
  {
    key: "cinerie-publication-worker",
    label: "Worker de projeção editorial",
    image: "Dockerfile.publication-worker",
    heartbeat: true,
    note: "Grava sinal de vida só no modo contínuo (loop).",
  },
  { key: "cinerie-admin", label: "Este painel", image: "Dockerfile.admin", heartbeat: true, note: null },
  {
    key: "cinerie-cms",
    label: "CMS (Payload)",
    image: "Dockerfile.cms",
    heartbeat: false,
    note: "Usa banco próprio e a ADR 0015 proíbe a ponte: estado e versão não determinados por este painel.",
  },
];

/** Uma credencial como o sinal de vida a descreve: nome, presenca e formato. Nunca o valor. */
export interface CredentialView {
  readonly name: string;
  readonly present: boolean;
  readonly format: string;
}

/** Uma instancia (container) de um servico. */
export interface ServiceInstance {
  readonly instanceId: string;
  readonly startedAt: Date;
  readonly lastSeenAt: Date;
  readonly digestMethod: string;
  readonly sourceDigest: string | null;
  readonly sourceFileCount: number | null;
  readonly digestError: string | null;
  readonly buildId: string | null;
  readonly nodeVersion: string;
  readonly rssBytes: number | null;
  readonly heapUsedBytes: number | null;
  readonly cpuPercent: number | null;
  readonly credentials: readonly CredentialView[];
}

/** A linha de um servico. */
export interface ServiceRow {
  readonly service: KnownService;
  readonly newest: ServiceInstance | null;
  readonly liveInstances: number;
  readonly instancesSeen30d: number;
  readonly liveness: Liveness | null;
  readonly version: VersionVerdict | null;
  readonly match: CommitMatch | null;
  readonly redReasons: readonly string[];
}

/** O `main`, como a fila deploy_reference o leu. */
export interface MainInfo {
  readonly headSha: string | null;
  readonly headTitle: string | null;
  readonly committedAt: Date | null;
  readonly readAt: Date | null;
  readonly lastRun: { readonly status: string; readonly errorCode: string | null; readonly at: Date } | null;
}

/** A tela de servicos. */
export interface ServicesPanel {
  readonly rows: readonly ServiceRow[];
  readonly unknownServiceKeys: readonly string[];
  readonly main: MainInfo;
  readonly method: string;
}

function parseCredentials(raw: unknown): readonly CredentialView[] {
  if (!Array.isArray(raw)) return [];
  const out: CredentialView[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(record.name)) continue;
    // So os tres campos saem daqui. Qualquer outro campo que um dia apareca no
    // JSON (por engano) nao chega a tela.
    out.push({
      name: record.name,
      present: record.present === true,
      format: typeof record.format === "string" ? record.format.slice(0, 20) : "desconhecido",
    });
  }
  return out;
}

interface HeartbeatRow {
  readonly service_key: string;
  readonly instance_id: string;
  readonly started_at: Date;
  readonly last_seen_at: Date;
  readonly digest_method: string;
  readonly source_digest: string | null;
  readonly source_file_count: number | null;
  readonly digest_error: string | null;
  readonly build_id: string | null;
  readonly node_version: string;
  readonly rss_bytes: unknown;
  readonly heap_used_bytes: unknown;
  readonly cpu_percent: unknown;
  readonly credentials: unknown;
}

/** Monta a tela de servicos. */
export async function getServicesPanel(now: Date): Promise<Measured<ServicesPanel>> {
  return measure(
    "service_heartbeats + deploy_main_commits",
    async () => {
      const db = opsDb();
      const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
      const heartbeats = await db.$queryRaw<HeartbeatRow[]>`
        SELECT service_key, instance_id, started_at, last_seen_at, digest_method, source_digest,
               source_file_count, digest_error, build_id, node_version, rss_bytes, heap_used_bytes,
               cpu_percent, credentials
          FROM service_heartbeats
         WHERE last_seen_at >= ${since}::timestamptz AT TIME ZONE 'UTC'
         ORDER BY service_key, last_seen_at DESC`;

      const heads = await db.$queryRaw<Array<{ commit_sha: string; title: string; committed_at: Date; positions_read_at: Date }>>`
        SELECT commit_sha, title, committed_at, positions_read_at
          FROM deploy_main_commits
         WHERE main_position = 0
         ORDER BY positions_read_at DESC
         LIMIT 1`;
      const head = heads[0] ?? null;

      const lastRuns = await db.$queryRaw<Array<{ status: string; error_code: string | null; created_at: Date }>>`
        SELECT status::text AS status, error_code, created_at
          FROM api_sync_logs
         WHERE endpoint = 'scheduler/deploy_reference'
         ORDER BY created_at DESC
         LIMIT 1`;
      const lastRun = lastRuns[0] ?? null;

      const byService = new Map<string, HeartbeatRow[]>();
      for (const row of heartbeats) {
        const list = byService.get(row.service_key) ?? [];
        list.push(row);
        byService.set(row.service_key, list);
      }

      const digests = [
        ...new Set(
          heartbeats
            .filter((row) => row.source_digest !== null && row.digest_method === SOURCE_FINGERPRINT_METHOD)
            .map((row) => row.source_digest as string),
        ),
      ];
      // A MESMA ordem de `newestCommitsForDigests` (runtime/deploy-reference.ts):
      // para cada digest, o commit mais novo do `main` que o tem.
      const matches =
        digests.length === 0
          ? []
          : await db.$queryRaw<
              Array<{
                source_digest: string;
                commit_sha: string;
                title: string;
                main_position: number | null;
                behind_head_by: number | null;
                behind_head_sha: string | null;
              }>
            >`
              SELECT DISTINCT ON (source_digest) source_digest, commit_sha, title, main_position,
                     behind_head_by, behind_head_sha
                FROM deploy_main_commits
               WHERE source_digest = ANY(${digests}::text[])
                 AND digest_method = ${SOURCE_FINGERPRINT_METHOD}
               ORDER BY source_digest, main_position ASC NULLS LAST, committed_at DESC`;
      const matchByDigest = new Map(matches.map((m) => [m.source_digest, m]));

      const main = { headSha: head?.commit_sha ?? null, readAt: head?.positions_read_at ?? null };

      const rows: ServiceRow[] = KNOWN_SERVICES.map((service) => {
        const instances = byService.get(service.key) ?? [];
        const newestRow = instances[0] ?? null;
        const newest: ServiceInstance | null =
          newestRow === null
            ? null
            : {
                instanceId: newestRow.instance_id,
                startedAt: newestRow.started_at,
                lastSeenAt: newestRow.last_seen_at,
                digestMethod: newestRow.digest_method,
                sourceDigest: newestRow.source_digest,
                sourceFileCount: newestRow.source_file_count,
                digestError: newestRow.digest_error,
                buildId: newestRow.build_id,
                nodeVersion: newestRow.node_version,
                rssBytes: numOrNull(newestRow.rss_bytes),
                heapUsedBytes: numOrNull(newestRow.heap_used_bytes),
                cpuPercent: numOrNull(newestRow.cpu_percent),
                credentials: parseCredentials(newestRow.credentials),
              };
        const liveInstances = instances.filter((row) => now.getTime() - row.last_seen_at.getTime() <= SERVICE_SILENCE_MS).length;

        if (!service.heartbeat) {
          return { service, newest, liveInstances, instancesSeen30d: instances.length, liveness: null, version: null, match: null, redReasons: [] };
        }

        const liveness = evaluateLiveness(newest?.lastSeenAt ?? null, now);
        const digestUsable = newest !== null && newest.digestMethod === SOURCE_FINGERPRINT_METHOD;
        const found = digestUsable && newest.sourceDigest !== null ? matchByDigest.get(newest.sourceDigest) : undefined;
        const match: CommitMatch | null =
          found === undefined
            ? null
            : {
                commitSha: found.commit_sha,
                title: found.title,
                mainPosition: found.main_position,
                behindHeadBy: found.behind_head_by,
                behindHeadSha: found.behind_head_sha,
              };
        const version: VersionVerdict =
          newest === null
            ? { kind: "nao_determinado", reason: "o serviço nunca gravou sinal de vida (ainda não foi reimplantado com esta versão?)" }
            : !digestUsable
              ? { kind: "nao_determinado", reason: `método de impressão digital diferente (${newest.digestMethod})` }
              : evaluateVersion({ sourceDigest: newest.sourceDigest, digestError: newest.digestError, main, match });

        const redReasons: string[] = [];
        if (liveness.kind === "sem_sinal") {
          redReasons.push(`SEM SINAL de vida ${formatRelative(liveness.lastSeenAt, now)} (limite: 3 min)`);
        }
        if (liveness.kind === "nunca") redReasons.push("NUNCA deu sinal de vida");
        if (version.kind === "atras") redReasons.push(`RODANDO CÓDIGO ${String(version.behindBy)} COMMIT(S) ATRÁS DO MAIN`);
        if (version.kind === "sem_correspondencia") redReasons.push("CÓDIGO SEM COMMIT CORRESPONDENTE NO MAIN");
        if (isVersionRed(version) && redReasons.length === 0) redReasons.push("versão divergente");

        return {
          service,
          newest,
          liveInstances,
          instancesSeen30d: instances.length,
          liveness,
          version,
          match,
          redReasons,
        };
      });

      const known = new Set(KNOWN_SERVICES.map((s) => s.key));
      const unknownServiceKeys = [...byService.keys()].filter((key) => !known.has(key));

      return {
        rows,
        unknownServiceKeys,
        main: {
          headSha: head?.commit_sha ?? null,
          headTitle: head?.title ?? null,
          committedAt: head?.committed_at ?? null,
          readAt: head?.positions_read_at ?? null,
          lastRun: lastRun === null ? null : { status: lastRun.status, errorCode: lastRun.error_code, at: lastRun.created_at },
        },
        method: SOURCE_FINGERPRINT_METHOD,
      };
    },
    () => now,
  );
}
