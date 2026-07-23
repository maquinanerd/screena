#!/usr/bin/env bash
set -euo pipefail

# verify-backup-restore.sh — prova AUTOMATIZADA de backup + restore com
# FIDELIDADE DE DADOS (Prompt 02). Roda no CI (Linux, com pg_dump/pg_restore/psql
# 16). Nao e checagem de sintaxe: gera dump real, restaura e compara contagens.
#
# Fluxo:
#   1. Sanidade da origem (migrations aplicadas + seed presente).
#   2. scripts/backup/backup.sh  -> dump custom-format + checksum.
#   3. scripts/backup/restore-test.sh (script ENVIADO) deve sair 0.
#   4. Restore proprio numa base efemera + comparacao de contagens de tabelas
#      de aplicacao (origem == restaurado). Dropa a base efemera ao fim.
#
# Requer: DATABASE_URL (origem, ja migrada+seed) e RESTORE_TEST_ADMIN_URL
# (base administrativa isolada). NUNCA escreve na origem.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

need() { command -v "$1" >/dev/null 2>&1 || { echo "verify: comando ausente: $1" >&2; exit 1; }; }
need pg_dump; need pg_restore; need psql

: "${DATABASE_URL:?verify: DATABASE_URL (origem) e obrigatorio}"
: "${RESTORE_TEST_ADMIN_URL:?verify: RESTORE_TEST_ADMIN_URL e obrigatorio}"

scalar() { psql "$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="$2"; }

echo "== 1. sanidade da origem =="
SRC_MIG="$(scalar "$DATABASE_URL" 'SELECT count(*) FROM "_prisma_migrations";')"
SRC_LANG="$(scalar "$DATABASE_URL" 'SELECT count(*) FROM languages;')"
SRC_COUNTRY="$(scalar "$DATABASE_URL" 'SELECT count(*) FROM countries;')"
SRC_LICENSE="$(scalar "$DATABASE_URL" 'SELECT count(*) FROM source_licenses;')"
echo "origem: migrations=$SRC_MIG languages=$SRC_LANG countries=$SRC_COUNTRY source_licenses=$SRC_LICENSE"
[[ "$SRC_MIG" -ge 1 && "$SRC_LANG" -ge 1 ]] || { echo "verify: origem sem migrations/seed — abortando" >&2; exit 1; }

echo "== 2. backup real =="
BACKUP_DIR="$(mktemp -d)"
export BACKUP_DIR
BACKUP_PREFIX="${BACKUP_PREFIX:-cinerie-verify}"
export BACKUP_PREFIX
BACKUP_OFFSITE_RCLONE_REMOTE="" "${SCRIPT_DIR}/backup.sh"
DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' | sort | tail -n1)"
[[ -f "$DUMP" && -f "${DUMP}.sha256" ]] || { echo "verify: dump/checksum nao gerados" >&2; exit 1; }
echo "dump: $DUMP ($(wc -c <"$DUMP") bytes)"

echo "== 3. restore-test.sh (script enviado) deve passar =="
"${SCRIPT_DIR}/restore-test.sh" "$DUMP"
echo "restore-test.sh: OK"

echo "== 4. restore proprio + comparacao de fidelidade =="
VERIFY_DB="cinerie_verify_restore_$(date -u +%Y%m%dT%H%M%SZ)"
admin_base="${RESTORE_TEST_ADMIN_URL%%\?*}"
admin_query=""; [[ "$RESTORE_TEST_ADMIN_URL" == *\?* ]] && admin_query="?${RESTORE_TEST_ADMIN_URL#*\?}"
TARGET_URL="${admin_base%/*}/${VERIFY_DB}${admin_query}"

drop_verify() { psql "$RESTORE_TEST_ADMIN_URL" --set=ON_ERROR_STOP=1 --quiet \
  --command="DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);" >/dev/null 2>&1 || true; }
trap drop_verify EXIT

psql "$RESTORE_TEST_ADMIN_URL" --set=ON_ERROR_STOP=1 --quiet --command="CREATE DATABASE \"$VERIFY_DB\";" >/dev/null
# INVARIANTE (igual a restore-test.sh): sem --clean/--create — so popula base vazia.
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TARGET_URL" "$DUMP"

R_MIG="$(scalar "$TARGET_URL" 'SELECT count(*) FROM "_prisma_migrations";')"
R_LANG="$(scalar "$TARGET_URL" 'SELECT count(*) FROM languages;')"
R_COUNTRY="$(scalar "$TARGET_URL" 'SELECT count(*) FROM countries;')"
R_LICENSE="$(scalar "$TARGET_URL" 'SELECT count(*) FROM source_licenses;')"
echo "restaurado: migrations=$R_MIG languages=$R_LANG countries=$R_COUNTRY source_licenses=$R_LICENSE"

fail=0
[[ "$SRC_MIG" == "$R_MIG" ]] || { echo "FAIL: migrations $SRC_MIG != $R_MIG" >&2; fail=1; }
[[ "$SRC_LANG" == "$R_LANG" ]] || { echo "FAIL: languages $SRC_LANG != $R_LANG" >&2; fail=1; }
[[ "$SRC_COUNTRY" == "$R_COUNTRY" ]] || { echo "FAIL: countries $SRC_COUNTRY != $R_COUNTRY" >&2; fail=1; }
[[ "$SRC_LICENSE" == "$R_LICENSE" ]] || { echo "FAIL: source_licenses $SRC_LICENSE != $R_LICENSE" >&2; fail=1; }
[[ "$fail" -eq 0 ]] || { echo "verify: FIDELIDADE FALHOU" >&2; exit 1; }

echo ""
echo "verify: PASSOU — backup gerado, restaurado e contagens de dados batem (origem == restaurado)."
