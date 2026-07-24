#!/usr/bin/env bash
set -uo pipefail

# catalog-cycle-with-alert.sh — um CICLO completo de catálogo, com sentinela e alerta.
#
# Executa, em ordem, os comandos que JÁ existem (não reimplementa nada):
#
#   1. snapshot ANTES  (catalog audit-database --json)
#   2. catalog worker  (drena a fila)
#   3. catalog search-reindex
#   4. catalog index-decisions --apply
#   5. snapshot DEPOIS
#   6. sentinela de saúde (scripts/catalog/lib/queue-health.mjs)
#   7. alerta via a infra do Prompt 02 (scripts/backup/lib/alert.mjs)
#
# POR QUE O SENTINELA: o modo de falha mais perigoso não é o worker morrer — é
# ele PARECER saudável. Na primeira execução do Prompt 03 a fila reivindicava
# jobs, reportava progresso, o exit code era 0 e ZERO entidades persistiam. O
# passo 6 compara os dois snapshots e falha quando jobs concluíram sem o
# catálogo crescer.
#
# LOCK: `flock` impede dois ciclos concorrentes. Sem ele, dois workers
# competiriam pela fila (o claim usa SKIP LOCKED, então não corrompe — mas
# duplica cota TMDB à toa) e, pior, dois produtores de indexabilidade poderiam
# criar duas decisões vigentes (não há unique parcial no banco).
#
# EXIT CODE: sempre o do trabalho, nunca o do alerta. O alerta é observabilidade;
# ele jamais mascara o resultado.
#
# Uso (tipicamente via systemd timer):
#   DATABASE_URL=... TMDB_READ_ACCESS_TOKEN=... \
#   CATALOG_ALERT_WEBHOOK_URL=https://hooks.slack.com/... \
#   BACKUP_ALERT_PROVIDER=slack \
#   scripts/catalog/catalog-cycle-with-alert.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ALERT_LIB="${REPO_ROOT}/scripts/backup/lib/alert.mjs"
HEALTH_LIB="${SCRIPT_DIR}/lib/queue-health.mjs"
LOCK_FILE="${CATALOG_LOCK_FILE:-/tmp/cinerie-catalog-cycle.lock}"

WORKER_MAX_JOBS="${CATALOG_WORKER_MAX_JOBS:-5000}"
WORKER_CONCURRENCY="${CATALOG_WORKER_CONCURRENCY:-4}"
WORKER_TIMEOUT_MS="${CATALOG_WORKER_TIMEOUT_MS:-300000}"

catalog() {
  # `pnpm --filter` evita depender do cwd; a CLI é a mesma que o operador usa.
  (cd "$REPO_ROOT" && corepack pnpm --filter @screena/ingestion exec tsx bin/catalog.ts "$@")
}

snapshot() {
  # Uma linha JSON com o que o sentinela precisa. Read-only.
  catalog audit-database --json 2>/dev/null || echo '{}'
}

emit_alert() {
  local exit_code="$1" summary="$2" status="$3"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  ALERT_LIB="$ALERT_LIB" A_EXIT="$exit_code" A_MSG="$summary" A_TS="$ts" A_STATUS="$status" \
    node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const m = await import(pathToFileURL(process.env.ALERT_LIB).href);
      const alert = m.buildAlert({
        source: "queue",
        status: process.env.A_STATUS,
        exitCode: Number(process.env.A_EXIT),
        message: process.env.A_MSG,
        timestamp: process.env.A_TS,
        host: process.env.HOSTNAME || "",
      });
      console.error(m.formatAlertText(alert));
      await m.dispatchAlert(alert, {
        webhookUrl: process.env.CATALOG_ALERT_WEBHOOK_URL || process.env.BACKUP_ALERT_WEBHOOK_URL,
        provider: process.env.BACKUP_ALERT_PROVIDER,
        log: () => {},
      });
    ' 2>&1 || echo "catalog-cycle: falha ao emitir alerta (ignorada)." >&2
}

run_cycle() {
  local before after code=0

  before="$(snapshot)"

  if ! catalog worker \
      --concurrency "$WORKER_CONCURRENCY" \
      --max-jobs "$WORKER_MAX_JOBS" \
      --timeout-ms "$WORKER_TIMEOUT_MS"; then
    code=$?
    emit_alert "$code" "catalog worker falhou (exit $code)" "failure"
    return "$code"
  fi

  # Projeção de busca e decisões de indexabilidade fazem parte do ciclo: sem
  # elas, entidade nova não entra na busca nem tem decisão registrada.
  catalog search-reindex --apply || echo "catalog-cycle: search-reindex falhou (seguindo)." >&2
  catalog index-decisions --apply || echo "catalog-cycle: index-decisions falhou (seguindo)." >&2

  after="$(snapshot)"

  # Sentinela: decide sobre os dois snapshots. Exit 1 = problema crítico.
  BEFORE="$before" AFTER="$after" HEALTH_LIB="$HEALTH_LIB" \
    node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const m = await import(pathToFileURL(process.env.HEALTH_LIB).href);
      const toSnap = (raw) => {
        let j = {};
        try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
        const ents = j.entities ?? [];
        const pick = (name) => Number(ents.find((e) => e.entity === name)?.total ?? 0);
        const jobs = j.jobs ?? [];
        const byStatus = (s) => Number(jobs.find((x) => x.status === s)?.count ?? 0);
        return {
          entities: pick("movies") + pick("tv_shows") + pick("seasons") + pick("episodes"),
          titles: pick("movies") + pick("tv_shows"),
          people: pick("people"),
          slugs: pick("slugs"),
          translations: pick("entity_translations"),
          searchDocuments: Number(j.searchDocuments?.total ?? 0),
          deadLetter: Number(j.deadLetters ?? 0),
          pending: byStatus("pending"),
          retryWait: byStatus("retry_wait"),
          succeeded: byStatus("succeeded"),
        };
      };
      const verdict = m.evaluateCycleHealth(toSnap(process.env.BEFORE), toSnap(process.env.AFTER));
      console.log(verdict.summary);
      for (const i of verdict.issues) console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
      process.exit(verdict.healthy ? 0 : 1);
    '
  code=$?

  if [[ "$code" -ne 0 ]]; then
    emit_alert "$code" "ciclo de catalogo com problema critico (sentinela)" "failure"
  else
    emit_alert 0 "ciclo de catalogo concluido" "success"
  fi
  return "$code"
}

# Um ciclo por vez. `-n` = falha imediata se já houver outro (não enfileira).
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "catalog-cycle: outro ciclo em andamento (lock $LOCK_FILE); saindo." >&2
  exit 0
fi

run_cycle
exit $?
