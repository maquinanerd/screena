#!/bin/dash
# pid1-shell.sh — o /bin/sh das imagens de servico que recebem comando do painel.
#
# E o dash de sempre, com UMA excecao: quando este shell e o PID 1 do container
# (ou o filho direto do init do Docker) e recebe exatamente `-c "<comando
# simples>"`, ele vira um init — repassa o sinal de parada ao comando, colhe os
# orfaos e so sai quando a arvore terminou de drenar.
#
# ============================================================================
# O DEFEITO QUE ESTE ARQUIVO CONSERTA
# ============================================================================
# O EasyPanel roda o campo "Comando" de um servico como `/bin/sh -c "<comando>"`
# NO LUGAR do ENTRYPOINT da imagem. Medido em 17/09/2026, de dentro dos containers:
#
#   - PID 1 do `screen-cron` = `/bin/sh -c corepack pnpm --filter @screena/sync
#     scheduler:start`, sem handler de SIGTERM (SigCgt);
#   - `PWD` AUSENTE do ambiente desse PID 1. O dash exporta `PWD`: um processo
#     exec'ado pelo `docker-entrypoint.sh` da imagem node a herda (o
#     `screen-catalog-worker`, que usa o CMD da imagem, tem). Logo o PID 1 do
#     `screen-cron` nao passou pelo ENTRYPOINT, e ENTRYPOINT novo nenhum chegaria
#     a ele. Calibrado com `docker run --entrypoint` na CI;
#   - o `cinerie-publication-worker` tambem tem comando no painel:
#     `pnpm --filter @screena/news-ingestion exec tsx bin/project-editorial.ts
#     --loop --allow-production-url`.
#
# O dash 0.5.12 (Debian bookworm) nao faz exec do ultimo comando de `-c`, entao
# fica como PID 1 com o servico de filho. E o kernel NAO entrega a um PID 1 um
# sinal que ele nao trata: o SIGTERM do `docker stop` era descartado, a carencia
# passava e chegava o SIGKILL. Nenhum desligamento gracioso rodava.
#
# ============================================================================
# POR QUE UM INIT AQUI, E NAO O TINI
# ============================================================================
# O tini sai quando o filho DIRETO sai. Com `pnpm exec`, o filho direto morre de
# proposito ao receber o sinal: ele repassa o SIGTERM ao comando e se re-sinaliza.
# O tini saia junto, o container acabava e o kernel matava o servico no meio da
# drenagem — medido: saida 143 em ~75 ms, sem drenar. O tini serviria ao
# `pnpm run` do agendador e pioraria o worker de projecao.
#
# Este init faz as tres coisas que o caso pede:
#
#   1. roda o comando em segundo plano e REPASSA o sinal (TERM, INT, HUP) so a
#      ele — um sinal por processo, nunca ao grupo: o agendador trata o SEGUNDO
#      SIGTERM como "sair ja";
#   2. COLHE orfaos. O `wait` do dash recolhe qualquer filho, inclusive os
#      reparentados ao PID 1 — o esbuild de cada CLI filha do agendador vira
#      orfao quando ela termina. Um `node` no PID 1 os deixaria como zumbi
#      (medido: 36 em 5 s);
#   3. depois de um pedido de parada, ESPERA a arvore inteira: enquanto houver
#      processo no container alem dele e das sessoes de `docker exec`, ele nao
#      sai. O orquestrador tem o SIGKILL para quem nao terminar a tempo.
#
# Sem pedido de parada (o servico caiu sozinho), ele sai na hora com o codigo do
# comando: o reinicio nao espera orfao nenhum.
#
# ============================================================================
# O QUE E "COMANDO SIMPLES", E POR QUE A REGRA E ESTREITA
# ============================================================================
# So [A-Za-z0-9_@%+=:,./ -]; a primeira palavra nao comeca com `-` nem tem `=`
# (seria atribuicao de variavel); e ela resolve para um EXECUTAVEL — caminho
# absoluto em `command -v`. Builtin (`exec`, `cd`), funcao, palavra reservada e
# comando inexistente ficam com o dash, que sabe o que fazer com cada um.
#
# Qualquer outro caractere (`;`, `&&`, `|`, aspas, `$`, redirecionamento, tab,
# quebra de linha) e sintaxe de shell: vai para o dash EXATAMENTE como antes. Um
# comando composto no painel continua sem receber SIGTERM, a menos que termine em
# `exec`. E o limite conhecido, e ele e deliberado: reescrever sintaxe de shell
# alheia e como se troca um defeito visivel por um invisivel.
#
# ============================================================================
# FORA DESSE CASO, E O DASH — INCLUSIVE NO `$0`
# ============================================================================
# O script e interpretado pelo proprio dash e termina em `exec /bin/dash`. O
# kernel entrega a este script o CAMINHO que o chamador usou, nao o `argv[0]`:
# por isso `-c` sem `$0` explicito recebe `sh` (quem procurou `sh` no PATH, como
# o pnpm) ou `/bin/sh` (quem chamou pelo caminho, como o Docker). A mensagem de
# erro continua `sh: 1: ...`, e `echo "$0"` continua igual — comparado com o dash
# numa bateria de invocacoes, na CI e em `tests/operations/container-signals.test.ts`.
#
# Instalado por ultimo no Dockerfile, depois de todo RUN, como `/usr/bin/sh` (o
# `/bin/sh` do bookworm, que tem `/bin -> usr/bin`). O dash continua em `/bin/dash`.
# Medidas e limites: docs/operations/sigterm-e-pid1.md. Prova com as imagens reais:
# job `docker-image` da CI.

# Repassa o sinal ao comando e marca o pedido de parada.
cinerie_repassar() {
	cinerie_sinal=$1
	cinerie_interrompido=1
	kill -s "$1" "$cinerie_filho" 2>/dev/null || :
}

# Ainda ha processo no container alem deste shell, do PID 1 e das sessoes de
# `docker exec` (pai 0)? So builtins: um processo criado aqui contaria a si mesmo.
cinerie_ha_outros() {
	for cinerie_p in /proc/[0-9]*; do
		case ${cinerie_p#/proc/} in
		1 | "$$") continue ;;
		esac
		read -r cinerie_linha 2>/dev/null <"$cinerie_p/stat" || continue
		# `pid (comm) estado ppid ...`: o comm pode ter espaco e parentese; o
		# ppid e o segundo campo depois do ULTIMO `) `.
		set -f
		# shellcheck disable=SC2086 # dividir por espaco e o objetivo
		set -- ${cinerie_linha##*) }
		set +f
		[ "${2-}" = 0 ] && continue
		return 0
	done
	return 1
}

cinerie_init() {
	cinerie_sinal=
	cinerie_interrompido=
	trap 'cinerie_repassar TERM' TERM
	trap 'cinerie_repassar INT' INT
	trap 'cinerie_repassar HUP' HUP

	"$@" &
	cinerie_filho=$!
	# Um sinal chegado entre o fork e a linha acima ainda nao tinha a quem ir.
	if [ -n "$cinerie_sinal" ]; then kill -s "$cinerie_sinal" "$cinerie_filho" 2>/dev/null || :; fi

	# O `wait` volta antes da hora quando chega um sinal com trap: repete ate o
	# comando sair de fato, e guarda o codigo DELE.
	while :; do
		cinerie_interrompido=
		wait "$cinerie_filho"
		cinerie_status=$?
		[ -z "$cinerie_interrompido" ] && break
		if ! kill -0 "$cinerie_filho" 2>/dev/null; then
			wait "$cinerie_filho"
			cinerie_real=$?
			[ "$cinerie_real" = 127 ] || cinerie_status=$cinerie_real
			break
		fi
	done

	# Houve pedido de parada: o que o comando deixou para tras ainda drena.
	if [ -n "$cinerie_sinal" ]; then
		while cinerie_ha_outros; do
			sleep 0.2
		done
	fi
	exit "$cinerie_status"
}

if [ "$#" -eq 2 ] && [ "$1" = -c ]; then
	cinerie_init_do_container=
	if [ "$$" = 1 ]; then
		cinerie_init_do_container=sim
	elif [ "$PPID" = 1 ] && read -r cinerie_pid1 2>/dev/null </proc/1/comm; then
		# "Tini Init" ligado no painel: o init do Docker e o PID 1 e este shell e
		# o filho dele. O init do Docker tambem sai quando o filho sai.
		case $cinerie_pid1 in
		docker-init | tini) cinerie_init_do_container=sim ;;
		esac
	fi

	if [ -n "$cinerie_init_do_container" ]; then
		cinerie_comando=$2
		case $cinerie_comando in
		'' | *[!A-Za-z0-9_@%+=:,./\ -]*) ;;
		*)
			set -f
			# shellcheck disable=SC2086 # dividir por espaco e o objetivo
			set -- $cinerie_comando
			set +f
			case $1 in
			-* | *=*) ;;
			*)
				case $(command -v "$1") in
				/*) cinerie_init "$@" ;;
				esac
				;;
			esac
			set -- -c "$cinerie_comando"
			;;
		esac
	fi

	case $0 in
	/bin/sh) exec /bin/dash -c "$2" /bin/sh ;;
	esac
	exec /bin/dash -c "$2" sh
fi

exec /bin/dash "$@"
