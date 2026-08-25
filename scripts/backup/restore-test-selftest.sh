#!/usr/bin/env bash
set -euo pipefail

# restore-test-selftest.sh — CONTROLE NEGATIVO EXECUTAVEL do restore-test.sh.
#
# Um teste de restore so vale se ele souber ficar VERMELHO. Este script prova
# isso de forma mecanica: roda o `restore-test.sh` cinco vezes contra o MESMO
# dump — uma limpa e quatro com uma divergencia injetada de proposito na base
# restaurada — e exige o desfecho correto em cada caso:
#
#   | caso        | o que e estragado no restaurado      | exit esperado |
#   |-------------|--------------------------------------|---------------|
#   | (limpo)     | nada                                 | 0             |
#   | row         | 1 linha apagada de uma tabela        | != 0          |
#   | table       | 1 tabela dropada                     | != 0          |
#   | index       | 1 indice avulso dropado              | != 0          |
#   | constraint  | 1 foreign key dropada                | != 0          |
#
# Nao basta sair != 0: cada caso tambem exige a MENSAGEM de diagnostico
# correspondente. Sem isso, uma injecao que falhasse por conta propria (ex.:
# dump sem nenhuma FK) produziria um vermelho pelo motivo errado e o controle
# passaria achando que a comparacao mordeu.
#
# Uso:
#   RESTORE_TEST_ADMIN_URL=... DATABASE_URL=... scripts/backup/restore-test-selftest.sh
#   RESTORE_TEST_ADMIN_URL=... scripts/backup/restore-test-selftest.sh /caminho/x.dump
#
# Sem dump informado: usa o mais recente de BACKUP_DIR; se nao houver, gera um
# com o backup.sh a partir de DATABASE_URL. NUNCA escreve na origem.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_TEST="${SCRIPT_DIR}/restore-test.sh"

: "${RESTORE_TEST_ADMIN_URL:?selftest: RESTORE_TEST_ADMIN_URL e obrigatorio}"

TMP_BACKUP_DIR=""
cleanup() {
  [[ -n "$TMP_BACKUP_DIR" ]] && rm -rf "$TMP_BACKUP_DIR"
  return 0
}
trap cleanup EXIT

DUMP="${1:-}"

if [[ -z "$DUMP" ]]; then
  CANDIDATE_DIR="${BACKUP_DIR:-./backups/postgres}"
  if [[ -d "$CANDIDATE_DIR" ]]; then
    DUMP="$(find "$CANDIDATE_DIR" -maxdepth 1 -type f -name '*.dump' -print | sort | tail -n 1)"
  fi
fi

if [[ -z "$DUMP" ]]; then
  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "selftest: sem dump disponivel e sem DATABASE_URL para gerar um." >&2
    echo "selftest: passe o caminho do dump como argumento ou exporte DATABASE_URL." >&2
    exit 1
  fi
  TMP_BACKUP_DIR="$(mktemp -d)"
  echo "selftest: gerando dump de trabalho a partir de DATABASE_URL..."
  BACKUP_DIR="$TMP_BACKUP_DIR" \
    BACKUP_PREFIX="cinerie-selftest" \
    BACKUP_OFFSITE_RCLONE_REMOTE="" \
    "${SCRIPT_DIR}/backup.sh" >/dev/null
  DUMP="$(find "$TMP_BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -print | sort | tail -n 1)"
fi

if [[ ! -f "$DUMP" ]]; then
  echo "selftest: dump nao encontrado: '$DUMP'" >&2
  exit 1
fi

echo "selftest: dump sob teste: $DUMP"
echo ""

FAILURES=0
CASE_INDEX=0

run_case() { # modo  exit_esperado(zero|nonzero)  trecho_obrigatorio_na_saida
  local mode="$1" expectation="$2" needle="${3:-}"
  local out rc db

  CASE_INDEX=$((CASE_INDEX + 1))
  db="screen_restore_test_selftest_${CASE_INDEX}_$$"

  set +e
  out="$(
    RESTORE_TEST_DB_NAME="$db" \
      RESTORE_TEST_INJECT_DIVERGENCE="$mode" \
      "$RESTORE_TEST" "$DUMP" 2>&1
  )"
  rc=$?
  set -e

  if [[ "$expectation" == "zero" && "$rc" -ne 0 ]]; then
    echo "  [FALHA] caso '${mode}': esperava exit 0, veio ${rc}." >&2
    echo "$out" | sed 's/^/          | /' >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if [[ "$expectation" == "nonzero" && "$rc" -eq 0 ]]; then
    echo "  [FALHA] caso '${mode}': o restore-test.sh PASSOU com divergencia injetada." >&2
    echo "          E exatamente o defeito que este controle existe para pegar." >&2
    echo "$out" | sed 's/^/          | /' >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if [[ -n "$needle" ]] && ! printf '%s' "$out" | grep -qF -- "$needle"; then
    echo "  [FALHA] caso '${mode}': saiu ${rc}, mas sem o diagnostico esperado (\"${needle}\")." >&2
    echo "          Vermelho pelo motivo errado conta como controle quebrado." >&2
    echo "$out" | sed 's/^/          | /' >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  echo "  [OK] caso '${mode}': exit ${rc} como esperado."
  if [[ -n "$needle" ]]; then
    printf '%s\n' "$out" | grep -F -- "$needle" | head -n 3 | sed 's/^/       > /'
  fi
  return 0
}

echo "== caminho feliz (o restore integro precisa passar) =="
run_case none zero 'restore-test: OK'
echo ""

echo "== controles negativos (cada divergencia precisa reprovar) =="
run_case row nonzero 'linhas divergem em'
run_case table nonzero 'tabela ausente no restaurado'
run_case index nonzero 'indice ausente no restaurado'
run_case constraint nonzero 'constraint ausente no restaurado'
echo ""

if [[ "$FAILURES" -ne 0 ]]; then
  echo "selftest: FALHOU — ${FAILURES} caso(s) fora do desfecho esperado." >&2
  echo "selftest: enquanto isso nao fechar, o restore-test.sh nao e prova de restore." >&2
  exit 1
fi

echo "selftest: PASSOU — o restore-test.sh passa no restore integro e REPROVA nas quatro"
echo "          divergencias injetadas (linha, tabela, indice e constraint)."
