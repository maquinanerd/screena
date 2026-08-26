# Roteiro de produção — espelho TMDB e provedores externos

> **Roteiro, não execução.** Nenhum deploy foi feito. Nenhuma imagem foi
> construída (o daemon do Docker não está rodando nesta máquina — o CLI existe,
> `docker info` falha). Nenhuma migration foi aplicada. Nenhum serviço do
> EasyPanel foi acessado.
>
> Idioma: pt-BR. **Nenhum valor de chave, token ou senha aparece aqui.**
> Data: 2026-08-11.

---

## 0. Ordem geral — e o que bloqueia o quê

```
[0] MEDIR O DISCO  ────────────────► bloqueia TUDO da Parte 1
        │
        ├─► [1] migration (sua aprovação) ──► [2] build ──► [3] serviço ──► [4] ligar ingestão
        │
        └─(independente)─► [5] ratings/streaming (Parte 2) — pode ir em paralelo
```

A Parte 2 **não depende** do disco: ela não escreve volume relevante.

---

## 1. Variáveis novas — qual serviço, e env var ou File Mount

### 1.1. Serviço NOVO: `cinerie-catalog-worker`

| # | Variável | Tipo | Valor | Obrigatória |
| --- | --- | --- | --- | --- |
| 1 | `DATABASE_URL` | **File Mount** | connection string do `screen-db` | **sim** |
| 2 | `TMDB_READ_ACCESS_TOKEN` | **File Mount** | token v4 do TMDB | **sim** |
| 3 | `NODE_ENV` | env var | `production` | sim (já vem na imagem) |
| 4 | `CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED` | env var | `true` | **sim** — sem ela o serviço recusa subir |
| 4a | `CATALOG_WORKER_ENQUEUE_DISCOVERY` | env var | `false` | **sim, com o `screen-cron` de pé** — ver nota abaixo |
| 4b | `CATALOG_WORKER_ENQUEUE_CHANGES` | env var | `false` | **sim, com o `screen-cron` de pé** — ver nota abaixo |
| 5 | `CATALOG_WORKER_HEALTH_PORT` | env var | `3004` | não (default) |
| 6 | `CATALOG_WORKER_ID` | env var | `cinerie-catalog-worker-1` | não |
| 7 | `CATALOG_WORKER_CONCURRENCY` | env var | **comece em `2`** (ver §6) | não (default 4) |
| 8 | `CATALOG_WORKER_DISCOVERY_LIMIT` | env var | **comece em `2000`** | não (default 2000) |
| 9 | `CATALOG_WORKER_DISCOVERY_KINDS` | env var | `movie,tv` no 1º dia; `movie,tv,person` depois | não |
| 10 | `CATALOG_WORKER_DISCOVERY_INTERVAL_MS` | env var | `86400000` (24 h) | não |
| 11 | `CATALOG_WORKER_CHANGES_INTERVAL_MS` | env var | `21600000` (6 h) | não |
| 12 | `CATALOG_WORKER_JOB_TIMEOUT_MS` | env var | `120000` | não |

> **As linhas 4a e 4b não existiam quando este roteiro foi escrito (2026-08-11).**
> O `screen-cron` (agendador) só virou o relógio da plataforma em 21/08, e é ele
> quem passou a enfileirar a MESMA descoberta diária. Quem criou o serviço
> seguindo a lista original de 12 variáveis subiu o worker com os dois
> enfileiradores no default `true` — e ficou com **dois relógios para o mesmo
> trabalho**. Hoje a duplicação é inofensiva (a chave de idempotência é a mesma:
> `discover_ids:<kind>:daily-exports:<dia>`), mas no dia em que a chave mudar de
> um lado são dois lotes por dia sem ninguém notar. **Desligadas, o worker
> continua fazendo o papel que só ele faz: drenar.** O default das duas é `true`
> de propósito — desligar por omissão quebraria uma instalação que ainda não
> subiu o agendador.
>
> Fonte canônica das duas:
> [`docs/operations/ingestion-scheduler.md` §6.1](../operations/ingestion-scheduler.md).

> **Por que File Mount para os dois segredos.** Segredo passado como
> `--build-arg` vaza **duas vezes**: no log de build (que o painel mostra) e nas
> **camadas da imagem** (`docker history` devolve). Já aconteceu neste projeto.
> O `Dockerfile.catalog-worker` **não tem nenhum `ARG` de credencial** — os
> únicos `ARG` são metadados de build (SHA, versão, data). É o mesmo padrão do
> `cinerie-cms`.

> **`CATALOG_WORKER_DISCOVERY_LIMIT=0` significa SEM TETO** (o universo inteiro:
> 1,23 M filmes + 228 k séries + 4,86 M pessoas), **não** "nenhum id". Só use `0`
> depois de a Parte 0 confirmar o disco.

> **Fail-loud:** valor inválido em qualquer variável numérica ou booleana faz o
> serviço **recusar subir** com a mensagem do campo — não cai em default
> silencioso. `"1"`, `"yes"` e `"sim"` **não** valem como `true`.

### 1.2. Serviço existente: onde roda o `catalog-cycle-with-alert.sh` (se você o usar)

| # | Variável | Tipo | Valor |
| --- | --- | --- | --- |
| 13 | `CINERIE_CATALOG_CYCLE_PRODUCTION_CONFIRMED` | env var | `true` |

Sem ela, em produção, o script **recusa** com exit 3 em vez de rodar quatro
comandos que falhariam um a um.

> O serviço em container (§1.1) e este script são **caminhos alternativos**, não
> complementares. Se você subir o `cinerie-catalog-worker`, **não** agende o
> script também: dois consumidores da mesma fila duplicam cota do TMDB à toa (o
> `claim` usa `SKIP LOCKED`, então não corrompe — só desperdiça).

### 1.3. Parte 2 — ratings e streaming (serviço onde os workers rodam)

| # | Variável | Tipo | Valor |
| --- | --- | --- | --- |
| 14 | `CINERIE_RATINGS_PROVIDER_AUTHORIZED` | env var | `true` |
| 15 | `CINERIE_STREAMING_PROVIDER_AUTHORIZED` | env var | `true` |
| 16 | `RAPIDAPI_FILM_SHOW_RATINGS_KEY` | **File Mount** | chave |
| 17 | `RAPIDAPI_STREAMING_AVAILABILITY_KEY` | **File Mount** | chave |

São **separadas por provedor** de propósito: desligar uma não desliga a outra.

**Nenhuma variável nova entra no `screen-app`.** O site não consulta provedor
externo (invariante 3) — ele lê o banco.

---

## 2. Serviços que precisam de redeploy, e em que ordem

| Ordem | Serviço | Motivo | Pode esperar? |
| --- | --- | --- | --- |
| 1 | `screen-db` | **migration** (só depois da sua aprovação) | é o ponto de não-retorno |
| 2 | `cinerie-catalog-worker` | **serviço novo** — criar | depende de 1 |
| 3 | serviço dos workers RapidAPI | variáveis 14–17 | **independente**, pode ir antes |
| 4 | `screen-app` | **nenhum redeploy necessário** | — |

O `screen-app` não muda: a Parte 1 não toca `apps/web`, e a Parte 2 só mexe em
gate de worker e em **teste** de presenter — o código de exibição em si não
mudou (o crédito já era bloqueante).

### Criar o serviço `cinerie-catalog-worker`

| Campo | Valor |
| --- | --- |
| Repositório | `maquinanerd/screena` |
| Branch | `claude/tmdb-mirror-disk-d64e67` (após merge: `main`) |
| Contexto de build | raiz do repositório |
| Dockerfile | `Dockerfile.catalog-worker` |
| Porta | `3004` / HTTP (**só health — não exponha domínio público**) |
| Healthcheck (liveness) | `GET /healthz` → 200 |
| Readiness | `GET /readyz` → 200/503 |
| Restart | `always` |
| Réplicas | **1** (ver §6) |
| Volumes | **nenhum** — imagens ficam no TMDB, nada de mídia entra no storage |

---

## 3. Comandos no console — qual serviço, e o que esperar

### [0] Parte 0 — **primeiro de tudo**

Os comandos estão em
[`docs/operations/tmdb-mirror-disk-budget.md`](../operations/tmdb-mirror-disk-budget.md)
§1. Resumo do que esperar:

| Comando | Serviço | Saída esperada |
| --- | --- | --- |
| `df -h` | `screen-app` | tabela de filesystems; olhe a coluna **Avail** da partição do Docker |
| `SELECT pg_size_pretty(pg_database_size(current_database()));` | `screen-db` | uma linha, ex. `12 GB` |
| a consulta de `tmdb_raw` (§1.2 do doc) | `screen-db` | total / só-tabela / TOAST+índices / nº de linhas |
| o censo de entidades (§1.2) | `screen-db` | 5 linhas: movies, tv_shows, seasons, episodes, people |
| **a consulta de compressão (§1.3)** | `screen-db` | média comprimida vs. JSON cru e o **fator de compressão** — pode valer 200 GB |

**Não siga para [1] sem esses números.**

### [1] Migration — só depois da sua aprovação

Antes, as **duas pré-condições** (elas podem abortar a migration no meio):

```sql
-- (a) linhas sem tmdb_id
SELECT 'seasons' AS t, COUNT(*) FROM seasons  WHERE tmdb_id IS NULL
UNION ALL SELECT 'episodes', COUNT(*) FROM episodes WHERE tmdb_id IS NULL;
```

```sql
-- (b) tmdb_id DUPLICADO — se vier alguma linha, PARE
SELECT 'seasons' AS t, tmdb_id, COUNT(*) FROM seasons
 WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1
UNION ALL
SELECT 'episodes', tmdb_id, COUNT(*) FROM episodes
 WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1;
```

`(b)` com resultado = já há corrupção do upsert posicional. **Pare e me chame.**

**Backup antes.** Depois, no serviço que aplica migration do `screen-db`:

```bash
pnpm --filter @screena/db db:migrate:deploy
```

Espere: `N migrations found` seguido de `applied`. Erro → restaure o backup.

### [2] Build e subida do worker

Depois de criar o serviço no painel, verifique:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3004/healthz
```
→ **`200`**. Se não responder, o serviço morreu na subida: veja o log (§4).

```bash
curl -sS http://127.0.0.1:3004/readyz
```
→ **`200`** com `"status":"ready"` e os 6 checks em `ok`:

```json
{"status":"ready","service":"cinerie-catalog-worker","checks":[
 {"name":"authorization","status":"ok","detail":"escrita em producao autorizada"},
 {"name":"config_database","status":"ok"},
 {"name":"config_tmdb","status":"ok"},
 {"name":"database","status":"ok"},
 {"name":"queue_schema","status":"ok"},
 {"name":"dead_letter","status":"ok"}]}
```

**503 é diagnóstico, não mistério** — o campo `detail` do check que bloqueou diz
exatamente o quê:

| `detail` | O que fazer |
| --- | --- |
| `sem CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED=true` | variável 4 |
| `DATABASE_URL ausente` | File Mount 1 |
| `TMDB_READ_ACCESS_TOKEN ... ausente` | File Mount 2 |
| `banco inalcancavel` | rede/credencial do `screen-db` |
| `catalog_jobs ausente: migration ... atrasada` | volte ao passo [1] |

### [3] Orçar ANTES de ingerir — **obrigatório**

A unidade de custo **não é título, é episódio**. Rode no serviço do worker:

```bash
pnpm --filter @screena/ingestion catalog plan-bootstrap \
  --strategy popular --entity movie,tv --limit 100 --json \
  --confirm-production-read
```

> **NÃO RODEI ESTE COMANDO.** Ele exige uma chave TMDB, que não pude ler (regra
> de permissão bloqueia `.env*`), e produção está inalcançável desta máquina.
> Os números são seus quando você o rodar.

Espere um JSON com `episodes`, `jobsTotal`, `apiCalls`, `durationMinutes` e três
cenários (`expected`, `optimistic`, `conservative`). **Olhe `episodes` antes de
qualquer outra coisa** — a evidência do repositório: 3 séries populares geraram
**33.178 episódios**; `--limit 20` gerou **85.878**. Só o Tagesschau tem 21.352.

Para deixar o planejador escolher o `--limit` que cabe:

```bash
pnpm --filter @screena/ingestion catalog plan-bootstrap \
  --strategy popular --entity movie,tv --limit 500 \
  --max-episodes 50000 --max-duration-minutes 120 --json \
  --confirm-production-read
```

### [4] Ligar a ingestão

O serviço **já enfileira sozinho** ao subir (descoberta + `/changes`), na ordem
de **popularidade decrescente**. Acompanhe:

```bash
pnpm --filter @screena/ingestion catalog status --json --confirm-production-read
```

Espere contagens por status (`pending`, `running`, `succeeded`, `dead_letter`).
`succeeded` crescendo = está funcionando.

Se quiser um bootstrap dirigido, além do automático:

```bash
pnpm --filter @screena/ingestion catalog bootstrap \
  --strategy popular --entity movie,tv --limit 200 --apply --force
```

> `--force` é o gate de escrita em produção. Sem ele: `bloqueado
> (production-write)` e exit 3.

### [5] Parte 2 — ratings e streaming com `--apply`

Depois das variáveis 14–17, **comece por `--sample`** (toca a rede, grava
`api_cache` + `api_sync_logs`, **não** grava `external_ratings`):

```bash
pnpm --filter @screena/ratings exec tsx bin/sync-film-show-ratings.ts \
  --kind=movie --limit=5 --sample
```

Se sair `Bloqueado: ... exige CINERIE_RATINGS_PROVIDER_AUTHORIZED=true`, a
variável 14 não chegou ao processo.

Só então:

```bash
pnpm --filter @screena/ratings exec tsx bin/sync-film-show-ratings.ts \
  --kind=movie --limit=20 --apply
```

```bash
pnpm --filter @screena/streaming exec tsx bin/sync-streaming-availability.ts \
  --kind=movie --country=BR --limit=20 --apply
```

Confirme o resultado:

```sql
SELECT rating_source, COUNT(*), COUNT(*) FILTER (WHERE display_allowed) AS exibiveis
  FROM external_ratings GROUP BY rating_source ORDER BY 2 DESC;
```

```sql
SELECT provider_api, country_code, COUNT(*),
       COUNT(*) FILTER (WHERE display_allowed) AS exibiveis
  FROM watch_availability GROUP BY provider_api, country_code;
```

> **A coluna `exibiveis` provavelmente virá `0`.** Isso é **correto**, não
> defeito: toda linha nasce `display_allowed = false` (invariante 6). Ligar a
> exibição é **decisão humana de licença**, registrada em `source_licenses` — e
> por regra do projeto ela nunca é automática. A nota estará no banco e **não**
> na página até você decidir.
>
> É por isso que **eu não pude executar a prova que você pediu** ("uma página de
> filme exibindo os dois COM crédito visível"): ela exige (a) chave e produção,
> que não alcanço, e (b) uma decisão de licença que é sua, não minha. O que
> entreguei no lugar é a **trava**: 12 testes provando que nota sem crédito e
> oferta sem crédito **não vão ao ar**, com controle positivo mostrando o
> formato exibido (`"7,9/10"` + `IMDb` + atribuição).

---

## 4. Se o worker do catálogo competir com o site pelo banco

**É o mesmo PostgreSQL que serve o site.** Este é o risco operacional real.

### Como reconhecer

| Sintoma | Onde ver |
| --- | --- |
| páginas do site lentas | tempo de resposta do `screen-app` |
| CPU do `screen-db` no teto | painel |
| disco livre caindo rápido | `df -h` |
| conexões esgotando | `SELECT count(*) FROM pg_stat_activity;` |

Consulta de diagnóstico (no `screen-db`):

```sql
SELECT pid, now() - query_start AS duracao, state, left(query, 80) AS query
  FROM pg_stat_activity
 WHERE state <> 'idle' AND now() - query_start > interval '5 seconds'
 ORDER BY duracao DESC;
```

### O que fazer — do mais brando ao mais drástico

| # | Ação | Como | Efeito |
| --- | --- | --- | --- |
| 1 | **Baixar a concorrência** | `CATALOG_WORKER_CONCURRENCY=1` + restart | menos escrita simultânea; a fila continua, mais devagar |
| 2 | **Aumentar o intervalo de poll** | `CATALOG_WORKER_POLL_INTERVAL_MS=10000` | menos `claim` por segundo |
| 3 | **Reduzir o teto de descoberta** | `CATALOG_WORKER_DISCOVERY_LIMIT=200` | lotes menores por ciclo |
| 4 | **Tirar `person` do ciclo** | `CATALOG_WORKER_DISCOVERY_KINDS=movie,tv` | corta **77% do universo** (4,86 M de 6,32 M) |
| 5 | **Pausar o worker** | parar o serviço no painel | **a fila não se perde** — ver abaixo |

**Pausar é seguro, e isso está provado.** A fila é durável: os jobs ficam em
`catalog_jobs` e o serviço retoma exatamente de onde parou. Jobs que estavam em
voo (`running`) são devolvidos pelo `reclaimOrphans`, que roda **na subida** e
periodicamente. Medido em `services/ingestion/scripts/prove-catalog-worker-service.ts`:
SIGKILL sem drenagem, **nenhum job perdido**, 4 órfãos recuperados pelo segundo
serviço, **sem duplicar trabalho**.

**Regra de parada dura:** disco livre abaixo de **20%** → pare o worker
imediatamente (ação 5). Abaixo disso o autovacuum não consegue trabalhar, o
PostgreSQL degrada — e o site cai junto, porque é o mesmo banco.

### Prevenção, se você puder pagar por ela

Um **usuário PostgreSQL próprio** para o worker, com
`ALTER ROLE catalog_worker SET statement_timeout = '60s'` e um teto de conexões
menor que o do site. Assim uma consulta descontrolada do worker morre sozinha em
vez de segurar o banco. Não implementei — é mudança de infraestrutura, e a
decisão de credencial é sua.

---

## 5. Checklist final

- [ ] **[0]** disco medido; fator de compressão do `tmdb_raw` conhecido
- [ ] **[1]** migration aprovada por você; duas pré-condições rodadas; backup feito
- [ ] `screen-db` migrado
- [ ] variáveis 1–12 no `cinerie-catalog-worker` (1 e 2 como **File Mount**)
- [ ] **4a e 4b** coladas — é o passo que ficou de fora em 2026-08 e deixou
      dois relógios enfileirando a mesma descoberta
- [ ] serviço criado, 1 réplica, sem domínio público
- [ ] `/healthz` 200 e `/readyz` 200 com os 6 checks `ok`
- [ ] **[3]** `plan-bootstrap` rodado e o número de **episódios** conferido
- [ ] **[4]** `catalog status` mostrando `succeeded` crescendo
- [ ] disco reconferido depois do primeiro ciclo
- [ ] **[5]** variáveis 14–17; `--sample` antes de `--apply`
- [ ] decisão humana de licença registrada em `source_licenses` antes de qualquer
      `display_allowed = true`

---

## 6. O que este roteiro NÃO cobre

- **Imagem nunca construída.** O daemon do Docker não está rodando nesta
  máquina. O `Dockerfile.catalog-worker` foi validado **por leitura** e segue o
  molde do `Dockerfile.publication-worker`, que já roda em produção — mas o
  `docker build` é a primeira coisa a falhar, e ela vai falhar no seu ambiente,
  não aqui. Construa antes de promover.
- **Normalizadores das tabelas novas.** A migration cria `entity_genres`,
  `movie_release_dates` e `tv_content_ratings`; **nada as popula ainda**. Esse é
  o trabalho seguinte, depois da sua aprovação do schema.
- **Normalizador de `watch/providers` do TMDB.** O payload já é baixado e
  arquivado em `tmdb_raw`, mas nunca normalizado — ver
  [`tmdb-vs-rapidapi-coverage.md`](../operations/tmdb-vs-rapidapi-coverage.md).
- **Formato de atribuição exigido por cada provedor.** Não verifiquei a
  documentação viva. Pendência registrada em
  [`ratings-streaming-provider-authorization.md`](../legal/ratings-streaming-provider-authorization.md) §5.
- **Backup automático.** Nenhum foi configurado ou executado.
