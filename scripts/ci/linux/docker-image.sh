#!/usr/bin/env bash
# docker-image.sh — o job `docker-image` do antigo workflow do GitHub Actions,
# agora rodado pela CI local (perfil `docker`). Mesmas secoes, mesmas provas,
# mesmos controles negativos; ver docs/ci-legacy/github-actions-ci.yml.
#
# Roda DENTRO do executor Linux (scripts/ci/linux/runner.Dockerfile), com o
# socket do Docker montado e a partir do snapshot LF do working tree em /work.
# Quem o chama e scripts/ci/pipeline.mjs, que tambem cria a rede do job e, no
# fim, remove todo container com o rotulo desta execucao.
#
# O que mudou em relacao ao workflow, e por que:
#   - nomes de container com prefixo da execucao (`cinerie-ci-<id>-web`): na
#     maquina do dono pode existir um container chamado `web` ou `pg`. O nome
#     curto continua valendo DENTRO da rede, como alias (`pg`, `web`...).
#   - sem `-p` no host: o executor esta na mesma rede e fala com `web:3000`,
#     `admin:3006`, `cms:3002`. Uma porta 3000 ocupada pelo `next dev` do dono
#     nao derruba a prova.
#   - GITHUB_SHA/GITHUB_RUN_NUMBER viram CINERIE_CI_SHA/CINERIE_CI_RUN_ID.
#   - os logs dos containers saem so quando algo falha.
set -euo pipefail

: "${CINERIE_CI_NETWORK:?docker-image: CINERIE_CI_NETWORK e obrigatorio (rode pelo pipeline)}"
: "${CINERIE_CI_RUN_ID:?docker-image: CINERIE_CI_RUN_ID e obrigatorio}"
: "${CINERIE_CI_SHA:?docker-image: CINERIE_CI_SHA e obrigatorio}"

NET="${CINERIE_CI_NETWORK}"
SHA="${CINERIE_CI_SHA}"
BUILD_VERSION="ci-local-${CINERIE_CI_RUN_ID}"
LBL=(--label "cinerie-ci.run=${CINERIE_CI_RUN_ID}")
P="cinerie-ci-${CINERIE_CI_RUN_ID}-"

PG="${P}pg"
WEB="${P}web"
SCHED="${P}sched"
SCHED_DASH="${P}sched-dash"
CATALOGO="${P}catalogo"
PROJECAO="${P}projecao"
PROJECAO_DASH="${P}projecao-dash"
WEB_SEM_EXEC="${P}web-sem-exec"
ADMIN="${P}admin"
ADMIN_SEM_EXEC="${P}admin-sem-exec"
CMS="${P}cms"
CMS_SEM_EXEC="${P}cms-sem-exec"
TODOS=("$PG" "$WEB" "$SCHED" "$SCHED_DASH" "$CATALOGO" "$PROJECAO" "$PROJECAO_DASH" "$WEB_SEM_EXEC" "$ADMIN" "$ADMIN_SEM_EXEC" "$CMS" "$CMS_SEM_EXEC")

secao() { printf '\n== %s ==\n' "$*"; }

# Nenhuma saida deste script deixa o banco congelado; em falha, os logs.
ao_sair() {
  local codigo=$?
  docker unpause "$PG" >/dev/null 2>&1 || true
  if [ "$codigo" -ne 0 ]; then
    for c in "${TODOS[@]}"; do
      if docker inspect "$c" >/dev/null 2>&1; then
        echo "== logs ${c} =="
        docker logs "$c" 2>&1 | tail -n 200 || true
      fi
    done
  fi
  exit "$codigo"
}
trap ao_sair EXIT

cd /work

# ---------------------------------------------------------------------------
secao 'Rede Docker + PostgreSQL 16'
docker run -d --name "$PG" "${LBL[@]}" --network "$NET" --network-alias pg \
  -e POSTGRES_USER=screen -e POSTGRES_PASSWORD=screen -e POSTGRES_DB=screen \
  postgres:16-alpine >/dev/null
# PRONTO PELO TCP, nao pelo socket. Durante o init a imagem postgres sobe um
# servidor TEMPORARIO que so escuta o socket; `pg_isready` por ali respondia
# "pronto" antes de o banco existir. O servidor temporario nao abre TCP.
for _ in $(seq 1 30); do
  if docker exec "$PG" pg_isready -h 127.0.0.1 -U screen -d screen >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$PG" psql -U screen -d screen -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;"

# ---------------------------------------------------------------------------
secao 'Build da imagem (digest declarado + build args)'
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Sem --build-arg NODE_IMAGE: usa o DIGEST default do Dockerfile. Se o digest
# nao existir mais, o build falha aqui (desejado).
docker build \
  --build-arg CINERIE_BUILD_SHA="${SHA}" \
  --build-arg CINERIE_BUILD_VERSION="${BUILD_VERSION}" \
  --build-arg CINERIE_BUILD_TIME="${BUILD_TIME}" \
  -t cinerie-web:ci .

# ---------------------------------------------------------------------------
secao 'Subir container (nao-root) e aguardar HEALTHCHECK'
docker run -d --name "$WEB" "${LBL[@]}" --network "$NET" --network-alias web \
  -e DATABASE_URL=postgresql://screen:screen@pg:5432/screen \
  -e CINERIE_PUBLIC_SITE_URL=http://localhost:3000 \
  -e CINERIE_PUBLIC_INDEXING_ENABLED=0 \
  cinerie-web:ci >/dev/null
status=starting
for _ in $(seq 1 80); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$WEB" 2>/dev/null || echo starting)"
  echo "healthcheck: ${status}"
  if [ "${status}" = "healthy" ]; then break; fi
  if [ "${status}" = "unhealthy" ]; then echo '== container unhealthy =='; exit 1; fi
  sleep 3
done
if [ "${status}" != "healthy" ]; then echo '== healthcheck nao ficou healthy =='; exit 1; fi

# ---------------------------------------------------------------------------
secao 'Assertivas - HTTP, versao, nao-root, migrations, gravabilidade'
# 1) /api/health 200 + versao casa com os build args. URL CANONICA com barra
#    final: `trailingSlash: true` faz /api/health responder 308.
H="$(curl -fsSL http://web:3000/api/health/)"; echo "health=${H}"
echo "${H}" | grep -q '"status":"ok"'
echo "${H}" | grep -q '"database":"ok"'
echo "${H}" | grep -q "\"commit\":\"${SHA}\""
echo "${H}" | grep -q "\"version\":\"${BUILD_VERSION}\""
# 2) /pt/ 200
test "$(curl -s -o /dev/null -w '%{http_code}' http://web:3000/pt/)" = "200"
# 3) /dev/movie-page-preview/ 404
test "$(curl -s -o /dev/null -w '%{http_code}' http://web:3000/dev/movie-page-preview/)" = "404"
# 4) container NAO-root
uid="$(docker exec "$WEB" id -u)"; echo "container uid=${uid}"
test "${uid}" != "0"
# 5) migrations aplicadas
n="$(docker exec "$PG" psql -U screen -d screen -tAc 'SELECT count(*) FROM "_prisma_migrations"')"
echo "migrations=${n}"; test "${n}" -ge 1
# 6) diretorios do Next gravaveis pelo usuario do container
docker exec "$WEB" sh -c 'mkdir -p /app/apps/web/.next/cache && touch /app/apps/web/.next/cache/__probe && rm /app/apps/web/.next/cache/__probe'
echo "OK: imagem real validada (nao-root, healthcheck, HTTP, migrations, gravabilidade)."

# ---------------------------------------------------------------------------
# A MESMA IMAGEM RODA O AGENDADOR (`screen-cron` = esta imagem + outro comando).
# Ate 16/09/2026 o HEALTHCHECK sondava fixo a porta 3000: o container do
# agendador nunca ficava saudavel e o orquestrador o substituia em loop.
# DRY-RUN (sem CINERIE_SCHEDULER_APPLY, NODE_ENV=test) e token FALSO.
secao 'Agendador na mesma imagem - o HEALTHCHECK segue o comando do container'
probe='node /app/scripts/healthcheck/container-health.mjs; echo "exit=$?"'

# Controle negativo 1: sem o comando do agendador e sem nada ouvindo, o alvo e
# o do SITE, e ele REPROVA.
out="$(docker run --rm "${LBL[@]}" cinerie-web:ci sh -c "${probe}")"; echo "${out}"
echo "${out}" | grep -q 'unhealthy screen-app (padrao) http://127.0.0.1:3000/api/health/'
echo "${out}" | grep -q '^exit=1$'

# Controle negativo 2: com o comando do agendador no PID 1 e nada ouvindo, o
# alvo e o /healthz do agendador, e ele REPROVA.
out="$(docker run --rm "${LBL[@]}" cinerie-web:ci sh -c ": scheduler:start; ${probe}")"; echo "${out}"
echo "${out}" | grep -q 'unhealthy screen-cron (pid1) http://127.0.0.1:3005/healthz'
echo "${out}" | grep -q '^exit=1$'

# O agendador de verdade, com o comando embrulhado como o EasyPanel embrulha:
# `/bin/sh -c corepack pnpm ...`, sem passar pelo ENTRYPOINT da imagem.
docker run -d --name "$SCHED" "${LBL[@]}" --network "$NET" \
  -e DATABASE_URL=postgresql://screen:screen@pg:5432/screen \
  -e TMDB_READ_ACCESS_TOKEN=token-de-prova-nao-e-credencial \
  -e NODE_ENV=test \
  -e CINERIE_SCHEDULER_WORKER_ID=ci-healthcheck \
  --entrypoint /bin/sh \
  cinerie-web:ci -c 'corepack pnpm --filter @screena/sync scheduler:start' >/dev/null
status=starting
for _ in $(seq 1 80); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$SCHED" 2>/dev/null || echo starting)"
  running="$(docker inspect --format '{{.State.Running}}' "$SCHED" 2>/dev/null || echo false)"
  echo "agendador: healthcheck=${status} running=${running}"
  if [ "${status}" = "healthy" ]; then break; fi
  if [ "${status}" = "unhealthy" ] || [ "${running}" != "true" ]; then
    echo '== agendador unhealthy ou parado =='
    docker inspect --format '{{json .State.Health}}' "$SCHED" || true
    exit 1
  fi
  sleep 3
done
if [ "${status}" != "healthy" ]; then
  echo '== o HEALTHCHECK do agendador nao ficou healthy =='
  docker inspect --format '{{json .State.Health}}' "$SCHED" || true
  exit 1
fi

# Quem o Docker sondou: a linha do log de saude nomeia servico e URL.
docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$SCHED" \
  | grep -q 'healthy screen-cron (pid1) http://127.0.0.1:3005/healthz -> HTTP 200'
# O site, na mesma imagem, continua sondando o proprio /api/health/.
docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$WEB" \
  | grep -q 'healthy screen-app (padrao) http://127.0.0.1:3000/api/health/ -> HTTP 200'
# Um processo, um sinal de vida: a medida que em producao mostrou 129.
n="$(docker exec "$PG" psql -U screen -d screen -tAc "SELECT count(DISTINCT instance_id) FROM service_heartbeats WHERE service_key = 'screen-cron'")"
echo "instancias do agendador: ${n}"; test "${n}" = "1"
echo "OK: o agendador fica saudavel na mesma imagem do site, e o site continua sondando o /api/health/."

# ---------------------------------------------------------------------------
# O worker de projecao e provado na imagem DELE, porque e ela que recebe o
# comando do painel em producao.
secao 'Build da imagem do worker de projecao'
docker build -f Dockerfile.publication-worker -t cinerie-publication:ci .

# ---------------------------------------------------------------------------
# O SIGTERM DO `docker stop` CHEGA A QUEM DRENA — no formato do EasyPanel.
# As regras estao em tests/operations/container-signals.test.ts; aqui se prova
# a montagem, com um controle negativo por imagem. MEDE TUDO ANTES DE AFIRMAR:
# a secao so reprova no fim, com os tres servicos medidos.
secao 'SIGTERM chega ao agendador e aos workers (formato do EasyPanel)'
(
  set -euo pipefail
  DB=postgresql://screen:screen@pg:5432
  falhas=0
  falha() { echo "ERRO: $*"; falhas=$((falhas + 1)); }

  parar() {
    local inicio fim
    inicio=$(date +%s%N)
    docker stop -t 30 "$1" >/dev/null
    fim=$(date +%s%N)
    echo "$1: saida=$(docker inspect -f '{{.State.ExitCode}}' "$1") stop_ms=$(( (fim - inicio) / 1000000 ))"
  }

  # `grep -q` sai no primeiro acerto; com pipefail, o `docker logs` leva SIGPIPE
  # e o pipeline devolve 141. `grep -c` le tudo.
  tem_log() {
    docker logs "$1" 2>&1 | grep -c -- "$2" >/dev/null
  }

  esperar_log() {
    for _ in $(seq 1 60); do
      if tem_log "$1" "$2"; then return 0; fi
      if [ "$(docker inspect -f '{{.State.Running}}' "$1")" != "true" ]; then break; fi
      sleep 2
    done
    docker logs "$1" 2>&1 | tail -n 40
    return 1
  }

  # 0) O discriminador usado em producao para saber que o painel SUBSTITUI o
  #    ENTRYPOINT: um PID 1 exec'ado pelo `docker-entrypoint.sh` tem PWD no
  #    ambiente, e um PID 1 posto direto pelo Docker nao.
  subst="$(docker run --rm "${LBL[@]}" --entrypoint /bin/dash cinerie-web:ci -c 'tr "\0" "\n" </proc/1/environ | grep -c "^PWD=" || true')"
  mant="$(docker run --rm "${LBL[@]}" cinerie-web:ci /bin/dash -c 'tr "\0" "\n" </proc/1/environ | grep -c "^PWD=" || true')"
  echo "variavel de diretorio no ambiente do PID 1: entrypoint substituido [${subst}] mantido [${mant}]"
  [ "${subst}" = "0" ] || falha "com o ENTRYPOINT substituido o PID 1 nao deveria ter PWD (teve ${subst})"
  [ "${mant}" = "1" ] || falha "com o ENTRYPOINT mantido o PID 1 deveria ter PWD (teve ${mant})"

  # 1) O agendador da secao anterior. O PID 1 e o /bin/sh da imagem, e entre ele
  #    e o node do agendador so existe o pnpm — nenhum shell.
  pid1="$(docker exec "$SCHED" /bin/dash -c 'tr "\0" " " </proc/1/cmdline')"
  echo "PID 1 do agendador: ${pid1}"
  [ "${pid1}" = "/bin/dash /bin/sh -c corepack pnpm --filter @screena/sync scheduler:start " ] \
    || falha "o PID 1 do agendador nao e o /bin/sh da imagem com o comando do painel"
  cadeia="$(docker exec "$SCHED" /bin/dash -c '
    alvo=
    for p in /proc/[0-9]*; do
      # este proprio script cita o binario: nao e ele que se procura
      [ "${p#/proc/}" = "$$" ] && continue
      case "$(tr "\0" " " <"$p/cmdline" 2>/dev/null)" in
        "node --import tsx bin/cinerie-scheduler.ts "*) alvo=${p#/proc/} ;;
      esac
    done
    pid=$alvo
    while [ -n "$pid" ] && [ "$pid" != 0 ]; do
      printf "%s:%s " "$pid" "$(cat "/proc/$pid/comm")"
      pid=$(cut -d" " -f4 "/proc/$pid/stat")
    done')"
  echo "cadeia do agendador ate o PID 1: ${cadeia}"
  # agendador (node) <- pnpm (node) <- PID 1. Qualquer `sh` no meio e o defeito.
  echo "${cadeia}" | grep -Eq '^[0-9]+:node [0-9]+:node 1:[^ ]+ $' \
    || falha "a cadeia do agendador nao e node <- pnpm <- PID 1: ${cadeia}"
  parar "$SCHED"
  tem_log "$SCHED" '"event":"scheduler_draining"' || falha "o agendador nao registrou scheduler_draining"
  tem_log "$SCHED" '"event":"scheduler_stopped"' || falha "o agendador nao registrou scheduler_stopped"
  [ "$(docker inspect -f '{{.State.ExitCode}}' "$SCHED")" = "0" ] || falha "o agendador nao saiu 0 no docker stop"

  # 2) CONTROLE NEGATIVO: o MESMO comando com o dash direto no PID 1. O sinal nao
  #    chega: 137 depois da carencia, sem drenar.
  docker run -d --name "$SCHED_DASH" "${LBL[@]}" --network "$NET" \
    -e DATABASE_URL="${DB}/screen" \
    -e TMDB_READ_ACCESS_TOKEN=token-de-prova-nao-e-credencial \
    -e NODE_ENV=test \
    -e CINERIE_SCHEDULER_WORKER_ID=ci-controle-negativo \
    --entrypoint /bin/dash \
    cinerie-web:ci -c 'corepack pnpm --filter @screena/sync scheduler:start' >/dev/null
  if esperar_log "$SCHED_DASH" '"event":"scheduler_started"'; then
    docker stop -t 8 "$SCHED_DASH" >/dev/null
    c="$(docker inspect -f '{{.State.ExitCode}}' "$SCHED_DASH")"
    echo "controle negativo (dash no PID 1): saida=${c}"
    [ "${c}" = "137" ] || falha "o controle negativo deveria sair 137 (SIGKILL), saiu ${c}"
    if tem_log "$SCHED_DASH" '"event":"scheduler_draining"'; then
      falha "o controle negativo drenou: esta secao nao distingue o conserto"
    fi
  else
    falha "o controle negativo nao subiu"
  fi

  # 3) O catalog-worker num banco NOVO (fila vazia: nenhum job chega ao TMDB) e
  #    sem enfileiradores, com o CMD da imagem dele.
  docker exec "$PG" psql -U screen -d screen -c "CREATE DATABASE catalogo_ci;" >/dev/null
  docker exec "$PG" psql -U screen -d catalogo_ci -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;" >/dev/null
  docker run --rm "${LBL[@]}" --network "$NET" -e DATABASE_URL="${DB}/catalogo_ci" \
    --entrypoint /bin/sh cinerie-web:ci -c 'pnpm --filter @screena/db db:migrate:deploy' >/dev/null
  docker run -d --name "$CATALOGO" "${LBL[@]}" --network "$NET" \
    -e DATABASE_URL="${DB}/catalogo_ci" \
    -e TMDB_READ_ACCESS_TOKEN=token-de-prova-nao-e-credencial \
    -e NODE_ENV=test \
    -e CATALOG_WORKER_ENQUEUE_DISCOVERY=false \
    -e CATALOG_WORKER_ENQUEUE_CHANGES=false \
    cinerie-web:ci sh -c 'exec pnpm --filter @screena/ingestion catalog-worker:start' >/dev/null
  if esperar_log "$CATALOGO" '"event":"catalog_service_started"'; then
    parar "$CATALOGO"
    tem_log "$CATALOGO" '"event":"catalog_service_draining"' || falha "o catalog-worker nao registrou catalog_service_draining"
    tem_log "$CATALOGO" '"event":"catalog_service_stopped"' || falha "o catalog-worker nao registrou catalog_service_stopped"
    [ "$(docker inspect -f '{{.State.ExitCode}}' "$CATALOGO")" = "0" ] || falha "o catalog-worker nao saiu 0 no docker stop"
  else
    falha "o catalog-worker nao subiu"
  fi

  # 4) O worker de projecao na IMAGEM DELE e com o COMANDO DO PAINEL dele. CMS
  #    inalcancavel (porta fechada no loopback) e 60 s entre ciclos, acima da
  #    carencia: so termina a tempo se o sinal CHEGAR e a espera ACORDAR com ele.
  PROJECAO_CMD='pnpm --filter @screena/news-ingestion exec tsx bin/project-editorial.ts --loop --allow-production-url'
  projecao_env=(
    -e SCREEN_DATABASE_URL="${DB}/screen"
    -e PAYLOAD_INTERNAL_SERVICE_URL=http://127.0.0.1:9/
    -e PAYLOAD_PROJECTION_API_KEY=chave-de-prova-nao-e-credencial
    -e PROJECTION_POLL_INTERVAL_MS=60000
    -e EDITORIAL_MEDIA_STORAGE_DRIVER=local
    -e EDITORIAL_MEDIA_LOCAL_ROOT=/tmp/midia-ci
    -e NODE_ENV=test
  )
  docker run -d --name "$PROJECAO" "${LBL[@]}" --network "$NET" "${projecao_env[@]}" \
    -e PROJECTION_WORKER_ID=ci-projecao \
    --entrypoint /bin/sh cinerie-publication:ci -c "${PROJECAO_CMD}" >/dev/null
  if esperar_log "$PROJECAO" 'worker=ci-projecao modo=loop'; then
    # O primeiro ciclo falha (CMS fora) e o worker entra na espera de 60 s.
    esperar_log "$PROJECAO" 'ciclo FALHOU' || true
    parar "$PROJECAO"
    tem_log "$PROJECAO" 'sinal recebido' || falha "o worker de projecao nao registrou o sinal"
    tem_log "$PROJECAO" '\[projecao\] parado' || falha "o worker de projecao nao terminou a drenagem (sem a linha parado)"
    c="$(docker inspect -f '{{.State.ExitCode}}' "$PROJECAO")"
    case "${c}" in
      0 | 143) ;;
      *) falha "o worker de projecao saiu ${c} no docker stop (esperado 0 ou 143, nunca o SIGKILL)" ;;
    esac
  else
    falha "o worker de projecao nao subiu"
  fi

  # 5) CONTROLE NEGATIVO do worker de projecao: o mesmo comando do painel com o
  #    dash direto no PID 1. 137, e a drenagem nunca termina.
  docker run -d --name "$PROJECAO_DASH" "${LBL[@]}" --network "$NET" "${projecao_env[@]}" \
    -e PROJECTION_WORKER_ID=ci-projecao-controle \
    --entrypoint /bin/dash cinerie-publication:ci -c "${PROJECAO_CMD}" >/dev/null
  if esperar_log "$PROJECAO_DASH" 'worker=ci-projecao-controle modo=loop'; then
    docker stop -t 8 "$PROJECAO_DASH" >/dev/null
    c="$(docker inspect -f '{{.State.ExitCode}}' "$PROJECAO_DASH")"
    echo "controle negativo do worker de projecao (dash no PID 1): saida=${c}"
    [ "${c}" = "137" ] || falha "o controle negativo do worker de projecao deveria sair 137, saiu ${c}"
    if tem_log "$PROJECAO_DASH" '\[projecao\] parado'; then
      falha "o controle negativo do worker de projecao drenou: esta secao nao distingue o conserto"
    fi
  else
    falha "o controle negativo do worker de projecao nao subiu"
  fi

  if [ "${falhas}" -gt 0 ]; then
    echo "${falhas} falha(s) - ver as linhas ERRO acima"
    exit 1
  fi
  echo "OK: o SIGTERM chega ao agendador e aos dois workers; os controles negativos provam a diferenca."
)

# ---------------------------------------------------------------------------
secao 'Build das imagens do admin e do CMS'
docker build -f Dockerfile.admin -t cinerie-admin:ci .
docker build -f Dockerfile.cms -t cinerie-cms:ci .

# ---------------------------------------------------------------------------
# O SIGTERM DO `docker stop` CHEGA AO NEXT — site, admin e CMS. A PROVA E UMA
# REQUISICAO EM CURSO: o PostgreSQL PAUSADO segura a requisicao dentro do
# handler; o `docker stop` chega com ela aberta e o banco volta 3 s depois. So
# um Next que recebeu o sinal e esperou entrega a resposta. Controle negativo
# por imagem: a MESMA imagem, com o `exec` tirado do `start`, tem de derrubar a
# requisicao e sair diferente de 0.
secao 'SIGTERM chega ao Next (site, admin e CMS)'
(
  set -euo pipefail
  DB=postgresql://screen:screen@pg:5432
  falhas=0
  falha() { echo "ERRO: $*"; falhas=$((falhas + 1)); }

  esperar_200() {
    local url=$1
    shift
    for _ in $(seq 1 90); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' "$@" "$url" || true)" = "200" ] && return 0
      sleep 2
    done
    return 1
  }

  # Do Next ate o PID 1, como `pid:comm|`. O Next se renomeia para
  # `next-server (vX)` ao subir, e o nome tem espaco: o pai sai do `stat`
  # depois do ULTIMO `) `.
  cadeia_do_next() {
    docker exec "$1" /bin/dash -c '
      alvo=
      for p in /proc/[0-9]*; do
        case "$(tr "\0" " " <"$p/cmdline" 2>/dev/null)" in "next-server "*) alvo=${p#/proc/} ;; esac
      done
      pid=$alvo
      while [ -n "$pid" ] && [ "$pid" != 0 ]; do
        read -r linha <"/proc/$pid/stat"
        printf "%s:%s|" "$pid" "$(cat "/proc/$pid/comm")"
        set -f; set -- ${linha##*) }; set +f
        pid=$2
      done'
  }

  # Tira o `exec` do `start` DENTRO do container criado — a forma de antes, na
  # MESMA imagem — e confere que a imagem tinha o `exec` a tirar.
  tirar_exec() {
    docker cp "$1:/app/$2" "/tmp/$1.json"
    jq '.scripts.start |= sub("^exec "; "")' "/tmp/$1.json" >"/tmp/$1-sem-exec.json"
    local antes depois
    antes="$(jq -r .scripts.start "/tmp/$1.json")"
    depois="$(jq -r .scripts.start "/tmp/$1-sem-exec.json")"
    echo "$1: start da imagem [${antes}] -> no controle negativo [${depois}]"
    [ "exec ${depois}" = "${antes}" ] || falha "$1: o start da imagem nao comeca com exec: ${antes}"
    docker cp "/tmp/$1-sem-exec.json" "$1:/app/$2"
  }

  # Para o container com uma requisicao em curso e anota o codigo de saida, o
  # tempo do stop e se a resposta chegou ao cliente (curl 0 + marcador no corpo).
  parar_com_requisicao() {
    local c=$1 url=$2 marcador=$3
    shift 3
    # a conexao do pool com o banco abre ANTES da pausa
    curl -s -o /dev/null "$@" "$url" || true
    docker pause "$PG" >/dev/null
    (
      set +e
      curl -s -o "/tmp/corpo-$c" -w '%{http_code}' --max-time 60 "$@" "$url" >"/tmp/http-$c"
      echo $? >"/tmp/curl-$c"
    ) &
    local p_curl=$! p_volta inicio fim
    sleep 1
    ( sleep 3; docker unpause "$PG" >/dev/null ) &
    p_volta=$!
    inicio=$(date +%s%N)
    docker stop -t 30 "$c" >/dev/null
    fim=$(date +%s%N)
    wait "${p_volta}" || true
    wait "${p_curl}" || true
    saida="$(docker inspect -f '{{.State.ExitCode}}' "$c")"
    entregue=nao
    if [ "$(cat "/tmp/curl-$c")" = "0" ] && grep -c -- "${marcador}" "/tmp/corpo-$c" >/dev/null; then
      entregue=sim
    fi
    echo "$c: saida [${saida}] stop_ms [$(( (fim - inicio) / 1000000 ))] curl [$(cat "/tmp/curl-$c")] http [$(cat "/tmp/http-$c")] requisicao_entregue [${entregue}]"
  }

  # O conserto: o Next e filho DIRETO do pnpm no PID 1, drena e sai 0.
  provar_conserto() {
    local rotulo=$1 c=$2 url=$3 marcador=$4 cadeia
    shift 4
    cadeia="$(cadeia_do_next "$c")"
    echo "${rotulo}: cadeia do Next ate o PID 1: ${cadeia}"
    local direto='^[0-9]+:next-server [^|]*[|]1:node[|]$'
    [[ "${cadeia}" =~ ${direto} ]] || falha "${rotulo}: o Next nao e filho direto do pnpm no PID 1: ${cadeia}"
    parar_com_requisicao "$c" "$url" "$marcador" "$@"
    [ "${saida}" = "0" ] || falha "${rotulo}: docker stop saiu ${saida} (esperado 0)"
    [ "${entregue}" = "sim" ] || falha "${rotulo}: a requisicao em curso nao chegou ao cliente - o Next nao drenou"
  }

  # O controle negativo: sem o `exec`, um shell fica entre o pnpm e o Next, o
  # sinal nao chega, e a requisicao morre com o container.
  provar_controle_negativo() {
    local rotulo=$1 c=$2 url=$3 marcador=$4
    shift 4
    echo "${rotulo} (controle negativo): cadeia do Next ate o PID 1: $(cadeia_do_next "$c")"
    parar_com_requisicao "$c" "$url" "$marcador" "$@"
    [ "${saida}" != "0" ] || falha "${rotulo}: o controle negativo saiu 0 - esta secao nao distingue o conserto"
    [ "${entregue}" = "nao" ] || falha "${rotulo}: o controle negativo entregou a requisicao - esta secao nao distingue o conserto"
  }

  # 1) SITE: o container web das secoes anteriores, com o CMD da imagem.
  provar_conserto site "$WEB" http://web:3000/api/health/ '"database":"ok"'
  docker create --name "$WEB_SEM_EXEC" "${LBL[@]}" --network "$NET" --network-alias web-sem-exec \
    -e DATABASE_URL="${DB}/screen" \
    -e CINERIE_PUBLIC_SITE_URL=http://localhost:3100 \
    -e CINERIE_PUBLIC_INDEXING_ENABLED=0 \
    cinerie-web:ci >/dev/null
  tirar_exec "$WEB_SEM_EXEC" apps/web/package.json
  docker start "$WEB_SEM_EXEC" >/dev/null
  if esperar_200 http://web-sem-exec:3000/api/health/; then
    provar_controle_negativo site "$WEB_SEM_EXEC" http://web-sem-exec:3000/api/health/ '"database":"ok"'
  else
    falha "o controle negativo do site nao subiu"
  fi

  # 2) ADMIN: o banco do site e o Basic Auth que o middleware exige em producao.
  admin_env=(
    -e DATABASE_URL="${DB}/screen"
    -e ADMIN_BASIC_AUTH_USER=ci
    -e ADMIN_BASIC_AUTH_PASSWORD=senha-de-prova-nao-e-credencial
  )
  admin_auth=(-u ci:senha-de-prova-nao-e-credencial)
  docker run -d --name "$ADMIN" "${LBL[@]}" --network "$NET" --network-alias admin "${admin_env[@]}" cinerie-admin:ci >/dev/null
  if esperar_200 http://admin:3006/health "${admin_auth[@]}"; then
    provar_conserto admin "$ADMIN" http://admin:3006/health 'Conectado' "${admin_auth[@]}"
  else
    falha "o admin nao subiu"
  fi
  docker create --name "$ADMIN_SEM_EXEC" "${LBL[@]}" --network "$NET" --network-alias admin-sem-exec "${admin_env[@]}" cinerie-admin:ci >/dev/null
  tirar_exec "$ADMIN_SEM_EXEC" apps/admin/package.json
  docker start "$ADMIN_SEM_EXEC" >/dev/null
  if esperar_200 http://admin-sem-exec:3006/health "${admin_auth[@]}"; then
    provar_controle_negativo admin "$ADMIN_SEM_EXEC" http://admin-sem-exec:3006/health 'Conectado' "${admin_auth[@]}"
  else
    falha "o controle negativo do admin nao subiu"
  fi

  # 3) CMS: banco proprio (nunca o do site), storage local declarado e as
  #    migrations do Payload, que o CMD aplica antes do start.
  docker exec "$PG" psql -U screen -d screen -c "CREATE DATABASE cms_ci;" >/dev/null
  cms_env=(
    -e PAYLOAD_DATABASE_URL="${DB}/cms_ci"
    -e PAYLOAD_SECRET=segredo-de-prova-nao-e-credencial-0123456789
    -e PAYLOAD_UPLOAD_STORAGE_DRIVER=local
    -e PAYLOAD_UPLOAD_LOCAL_ROOT=/app/apps/cms/media
    -e PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true
  )
  docker run -d --name "$CMS" "${LBL[@]}" --network "$NET" --network-alias cms "${cms_env[@]}" \
    -e PAYLOAD_PUBLIC_SERVER_URL=http://localhost:3002 cinerie-cms:ci >/dev/null
  if esperar_200 http://cms:3002/healthz; then
    provar_conserto cms "$CMS" http://cms:3002/readyz '"service":"cinerie-cms"'
  else
    falha "o CMS nao subiu"
  fi
  docker create --name "$CMS_SEM_EXEC" "${LBL[@]}" --network "$NET" --network-alias cms-sem-exec "${cms_env[@]}" \
    -e PAYLOAD_PUBLIC_SERVER_URL=http://localhost:3102 cinerie-cms:ci >/dev/null
  tirar_exec "$CMS_SEM_EXEC" apps/cms/package.json
  docker start "$CMS_SEM_EXEC" >/dev/null
  if esperar_200 http://cms-sem-exec:3002/healthz; then
    provar_controle_negativo cms "$CMS_SEM_EXEC" http://cms-sem-exec:3002/readyz '"service":"cinerie-cms"'
  else
    falha "o controle negativo do CMS nao subiu"
  fi

  if [ "${falhas}" -gt 0 ]; then
    echo "${falhas} falha(s) - ver as linhas ERRO acima"
    exit 1
  fi
  echo "OK: o Next dos tres apps recebe o SIGTERM, entrega a requisicao em curso e sai 0; sem o exec, a derruba."
)

echo
echo "OK: job docker-image completo."
