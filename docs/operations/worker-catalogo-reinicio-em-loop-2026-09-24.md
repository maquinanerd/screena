# O worker de catálogo reiniciando em loop — 24/09/2026

> Diagnóstico medido em produção, só leitura (DbGate e log do painel), mais a
> leitura do código em `main` (`59a414f`). **MEDI** é número de produção; **LI** é
> código. A última seção lista o que ainda não está provado.

## O sintoma

`service_heartbeats` com `service_key = 'screen-catalog-worker'`, **MEDI**:

| hora (UTC, 24/09) | containers novos | vida mediana   |
| ----------------- | ---------------- | -------------- |
| 00h–08h           | 1–7 por hora     | de 2 min a 1 h |
| 09h               | 14               | 153 s          |
| 10h–11h           | 25–28            | 12–17 s        |
| 12h–16h           | 12–22            | 39–241 s       |
| 17h–20h           | 36–55            | 5–13 s         |

236 containers em 6 h, para 1 réplica. O `screen-cron` tem 1 instância no mesmo
período. Cada morte deixou até 4 jobs em `running`, que o reclaim devolveu depois
como `worker_heartbeat_timeout`.

## O que foi descartado

- **Memória:** RSS de 120 a 200 MB e heap de 20 a 34 MB. O serviço não tem limite de
  memória nem de CPU no painel (`resources.*Limit = 0`). **MEDI**
- **HEALTHCHECK do Docker:** `/healthz` só responde `isAlive()`, sem consultar o
  banco (`services/ingestion/src/worker-service/health-server.ts`). O teste roda
  a cada 30 s, com 30 s de carência e 3 tentativas, então no mínimo 2 minutos até
  o Docker matar. Os containers morriam em 3 a 15 s. **LI**
- **Job envenenado:** os jobs que morreram com o container estavam todos na 1ª
  tentativa e eram de entidades diferentes. Nenhum volta a cada container novo. **MEDI**
- **Produtores sem prioridade:** `sync_changes` roda 3 a 4 vezes por dia desde 17/09,
  na prioridade 20, sempre com sucesso; o último foi 24/09 às 17:56 UTC. **MEDI**
  - Os 59 `sync_changes` e os 42 `discover_ids` presos na prioridade 100 são de
    14 a 16/09. O `ON CONFLICT DO NOTHING` nunca sobe a prioridade de uma linha
    existente (`producer-jobs.ts`), então eles não vão rodar. Não afetam nada.

## O mecanismo

**LI (`main`):**

1. O claim roda numa **transação interativa do Prisma sem opções**
   (`catalog-job-store.ts`, `prisma.$transaction(async tx => …)`). Vale o teto
   padrão: 2 s de espera por conexão e 5 s de duração. Passou disso, é P2028.
2. O `claimNext()` roda **fora de qualquer `try`** no laço
   (`catalog-jobs/worker.ts`). Um erro nas escritas de estado (`complete` e
   `applyFailure`) também escapa do laço.
3. O erro rejeita o laço e o `Promise.all`, e depois o `main()`. O
   `.catch` do `bin/catalog-worker-service.ts` escreve a mensagem no stderr e
   chama **`process.exit(1)`**. Não existe handler de `uncaughtException` nem de
   `unhandledRejection`.

**MEDI:** o claim era a consulta mais cara do worker.

| filtro do claim                            | plano                                                   | blocos lidos                | tempo (isolado) |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------- | --------------- |
| `status::text IN (…)` (o código de `main`) | Seq Scan na fila inteira (~3,6 milhões de linhas)       | 172.735 (≈1,3 GB, do disco) | 908 ms          |
| `status IN (… enum …)`                     | Bitmap Index Scan em `(status, priority, available_at)` | 50.093                      | 379 ms          |

Esses 908 ms foram medidos isolados, sem o `FOR UPDATE` e sem os outros 3 laços
concorrendo. Com 4 laços pedindo job um atrás do outro, mais o site e o
agendador no mesmo banco, a transação passa dos 5 s. **MEDI:** os erros P2028
aparecem nos `sync_details` a partir das 09h UTC, a mesma hora em que os reinícios
saltam de ~5 para 14 e depois 28 por hora.

A causa é que a fila cresceu: 147.632 `sync_media` pendentes, o mais antigo de
20/09. Com o cast, cada claim lê a tabela inteira, que cresce, e o claim piora. Cada
morte custa ainda mais tempo:

- **download do pnpm pelo corepack:** `Corepack is about to download …pnpm-9.15.4.tgz`
  em todo início. O `corepack prepare` do Dockerfile roda como `root`, e o
  processo roda como `node`;
- **impressão digital de 1.593 arquivos;**
- **reclaim dos órfãos.**

## O conserto (PR desta data)

1. **Claim numa instrução só:** um `UPDATE` cuja condição é a subconsulta
   `SELECT id … FOR UPDATE SKIP LOCKED LIMIT 1`, com `RETURNING`. A exclusão
   entre workers é a mesma, sem transação interativa, portanto sem o teto de 5 s,
   e com uma ida ao banco em vez de duas.
2. **`status IN ('pending'::"CatalogJobStatus", …)` sem cast:** o índice passa a
   valer.
3. **O laço no modo serviço (`drain: false`) não sai mais em erro do banco da fila.**
   - Registra `catalog_worker_store_error` e espera de 1 s até no máximo 5 s,
     dobrando a cada falha seguida. O teto fica abaixo dos 10 s de grace period do
     Docker.
   - O job em voo fica `running`, e o reclaim o devolve à fila.
   - No modo `drain` (CLI e CI) o erro continua subindo.

## O que ainda NÃO está provado

- **A linha de stderr da morte.** O log do painel veio cortado para o container
  anterior, e o container observado durante a medição não morreu. A cadeia P2028 →
  `exit(1)` está provada pelo código e pela correlação de horário, não por uma linha
  de log. Quem tem acesso ao host confirma com
  `docker service ps rss_prime_screen-catalog-worker --no-trunc` (o código de
  saída) e com a linha de stderr que vem logo antes de cada linha "Corepack is
  about to download".

## 28/09/2026 — o worker estável passou a pesar no banco inteiro

Com o conserto da #327 no ar, o worker parou de reiniciar: 1 container com o
código novo. Só que, trabalhando sem parar, o claim de `status IN (...)` virou o
maior leitor do banco. **MEDI**, em 28/09:

- **O site degradou:** a home levava de 16 a 56 s (era ~2 s em 24/09), o
  `/sitemap.xml` voltava 524 depois de 127 s, e a listagem de filmes levava ~6 s.
  A ficha de filme e o health seguiam rápidos.
- **`pg_statio_user_tables` numa janela de 30 s:** a `catalog_jobs` lia **122 MB/s
  do disco e 489 MB/s do cache**, praticamente toda a leitura do banco, que tem
  `shared_buffers` de 128 MB.
- **O claim em si, medido no mesmo minuto:**

| forma do claim                            | plano                                  | tempo    | blocos do disco |
| ----------------------------------------- | -------------------------------------- | -------- | --------------- |
| `status IN ('pending', 'retry_wait')`     | Bitmap Heap Scan + Sort de ~30 mil     | 2.668 ms | 18.230          |
| um status por subconsulta (este conserto) | Index Scan na ordem do índice, LIMIT 1 | 11 ms    | 2               |

- **A contagem do sitemap de pessoas** (um `COUNT(*)` sobre `slugs` junto com
  `people`) tinha 4 cópias rodando ao mesmo tempo, há 16 a 24 minutos cada, todas
  esperando disco. A Cloudflare desiste em 100 s, mas a consulta continua no banco,
  e cada nova leitura do sitemap empilha mais uma.

**O conserto:** o claim passa a buscar a melhor candidata de cada status em sua própria
subconsulta (`WITH pendente …, em_espera …`), cada uma com `FOR UPDATE SKIP LOCKED`,
porque o Postgres não aceita lock numa entrada de `UNION`. Depois fica a melhor das duas por
`(priority, available_at)`, a mesma ordem global de antes. Com um status só, a
ordem pedida é a ordem do índice `(status, priority, available_at)`, e o Postgres para na
primeira entrada elegível. Não precisa de índice novo nem de migration.

## Próximos passos, fora deste PR

1. **Índice parcial:** não é mais necessário para o claim. A consulta por status já usa
   o índice existente na ordem certa (11 ms).
2. **Sitemap de pessoas:** a contagem leva minutos e se empilha. Ela precisa de
   `statement_timeout` próprio e de uma forma que não varra `slugs × people` a cada
   pedido. Ver [`../../apps/web/src/server/seo/sitemap-index.ts`](../../apps/web/src/server/seo/sitemap-index.ts)
   e a reversão da #323.
3. **`shared_buffers` de 128 MB** é o padrão de fábrica, para um banco de ~10 GB. É
   configuração do servidor: decisão do dono.
4. **Corepack no Dockerfile:** preparar o pnpm num `COREPACK_HOME` legível pelo
   usuário `node`, para a subida não depender da rede nem pagar o download a cada
   reinício.
5. **Os produtores órfãos da prioridade 100** (14 a 16/09): cancelar é escrita em
   produção, decisão do dono.
6. **O backlog de `sync_media`** (147 mil) é o combustível do problema. Revisar a
   cascata de mídia por episódio, como no item "C" de
   [`fila-represada-2026-09-16.md`](./fila-represada-2026-09-16.md).
