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
  # Node constroi+redige+dispara (dynamic import de caminho absoluto).
  #
  # O alerta NAO mascara o exit code do backup: esta chamada roda num
  # SUBPROCESSO, e quem sai deste script e o `exit "$code"` la embaixo. Mas
  # falha de alerta tambem nao pode ser engolida: o backup ja falhou e, se o
  # canal caiu, NINGUEM foi avisado. `dispatchAlert` lanca nesse caso; o `catch`
  # abaixo transforma isso numa linha de diagnostico explicita em stderr.
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
      try {
        await m.dispatchAlert(alert, {
          webhookUrl: process.env.BACKUP_ALERT_WEBHOOK_URL,
          provider: process.env.BACKUP_ALERT_PROVIDER,
          log: () => {},
        });
      } catch (err) {
        // `err.detail` ja vem redigido pela lib; nunca imprimir a URL/segredo.
        console.error(
          `backup-with-alert: ALERTA NAO ENTREGUE (${err.outcome ?? "erro"}): ${err.detail ?? "falha ao despachar"}`,
        );
        process.exit(1);
      }
    ' 2>&1 || {
      echo "backup-with-alert: ALERTA NAO ENTREGUE — o backup falhou e o canal de alerta tambem; ninguem foi notificado." >&2
      echo "backup-with-alert: confira BACKUP_ALERT_WEBHOOK_URL / BACKUP_ALERT_PROVIDER (docs/runbooks/OBSERVABILITY.md)." >&2
    }
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
