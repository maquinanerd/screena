#!/usr/bin/env bash
set -uo pipefail

# catalog-cycle-with-alert.sh — um CICLO completo de catálogo, com sentinela e alerta.
#
# Executa, em ordem, os comandos que JÁ existem (não reimplementa nada):
#
#   1. snapshot ANTES  (catalog audit-database --json)
#   2. catalog worker  (drena a fila)
#   3. catalog search-reindex
#   4. catalog index-decisions --apply  (com FREIO de mudança em massa)
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
# ========== FREIO DE MUDANÇA EM MASSA: por que o exit 5 é especial ==========
# `index-decisions --apply` roda aqui de hora em hora, sem humano nenhum. Uma
# alteração na política pura de `@screena/seo` se aplicaria ao catálogo INTEIRO
# no primeiro ciclo depois do deploy — a "indexação em massa" que a seção 6 do
# CLAUDE.md manda submeter a revisão humana.
#
# A CLI agora conta quantas entidades ENTRAM ou SAEM do sitemap e, passando do
# teto, grava ZERO linhas e sai com o code 5. Este script trata esse code de
# forma DIFERENTE de uma falha:
#
#   exit 0  -> gravou (ou não havia o que gravar). Segue.
#   exit 5  -> FREIO ARMADO: nada gravado, aguardando humano. Emite alerta e
#              SEGUE o ciclo. NÃO derruba o ciclo, e não vira vermelho de hora
#              em hora — um ciclo que falha toda hora deixa de ser lido, e a
#              próxima falha REAL do worker passa despercebida no meio do ruído.
#   outro   -> falha de verdade do produtor. Loga e segue (como antes).
#
# O alerta sai com severidade `warning`: `buildAlert` só aceita success/failure,
# e para a source `queue` um `failure` já mapeia para severity `warning` (as
# críticas são backup/migration/availability). O texto diz explicitamente que
# nada foi gravado, para não ser lido como quebra.
#
# Destravar é ato humano deliberado, fora do timer:
#   pnpm catalog index-decisions --dry-run --json          # lê o censo
#   pnpm catalog index-decisions --apply --confirm-mass-change --force
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

# Contrato com src/cli/exit.ts (EXIT_CODES.massChangeBlocked). O número mágico
# aqui é inevitável — shell não importa TypeScript —, então
# tests/governance/catalog-mass-change-brake.test.ts trava os dois lados juntos
# para o valor não divergir em silêncio.
INDEX_DECISIONS_BRAKE_EXIT=5

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
  # O alerta NAO mascara o exit code do ciclo: esta chamada roda num SUBPROCESSO
  # e quem decide a saida e o `return "$code"` de `run_cycle`. Mas a falha do
  # ALERTA tambem nao pode sumir: `dispatchAlert` lanca quando havia canal
  # configurado e a entrega falhou, e o `catch` abaixo vira diagnostico em
  # stderr (journal da unit) em vez de silencio.
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
      try {
        await m.dispatchAlert(alert, {
          webhookUrl: process.env.CATALOG_ALERT_WEBHOOK_URL || process.env.BACKUP_ALERT_WEBHOOK_URL,
          provider: process.env.BACKUP_ALERT_PROVIDER,
          log: () => {},
        });
      } catch (err) {
        // `err.detail` ja vem redigido pela lib; nunca imprimir a URL/segredo.
        console.error(
          `catalog-cycle: ALERTA NAO ENTREGUE (${err.outcome ?? "erro"}): ${err.detail ?? "falha ao despachar"}`,
        );
        process.exit(1);
      }
    ' 2>&1 || {
      echo "catalog-cycle: ALERTA NAO ENTREGUE — o canal de alerta falhou; ninguem foi notificado sobre este ciclo." >&2
      echo "catalog-cycle: confira CATALOG_ALERT_WEBHOOK_URL / BACKUP_ALERT_PROVIDER (docs/runbooks/OBSERVABILITY.md)." >&2
    }
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

  # DECISÕES DE INDEXABILIDADE: `--apply` DE VOLTA, agora com a trava.
  #
  # HISTÓRICO, porque a linha já mudou duas vezes e o motivo importa:
  #
  # 1. Era `catalog_write index-decisions --apply`, sem trava nenhuma.
  # 2. A política v2 (gates de sinopse/biografia/imagem) mostrou o tamanho do
  #    problema: a primeira execução tiraria ~51 mil URLs do sitemap — 22.385
  #    pessoas (nenhuma tem biografia), ~28 mil episódios (só 1.257 de 30.803
  #    têm sinopse) e ~40 séries. Isso é INDEXAÇÃO EM MASSA, e o CLAUDE.md §6
  #    exige revisão humana. A linha virou `--dry-run` — mitigação correta na
  #    ausência de trava, e o comentário de lá dizia, com todas as letras, o que
  #    faltava: "aplicação automática precisa de uma trava PRÓPRIA de mudança em
  #    massa — não de descomentar uma linha".
  # 3. Essa trava agora existe (o freio deste arquivo + `catalog-mass-change.ts`),
  #    então `--apply` volta — mas incapaz de fazer o estrago do item 2.
  #
  # O acoplamento invisível continua registrado: este ciclo nunca rodou (a fila
  # tinha 626 jobs `pending` e zero `succeeded`). Quem o liga é a criação do
  # catalog worker. Sem o freio, subir o worker dispararia a desindexação em
  # massa como EFEITO COLATERAL de uma tarefa que não tem nada a ver com SEO.
  # COM o freio, subir o worker produz um alerta e ZERO linhas gravadas.
  #
  # O que `--apply` faz agora: aplica a DERIVA (punhado de entidades por hora,
  # que é o trabalho real do ciclo) e RECUSA a mudança em massa, com censo no
  # log e alerta. Os ~51 mil do item 2 continuam exigindo ato humano deliberado:
  #
  #     catalog index-decisions --dry-run --json            # ler o censo
  #     catalog index-decisions --apply --confirm-mass-change --force
  #
  # Sem `|| echo`: aqui o code EXATO importa — é ele que separa "o produtor
  # quebrou" de "o produtor se recusou de propósito e está esperando um humano".
  local idx_code=0
  catalog_write index-decisions --apply || idx_code=$?
  if [[ "$idx_code" -eq "$INDEX_DECISIONS_BRAKE_EXIT" ]]; then
    echo "catalog-cycle: index-decisions RECUSOU gravar — freio de mudança em massa." >&2
    echo "catalog-cycle: nenhuma decisão foi alterada; o ciclo segue normalmente." >&2
    emit_alert "$idx_code" \
      "index-decisions: FREIO DE MUDANCA EM MASSA armado - ZERO linhas gravadas, indexabilidade inalterada. Revise com 'catalog index-decisions --dry-run --json' e, se a mudanca for intencional, rode com --confirm-mass-change." \
      "failure"
  elif [[ "$idx_code" -ne 0 ]]; then
    echo "catalog-cycle: index-decisions falhou (exit $idx_code; seguindo)." >&2
  fi

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
