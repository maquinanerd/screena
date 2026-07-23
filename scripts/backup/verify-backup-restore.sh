#!/usr/bin/env bash
set -euo pipefail

# verify-backup-restore.sh — prova AUTOMATIZADA de backup + restore com
# COMPARAÇÃO DETERMINÍSTICA DE CONTEÚDO E SCHEMA (Prompt 02). Roda no CI (Linux,
# com pg_dump/pg_restore/psql 16). Não é checagem de sintaxe.
#
# Prova, nesta ordem:
#   1. dump gerado + checksum gerado + checksum VALIDADO (via restore-test.sh);
#   2. restore num PostgreSQL 16 ISOLADO (base efêmera, sem --clean/--create);
#   3. schema íntegro: mesma lista+checksums de migrations, mesmas extensões
#      críticas, mesma assinatura de constraints;
#   4. dados preservados: por tabela seeded, HASH determinístico de conteúdo
#      (ordenado por chave estável) origem == restaurado — não só contagem;
#   5. descarte seguro da base temporária (trap).
#
# Determinismo: PGTZ=UTC fixa a renderização de timestamptz nas duas pontas
# (mesmo servidor, mesma GUC). Nenhum campo é excluído do hash: valores de
# dump/restore são preservados byte-a-byte (não há volatilidade de execução nas
# tabelas de referência); se algum dado volátil for introduzido no futuro,
# exclua-o explicitamente aqui e documente a exclusão.
#
# Requer: DATABASE_URL (origem, migrada+seed) e RESTORE_TEST_ADMIN_URL (base
# administrativa isolada). NUNCA escreve na origem.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGTZ=UTC

need() { command -v "$1" >/dev/null 2>&1 || { echo "verify: comando ausente: $1" >&2; exit 1; }; }
need pg_dump; need pg_restore; need psql

: "${DATABASE_URL:?verify: DATABASE_URL (origem) e obrigatorio}"
: "${RESTORE_TEST_ADMIN_URL:?verify: RESTORE_TEST_ADMIN_URL e obrigatorio}"

# Tabelas seeded comparadas por conteúdo (o seed popula exatamente estas).
SEEDED_TABLES=(languages countries api_providers rating_sources source_licenses)

scalar() { psql "$1" --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="$2"; }

fail=0
check() { # nome  valor_origem  valor_restaurado
  if [[ "$2" == "$3" ]]; then
    echo "  [PASS] $1"
  else
    echo "  [FAIL] $1 — origem='$2' restaurado='$3'" >&2
    fail=1
  fi
}

# Hash determinístico do conteúdo de uma tabela: md5 do agregado das linhas
# (row::text, ordem canônica pelas próprias linhas) — independe de conhecer a PK
# e é estável entre bancos. Retorna também a contagem.
table_content_hash() { # url  tabela  ->  "<hash>|<count>"
  scalar "$1" \
    "SELECT coalesce(md5(string_agg(r, E'\n' ORDER BY r)), 'empty') || '|' || count(*)
     FROM (SELECT t::text AS r FROM ${2} t) s;"
}

echo "== 1. sanidade da origem =="
SRC_MIG_COUNT="$(scalar "$DATABASE_URL" 'SELECT count(*) FROM "_prisma_migrations";')"
echo "origem: migrations=$SRC_MIG_COUNT"
[[ "$SRC_MIG_COUNT" -ge 1 ]] || { echo "verify: origem sem migrations — abortando" >&2; exit 1; }
[[ "$(scalar "$DATABASE_URL" 'SELECT count(*) FROM languages;')" -ge 1 ]] || {
  echo "verify: origem sem seed — abortando" >&2; exit 1; }

# Assinaturas de schema/conteúdo da ORIGEM (calculadas antes do backup).
SRC_MIG_SIG="$(scalar "$DATABASE_URL" \
  'SELECT md5(string_agg(migration_name || '"'"':'"'"' || checksum, '"'"','"'"' ORDER BY migration_name)) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
SRC_MIG_LIST="$(scalar "$DATABASE_URL" \
  'SELECT string_agg(migration_name, '"'"','"'"' ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
SRC_EXT="$(scalar "$DATABASE_URL" "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension;")"
SRC_CONSTR="$(scalar "$DATABASE_URL" \
  "SELECT md5(string_agg(conname || ':' || contype::text, ',' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'public'::regnamespace;")"
declare -A SRC_TBL
for t in "${SEEDED_TABLES[@]}"; do SRC_TBL[$t]="$(table_content_hash "$DATABASE_URL" "$t")"; done

echo "== 2. backup real (dump + checksum) =="
BACKUP_DIR="$(mktemp -d)"; export BACKUP_DIR
BACKUP_PREFIX="${BACKUP_PREFIX:-cinerie-verify}"; export BACKUP_PREFIX
BACKUP_OFFSITE_RCLONE_REMOTE="" "${SCRIPT_DIR}/backup.sh"
DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' | sort | tail -n1)"
[[ -f "$DUMP" ]] || { echo "verify: dump nao gerado" >&2; exit 1; }
[[ -f "${DUMP}.sha256" ]] || { echo "verify: checksum nao gerado" >&2; exit 1; }
echo "dump: $DUMP ($(wc -c <"$DUMP") bytes) + checksum"

echo "== 3. restore-test.sh (script enviado: valida checksum + restaura + dropa) =="
"${SCRIPT_DIR}/restore-test.sh" "$DUMP"
echo "restore-test.sh: OK"

echo "== 4. restore proprio isolado + comparacao determinista =="
VERIFY_DB="cinerie_verify_restore_$(date -u +%Y%m%dT%H%M%SZ)"
admin_base="${RESTORE_TEST_ADMIN_URL%%\?*}"
admin_query=""; [[ "$RESTORE_TEST_ADMIN_URL" == *\?* ]] && admin_query="?${RESTORE_TEST_ADMIN_URL#*\?}"
TARGET_URL="${admin_base%/*}/${VERIFY_DB}${admin_query}"

drop_verify() { psql "$RESTORE_TEST_ADMIN_URL" --set=ON_ERROR_STOP=1 --quiet \
  --command="DROP DATABASE IF EXISTS \"$VERIFY_DB\" WITH (FORCE);" >/dev/null 2>&1 || true; }
trap drop_verify EXIT

psql "$RESTORE_TEST_ADMIN_URL" --set=ON_ERROR_STOP=1 --quiet --command="CREATE DATABASE \"$VERIFY_DB\";" >/dev/null
# INVARIANTE (igual a restore-test.sh): sem --clean/--create — só popula base vazia.
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TARGET_URL" "$DUMP"

echo "-- schema --"
R_MIG_SIG="$(scalar "$TARGET_URL" 'SELECT md5(string_agg(migration_name || '"'"':'"'"' || checksum, '"'"','"'"' ORDER BY migration_name)) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
R_MIG_LIST="$(scalar "$TARGET_URL" 'SELECT string_agg(migration_name, '"'"','"'"' ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')"
R_EXT="$(scalar "$TARGET_URL" "SELECT string_agg(extname, ',' ORDER BY extname) FROM pg_extension;")"
R_CONSTR="$(scalar "$TARGET_URL" "SELECT md5(string_agg(conname || ':' || contype::text, ',' ORDER BY conname)) FROM pg_constraint WHERE connamespace = 'public'::regnamespace;")"
check "migrations: lista aplicada" "$SRC_MIG_LIST" "$R_MIG_LIST"
check "migrations: checksums (hash)" "$SRC_MIG_SIG" "$R_MIG_SIG"
check "extensoes (inclui pgcrypto)" "$SRC_EXT" "$R_EXT"
case ",$R_EXT," in *,pgcrypto,*) echo "  [PASS] pgcrypto presente";; *) echo "  [FAIL] pgcrypto ausente" >&2; fail=1;; esac
check "constraints do schema public (assinatura)" "$SRC_CONSTR" "$R_CONSTR"

echo "-- conteudo (hash determinista por tabela) --"
for t in "${SEEDED_TABLES[@]}"; do
  check "tabela $t (hash|count)" "${SRC_TBL[$t]}" "$(table_content_hash "$TARGET_URL" "$t")"
done

echo ""
if [[ "$fail" -ne 0 ]]; then
  echo "verify: FALHOU — schema/conteudo divergem entre origem e restaurado." >&2
  exit 1
fi
echo "verify: PASSOU — dump+checksum validados, schema integro (migrations/extensoes/constraints)"
echo "        e conteudo IDENTICO (hash determinista) origem == restaurado; base temporaria descartada."
