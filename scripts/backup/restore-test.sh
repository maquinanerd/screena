#!/usr/bin/env bash
set -euo pipefail

# Teste de restore de um dump. Sem argumento, usa o dump mais recente de
# BACKUP_DIR; com argumento, usa o caminho informado.
#
#   scripts/backup/restore-test.sh
#   scripts/backup/restore-test.sh /caminho/screen-postgres-20260709T031500Z.dump
#
# Cria uma base efemera, restaura o dump, COMPARA o banco restaurado com o que o
# dump declara conter e derruba a base. Jamais escreve na base de origem: so
# RESTORE_TEST_ADMIN_URL e a base efemera.
#
# O QUE E COMPARADO (e nao apenas impresso):
#   1. conjunto de TABELAS        — CREATE TABLE do dump  x  pg_class
#   2. CONTAGEM DE LINHAS         — blocos COPY do dump    x  count(*) por tabela
#   3. conjunto de INDICES        — CREATE INDEX do dump   x  pg_index
#   4. conjunto de CONSTRAINTS    — ADD CONSTRAINT do dump x  pg_constraint (p/f/u/x)
#
# Qualquer divergencia imprime a tabela/objeto e os DOIS numeros, e o script sai
# com codigo != 0. Um teste de restore que so imprime contagens nao prova
# restore nenhum — prova que o `echo` funciona.
#
# O "esperado" e derivado do PROPRIO dump (`pg_restore --file=-`), antes de
# restaurar. Nao existe baseline versionado no repositorio e o script nao abre
# conexao com a base de origem: o dump e o unico contrato disponivel no momento
# do teste. A comparacao origem-viva x restaurado, mais forte, vive em
# `scripts/backup/verify-backup-restore.sh` (roda na CI, com a origem parada).
#
# Custo: o dump e lido DUAS vezes (uma para o manifesto, uma para o restore).
# E o preco de ter um "esperado" independente do banco que acabou de ser escrito.

# Ordenacao byte-a-byte nos dois lados da comparacao: `sort`/`comm` e a saida do
# psql precisam concordar. Sem isso, uma diferenca de collation vira divergencia
# fantasma.
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_AWK="${SCRIPT_DIR}/lib/dump-manifest.awk"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "restore-test: comando obrigatorio ausente: $1." >&2
    echo "restore-test: instale o cliente do PostgreSQL (ex.: apt-get install postgresql-client)." >&2
    exit 1
  fi
}

require_cmd pg_restore
require_cmd psql
require_cmd awk
require_cmd sort
require_cmd comm

if [[ ! -f "$MANIFEST_AWK" ]]; then
  echo "restore-test: parser do manifesto ausente: $MANIFEST_AWK" >&2
  echo "restore-test: rode o script a partir do checkout completo do repositorio." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
DUMP_ARG="${1:-}"
RESTORE_TEST_DB_NAME="${RESTORE_TEST_DB_NAME:-screen_restore_test_$(date -u +%Y%m%dT%H%M%SZ)}"

# Formato estrito: o nome e interpolado dentro de um identificador SQL entre
# aspas. Um glob de prefixo aceitaria aspas embutidas; este regex nao.
if [[ ! "$RESTORE_TEST_DB_NAME" =~ ^screen_restore_test_[A-Za-z0-9_]+$ ]]; then
  echo "restore-test: RESTORE_TEST_DB_NAME deve casar ^screen_restore_test_[A-Za-z0-9_]+\$." >&2
  exit 1
fi

# Controle negativo: injeta uma divergencia NO BANCO RESTAURADO depois do
# restore e antes da comparacao. Serve para provar que a comparacao morde — se
# o script continuar verde com a divergencia injetada, a comparacao e decorativa.
# So pode tocar a base efemera (o nome e travado pelo regex acima).
INJECT_DIVERGENCE="${RESTORE_TEST_INJECT_DIVERGENCE:-none}"
case "$INJECT_DIVERGENCE" in
  none | row | table | index | constraint) ;;
  *)
    echo "restore-test: RESTORE_TEST_INJECT_DIVERGENCE invalido: '$INJECT_DIVERGENCE'." >&2
    echo "restore-test: valores aceitos: none, row, table, index, constraint." >&2
    exit 1
    ;;
esac

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

MANIFEST_DIR="$(mktemp -d)"
EXPECTED_TABLES="${MANIFEST_DIR}/expected-tables.txt"
EXPECTED_ROWS="${MANIFEST_DIR}/expected-rows.txt"
EXPECTED_INDEXES="${MANIFEST_DIR}/expected-indexes.txt"
EXPECTED_CONSTRAINTS="${MANIFEST_DIR}/expected-constraints.txt"
ACTUAL_TABLES="${MANIFEST_DIR}/actual-tables.txt"
ACTUAL_ROWS="${MANIFEST_DIR}/actual-rows.txt"
ACTUAL_INDEXES="${MANIFEST_DIR}/actual-indexes.txt"
ACTUAL_CONSTRAINTS="${MANIFEST_DIR}/actual-constraints.txt"

drop_test_db() {
  psql "$RESTORE_TEST_ADMIN_URL" \
    --set=ON_ERROR_STOP=1 \
    --quiet \
    --command="DROP DATABASE IF EXISTS \"$RESTORE_TEST_DB_NAME\" WITH (FORCE);" >/dev/null
}

cleanup() {
  local rc=$?
  # Falhar em derrubar a base efemera nao pode ser silencioso: o checklist de
  # operacao exige que nenhum `screen_restore_test_*` sobre no servidor.
  if ! drop_test_db; then
    echo "restore-test: AVISO — nao consegui derrubar a base efemera $RESTORE_TEST_DB_NAME; derrube manualmente." >&2
  fi
  if [[ "${RESTORE_TEST_KEEP_MANIFEST:-0}" == "1" ]]; then
    echo "restore-test: manifestos preservados em $MANIFEST_DIR (RESTORE_TEST_KEEP_MANIFEST=1)." >&2
  else
    rm -rf "$MANIFEST_DIR"
  fi
  return "$rc"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 1. Manifesto ESPERADO, derivado do dump (antes de restaurar).
# ---------------------------------------------------------------------------

: >"$EXPECTED_TABLES"
: >"$EXPECTED_ROWS"
: >"$EXPECTED_INDEXES"
: >"$EXPECTED_CONSTRAINTS"

# `tr -d '\r'` e no-op no Linux e obrigatorio no Windows, onde o pg_restore
# escreve CRLF em stdout — o terminador `\.` do bloco COPY viraria `\.\r` e o
# parser leria o dump inteiro como dado. No formato TEXT do COPY um CR real vem
# escapado como `\r` (dois caracteres), entao nenhum byte de dado e perdido.
pg_restore --no-owner --no-acl --file=- "$LATEST_DUMP" |
  tr -d '\r' |
  awk \
    -v tables_out="$EXPECTED_TABLES" \
    -v rows_out="$EXPECTED_ROWS" \
    -v indexes_out="$EXPECTED_INDEXES" \
    -v constraints_out="$EXPECTED_CONSTRAINTS" \
    -f "$MANIFEST_AWK"

sort -u -o "$EXPECTED_TABLES" "$EXPECTED_TABLES"
sort -u -o "$EXPECTED_INDEXES" "$EXPECTED_INDEXES"
sort -u -o "$EXPECTED_CONSTRAINTS" "$EXPECTED_CONSTRAINTS"
sort -u -o "$EXPECTED_ROWS" "$EXPECTED_ROWS"

EXPECTED_TABLE_TOTAL="$(wc -l <"$EXPECTED_TABLES" | tr -d '[:space:]')"

# Dump que nao declara NENHUMA tabela nao pode produzir verde. Sem esta guarda,
# um arquivo vazio/truncado casaria com uma base vazia e o teste "passaria".
if [[ "$EXPECTED_TABLE_TOTAL" -lt 1 ]]; then
  echo "restore-test: o dump $LATEST_DUMP nao declara nenhuma tabela — nada a restaurar." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Base efemera + restore.
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# 3. Controle negativo opcional: estraga o RESTAURADO de proposito.
# ---------------------------------------------------------------------------

inject_divergence() {
  echo "restore-test: ATENCAO — injetando divergencia '$INJECT_DIVERGENCE' na base efemera $RESTORE_TEST_DB_NAME." >&2
  echo "restore-test: isto e um CONTROLE NEGATIVO; o script DEVE terminar com codigo != 0." >&2

  case "$INJECT_DIVERGENCE" in
    row)
      psql "$TARGET_URL" --set=ON_ERROR_STOP=1 --quiet --file=- <<'SQL'
DO $$
DECLARE r record;
BEGIN
  SELECT n.nspname AS s, c.relname AS t INTO r
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\_%'
    AND (xpath('/row/cnt/text()',
               query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', n.nspname, c.relname),
                            false, true, '')))[1]::text::bigint > 0
  ORDER BY 1, 2
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'nenhuma tabela povoada para injetar divergencia'; END IF;
  EXECUTE format('DELETE FROM %I.%I WHERE ctid IN (SELECT ctid FROM %I.%I LIMIT 1)', r.s, r.t, r.s, r.t);
  RAISE NOTICE 'injetado: 1 linha removida de %.%', r.s, r.t;
END
$$;
SQL
      ;;
    table)
      psql "$TARGET_URL" --set=ON_ERROR_STOP=1 --quiet --file=- <<'SQL'
DO $$
DECLARE r record;
BEGIN
  SELECT n.nspname AS s, c.relname AS t INTO r
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\_%'
    AND c.relname <> '_prisma_migrations'
  ORDER BY 1, 2
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'nenhuma tabela para injetar divergencia'; END IF;
  EXECUTE format('DROP TABLE %I.%I CASCADE', r.s, r.t);
  RAISE NOTICE 'injetado: tabela %.% removida', r.s, r.t;
END
$$;
SQL
      ;;
    index)
      psql "$TARGET_URL" --set=ON_ERROR_STOP=1 --quiet --file=- <<'SQL'
DO $$
DECLARE r record;
BEGIN
  SELECT n.nspname AS s, ic.relname AS i INTO r
  FROM pg_index x
  JOIN pg_class ic ON ic.oid = x.indexrelid
  JOIN pg_class tc ON tc.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = tc.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\_%'
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.conindid = x.indexrelid AND k.contype IN ('p', 'u', 'x')
    )
  ORDER BY 1, 2
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'nenhum indice avulso para injetar divergencia'; END IF;
  EXECUTE format('DROP INDEX %I.%I', r.s, r.i);
  RAISE NOTICE 'injetado: indice %.% removido', r.s, r.i;
END
$$;
SQL
      ;;
    constraint)
      psql "$TARGET_URL" --set=ON_ERROR_STOP=1 --quiet --file=- <<'SQL'
DO $$
DECLARE r record;
BEGIN
  SELECT n.nspname AS s, t.relname AS t, k.conname AS c INTO r
  FROM pg_constraint k
  JOIN pg_class t ON t.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE k.contype = 'f'
    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND n.nspname NOT LIKE 'pg\_%'
  ORDER BY 1, 2, 3
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'nenhuma FK para injetar divergencia'; END IF;
  EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.s, r.t, r.c);
  RAISE NOTICE 'injetado: constraint %.% removida', r.s, r.c;
END
$$;
SQL
      ;;
  esac
}

if [[ "$INJECT_DIVERGENCE" != "none" ]]; then
  # Cinto e suspensorio: a injecao so pode tocar a base efemera.
  if [[ ! "$RESTORE_TEST_DB_NAME" =~ ^screen_restore_test_ ]]; then
    echo "restore-test: recusando injetar divergencia fora da base efemera." >&2
    exit 1
  fi
  inject_divergence
fi

# ---------------------------------------------------------------------------
# 4. Manifesto REAL, lido do banco restaurado.
# ---------------------------------------------------------------------------

query_list() { # sql -> uma linha por item, ja ordenado byte-a-byte
  psql "$TARGET_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --command="$1" |
    tr -d '\r' |
    sed '/^$/d' |
    sort -u
}

SQL_TABLES=$(
  cat <<'SQL'
SELECT n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  );
SQL
)

# Parent particionado (relkind 'p') fica de fora: os dados dele vivem nas
# particoes, que tem bloco COPY proprio no dump. Conta-lo duplicaria as linhas.
SQL_ROWS=$(
  cat <<'SQL'
SELECT n.nspname || '.' || c.relname || E'\t' ||
       (xpath('/row/cnt/text()',
              query_to_xml(format('SELECT count(*) AS cnt FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
  );
SQL
)

SQL_INDEXES=$(
  cat <<'SQL'
SELECT n.nspname || '.' || ic.relname
FROM pg_index x
JOIN pg_class ic ON ic.oid = x.indexrelid
JOIN pg_class tc ON tc.oid = x.indrelid
JOIN pg_namespace n ON n.oid = tc.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%'
  -- So indices DE CONSTRAINT saem daqui (p/u/x sao donos do proprio indice).
  -- `conindid` de uma FOREIGN KEY aponta para o indice unico REFERENCIADO, que
  -- continua sendo um `CREATE UNIQUE INDEX` do dump: filtrar por `conindid` sem
  -- olhar `contype` sumiria com ele e inventaria divergencia.
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint k
    WHERE k.conindid = x.indexrelid AND k.contype IN ('p', 'u', 'x')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = ic.oid AND d.deptype = 'e'
  );
SQL
)

SQL_CONSTRAINTS=$(
  cat <<'SQL'
SELECT n.nspname || '.' || k.conname
FROM pg_constraint k
JOIN pg_namespace n ON n.oid = k.connamespace
WHERE k.contype IN ('p', 'f', 'u', 'x')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_%';
SQL
)

query_list "$SQL_TABLES" >"$ACTUAL_TABLES"
query_list "$SQL_ROWS" >"$ACTUAL_ROWS"
query_list "$SQL_INDEXES" >"$ACTUAL_INDEXES"
query_list "$SQL_CONSTRAINTS" >"$ACTUAL_CONSTRAINTS"

# ---------------------------------------------------------------------------
# 5. Comparacao. Toda falha nomeia o objeto e, quando ha numero, os DOIS numeros.
# ---------------------------------------------------------------------------

FAIL_TABLES=0
FAIL_ROWS=0
FAIL_INDEXES=0
FAIL_CONSTRAINTS=0

compare_sets() { # rotulo  esperado_file  atual_file  -> ecoa divergencias, retorna a contagem
  local label="$1" expected="$2" actual="$3" item n=0
  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    echo "restore-test: [FALHA] ${label} ausente no restaurado: ${item} (declarado no dump)" >&2
    n=$((n + 1))
  done < <(comm -23 "$expected" "$actual")
  while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    echo "restore-test: [FALHA] ${label} inesperado no restaurado: ${item} (nao existe no dump)" >&2
    n=$((n + 1))
  done < <(comm -13 "$expected" "$actual")
  printf '%s' "$n"
}

FAIL_TABLES="$(compare_sets 'tabela' "$EXPECTED_TABLES" "$ACTUAL_TABLES")"
FAIL_INDEXES="$(compare_sets 'indice' "$EXPECTED_INDEXES" "$ACTUAL_INDEXES")"
FAIL_CONSTRAINTS="$(compare_sets 'constraint' "$EXPECTED_CONSTRAINTS" "$ACTUAL_CONSTRAINTS")"

declare -A EXPECTED_ROW_COUNT
declare -A ACTUAL_ROW_COUNT

while IFS=$'\t' read -r name value; do
  [[ -z "$name" ]] && continue
  EXPECTED_ROW_COUNT["$name"]="$value"
done <"$EXPECTED_ROWS"

while IFS=$'\t' read -r name value; do
  [[ -z "$name" ]] && continue
  ACTUAL_ROW_COUNT["$name"]="$value"
done <"$ACTUAL_ROWS"

TOTAL_ROWS=0
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  actual_rows="${ACTUAL_ROW_COUNT[$table]:-}"
  # Sem contagem do lado do banco = parent particionado (os dados estao nas
  # particoes). Tabela ausente/inesperada ja foi reportada em compare_sets.
  [[ -z "$actual_rows" ]] && continue
  expected_rows="${EXPECTED_ROW_COUNT[$table]:-0}"
  TOTAL_ROWS=$((TOTAL_ROWS + actual_rows))
  if [[ "$expected_rows" != "$actual_rows" ]]; then
    echo "restore-test: [FALHA] linhas divergem em ${table} — dump=${expected_rows} restaurado=${actual_rows}" >&2
    FAIL_ROWS=$((FAIL_ROWS + 1))
  fi
done < <(comm -12 "$EXPECTED_TABLES" "$ACTUAL_TABLES")

# ---------------------------------------------------------------------------
# 6. Assertivas de aplicacao (o dump precisa ser um dump da Cinerie).
# ---------------------------------------------------------------------------

run_scalar() {
  psql "$TARGET_URL" \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --command="$1" | tr -d '\r'
}

FAIL_APP=0

TABLE_COUNT="$(run_scalar 'SELECT count(*) FROM information_schema.tables;')"

if [[ "$(run_scalar "SELECT to_regclass('public._prisma_migrations') IS NOT NULL;")" == "t" ]]; then
  MIGRATION_COUNT="$(run_scalar 'SELECT count(*) FROM "_prisma_migrations";')"
  if [[ "$MIGRATION_COUNT" -lt 1 ]]; then
    echo "restore-test: [FALHA] _prisma_migrations existe mas esta vazia (0 migrations aplicadas)." >&2
    FAIL_APP=$((FAIL_APP + 1))
  fi
else
  MIGRATION_COUNT="tabela ausente"
  echo "restore-test: [FALHA] _prisma_migrations ausente no restaurado — o dump nao e de uma base da Cinerie." >&2
  FAIL_APP=$((FAIL_APP + 1))
fi

# content_blocks so e contado quando a tabela existe: um dump anterior a essa
# migration continua sendo um restore valido, nao uma falha do teste.
if [[ "$(run_scalar "SELECT to_regclass('public.content_blocks') IS NOT NULL;")" == "t" ]]; then
  CONTENT_BLOCK_COUNT="$(run_scalar 'SELECT count(*) FROM content_blocks;')"
else
  CONTENT_BLOCK_COUNT="tabela ausente"
fi

# ---------------------------------------------------------------------------
# 7. Veredito.
# ---------------------------------------------------------------------------

echo "restore-test: dump restaurado: $LATEST_DUMP"
echo "restore-test: information_schema.tables=${TABLE_COUNT}"
echo "restore-test: _prisma_migrations=${MIGRATION_COUNT}"
echo "restore-test: content_blocks=${CONTENT_BLOCK_COUNT}"

TOTAL_DIVERGENCES=$((FAIL_TABLES + FAIL_ROWS + FAIL_INDEXES + FAIL_CONSTRAINTS + FAIL_APP))

if [[ "$TOTAL_DIVERGENCES" -ne 0 ]]; then
  echo "restore-test: DIVERGENCIA — ${FAIL_TABLES} tabela(s), ${FAIL_ROWS} contagem(ns) de linhas, ${FAIL_INDEXES} indice(s), ${FAIL_CONSTRAINTS} constraint(s), ${FAIL_APP} assertiva(s) de aplicacao." >&2
  echo "restore-test: o restore NAO reproduz o dump. Nao trate este backup como valido." >&2
  exit 1
fi

echo "restore-test: OK — restaurado confere com o dump:"
echo "restore-test:   tabelas=$(wc -l <"$ACTUAL_TABLES" | tr -d '[:space:]')" \
  "linhas=${TOTAL_ROWS}" \
  "indices=$(wc -l <"$ACTUAL_INDEXES" | tr -d '[:space:]')" \
  "constraints=$(wc -l <"$ACTUAL_CONSTRAINTS" | tr -d '[:space:]')"
