#!/bin/dash
# pnpm-install.sh — o `pnpm install` das imagens, com nova tentativa.
#
# ============================================================================
# O DEFEITO QUE ESTE ARQUIVO CONSERTA
# ============================================================================
# MEDIDO em 22 e 23/09/2026: a rede da VPS derruba conexao com o registro no meio
# do install, e o build inteiro morre. Aconteceu em dois deploys e num job de CI
# no mesmo dia. O log do `screen-catalog-worker` em 23/09 mostra os dois lados do
# problema numa execucao so:
#
#   WARN GET https://registry.npmjs.org/@playwright/test/-/test-1.62.0.tgz
#        error (ECONNRESET). Will retry in 10 seconds. 2 retries left.
#   ... (mais quatro ECONNRESET nos primeiros 5 segundos)
#   .../node_modules/@prisma/engines postinstall: Error: aborted
#        at TLSSocket.socketCloseListener  { code: 'ECONNRESET' }
#   ELIFECYCLE Command failed with exit code 1.
#
# O `pnpm` se recuperou sozinho dos tarballs — ele tem retry proprio. Quem nao se
# recuperou foi o `postinstall` do `@prisma/engines`, que baixa os binarios da
# engine por fora do registro: ele desistiu e derrubou o `pnpm install` junto.
#
# O log tambem mostra `reused 0` com 687 pacotes: NAO existe store de pnpm
# reaproveitavel entre builds nesta maquina. Todo build baixa tudo de novo, o que
# multiplica a exposicao a instabilidade da rede.
#
# ============================================================================
# POR QUE UM LACO, E NAO SO MAIS RETRY DO PNPM
# ============================================================================
# `fetch-retries` do pnpm cobre o que o PNPM baixa. Nao cobre o que um script de
# `postinstall` baixa por conta propria — e foi exatamente ai que quebrou. A
# unica rede de seguranca que alcanca os dois e repetir o comando inteiro.
#
# `pnpm install` e idempotente: a repeticao completa o que faltou em vez de
# comecar do zero.
#
# FALHA DE VERDADE CONTINUA FALHANDO. Esgotadas as tentativas, o script sai com
# codigo 1 e o build quebra. Um laco que engolisse o erro no fim seria pior que
# o defeito: geraria imagem com dependencia faltando, que so aparece em runtime.
set -eu

tentativas="${CINERIE_INSTALL_TENTATIVAS:-3}"
espera="${CINERIE_INSTALL_ESPERA_S:-20}"

# `fetch-retries` sobe de 2 (padrao) para 5: e de graca, e cobre a parte que o
# proprio pnpm baixa, reduzindo quantas vezes o laco precisa entrar.
PNPM_CONFIG_FETCH_RETRIES="${PNPM_CONFIG_FETCH_RETRIES:-5}"
export PNPM_CONFIG_FETCH_RETRIES

i=1
while :; do
  if PNPM_CONFIG_PROD=false pnpm install --frozen-lockfile; then
    exit 0
  fi
  if [ "$i" -ge "$tentativas" ]; then
    echo "pnpm-install: falhou em $i tentativa(s); o build para aqui." >&2
    exit 1
  fi
  echo "pnpm-install: tentativa $i de $tentativas falhou; nova em ${espera}s." >&2
  i=$((i + 1))
  sleep "$espera"
done
