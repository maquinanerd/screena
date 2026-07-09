#!/usr/bin/env bash
set -euo pipefail

# Teste de restore de um dump. Sem argumento, usa o dump mais recente de
# BACKUP_DIR; com argumento, usa o caminho informado.
#
#   scripts/backup/restore-test.sh
#   scripts/backup/restore-test.sh /caminho/screen-postgres-20260709T031500Z.dump
#
# Cria uma base efemera, restaura o dump, valida contagens e derruba a base.
# Jamais escreve na base de origem: so RESTORE_TEST_ADMIN_URL e a base efemera.

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "restore-test: comando obrigatorio ausente: $1." >&2
    echo "restore-test: instale o cliente do PostgreSQL (ex.: apt-get install postgresql-client)." >&2
    exit 1
  fi
}

require_cmd pg_restore
require_cmd psql

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
DUMP_ARG="${1:-}"
RESTORE_TEST_DB_NAME="${RESTORE_TEST_DB_NAME:-screen_restore_test_$(date -u +%Y%m%dT%H%M%SZ)}"

# Formato estrito: o nome e interpolado dentro de um identificador SQL entre
# aspas. Um glob de prefixo aceitaria aspas embutidas; este regex nao.
if [[ ! "$RESTORE_TEST_DB_NAME" =~ ^screen_restore_test_[A-Za-z0-9_]+$ ]]; then
  echo "restore-test: RESTORE_TEST_DB_NAME deve casar ^screen_restore_test_[A-Za-z0-9_]+\$." >&2
  exit 1
fi

if [[ -z "${RESTORE_TEST_ADMIN_URL:-}" ]]; then
  cat >&2 <<'MSG'
restore-test: RESTORE_TEST_ADMIN_URL e obrigatorio.
Use uma connection string para uma base administrativa isolada, por exemplo:
  RESTORE_TEST_ADMIN_URL="postgresql://user:pass@localhost:5432/postgres"
MSG
  exit 1
fi

if [[ -n "$DUMP_ARG" ]]; then
  if [[ ! -f "$DUMP_ARG" ]]; then
    echo "restore-test: dump nao encontrado: $DUMP_ARG" >&2
    exit 1
  fi
  LATEST_DUMP="$DUMP_ARG"
else
  LATEST_DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print | sort | tail -n 1)"
  if [[ -z "$LATEST_DUMP" ]]; then
    echo "restore-test: nenhum dump encontrado em $BACKUP_DIR." >&2
    echo "restore-test: rode scripts/backup/backup.sh ou passe o caminho do dump como argumento." >&2
    exit 1
  fi
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

# Troca so o nome da base na URL administrativa, preservando a query string
# (ex.: `?sslmode=require`, exigido por Postgres gerenciado).
derive_target_url() {
  local admin="$1" db="$2" base="" query=""
  case "$admin" in
    *\?*)
      base="${admin%%\?*}"
      query="?${admin#*\?}"
      ;;
    *) base="$admin" ;;
  esac
  printf '%s/%s%s' "${base%/*}" "$db" "$query"
}

# dbname efetivo da URL: ultimo segmento do path, ja sem a query string. Comparar
# por igualdade evita a URL forjada que apenas *termina* com o nome esperado
# (ex.: `.../screen?application_name=x/screen_restore_test_1`), cujo dbname real
# seria a base de producao.
url_dbname() {
  local path="${1%%\?*}"
  printf '%s' "${path##*/}"
}

TARGET_URL="${RESTORE_TEST_DATABASE_URL:-$(derive_target_url "$RESTORE_TEST_ADMIN_URL" "$RESTORE_TEST_DB_NAME")}"

if [[ -n "${RESTORE_TEST_DATABASE_URL:-}" ]]; then
  if [[ "$(url_dbname "$RESTORE_TEST_DATABASE_URL")" != "$RESTORE_TEST_DB_NAME" ]]; then
    echo "restore-test: RESTORE_TEST_DATABASE_URL deve apontar para a base $RESTORE_TEST_DB_NAME." >&2
    exit 1
  fi
fi

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

# INVARIANTE: nunca adicionar `--clean` nem `--create` aqui. Sem eles, o restore
# so popula uma base recem-criada e vazia. Com `--clean`, um TARGET_URL que
# resolvesse para uma base povoada teria seus objetos dropados — e este script
# passaria de teste de restore a destruidor de dados.
pg_restore \
  --no-owner \
  --no-acl \
  --exit-on-error \
  --dbname="$TARGET_URL" \
  "$LATEST_DUMP"

run_scalar() {
  psql "$TARGET_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --command="$1"
}

TABLE_COUNT="$(run_scalar 'SELECT count(*) FROM information_schema.tables;')"
MIGRATION_COUNT="$(run_scalar 'SELECT count(*) FROM "_prisma_migrations";')"

# content_blocks so e contado quando a tabela existe: um dump anterior a essa
# migration continua sendo um restore valido, nao uma falha do teste.
if [[ "$(run_scalar "SELECT to_regclass('public.content_blocks') IS NOT NULL;")" == "t" ]]; then
  CONTENT_BLOCK_COUNT="$(run_scalar 'SELECT count(*) FROM content_blocks;')"
else
  CONTENT_BLOCK_COUNT="tabela ausente"
fi

echo "restore-test: dump restaurado: $LATEST_DUMP"
echo "restore-test: information_schema.tables=${TABLE_COUNT}"
echo "restore-test: _prisma_migrations=${MIGRATION_COUNT}"
echo "restore-test: content_blocks=${CONTENT_BLOCK_COUNT}"
