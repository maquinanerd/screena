#!/usr/bin/env bash
set -uo pipefail

# backup-with-alert.sh — envelope do backup com alerta em caso de falha.
#
# Roda scripts/backup/backup.sh; em QUALQUER falha, constrói um alerta
# estruturado (scripts/backup/lib/alert.mjs, com segredos redigidos) e o
# dispara para BACKUP_ALERT_WEBHOOK_URL, se definido. O codigo de saida do
# backup e SEMPRE preservado — o alerta nunca mascara o resultado.
#
# Uso (tipicamente via cron/systemd):
#   BACKUP_ALERT_WEBHOOK_URL="https://hooks.slack.com/..." \
#   DATABASE_URL="postgresql://..." BACKUP_DIR=/var/backups \
#   scripts/backup/backup-with-alert.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALERT_LIB="${SCRIPT_DIR}/lib/alert.mjs"

emit_alert() {
  local exit_code="$1" message="$2"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # Node constrói+redige+dispara (dynamic import de caminho absoluto). A falha
  # do proprio alerta nunca aborta — o backup e a fonte de verdade.
  ALERT_LIB="$ALERT_LIB" A_EXIT="$exit_code" A_MSG="$message" A_TS="$ts" \
    node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const m = await import(pathToFileURL(process.env.ALERT_LIB).href);
      const alert = m.buildAlert({
        source: "backup",
        status: "failure",
        exitCode: Number(process.env.A_EXIT),
        message: process.env.A_MSG,
        timestamp: process.env.A_TS,
        host: process.env.HOSTNAME || "",
      });
      console.error(m.formatAlertText(alert));
      await m.dispatchAlert(alert, process.env.BACKUP_ALERT_WEBHOOK_URL);
    ' 2>&1 || echo "backup-with-alert: falha ao emitir alerta (ignorada)." >&2
}

if output="$("${SCRIPT_DIR}/backup.sh" 2>&1)"; then
  code=0
else
  code=$?
fi
echo "$output"

if [[ "$code" -ne 0 ]]; then
  emit_alert "$code" "$output"
  exit "$code"
fi

echo "backup-with-alert: backup concluido com sucesso."
exit 0
