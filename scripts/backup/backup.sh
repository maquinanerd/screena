#!/usr/bin/env bash
set -euo pipefail

# Backup logico do PostgreSQL para o Cinerie.
# Requer DATABASE_URL em env. Nunca escreva credenciais neste arquivo.

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "backup: comando obrigatorio ausente: $1." >&2
    if [[ -n "${2:-}" ]]; then
      echo "backup: $2" >&2
    fi
    exit 1
  fi
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup: DATABASE_URL e obrigatorio." >&2
  echo "backup: exporte a connection string da base de origem antes de rodar." >&2
  exit 1
fi

require_cmd pg_dump "instale o cliente do PostgreSQL (ex.: apt-get install postgresql-client)."

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
BACKUP_PREFIX="${BACKUP_PREFIX:-screen-postgres}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# So endurece a permissao do diretorio que este script criou. Um `chmod 700`
# incondicional sobre um BACKUP_DIR mal configurado (ex.: typo em /home/screen)
# reescreveria o modo de um diretorio alheio.
if [[ ! -d "$BACKUP_DIR" ]]; then
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
fi

DUMP_PATH="${BACKUP_DIR}/${BACKUP_PREFIX}-${TIMESTAMP}.dump"
CHECKSUM_PATH="${DUMP_PATH}.sha256"
TMP_PATH="${DUMP_PATH}.tmp"

cleanup() {
  rm -f "$TMP_PATH"
}
trap cleanup EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="$DATABASE_URL" \
  --file="$TMP_PATH"

mv "$TMP_PATH" "$DUMP_PATH"
chmod 600 "$DUMP_PATH"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && sha256sum "$(basename "$DUMP_PATH")" > "$(basename "$CHECKSUM_PATH")")
elif command -v shasum >/dev/null 2>&1; then
  (cd "$BACKUP_DIR" && shasum -a 256 "$(basename "$DUMP_PATH")" > "$(basename "$CHECKSUM_PATH")")
else
  echo "backup: sha256sum ou shasum e obrigatorio para gerar checksum." >&2
  exit 1
fi
chmod 600 "$CHECKSUM_PATH"

# Copia off-site opcional. Exemplo:
#   BACKUP_OFFSITE_RCLONE_REMOTE="s3:screen-backups/postgres" scripts/backup/backup.sh
if [[ -n "${BACKUP_OFFSITE_RCLONE_REMOTE:-}" ]]; then
  require_cmd rclone "BACKUP_OFFSITE_RCLONE_REMOTE esta definido; instale e configure o rclone."
  rclone copyto "$DUMP_PATH" "${BACKUP_OFFSITE_RCLONE_REMOTE}/$(basename "$DUMP_PATH")"
  rclone copyto "$CHECKSUM_PATH" "${BACKUP_OFFSITE_RCLONE_REMOTE}/$(basename "$CHECKSUM_PATH")"
else
  echo "backup: BACKUP_OFFSITE_RCLONE_REMOTE nao definido; copia off-site pulada." >&2
fi

echo "backup: dump criado em $DUMP_PATH"
echo "backup: checksum criado em $CHECKSUM_PATH"
