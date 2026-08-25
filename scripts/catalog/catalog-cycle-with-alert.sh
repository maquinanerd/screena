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
# ============== GATE DE PRODUÇÃO: por que este bloco existe ==============
# A CLI tem um gate (src/cli/exit.ts) que, sob NODE_ENV=production, exige
# `--force` para ESCRITA e `--confirm-production-read` para LEITURA. Este script
# não passava nenhuma das duas — então, agendado em produção, os QUATRO comandos
# do ciclo saíam com exit 3 (blocked) e o ciclo nunca rodava:
#
#   catalog audit-database --json    -> leitura   -> exigia --confirm-production-read
#   catalog worker                   -> leitura*  -> exigia --confirm-production-read
#   catalog search-reindex --apply   -> escrita   -> exigia --force
#   catalog index-decisions --apply  -> escrita   -> exigia --force
#
#   (*) `worker` é classificado como leitura porque o gate deriva `mutates` de
#       `--apply`, e o worker não tem `--apply`. Ele é, na prática, o maior
#       ESCRITOR do ciclo. A classificação é frouxa; o gate abaixo compensa.
#
# A correção NÃO é passar `--force` incondicionalmente — isso apagaria o gate e
# devolveria exatamente o descuido que ele existe para impedir (um `--apply`
# copiado de um runbook de staging mutando produção). O script passa as flags
# SOMENTE quando o operador declarou, por variável de ambiente, que este host é
# autorizado a escrever em produção:
#
#   CINERIE_CATALOG_CYCLE_PRODUCTION_CONFIRMED=true
#
# Sem a variável, em produção, o script RECUSA e sai com 3 — em vez de rodar
# quatro comandos que falhariam um a um e emitir um alerta confuso. Fora de
# produção nada muda: as flags não são passadas e o gate já libera.
#
# Uso (tipicamente via systemd timer):
#   DATABASE_URL=... TMDB_READ_ACCESS_TOKEN=... \
#   CINERIE_CATALOG_CYCLE_PRODUCTION_CONFIRMED=true \
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

# Flags do gate de produção, resolvidas UMA vez na subida (ver o bloco acima).
# Arrays vazios fora de produção: `"${GATE_READ[@]}"` some da linha de comando.
GATE_READ=()
GATE_WRITE=()
if [[ "${NODE_ENV:-}" == "production" ]]; then
  if [[ "${CINERIE_CATALOG_CYCLE_PRODUCTION_CONFIRMED:-}" != "true" ]]; then
    echo "catalog-cycle: BLOQUEADO — NODE_ENV=production sem CINERIE_CATALOG_CYCLE_PRODUCTION_CONFIRMED=true." >&2
    echo "catalog-cycle: escrita em produção exige autorização explícita do operador." >&2
    exit 3
  fi
  GATE_READ=(--confirm-production-read)
  GATE_WRITE=(--force)
fi

catalog_read() {
  # `pnpm --filter` evita depender do cwd; a CLI é a mesma que o operador usa.
  (cd "$REPO_ROOT" && corepack pnpm --filter @screena/ingestion exec tsx bin/catalog.ts "$@" "${GATE_READ[@]}")
}

catalog_write() {
  (cd "$REPO_ROOT" && corepack pnpm --filter @screena/ingestion exec tsx bin/catalog.ts "$@" "${GATE_WRITE[@]}")
}

snapshot() {
  # Uma linha JSON com o que o sentinela precisa. Read-only.
  catalog_read audit-database --json 2>/dev/null || echo '{}'
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

  # `worker` é classificado como LEITURA pelo gate (não tem `--apply`), embora
  # seja o maior escritor do ciclo. Passa a flag de leitura para não sair com 3.
  if ! catalog_read worker \
      --concurrency "$WORKER_CONCURRENCY" \
      --max-jobs "$WORKER_MAX_JOBS" \
      --timeout-ms "$WORKER_TIMEOUT_MS"; then
    code=$?
    emit_alert "$code" "catalog worker falhou (exit $code)" "failure"
    return "$code"
  fi

  # Projeção de busca faz parte do ciclo: sem ela, entidade nova não entra na
  # busca. É escrita, mas de baixo risco — projeta o que já existe.
  catalog_write search-reindex --apply || echo "catalog-cycle: search-reindex falhou (seguindo)." >&2

  # DECISÕES DE INDEXABILIDADE: DRY-RUN, NUNCA `--apply` AQUI.
  #
  # Até esta mudança a linha era `catalog_write index-decisions --apply`. Com a
  # política v2 (gates de sinopse/biografia/imagem), a primeira execução tira
  # ~51 mil URLs do sitemap — 22.385 pessoas (nenhuma tem biografia), ~28 mil
  # episódios (só 1.257 de 30.803 têm sinopse) e ~40 séries.
  #
  # Isso é INDEXAÇÃO EM MASSA, e o CLAUDE.md §6 exige revisão humana para ela.
  # Um timer horário aplicando sozinho é exatamente o contrário: a decisão mais
  # cara do sistema tomada por um cron, sem ninguém ler o censo.
  #
  # Havia ainda um acoplamento invisível: este ciclo nunca rodou (a fila tem 626
  # jobs `pending` e zero `succeeded` na história). Quem o liga é a criação do
  # catalog worker. Ou seja, subir o worker dispararia a desindexação em massa
  # como EFEITO COLATERAL de uma tarefa que não tem nada a ver com SEO.
  #
  # O dry-run mantém o valor do ciclo — o censo por razão fica no log a cada
  # hora, e uma divergência nova aparece — sem que nada mude no índice. Aplicar
  # continua possível e passa a ser um ATO DELIBERADO:
  #
  #     catalog index-decisions --apply --force
  #
  # Se um dia a aplicação automática for desejada, ela precisa de decisão
  # registrada e de uma trava própria de mudança em massa — não de descomentar
  # uma linha.
  catalog_read index-decisions --dry-run --json \
    || echo "catalog-cycle: index-decisions (dry-run) falhou (seguindo)." >&2

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
