#!/usr/bin/env bash
set -euo pipefail

# Teste de restore do ultimo dump.
# Cria uma base efemera, restaura o dump, valida content_blocks e derruba a base.

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
RESTORE_TEST_DB_NAME="${RESTORE_TEST_DB_NAME:-screen_restore_test_$(date -u +%Y%m%dT%H%M%SZ)}"

if [[ -z "${RESTORE_TEST_ADMIN_URL:-}" ]]; then
  cat >&2 <<'MSG'
restore-test: RESTORE_TEST_ADMIN_URL e obrigatorio.
Use uma connection string para uma base administrativa isolada, por exemplo:
  RESTORE_TEST_ADMIN_URL="postgresql://user:pass@localhost:5432/postgres"
MSG
  exit 1
fi

LATEST_DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print | sort | tail -n 1)"
if [[ -z "$LATEST_DUMP" ]]; then
  echo "restore-test: nenhum dump encontrado em $BACKUP_DIR." >&2
  exit 1
fi

CHECKSUM_PATH="${LATEST_DUMP}.sha256"
if [[ ! -f "$CHECKSUM_PATH" ]]; then
  echo "restore-test: checksum ausente: $CHECKSUM_PATH" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$(dirname "$LATEST_DUMP")" && sha256sum -c "$(basename "$CHECKSUM_PATH")")
elif command -v shasum >/dev/null 2>&1; then
  expected="$(awk '{print $1}' "$CHECKSUM_PATH")"
  actual="$(shasum -a 256 "$LATEST_DUMP" | awk '{print $1}')"
  if [[ "$expected" != "$actual" ]]; then
    echo "restore-test: checksum divergente para $LATEST_DUMP." >&2
    exit 1
  fi
else
  echo "restore-test: sha256sum ou shasum e obrigatorio para validar checksum." >&2
  exit 1
fi

TARGET_URL="${RESTORE_TEST_DATABASE_URL:-${RESTORE_TEST_ADMIN_URL%/*}/${RESTORE_TEST_DB_NAME}}"

drop_test_db() {
  psql "$RESTORE_TEST_ADMIN_URL" \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DROP DATABASE IF EXISTS \"$RESTORE_TEST_DB_NAME\" WITH (FORCE);" >/dev/null
}
trap drop_test_db EXIT

psql "$RESTORE_TEST_ADMIN_URL" \
  --set=ON_ERROR_STOP=1 \
  --quiet \
  --command="DROP DATABASE IF EXISTS \"$RESTORE_TEST_DB_NAME\" WITH (FORCE);" >/dev/null

psql "$RESTORE_TEST_ADMIN_URL" \
  --set=ON_ERROR_STOP=1 \
  --quiet \
  --command="CREATE DATABASE \"$RESTORE_TEST_DB_NAME\";" >/dev/null

pg_restore \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --dbname="$TARGET_URL" \
  "$LATEST_DUMP"

CONTENT_BLOCK_COUNT="$(
  psql "$TARGET_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --command='SELECT count(*) FROM content_blocks;'
)"

echo "restore-test: dump restaurado: $LATEST_DUMP"
echo "restore-test: content_blocks=${CONTENT_BLOCK_COUNT}"
