/**
 * container-health.mjs — o HEALTHCHECK da imagem do `Dockerfile` da raiz.
 *
 * Uma imagem, dois servicos (`screen-app` e `screen-cron`), e cada um serve
 * saude numa porta diferente. Este arquivo so liga o IO real — `/proc/1/cmdline`,
 * o ambiente e o `fetch` do Node 22 — a decisao, que mora em
 * `lib/health-target.mjs` e e testada la. O porque esta no cabecalho daquele
 * modulo.
 *
 * Saida: 0 saudavel, 1 nao (o 2 e reservado pelo Docker). Uma linha em stdout,
 * que o Docker guarda em `.State.Health.Log`: servico, como foi reconhecido,
 * URL sondada e o desfecho.
 *
 * Plain `.mjs`, sem tsx e sem dependencia: roda a cada 30 s em todo container,
 * e subir um transpilador por sondagem gastaria CPU e memoria a toa.
 */

import { readFileSync } from 'node:fs'

import { runHealthcheck } from './lib/health-target.mjs'

const result = await runHealthcheck({
  readPid1Cmdline: () => readFileSync('/proc/1/cmdline'),
  env: process.env,
  fetch: (url, init) => fetch(url, init),
})

process.exitCode = result.code
// `exit` explicito: uma conexao keep-alive do `fetch` seguraria o processo alem
// do `--timeout` do HEALTHCHECK, e o Docker contaria a sondagem como falha.
process.stdout.write(`${result.line}\n`, () => process.exit(result.code))
