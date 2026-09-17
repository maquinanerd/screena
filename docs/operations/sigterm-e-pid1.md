# SIGTERM e o PID 1 dos containers de servico

> Por que o `docker stop` de todo redeploy matava o agendador, os workers e o Next
> dos tres apps sem desligamento gracioso, com o codigo de drenagem escrito e
> testado, e o que entrega o sinal hoje. Leia antes de mexer no **comando de um
> servico no painel**, no **`/bin/sh` das imagens**, num script **`*:start`** de
> `services/*` ou no **`start`** de `apps/*`.

---

## 1. O que foi medido em producao (17/09/2026, somente leitura)

De dentro de cada container, pelo console do EasyPanel: a arvore de processos
(`/proc/*/stat`) e, para cada processo, se ele instala handler de SIGTERM
(`SigCgt` em `/proc/<pid>/status`).

**`screen-cron`** (PID 1 com 79 s de idade):

| pid | pai | trata SIGTERM? | processo |
| --- | --- | --- | --- |
| 1 | 0 | **nao** | `/bin/sh -c corepack pnpm --filter @screena/sync scheduler:start` |
| 7 | 1 | sim | `node corepack pnpm --filter @screena/sync scheduler:start` |
| 19 | 7 | **nao** | `sh -c tsx bin/cinerie-scheduler.ts` |
| 20 | 19 | sim | `node .../tsx/dist/cli.mjs bin/cinerie-scheduler.ts` |
| 36 | 20 | sim | `node --require preflight.cjs --import loader.mjs bin/cinerie-scheduler.ts` (o agendador) |

**`screen-catalog-worker`** (818 s):

| pid | pai | trata SIGTERM? | processo |
| --- | --- | --- | --- |
| 1 | 0 | sim | `node pnpm --filter @screena/ingestion catalog-worker:start` |
| 33 | 1 | **nao** | `sh -c tsx bin/catalog-worker-service.ts` |
| 34 | 33 | sim | `node .../tsx/dist/cli.mjs bin/catalog-worker-service.ts` |
| 50 | 34 | sim | `node --require preflight.cjs --import loader.mjs bin/catalog-worker-service.ts` (o worker) |

**Comando de cada servico no painel** (tela Avancado, leitura dos campos):

| servico | imagem | "Comando" no painel | Tini Init |
| --- | --- | --- | --- |
| `screen-cron` | `Dockerfile` | `corepack pnpm --filter @screena/sync scheduler:start` | desligado |
| `cinerie-publication-worker` | `Dockerfile.publication-worker` | `pnpm --filter @screena/news-ingestion exec tsx bin/project-editorial.ts --loop --allow-production-url` | desligado |
| `screen-catalog-worker` | `Dockerfile.catalog-worker` | vazio (vale o CMD da imagem) | desligado |

O console do `cinerie-publication-worker` nao foi aberto; com o comando acima, o
PID 1 dele e o mesmo dash do `screen-cron`. `dash` 0.5.12-2 (Debian bookworm, a
base `node:22-bookworm-slim` das imagens).

### O painel SUBSTITUI o ENTRYPOINT — e como se sabe

O dash exporta `PWD`. Um PID 1 exec'ado pelo `docker-entrypoint.sh` da imagem
node herda essa variavel; um PID 1 posto direto pelo Docker, nao.

| container | `PWD` no ambiente do PID 1 |
| --- | --- |
| `screen-catalog-worker` (CMD da imagem, via ENTRYPOINT) | 1 |
| `screen-cron` (campo "Comando" do painel) | **0** |

Calibrado com `docker run` na CI: `--entrypoint /bin/dash` da 0; argumentos
depois da imagem (ENTRYPOINT mantido) dao 1. Consequencia pratica: **nenhum
ENTRYPOINT da imagem alcanca um servico com comando no painel** — nem tini, nem
wrapper. O que o painel nao substitui e o proprio `/bin/sh`.

---

## 2. Os elos que cortavam o sinal

1. **O dash no PID 1.** O kernel nao entrega a um PID 1 um sinal que ele nao
   trata. O SIGTERM do `docker stop` e descartado, a carencia passa, chega o
   SIGKILL e todos os processos do container morrem juntos.
2. **O `sh -c` do `pnpm run`.** O pnpm roda o script com
   `spawn('sh', ['-c', script])` e, ao receber SIGTERM, repassa o sinal SO a esse
   shell. O dash nao faz exec do comando: morre sem repassar, o pnpm sai, e o fim
   do PID 1 leva o servico por SIGKILL — em ~100 ms, sem drenar.
3. **A CLI `tsx`.** Ela repassa o sinal ao processo filho e espera a confirmacao
   dele por IPC por **30 ms**; sem confirmacao, manda SIGKILL. Lido no codigo do
   tsx 4.22.4 (`relaySignalToChild`) e medido: com o laco de eventos ocupado, o
   filho morre antes de ver o sinal.
4. **O `pnpm exec`.** Ele nao usa shell, mas ao receber SIGTERM mata o comando e
   se re-sinaliza para morrer (`signal-exit`). Com um init que sai junto com o
   filho direto — o tini, o "Tini Init" do painel —, o container acaba com o
   servico no meio da drenagem.

E um problema que aparece quando o primeiro e consertado do jeito obvio: **um
`node` no PID 1 nao colhe processos orfaos.** O esbuild de cada CLI filha do
agendador vira orfao quando ela termina; com o pnpm no PID 1, cada um fica como
zumbi. O dash colhia.

---

## 3. Laboratorio (CI, `docker stop -t 8`)

Imagem minima com a MESMA base por digest, `dash` 0.5.12-2, `tini` 0.19.0,
pnpm 9.15.4 e tsx 4.22.4. O servico de prova registra cada SIGTERM, drena em
1,5 s e sai 0.

**Como estava:**

| formato | saida | tempo do stop | viu o SIGTERM | drenou |
| --- | --- | --- | --- | --- |
| `/bin/sh -c "corepack pnpm ... :start"`, script `tsx` (o `screen-cron`) | **137** | 8,1 s | nao | nao |
| CMD `sh -c "exec pnpm ..."`, script `tsx` (o `screen-catalog-worker`) | **1** | 0,09 s | nao | nao |
| `/bin/sh -c "pnpm ... exec tsx ..."` (o `cinerie-publication-worker`) | **137** | 8,1 s | nao | nao |

**Cada elo isolado:**

| formato | saida | tempo | viu | drenou |
| --- | --- | --- | --- | --- |
| pnpm no PID 1, script `exec tsx` | 0 | 1,6 s | sim | sim |
| o mesmo, laco ocupado 950 ms/s (3 rodadas) | **143** | 0,17 s | nao | nao |
| pnpm no PID 1, script `exec node --import tsx`, laco ocupado (3 rodadas) | 0 | 2,7 s | sim | sim |
| tini no PID 1 -> `pnpm run`, script `exec node --import tsx` | 0 | 2,7 s | sim | sim |
| tini no PID 1 -> `pnpm exec tsx` (3 formatos) | **143** | 0,08 s | nao | nao |
| "Tini Init" do painel, `/bin/sh` de antes | **143** | 0,09 s | nao | nao |
| `pnpm exec tsx` direto no PID 1 | 0 | 1,6 s | sim | sim |

Zumbis depois de 5 s com orfaos em serie: dash no PID 1 = 0; **pnpm no PID 1 =
36**; tini no PID 1 = 0.

**O conserto** (`/bin/sh` que vira init no PID 1, secao 4):

| formato | saida | tempo | viu | drenou |
| --- | --- | --- | --- | --- |
| `screen-cron` (`corepack pnpm run`, script `exec node --import tsx`) | 0 | 1,6 s | sim | sim |
| o mesmo, laco ocupado | 0 | 2,9 s | sim | sim |
| o mesmo, ENTRYPOINT mantido | 0 | 1,6 s | sim | sim |
| o mesmo, "Tini Init" ligado | 0 | 1,6 s | sim | sim |
| `cinerie-publication-worker` (`pnpm exec tsx`, o comando do painel) | 143 | 1,7 s | sim | **sim** |
| o mesmo, "Tini Init" ligado | 143 | 1,7 s | sim | sim |
| o mesmo, laco ocupado | **143** | 0,3 s | nao | nao |
| composto sem exec: `true && corepack pnpm ...` | **137** | 8,2 s | nao | nao |
| composto terminando em exec (o CMD do site) | 0 | 1,6 s | sim | sim |

Zumbis: 0 nos dois formatos. Queda sem sinal (o servico sai sozinho com codigo
3): o container sai na hora, com o codigo do comando (3 pelo `pnpm run`, 1 pelo
`pnpm exec`) — sem esperar orfao nenhum. O processo de uma sessao `docker exec`
aberta durante o stop nao segura o container (os filhos dele, sim — secao 5).
Fora do PID 1, o `/bin/sh` novo
deu saida identica a do dash numa bateria de 16 invocacoes (`-c` com e sem `$0`,
entrada padrao, arquivo, `-e`, codigo de saida, comando inexistente, `/bin/sh`
pelo caminho).

O 143 do worker de projecao e o codigo do `pnpm exec`, que morre ao repassar o
sinal; o worker drena como orfao e o init espera por ele. A linha com laco
ocupado e a corrida de 30 ms da CLI `tsx` — ela esta NO COMANDO DO PAINEL (secao 5).

---

## 4. O conserto

- **`/bin/sh` das imagens com comando no painel = [`scripts/container/pid1-shell.sh`](../../scripts/container/pid1-shell.sh)**,
  instalado no ultimo `RUN` do `Dockerfile` (screen-app/screen-cron) e do
  `Dockerfile.publication-worker`. E o dash, exceto quando e o PID 1 (ou filho
  direto do init do Docker) com `-c "<comando simples>"`: ai ele vira um init que
  repassa o sinal so ao comando, colhe orfaos e, depois de um pedido de parada,
  espera a arvore inteira sair. Por que nao o tini: ele sai quando o filho direto
  sai, e o `pnpm exec` sai de proposito. A regra de "comando simples", e por que
  ela e estreita, esta no cabecalho do arquivo.
- **Scripts `*:start` de `services/*` = `exec node --import tsx bin/<servico>.ts`.**
  O `exec` faz o shell do `pnpm run` virar o servico; `node --import tsx` tira a
  CLI do meio (um processo so, sem a corrida de 30 ms). Sao entrypoints de
  container (POSIX): no Windows o `cmd.exe` nao tem `exec` — rode o binario
  direto (`node --import tsx bin/...`).
- **Worker de projecao: a espera entre ciclos acorda com o sinal**, e a drenagem
  termina com a linha `[projecao] parado`. A espera era um `setTimeout` de
  `PROJECTION_POLL_INTERVAL_MS` (15 s no default), maior que a carencia de 10 s do
  Swarm.

Cadeia do `screen-cron` depois do conserto:

```
PID 1  /bin/dash /bin/sh -c corepack pnpm --filter @screena/sync scheduler:start   (init)
 └─ node corepack/pnpm                                   (repassa o SIGTERM ao script)
     └─ node --import tsx bin/cinerie-scheduler.ts       (drena e sai 0)
```

O HEALTHCHECK da imagem (PR #291) reconhece o agendador pelo comando do PID 1; o
marcador `scheduler:start` continua em `/proc/1/cmdline` (travado em
`tests/operations/container-healthcheck.test.ts`).

---

## 4b. O Next dos tres apps (`screen-app`, `cinerie-admin`, `cinerie-cms`)

O CMD das tres imagens termina em `exec pnpm --filter <app> start`: o PID 1 e o
**pnpm**, nao o Next. O pnpm repassa o SIGTERM so ao processo que roda o script
`start` — e o `start` de cada app era `next start`, sem `exec`. O elo 2 da secao 2.

O Next trata o SIGTERM sozinho. Lido em `next/dist/server/lib/start-server.js` nas
duas versoes do lockfile (15.5.25 no site e no admin, 15.4.11 no CMS): fecha o
servidor, espera as requisicoes em curso, fecha o resto e sai 0. Nem o Payload nem
o codigo dos apps registra outro handler. Faltava o sinal chegar.

### Laboratorio (CI, imagens REAIS, `docker stop -t 12` com uma requisicao em curso)

A requisicao fica presa no handler pelo PostgreSQL PAUSADO (`/api/health/` no site,
`/health` no admin, `/readyz` no CMS); o `docker stop` chega com ela aberta, e o
banco volta 3 s depois. So um Next que recebeu o sinal e esperou entrega a
resposta. Run [35223972539](https://github.com/maquinanerd/screena/actions/runs/35223972539).

**Como estava** (CMD da imagem, `start` sem `exec`):

| app | cadeia | saida | tempo do stop | requisicao em curso |
| --- | --- | --- | --- | --- |
| site | pnpm (PID 1) -> `sh -c next start` (nao trata SIGTERM) -> Next | **1** | 0,18 s | **derrubada** (curl 52, resposta vazia) |
| admin | a mesma | **1** | 0,24 s | **derrubada** |
| CMS | a mesma, com `--port ${PORT:-3002} --hostname 0.0.0.0` | **1** | 0,24 s | **derrubada** |

**Com `exec next start`:**

| app | formato | saida | tempo do stop | requisicao em curso |
| --- | --- | --- | --- | --- |
| site | CMD da imagem: pnpm (PID 1) -> Next | 0 | 3,1 s | entregue (200) |
| admin | CMD da imagem | 0 | 3,2 s | entregue |
| CMS | CMD da imagem | 0 | 3,2 s | entregue |
| site | "Tini Init" ligado (`--init`) | 0 | 3,1 s | entregue |
| site | comando simples no painel (o init da secao 4) | 0 | 3,1 s | entregue |
| admin | comando simples no painel | **137** | 12,2 s | entregue — e SIGKILL no fim da carencia |
| CMS | comando simples no painel | **137** | 12,2 s | entregue — e SIGKILL no fim da carencia |

Os 3 s sao o banco pausado: o Next esperou a requisicao. Nas duas ultimas linhas o
PID 1 e o dash, porque as imagens do admin e do CMS nao tem o `/bin/sh` da secao 4:
o SIGTERM e descartado, e o Next — que nunca o viu — continua servindo ate o
SIGKILL. O `start` antigo com comando no painel, na imagem do site, tambem da
**137** (12,1 s): o init repassa o sinal ao pnpm, o `sh -c` morre, e o Next orfao
segura o container ate a carencia acabar.

A arvore medida com o conserto tem dois processos — pnpm e `next-server` —, nenhum
zumbi. O PID 1 continua sendo o pnpm, como sempre foi nesses apps: o `exec` do
script nao muda quem colhe orfaos, e o `next start` nao cria processo filho em
regime.

### O conserto

- **`start` de `apps/*` = `exec next start ...`.** O CMS mantem
  `--port ${PORT:-3002} --hostname 0.0.0.0`: o `exec` e do mesmo shell, que ainda
  expande a variavel. Cadeia: `PID 1 pnpm -> next-server`, sem shell no meio. Como
  os `*:start` de `services/*`, sao entrypoints de container (POSIX): no Windows,
  `pnpm --filter @screena/web exec next start`.

---

## 5. O que continua aberto — deliberadamente

- **O comando do painel do `cinerie-publication-worker` ainda passa pela CLI
  `tsx`** (`pnpm ... exec tsx ...`). Com o conserto ele drena; com o laco de
  eventos ocupado no instante do sinal, a CLI mata o worker em 30 ms (medido). So
  sai trocando o comando — por exemplo
  `corepack pnpm --filter @screena/news-ingestion publication-worker:start --allow-production-url`
  (o `pnpm run` repassa o argumento ao script, que ja faz `exec node --import tsx`;
  medido: drena). E decisao de operacao, fora deste codigo.
- **Comando composto no painel** (`cd /app && corepack pnpm ...`, `;`, `|`,
  aspas, variavel): o `/bin/sh` nao reescreve sintaxe de shell, e o dash fica no
  PID 1 como antes. O comando de um servico no painel tem de ser SIMPLES — ou
  terminar em `exec`.
- **Servico novo com comando no painel**: a imagem dele precisa do mesmo
  `/bin/sh` (e entrar na lista `IMAGENS_COM_COMANDO_NO_PAINEL` do teste).
- **CLIs filhas do agendador nao tratam SIGTERM.** No desligamento o agendador
  as aborta (`runScript`), e elas morrem na hora. `sync-omdb-ratings` grava
  `api_sync_logs` uma vez, no FIM do lote (`services/ratings/src/omdb/run.ts`):
  um lote abortado fica sem registro, e a cota que ele gastou tambem. Entregar o
  sinal nao muda isso; muda que agora ha um sinal para a CLI tratar.
- **Lote longo EM PROCESSO do agendador** so olha o desligamento entre filas.
  Se um lote passa da carencia, o SIGKILL chega no meio — sem perda de estado (o
  progresso vive no banco), mas sem drenagem.
- **Console `docker exec` aberto durante o stop**: o init ignora a raiz da sessao
  (pai 0), mas nao os filhos dela (o `bash` que o console abre). Com um console
  aberto, o container espera ate o SIGKILL da carencia — a drenagem do servico ja
  terminou; so o codigo de saida e que vira 137.
- **A carencia do painel** nao aparece na tela. O default do Swarm e 10 s.

---

## 6. Como conferir em producao, depois do deploy

No console do `screen-cron` (aba Bash), uma linha:

```sh
tr '\0' ' ' < /proc/1/cmdline; echo
```

Esperado: `/bin/dash /bin/sh -c corepack pnpm --filter @screena/sync scheduler:start`.
Antes do conserto: `/bin/sh -c corepack pnpm ...` (sem o `/bin/dash` na frente).
No `cinerie-publication-worker`, o mesmo, com o comando dele.

No log de cada redeploy: `scheduler_draining` e `scheduler_stopped` no
`screen-cron`; `sinal recebido` e `[projecao] parado` no
`cinerie-publication-worker`; `catalog_service_draining` e
`catalog_service_stopped` no `screen-catalog-worker`. Antes do conserto essas
linhas nunca apareciam.

Nos tres apps Next (`screen-app`, `cinerie-admin`, `cinerie-cms`) o Next nao
escreve nada ao parar; confere-se a cadeia. No console de cada um, uma linha:

```sh
for p in /proc/[0-9]*; do case "$(tr '\0' ' ' < $p/cmdline)" in next-server*) echo "next ${p#/proc/} pai $(sed 's/.*) //' $p/stat | cut -d' ' -f2)";; esac; done
```

Esperado: `next <pid> pai 1`. Antes do conserto, o pai era o `sh -c next start`.

---

## 7. Travas

- [`tests/operations/container-signals.test.ts`](../../tests/operations/container-signals.test.ts)
  — a forma dos scripts `*:start` e do `start` de todo app de `apps/*` (com
  controle negativo de cada forma que cortava o sinal), o CMD de TODA imagem da
  raiz terminando no `exec pnpm` de um script que entrega o sinal, o `/bin/sh`
  como ultimo `RUN` em cada imagem com comando no painel, e a equivalencia com o
  dash fora do PID 1.
- CI, job `docker-image`, passo "SIGTERM chega ao agendador e aos workers": as
  imagens reais no formato do painel, `docker stop` em cada servico com codigo de
  saida e linha de drenagem, e **um controle negativo por imagem** — o mesmo
  comando com o dash direto no PID 1 tem de sair 137 sem drenar.
- CI, job `docker-image`, passo "SIGTERM chega ao Next (site, admin e CMS)": as
  tres imagens reais com o CMD delas, a cadeia `next-server <- PID 1`, e
  `docker stop` com uma requisicao em curso — saida 0 e resposta entregue. **Um
  controle negativo por imagem**: a mesma imagem, com o `exec` tirado do `start`
  dentro do container, tem de sair diferente de 0 e derrubar a requisicao.
- CI, job `build`: `dash -n` no `pid1-shell.sh`.
