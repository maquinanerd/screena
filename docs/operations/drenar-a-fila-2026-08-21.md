# Drenar a fila e acender a imagem — o que o dono roda, na ordem

> Data: 2026-08-21. **Nada aqui foi executado em produção.** São os comandos;
> quem roda é o dono. Nenhum valor de chave, token ou senha aparece neste
> documento.

---

## 0. O diagnóstico, em uma frase

**534 jobs em `catalog_jobs`, todos `pending`, porque o serviço que os drena
nunca foi criado.** O `screen-cron` (produtor) subiu; o
`screen-catalog-worker` (consumidor) não. O painel ficava verde porque media
`api_sync_logs` — o relógio do agendador —, nunca a fila de trabalho.

Ver [`ingestion-scheduler.md` §6.1](./ingestion-scheduler.md) para a
configuração completa do serviço que falta.

---

## 1. Antes de qualquer coisa: MEDIR (read-only, não muda nada)

```bash
corepack pnpm --filter @screena/sync ingestion:status
```

O painel **mudou**: agora a primeira seção é `FILA DE TRABALHO (catalog_jobs)`,
com uma linha por tipo de job — pendentes, em execução, retry, concluídos,
falhos e **a idade do pendente mais antigo**. Guarde esta saída: é o "antes" da
tabela do item 6.

Espere ver, hoje, algo como:

```
FILA DE TRABALHO (catalog_jobs) — 534 pendente(s)
  !! NENHUM job jamais foi processado: 534 aberto(s), zero concluido(s).
```

Se **não** aparecer essa linha, o diagnóstico mudou desde a medição — pare e
releia antes de seguir.

---

## 2. Migrations e o registro legal

As migrations do banco **não mudaram nesta leva**. O que mudou é declaração de
licença, que entra pela CLI do `legal`.

> ### Este passo NÃO é opcional, e pular ele apaga arte do site
>
> Medido em produção em **21/08/2026, depois do deploy da PR #209 e antes do
> `apply`**: nenhuma página de detalhe de filme ou série tinha pôster, backdrop,
> banda de mídia ou faixa de crítica. Os mesmos títulos mostravam pôster
> normalmente no índice `/pt/filmes/` — porque o índice
> (`entity-index-presenter`) ainda **não** passa pelo gate, e o detalhe
> (`movie-presenter` / `series-presenter`) passa.
>
> A causa não é bug: é o gate funcionando **fail-closed** contra um banco onde a
> decisão ainda não foi aplicada. O código diz `displayAllowed: true` (declarado
> em `authorization-spec.ts`); o banco de produção ainda dizia o contrário. O
> rodapé, que lê a **declaração** e não o banco, continuava creditando as
> imagens que a página não estava exibindo — a divergência fica visível aí.
>
> **Como conferir em 10 segundos, sem banco:** abra uma ficha de filme e procure
> `image.tmdb.org/t/p/w500` (pôster) e `w1280` (backdrop) no HTML. Se só
> aparecer `original` (que é o elenco, ainda sem gate), o `apply` não rodou.

```bash
corepack pnpm legal sources review
```

`review` é **read-only** e diz **quantas linhas serão carregadas** antes de
qualquer escrita. Procure a entrada `tmdb` / `image`: ela sai de
`display_allowed=false` para `true`, o que faz a licença ser **superseded** — e
o supersede **carrega** as decisões e as linhas ligadas na mesma transação (a
correção da PR #204). Órfãos devem ficar em zero.

```bash
corepack pnpm legal sources apply --reviewer="Pablo Eduardo — proprietario da Cinerie" --policy-version="cinerie-source-auth/2026-08-v2" --confirm
```

> **A forma é FECHADA.** `sources` é o comando, `apply` o subcomando, e
> `--policy-version` é comparado com `AUTHORIZATION_BATCH` — qualquer outro
> valor sai com erro de uso **sem escrever nada**. A grafia do `--reviewer` é a
> MESMA que já está em produção (sem acento em "proprietario"): usar outra
> criaria duas grafias da mesma pessoa em `decided_by`.

**O que essa decisão autoriza, e sob que condições**, está gravado na própria
linha (`notes` de `authorization-spec.ts`), não no código: atribuição no rodapé;
a arte é material de terceiro servido pelo canal do TMDB (autoriza **exibir**,
nunca redistribuir o arquivo); sem alteração que descaracterize a arte; sem
reivindicação de propriedade.

---

## 3. Criar o serviço que falta

Passo de painel, não de terminal. A configuração completa — imagem, comando,
porta, health, réplicas e **todas** as variáveis pelo nome — está em
[`ingestion-scheduler.md` §6.1](./ingestion-scheduler.md).

Resumo do que não pode faltar:

| | |
| --- | --- |
| Dockerfile | `Dockerfile.catalog-worker` (contexto = raiz) |
| Porta | `3004`, só health |
| `CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED` | `true` — **sem ela o serviço recusa subir** |
| `CATALOG_WORKER_ENQUEUE_DISCOVERY` | `false` (o `screen-cron` já enfileira) |
| `CATALOG_WORKER_ENQUEUE_CHANGES` | `false` (idem) |
| `DATABASE_URL`, `TMDB_READ_ACCESS_TOKEN` | **File Mount**, nunca `--build-arg` |

Depois de subir:

```bash
curl -sS http://127.0.0.1:3004/readyz
```

`200` com os seis checks em `ok`. Um `503` **é diagnóstico**: o campo `detail`
do check que barrou diz exatamente o quê.

---

## 4. Drenar os 534 agora, sem esperar o serviço

Se você quiser ver o catálogo crescer **antes** de criar o serviço, o mesmo
worker roda como comando, no console de qualquer serviço que alcance o banco:

```bash
corepack pnpm --filter @screena/ingestion catalog worker --max-jobs 0 --concurrency 2
```

- `--max-jobs 0` = **sem teto**: fica processando até a fila esvaziar e depois
  segue pollando (é o modo serviço). Para uma passada única com teto, use
  `--max-jobs 600 --concurrency 2`, que drena os 534 e sai.
- **O worker é a exceção declarada da CLI**: não pede `--dry-run` nem
  `--apply`, porque a ação dele *é* processar.

### O custo do dreno

| | |
| --- | --- |
| Chamadas ao TMDB | **~1 por job de detalhe/mídia/temporada**, mais o cascateamento que cada `sync_details` enfileira (créditos, ids externos, mídia). Para os 534 atuais: da ordem de **1,5 k–2,5 k requisições**. |
| Cota | O TMDB **não publica teto diário** — o registro de cota do projeto trata `tmdb` como `assumed_floor`. O rate limit por provedor e o circuit breaker do cliente já governam o ritmo; `--concurrency 2` mantém folga. **Não estoura.** |
| Tempo | Com `--concurrency 2` e o rate limit atual, **da ordem de 20–40 min** para os 534. Com `--concurrency 4`, cerca de metade. |
| Escrita | `movies`, `tv_shows`, `people`, `tmdb_images`, `tmdb_videos`, `entity_external_ids`, `cast_members`, `crew_members`, `api_cache`, `api_sync_logs`. |

> Estes números são **projeção a partir do código** (1 requisição por job, mais
> o cascateamento declarado em `sync-details-handler.ts`), não medição de
> produção — esta máquina não alcança o banco de produção. Meça com o item 6.

---

## 5. Conferir que o painel agora diz a verdade

```bash
corepack pnpm --filter @screena/sync ingestion:status
```

Com a fila drenada, cada tipo sai de `REPRESADA` para `drenada`, o aviso
"NENHUM job jamais foi processado" some, e o semáforo volta a `OK`.

Com a fila **cheia**, o mesmo comando mostra `REPRESADA` e o semáforo vai a
`DEGRADADO` — o comportamento está provado por
`pnpm --filter @screena/sync prove:queue-drains` (PostgreSQL efêmero,
migrations reais, TMDB falso; 13 verificações, metade delas controle negativo).

---

## 6. MEDIR se resolveu — tabela antes/depois

```sql
SELECT 'tmdb_images'                  AS tabela, COUNT(*) FROM tmdb_images
UNION ALL SELECT 'tmdb_videos',                  COUNT(*) FROM tmdb_videos
UNION ALL SELECT 'movie_genres',                 COUNT(*) FROM movie_genres
UNION ALL SELECT 'tv_show_genres',               COUNT(*) FROM tv_show_genres
UNION ALL SELECT 'movie_production_countries',   COUNT(*) FROM movie_production_countries
UNION ALL SELECT 'movies',                       COUNT(*) FROM movies
UNION ALL SELECT 'tv_shows',                     COUNT(*) FROM tv_shows;
```

```sql
-- a fila, por tipo e estado
SELECT job_type::text, status::text, COUNT(*),
       MIN(created_at) FILTER (WHERE status = 'pending') AS pendente_mais_antigo
  FROM catalog_jobs GROUP BY 1, 2 ORDER BY 1, 2;
```

**Se `movie_genres`, `tv_show_genres` ou `movie_production_countries`
continuarem em zero depois do dreno**, o dreno não explicou tudo. As três
tabelas são escritas por `store.ts` (`upsertMovie`/`upsertTvShow`) a partir de
`normalized.genres` / `normalized.countries`, com os flags de presença
`genresPresent` / `countriesPresent` — que existem justamente para distinguir
"o payload não trouxe" de "o payload trouxe vazio", e para não apagar o que já
existe quando o campo ausenta. O próximo passo, nesse caso, é comparar um
payload cru em `api_cache` com a linha resultante.

---

## 7. Uma armadilha que ficou consertada nesta leva

`importMovie` (e os irmãos de TV e pessoa) tinham um **sucesso falso com cache
quente**: o ramo "payload inalterado" chamava `touchMovie` e **descartava o
booleano de retorno**. Com o payload já em `api_cache` de uma tentativa que
falhou depois da escrita do cache, toda tentativa seguinte tocava **zero**
linhas e reportava `success` — `api_sync_logs` verde, job fora da fila,
entidade ausente, **para sempre** (o hash nunca mais muda).

Medido durante esta leva: `catalog sync` imprimiu `1 ok · 603: inalterado` com
a tabela `movies` **vazia**.

Consequência prática para você: **se houver entidades que "sincronizaram com
sucesso" e não existem no banco**, elas estavam presas nesse laço. Depois do
deploy desta leva, um novo `sync` delas passa a criar a linha, porque o ramo
agora só reporta sucesso quando encontrou o que tocar.

---

## 8. De 239 até ~15 mil — o caminho, e por que a diária sozinha não chega

**Antes de drenar, leia isto.** Os 3 jobs `discover_ids` que estão em
`catalog_jobs` carregam `enqueueDetails: true`. Quando o worker os processar,
cada id descoberto vira um `sync_details`. Quantos ids é o que
`CINERIE_SCHEDULER_DISCOVERY_LIMIT` decide — e até esta leva ele era
**`null` hardcoded**, ou seja, o universo inteiro do TMDB.

### Por que a descoberta diária, sozinha, não faz o catálogo crescer até 15 k

`services/ingestion/src/discovery/export-discovery.ts` ordena o export **por
popularidade** e só então corta pelo `limit`. O corte é um **prefixo**, e o
prefixo é praticamente o mesmo todo dia. O ganho diário não é "mais 2000
títulos" — é só o que **entrou** no topo do export desde ontem. Ordem de
grandeza: dezenas por dia. Chegar a 15 k assim levaria **meses**.

### O que realmente move o número

O teto **é** a alavanca. Com o worker de pé, o primeiro ciclo drenado já leva o
catálogo ao tamanho do teto:

| `CINERIE_SCHEDULER_DISCOVERY_LIMIT` | Títulos após o 1º ciclo | Jobs | Requisições TMDB | Tempo (`--concurrency 2`) |
| --- | --- | --- | --- | --- |
| `2000` (default novo) | ~4.000 | 6.000 | ~17 k | ~2,8 h |
| `7500` | **~15.000** | 22.500 | ~63 k | ~10,5 h |
| `10000` | ~20.000 | 30.000 | ~84 k | ~14 h |

> **Base dos números:** 1 `sync_details` por id descoberto (movie + tv + person),
> mais o cascateamento de dependentes que `sync-details-handler.ts` enfileira, a
> ~1,2 s por requisição imposto pelo rate limit do próprio cliente. São
> **projeções a partir do código**, não medição de produção.

### O comando da leva inicial

Suba o `screen-catalog-worker` (§3) com o teto que você quer e deixe o ciclo
diário fazer o trabalho — **não há comando separado de semente necessário**:

```
CINERIE_SCHEDULER_DISCOVERY_LIMIT=7500
```

no `screen-cron`, e o próximo ciclo de descoberta enfileira os 22.500 jobs. O
worker drena no ritmo dele; a fila é durável e retomável, então nada se perde
se o container reiniciar no meio.

Se preferir uma passada única sem mexer no agendador:

```bash
corepack pnpm --filter @screena/ingestion catalog bootstrap --strategy daily-exports --limit 7500 --apply
```

Rode antes com `--dry-run` — a CLI recusa mutar sem um dos dois.

### Não semear lixo

O critério **já existe e não é novo**: o export vem ordenado por popularidade, o
filtro anti-adulto é **fail-closed em duas camadas** (arquivos `adult_*` nunca
são baixados; campo `adult` malformado ou ausente onde deveria existir é
descartado como *unsafe*, nunca presumido seguro), e id duplicado é removido
antes do corte. Aumentar o teto **não** relaxa nenhum desses filtros — só move o
ponto do prefixo.
