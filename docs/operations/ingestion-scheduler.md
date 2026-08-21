# Agendador de ingestao — o relogio da Cinerie

> Documento operacional. Descreve **onde o relogio mora**, **o ritmo de cada
> dado**, **o teto de cada fornecedor**, **como o dono ve o estado sem abrir
> terminal** e **o que roda em producao, na ordem**.
>
> Codigo: `services/sync/src/scheduler/**` (nucleo puro),
> `services/sync/src/scheduler/runtime/**` (adapters Prisma/HTTP),
> `services/sync/bin/cinerie-scheduler.ts` (o servico),
> `services/sync/bin/ingestion-status.ts` (o painel em texto).

---

## 1. Onde o relogio mora

**Um servico proprio no EasyPanel (`screen-cron`), no mesmo projeto do
`screen-app` e do `screen-db`.**

As tres alternativas foram avaliadas contra os quatro criterios do dono:

| Criterio | Servico proprio | GitHub Actions agendado | Dentro do `screen-app` |
| --- | --- | --- | --- |
| Sobrevive a redeploy | **sim** — nenhum estado vive no processo | sim | nao: todo deploy do front mata um lote no meio |
| Nao roda duas vezes com duas replicas | **sim** — `pg_try_advisory_lock` por fila | so com trava externa | nao: escalar o front duplica o relogio |
| Enxerga o `screen-db` pela rede interna | **sim** | **nao** — exigiria expor o banco na internet | sim |
| O dono ve que rodou sem terminal | **sim** — `/status`, `/readyz`, log | so no historico do Actions | misturado ao log do site |

O criterio que **decidiu** foi o terceiro: um workflow do GitHub Actions
precisaria do PostgreSQL alcancavel de fora. Trocar a trava contra execucao dupla
por um buraco de firewall e um pessimo negocio. O segundo criterio **eliminou** o
agendador embutido no `screen-app`.

### A trava contra execucao dupla

`pg_try_advisory_lock`, uma chave por fila, derivada do nome por SHA-256 truncado
em 63 bits (`advisoryLockKey`). Escolhida sobre uma tabela de lease por tres
motivos:

1. **nao exige migration** — schema novo e um passo a mais entre o dono e o
   agendador funcionando;
2. **libera sozinha na queda** — o lock de sessao morre com a conexao; uma lease
   ficaria presa ate o TTL vencer depois de um OOM;
3. **e nao-bloqueante** (`try`) — quem nao pegou desiste e **loga**. Um agendador
   que espera acumula ciclos e dispara tudo de uma vez quando a trava solta.

> **Armadilha do pool, e ela e fatal se ignorada.** `pg_advisory_lock` e de
> SESSAO. Um `PrismaClient` com pool pode emitir o `lock` numa conexao e o
> `unlock` em outra — o Postgres nao levanta erro, so devolve `false` e escreve um
> WARNING no log do servidor, e a trava fica presa ate a conexao morrer. Por isso
> `createLockClient` cria um cliente **dedicado com `connection_limit=1`**, e
> substitui qualquer `connection_limit` herdado do ambiente.

A fila `catalog_jobs` mantem a sua propria trava por LINHA
(`FOR UPDATE SKIP LOCKED`). As duas convivem em niveis diferentes: o advisory lock
impede dois **agendadores** de decidir; o SKIP LOCKED impede dois **workers** de
pegar o mesmo job. Nenhuma substitui a outra.

**Provas:**

- contrato (roda em todo `pnpm test`, sem banco):
  `services/sync/src/scheduler/__tests__/lock.test.ts`
- realidade (dois PROCESSOS, PostgreSQL efemero):
  `pnpm --filter @screena/sync prove:scheduler-lock`

---

## 2. A tabela de ritmos

Fonte executavel: `services/sync/src/scheduler/rhythms.ts`. Cada entrada carrega
`rationale` — o **dado** que justifica o intervalo. Um teste de governanca
reprova entrada sem motivo escrito.

| Fila | Ritmo | Fornecedor | Por que |
| --- | --- | --- | --- |
| `watch_offers` | **diario** | tmdb | O dado que mais estraga. Endpoint DEDICADO (`/movie/{id}/watch/providers`), ~2 kB, contra 130,6 kB (filme) / 648,3 kB (serie) do detalhe. |
| `trending` | **6 h** | tmdb | O sinal de AGORA. 4 requisicoes por ciclo (movie\|tv x day\|week, 1 pagina). O intervalo NAO e numero novo: `discovery-snapshots/index.ts:32` ja declarava TTL de 6 h para trending. |
| `airing_series` | **diario** | tmdb | Episodio que foi ao ar hoje tem que estar na pagina hoje. So `status` em exibicao/producao. |
| `discovery` | **diario** | tmdb-exports | Os Daily ID Exports saem uma vez por dia (~08:00 UTC). Arquivo publico: sem token, sem cota. |
| `changes` | **6 h** | tmdb | A janela do `/changes` e ~24 h (max. 14 dias). 6 h da quatro tentativas dentro de uma janela — tres ciclos podem falhar sem que nada se perca. |
| `cinerie_score` | **por evento** (teto 24 h) | — | Derivado nao tem ritmo, tem gatilho. O teto existe para que um gatilho perdido nao congele o numero para sempre. |
| `search_projection` | **por evento** (teto 24 h) | — | Ao fim de qualquer lote que mudou algo. Sem isso a pagina nova existe e ninguem a acha. |
| `ratings_omdb` | **semanal**, em rodizio | omdb | 168 h e o MENOR `refreshAfterHours` das tres fontes da OMDb (`RATING_STALE_POLICY`). O limite real e a COTA, nao o relogio. |
| `title_detail_active` | **semanal** | tmdb | Data, elenco e sinopse ainda mudam antes do lancamento. Lado curto da janela de 7–14 dias. |
| `people` | **mensal** | tmdb | Biografia quase nao muda. Quem entra num titulo novo chega pelos CREDITOS, no mesmo request do titulo — nao espera este ciclo. |
| `title_detail_ended` | **mensal** | tmdb | Filme lancado e serie finalizada nao mudam mais. O que muda neles (a OFERTA) tem fila propria, diaria. |
| `awards` | **mensal**, **diario na janela** | omdb | Fora da temporada nao acontece nada; dentro dela muda em horas. Janelas em `awards-window.ts`. |

### Mudancas em relacao a proposta inicial

1. **"Trailers e videos junto com o detalhe"** — mantido, e agora explicito: eles
   chegam no mesmo `append_to_response`, custo zero adicional.
2. **"Nota e votos do TMDB junto com o detalhe"** — mantido pelo mesmo motivo.
3. **Ofertas separadas do detalhe** — mudanca de IMPLEMENTACAO, nao de ritmo. Ate
   aqui a oferta so chegava dentro do payload de detalhe, entao "oferta diaria"
   implicaria "detalhe diario". Foi acrescentado o endpoint dedicado
   (`getMovieWatchProviders` / `getTvWatchProviders`) para que os dois ritmos
   sejam de fato diferentes. Sem ele, a linha "detalhe encerrado = mensal" da
   tabela seria letra morta.
4. **`changes` a cada 6 h** — nao estava na proposta. Entrou porque a janela do
   `/changes` e finita: sem redundancia dentro dela, tres falhas seguidas perdem
   mudancas para sempre.
5. **`trending` a cada 6 h** (2026-08-21). O client existia e estava testado
   desde a Fase 6, o job `sync_lists` existia, a tabela existia — e ninguem
   enfileirava. Ver a secao "O sinal de AGORA" abaixo.

### A ordem DENTRO de cada fila

`popularity DESC NULLS LAST, id ASC` — nunca alfabetica, nunca por `id` sozinho.

**O sinal usado e `popularity` do TMDB.** Ele e medido (visualizacoes, votos e
watchlist do dia anterior), ja vem preenchido para todo o catalogo, ja tem indice
nas duas tabelas e e atualizado por nos em todo sync de detalhe.

> **"Titulo que o leitor abriu recentemente" nao existe como medicao.** A Cinerie
> nao registra visualizacao de pagina: nao ha tabela de pageview, nem contador em
> `slugs`, nem analytics no banco. As unicas acoes de leitor persistidas sao de
> usuario LOGADO (`viewing_events`), que e outra populacao e nao responde "que
> pagina foi aberta". Ordenar por um sinal que nao se mede seria fabricar
> prioridade.
>
> A demanda REAL de leitor — alguem esperando na tela agora — nao e tratada por
> ordenacao e sim por **reserva de cota** (secao 3). E uma garantia mais forte:
> ordem so ajuda se a fila chegar no item.

O que mudou no codigo: `services/ratings/src/persistence/stale-entity-candidates.ts`
ordenava por `e."id" ASC` — ordem de INSERCAO.

### O sinal de AGORA: trending na prioridade

`popularity` e ACUMULADA. Um titulo que estreou ontem e explodiu tem popularity
acumulada baixa: cai na faixa de CAUDA (`+16`) e espera atras de milhares de
titulos antigos e mornos, no exato dia em que a pagina dele mais e procurada.

**O peso: a posicao do `trending/day` SUBSTITUI o rank de popularidade.** Nao
soma, nao pondera. Somar exigiria uma constante inventada — `popularity` e um
float sem teto publicado e a posicao do trending e um ordinal de 1 a 20, e nao
existe taxa de conversao entre os dois (nem o TMDB publica, nem medimos).
Substituir nao precisa de constante nenhuma, porque os dois ja sao a MESMA
grandeza (ordem de atencao) em janelas diferentes.

**Efeito medido:** rank 40.000 por popularidade (offset `+16`) que aparece na
posicao 3 do trending vira rank 3 (offset `0`). Sao **16 pontos** de prioridade,
do fundo da faixa `scheduled` para a frente dela. O teto continua valendo: o
deslocamento fica em `[0, 16]`, entao trending **nunca** promove um pedido para a
faixa de outro motivo — `changes` e `on_demand` seguem na frente.

**Duas ressalvas que precisam estar escritas:**

1. **`day` e `week` nao colapsam.** `day` alimenta a prioridade da fila; `week`
   existe para a superficie "Popular essa semana". Sao janelas diferentes e
   respondem perguntas diferentes.
2. **O snapshot so guarda entidade JA PROMOVIDA** (o store descarta o resto). Ou
   seja: este sinal acelera titulo que ja existe no catalogo; ele **nao** acelera
   a primeira ingestao de um titulo que o catalogo ainda nao tem — quem descobre
   esse continua sendo o Daily ID Export, pela fila `discovery`.

**Degradacao segura:** a leitura filtra por `expires_at > now`, nao por "o mais
recente". Se a fila `trending` parar, o snapshot vence, o mapa fica vazio e a
fila volta a ordenar por popularidade acumulada — o comportamento anterior, que
continua correto. E a parada e VISIVEL: a fila cruza 2x o intervalo e o alerta
dispara.

---

## 3. Cota: o teto real de cada fornecedor

Fonte executavel: `packages/config/src/provider-quotas.ts`. Cada entrada carrega
`basis` — se o numero foi **publicado** pelo fornecedor, **medido** por nos, ou e
um **piso conservador** por nao haver numero publicado.

| Fornecedor | Teto/dia | Teto/s | Base | Fonte |
| --- | --- | --- | --- | --- |
| `omdb` | **1.000** | — | `published` | Pagina de chave da OMDb: plano FREE anunciado como "1,000 daily limit". |
| `tmdb` | **sem teto diario** | 40 (nosso piso) | `assumed_floor` | O limite de 40 req/10 s foi removido em 12/2019; a orientacao vigente e ~50 req/s e nenhuma cota diaria. Usamos 40 (20% abaixo). |
| `tmdb-exports` | — | — | `published` | Arquivos publicos em `files.tmdb.org`, fora da API: sem token e sem cota. |
| `rapidapi` | **16** (500/mes) | 1 | `assumed_floor` | O teto e do PLANO contratado, e o repositorio nao registra qual esta ativo. Piso do menor plano gratuito tipico. Nenhuma fonte RapidAPI esta ativa como produto. |

### O gargalo e a OMDb, e ele agora e respeitado

`checkOmdbBudget` existia em `@screena/config`, tinha nove testes proprios e
**nenhum chamador em codigo de producao**. A fila de fundo gastava as 1.000
requisicoes sem pedir licenca. Ligado em `services/ratings/src/omdb/run.ts`:

- **rodizio, nao varredura** — a selecao pega a fatia mais velha
  (`omdbRefreshCutoff`, 168 h), nunca recomeca do inicio;
- **quem espera na tela ganha** — 15% do teto (150/dia) e reservado ao consumidor
  `on_demand`; a fila de fundo (`seed`) cede a vez assim que o saldo entra na
  reserva. A fila de fundo **nunca** consome 100%;
- **estouro nao vira pagina muda** — o id barrado nao gera linha nenhuma, continua
  stale e volta como candidato no ciclo seguinte. O ciclo e registrado como
  `aborted` (nunca `empty`) com o motivo `quota-denied` e a contagem de
  devolvidos. A pagina segue mostrando a nota anterior com a data dela.

**Quantos dias uma volta completa leva** (fila de fundo, 850 requisicoes/dia uteis
apos a reserva, 1 requisicao por titulo — um payload da OMDb traz as TRES fontes):

| Tamanho do catalogo | Titulos com `imdb_id` | Volta completa |
| --- | --- | --- |
| hoje (239) | ate 239 | **menos de 1 dia** |
| 10.000 | 10.000 | **12 dias** |
| 20.000 | 20.000 | **24 dias** |

Com 10 mil titulos, a janela de frescor de 7 dias **nao e alcancavel no plano
gratuito**: a volta leva 12. As saidas sao plano pago, catalogo menor, ou aceitar
que a nota tem ate 12 dias. E uma decisao do dono, e o painel mostra o numero
todos os dias para que ela nao seja tomada por acidente.

---

## 4. Rastro: nada falha em silencio

- **Toda execucao com fornecedor grava `api_sync_logs`** com `endpoint =
  scheduler/<fila>`, status, itens processados, duracao e `quota_cost`.
- **Filas derivadas** (`cinerie_score`, `search_projection`) NAO gravam linha de
  sync — seria afirmar um sync externo que nao houve. O ultimo sucesso delas vem
  do artefato: `MAX(cinerie_score_calculations.calculated_at)` e
  `MAX(search_documents.updated_at)`. E medida melhor: afirma que o trabalho SAIU.
- **Falha parcial e falha visivel.** `classifyRun` decide pelas CONTAGENS, nunca
  pela ausencia de excecao. Um lote de 300/500 e `partial`, reporta os 200 e o
  motivo, e **nao avanca o carimbo de ultimo sucesso** — senao uma fila que
  processa 1 de 500 todo ciclo pareceria saudavel para sempre.
- **Desfecho ruim sem motivo** ganha o motivo sintetico `reason_not_reported`. O
  vazio nao passa.

### Como o dono ve, sem abrir terminal

| Superficie | O que responde |
| --- | --- |
| `GET /status` do `screen-cron` | **O painel.** HTML, sem script e sem fonte remota: uma linha por fila com intervalo, ultimo sucesso, estado (em dia / vencida / PARADA / NUNCA RODOU) e atraso; e a tabela de cota do dia com saldo total e saldo da fila de fundo. Semaforo `OK`/`DEGRADADO` no topo. `?format=json` e `?format=text` para maquina. |
| `GET /readyz` | Pode trabalhar? Banco alcancavel, credencial presente, autorizacao de escrita. Carrega a contagem de filas paradas no payload. |
| `GET /healthz` | Liveness. Nao toca banco. **E este que o healthcheck do container deve apontar.** |
| Log do servico | Uma linha `error` por fila parada, evento `scheduler_queue_stalled`. |

### O alerta de fila parada

Limiar: **2x o intervalo da propria fila** (`STALL_THRESHOLD_RATIO`). Duas janelas
perdidas nao acontecem por acaso; uma cabe em manutencao ou upstream fora do ar.
Fila que nunca rodou vira alerta separado (`never_ran`) apos 6 h de carencia — sem
isso todo deploy nasceria com onze alertas vermelhos, e um painel que nasce
vermelho ensina o dono a ignorar vermelho.

**Por onde sai:** log `error` (evento `scheduler_queue_stalled`) + `/status` em
`DEGRADADO` + a contagem no payload de `/readyz`.

> **Por que fila parada NAO derruba `/readyz` para 503:** o healthcheck do
> orquestrador REINICIA o container. Reiniciar um agendador saudavel porque a
> OMDb esta fora do ar troca um problema visivel por um crash-loop — e o restart
> zera o `startedAt`, apagando o proprio alerta.

---

## 5. Retomada e idempotencia

- **Idempotente.** Todo enfileiramento carrega chave com o DIA (ou a HORA, no
  `/changes`): repetir dentro da janela e no-op; na janela seguinte e trabalho
  novo. Sem o dia, o segundo ciclo colidiria na mesma chave e a fila congelaria
  no primeiro lote, em silencio.
- **Retomavel.** Nenhum progresso vive no processo: catalogo e `catalog_jobs`
  (com `reclaimOrphans`, backoff e dead-letter), o `/changes` avanca checkpoint
  **apos** o commit, e o ultimo sucesso de cada fila e lido do banco a cada tick.
- **Nunca escreve pela metade.** A entidade entra inteira pelo handler que ja
  existe; o agendador nunca escreve entidade diretamente.
- **Backoff.** Retry com backoff exponencial e circuit breaker vivem nos clientes
  (`catalog-jobs/backoff.ts`, `rapidapi-core`); o worker OMDb interrompe o lote
  apos 3 falhas consecutivas ou circuito aberto, e REPORTA quantos ficaram.
- **Dado que some da fonte nao some do banco em silencio.** Oferta que deixou de
  existir vira snapshot vazio com data (`watch_offers` reporta `no_offer_today`),
  nunca linha apagada sem registro.

---

## 6. Variaveis de ambiente

| Variavel | Default | O que faz |
| --- | --- | --- |
| `DATABASE_URL` | — | Obrigatoria. |
| `TMDB_READ_ACCESS_TOKEN` (ou `TMDB_API_KEY`) | — | Obrigatoria. |
| `CINERIE_SCHEDULER_APPLY` | `false` | **`true` para trabalhar de verdade.** Sem ela o ciclo roda inteiro em dry-run. Em `NODE_ENV=production` o servico RECUSA subir sem ela. |
| `CINERIE_SCHEDULER_HEALTH_PORT` | `3005` | Porta de `/healthz`, `/readyz`, `/status`. |
| `CINERIE_SCHEDULER_TICK_MS` | `300000` (5 min) | Intervalo entre avaliacoes do relogio. |
| `CINERIE_SCHEDULER_BATCH_LIMIT` | `200` | Teto de itens por ciclo de cada fila. |
| `CINERIE_SCHEDULER_DISABLED_QUEUES` | vazio | Lista separada por virgula. |
| `CINERIE_SCHEDULER_DISCOVERY_LIMIT` | `2000` | **Teto de ids por TIPO em cada descoberta.** `0` = SEM TETO (o universo inteiro: 1,23 M filmes + 228 k series + 4,86 M pessoas) — e nao "nenhum id". Mesma semantica de `CATALOG_WORKER_DISCOVERY_LIMIT`, de proposito. |
| `CINERIE_SCHEDULER_LOCALE` | `pt-BR` | Locale dos jobs enfileirados. |
| `CINERIE_SCHEDULER_WORKER_ID` | `scheduler-<pid>` | Aparece no painel e no log. |

> **ATENCAO ao teto de descoberta.** Ate 21/08/2026 `runDiscovery` mandava
> `limit: null` HARDCODED, e `null` e o export INTEIRO. Com
> `enqueueDetails: true`, o primeiro ciclo drenado enfileiraria da ordem de
> **6,3 milhoes** de `sync_details`. O servico de catalogo sempre teve o botao
> equivalente (default 2000) e este runbook manda DESLIGA-LO quando o agendador
> sobe — entao o produtor COM teto saía de cena e o SEM teto ficava. Agora os
> dois tem o mesmo default.

> **Estas duas variaveis pertencem ao `screen-catalog-worker`, nao a este
> servico** — e o servico dele tem passo proprio na secao 7. Ate 21/08/2026
> elas eram a UNICA mencao a ele neste documento, dentro de uma citacao na
> secao de variaveis do `screen-cron`, sem passo, sem titulo e sem destaque.
> O `screen-cron` foi criado; o `screen-catalog-worker` nao. Resultado medido:
> 534 jobs `pending` em `catalog_jobs`, nenhum jamais processado, com este
> painel exibindo nove filas verdes.

---

## 6.1. O CONSUMIDOR DA FILA — o outro servico, e ele nao e opcional

O agendador **ENFILEIRA**. Ele nunca processa job nenhum. Quem tira o job de
`pending` e o transforma em linha de catalogo e um **segundo servico**, com
imagem, comando e ciclo de vida proprios:

| | Produtor | Consumidor |
| --- | --- | --- |
| Servico | `screen-cron` | **`screen-catalog-worker`** |
| Comando | `corepack pnpm --filter @screena/sync scheduler:start` | `corepack pnpm --filter @screena/ingestion catalog-worker:start` |
| Escreve | `catalog_jobs` (`store.enqueue`) | `movies`, `tv_shows`, `people`, `tmdb_images`, `tmdb_videos`, ... |
| Arquivo | [`services/sync/bin/cinerie-scheduler.ts`](../../services/sync/bin/cinerie-scheduler.ts) | [`services/ingestion/bin/catalog-worker-service.ts`](../../services/ingestion/bin/catalog-worker-service.ts) |
| Dockerfile | `Dockerfile` (mesmo do app) | **`Dockerfile.catalog-worker`** |

**Subir so o `screen-cron` produz exatamente o estado de 21/08/2026:** a fila
cresce todo dia, o painel fica verde, e o catalogo nao ganha uma linha.

O roteiro completo de criacao do servico (variaveis uma a uma, File Mount dos
segredos, healthcheck, replicas, diagnostico de `503`) esta em
[`docs/runbooks/EASYPANEL_CATALOG_WORKER.md`](../runbooks/EASYPANEL_CATALOG_WORKER.md).
**Aquele documento chama o servico de `cinerie-catalog-worker` e este o chamava
de `screen-catalog-worker`** — dois nomes para o mesmo servico ausente, o que
ajudou a lacuna a passar batida. O nome canonico e o do painel; o que importa e
que exista UM, e um so.

### Configuracao do `screen-catalog-worker`

| Campo | Valor |
| --- | --- |
| Dockerfile | `Dockerfile.catalog-worker` (contexto = raiz do repositorio) |
| Comando | vem do `CMD` da imagem (`catalog-worker:start`) |
| Porta | `3004`, **so health — nao exponha dominio publico** |
| Liveness | `GET /healthz` -> 200 |
| Readiness | `GET /readyz` -> 200/503 (o campo `detail` diz qual check barrou) |
| Restart | `always` |
| Replicas | **1** (o `claim` usa `SKIP LOCKED`, entao 2 nao corrompe — so duplica cota) |
| Volumes | **nenhum** (a imagem fica no TMDB; nada de midia entra no storage) |

| Variavel | Tipo | Valor | Obrigatoria |
| --- | --- | --- | --- |
| `DATABASE_URL` | **File Mount** | connection string do `screen-db` | **sim** |
| `TMDB_READ_ACCESS_TOKEN` | **File Mount** | token v4 do TMDB | **sim** |
| `NODE_ENV` | env var | `production` | sim (ja vem na imagem) |
| `CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED` | env var | `true` | **sim — sem ela o servico RECUSA subir** |
| `CATALOG_WORKER_ENQUEUE_DISCOVERY` | env var | `false` | **sim, com o `screen-cron` de pe** |
| `CATALOG_WORKER_ENQUEUE_CHANGES` | env var | `false` | **sim, com o `screen-cron` de pe** |
| `CATALOG_WORKER_HEALTH_PORT` | env var | `3004` | nao (default) |
| `CATALOG_WORKER_ID` | env var | `cinerie-catalog-worker-1` | nao |
| `CATALOG_WORKER_CONCURRENCY` | env var | comece em `2` | nao (default `4`) |
| `CATALOG_WORKER_JOB_TIMEOUT_MS` | env var | `120000` | nao (default) |
| `CATALOG_WORKER_POLL_INTERVAL_MS` | env var | `1000` | nao (default) |
| `CATALOG_WORKER_LOCALE` | env var | `pt-BR` | nao (default) |
| `CATALOG_WORKER_DISCOVERY_LIMIT` | env var | `2000` | so importa com o enfileirador LIGADO |
| `CATALOG_WORKER_DISCOVERY_KINDS` | env var | `movie,tv,person` | so importa com o enfileirador LIGADO |
| `CATALOG_WORKER_DISCOVERY_INTERVAL_MS` | env var | `86400000` (24 h) | so importa com o enfileirador LIGADO |
| `CATALOG_WORKER_CHANGES_INTERVAL_MS` | env var | `21600000` (6 h) | so importa com o enfileirador LIGADO |

**Por que `ENQUEUE_DISCOVERY`/`ENQUEUE_CHANGES` vao para `false`:** o
`screen-cron` passou a ser o relogio da plataforma e enfileira a MESMA
descoberta, com a MESMA chave de idempotencia. A duplicacao e inofensiva hoje,
mas dois relogios para o mesmo trabalho e uma divergencia esperando acontecer —
no dia em que a chave mudar de um lado, sao dois lotes por dia sem ninguem
notar. Desligadas, o worker continua fazendo o papel que so ele faz: **drenar**.
O default das duas e `true` de proposito: desligar por omissao quebraria uma
instalacao que ainda nao subiu o agendador.

**Fail-loud:** valor invalido em qualquer variavel numerica ou booleana faz o
servico **recusar subir** com a mensagem do campo — nao cai em default
silencioso. `"1"`, `"yes"` e `"sim"` **nao** valem como `true`.

---

## 7. O que roda em producao, na ordem

```bash
# 0. Dependencias (o agendador acrescentou workspaces novos)
corepack pnpm install

# 1. Registro legal — a leva nova. REVIEW primeiro: read-only, nao escreve.
corepack pnpm legal sources review

# 2. APPLY da leva. Dry-run por default; --confirm escreve.
#    A FORMA E FECHADA: `sources` e o comando, `apply` o subcomando, e
#    --policy-version e comparado com AUTHORIZATION_BATCH (qualquer outro valor
#    sai com erro de uso sem escrever nada). A grafia do --reviewer e a MESMA que
#    ja esta em producao (sem acento em "proprietario") — usar outra criaria duas
#    grafias da mesma pessoa em `decided_by`.
corepack pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-08-v2" --confirm

# 3. Conferir o estado da ingestao (read-only, sem rede)
corepack pnpm --filter @screena/sync ingestion:status

# 4. Ligar o agendador (servico screen-cron no EasyPanel)
#    comando: corepack pnpm --filter @screena/sync scheduler:start
#    env:     CINERIE_SCHEDULER_APPLY=true
#    health:  /healthz na porta 3005

# 5. Semente (SO depois de o agendador estar estavel) — dry-run primeiro
corepack pnpm --filter @screena/ingestion catalog plan-bootstrap --limit 20000
```

As migrations **ja estao aplicadas** (22, nenhuma pendente). O agendador **nao
acrescenta migration nenhuma**: advisory lock nao usa tabela, e o rastro vai para
`api_sync_logs`, que ja existe.
