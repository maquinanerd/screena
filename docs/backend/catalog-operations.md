# Operacao do catalogo — Cinerie

> Complementa [`catalog-editorial-scope.md`](catalog-editorial-scope.md) (o QUE
> entra) e [`catalog-bootstrap-evidence-2026-07.md`](catalog-bootstrap-evidence-2026-07.md)
> (a prova). Este documento e o COMO operar.

---

## 1. Planejar antes de executar

`--limit` mede **titulo**, e titulo nao e a unidade de custo.

```bash
pnpm catalog plan-bootstrap --strategy popular --entity movie,tv --limit 20 --json
```

Medido contra o TMDB real em 2026-07-24, `--limit 20` (20 filmes + 20 series):

| Dimensao | Valor |
| --- | ---: |
| temporadas | 950 |
| episodios | **85.878** |
| jobs | 1.062 |
| chamadas TMDB | 1.054 |

As series responsaveis aparecem nomeadas na saida:

| Serie | Temporadas | Episodios |
| --- | ---: | ---: |
| Tagesschau | 75 | 21.352 |
| Gute Zeiten, schlechte Zeiten | 35 | 8.527 |
| 百家讲坛：专题集 | 540 | 7.463 |
| Malhação | 27 | 6.198 |
| 7de Laan | 24 | 6.032 |

Tagesschau e um **telejornal alemao** — cada edicao diaria e um episodio. Nada em
`--limit 20` sugere 85 mil episodios.

### Orcamento

O planejador nao apenas informa: **recusa**.

```bash
pnpm catalog plan-bootstrap --limit 20 --max-episodes 5000
# ESTOUROU episodes: 85878 > 5000 (+80878)
# cabe no orcamento: 20 de 40 titulo(s)
# exit code 4
```

Dimensoes: `--max-titles`, `--max-series`, `--max-seasons`, `--max-episodes`,
`--max-jobs`, `--max-api-calls`, `--max-media-items`, `--max-duration-minutes`.
Dimensao sem teto declarado nunca viola.

O veredito usa o cenario **esperado**, nunca o otimista — orcamento que so cabe
no melhor caso nao e orcamento.

O comando **nao usa banco** (planejar precisa funcionar de um host sem
PostgreSQL) e **nao persiste nada**.

---

## 2. Executar

Pre-requisitos obrigatorios em banco novo (ver
[runbook de bootstrap](../runbooks/catalog-bootstrap.md)): `db:seed`, taxonomias
e configuration cache. Pular qualquer um produz o sintoma mais traicoeiro do
sistema — fila saudavel, zero entidades.

```bash
pnpm catalog bootstrap --strategy popular --entity movie,tv --limit 10 --apply
pnpm catalog worker --concurrency 4 --max-jobs 0
```

---

## 3. Ciclo continuo

```bash
scripts/catalog/catalog-cycle-with-alert.sh
```

Executa, em ordem: snapshot -> `worker` -> `search-reindex` ->
`index-decisions --apply` -> snapshot -> sentinela -> alerta.

Agendado por [`cinerie-catalog-cycle.timer`](../../services/ingestion/systemd/cinerie-catalog-cycle.timer)
(de hora em hora, `Persistent=true`, jitter de 300 s).

### Frequencias

| Job | Frequencia | Por que |
| --- | --- | --- |
| ciclo (worker + busca + indexabilidade) | horaria | drena o que ja esta enfileirado; nao descobre catalogo novo |
| `/changes` incremental | diaria | janela do provider e de 14 dias; diario mantem folga |
| bootstrap | manual | ampliar escopo e decisao editorial, nunca automatica |
| configuration cache | semanal | base de imagens muda raramente |
| detalhe estavel | 7–14 dias | metadado nao muda apos o lancamento |
| episodios de serie no ar | diaria | episodio ganha titulo/still poucos dias antes |

### Concorrencia

`flock -n` no wrapper. Dois ciclos simultaneos duplicariam cota TMDB e poderiam
criar duas decisoes de indexabilidade vigentes — **nao existe unique parcial**
em `(entity_type, entity_id, language_code) WHERE is_current`, apesar do
comentario do schema afirmar que existe.

### Runner legado

`services/sync/systemd/screena-tmdb-catalog.{service,timer}` agenda
`@screena/sync bin/run.ts`, o refresh por frescor anterior a fila. **Nao foi
removido**: continua valido e nao tem consumidor identificado alem da
documentacao (as units se declaram "ilustrativas" e nunca foram instaladas — o
deploy e container EasyPanel, sem systemd).

**Rollback:** desabilite `cinerie-catalog-cycle.timer` e reabilite o legado. Os
dois nao compartilham estado.

---

## 4. Sentinela e alertas

O modo de falha mais perigoso nao e o worker morrer — e ele **parecer saudavel**.

`scripts/catalog/lib/queue-health.mjs` compara os snapshots antes/depois:

| Codigo | Severidade | Significado |
| --- | --- | --- |
| `zero_growth` | critico | jobs concluidos E catalogo parado — o sinal central |
| `queue_stuck` | critico | backlog sem nenhum job concluido |
| `no_slugs` | critico | titulos e nenhum slug: nada vira rota publica |
| `retry_storm` | critico | >30% da fila em `retry_wait` |
| `dead_letter_growing` | critico | dead-letter aumentou no ciclo |
| `dead_letter_present` | aviso | dead-letter estavel |
| `backlog_high` | aviso | backlog acima do teto |
| `checkpoint_stale` | aviso | checkpoint parado alem da janela |
| `no_translations` | aviso | titulos sem traducao |
| `no_search_documents` | aviso | slugs sem projecao de busca |
| `abnormal_people_growth` | aviso | pessoas/titulo acima do teto |

So problema **critico** derruba a saude do ciclo.

Os alertas reusam a infra do Prompt 02 (`scripts/backup/lib/alert.mjs`), com a
source `queue` que ja existia. Configuracao:

```bash
CATALOG_ALERT_WEBHOOK_URL=https://hooks.slack.com/...   # ou BACKUP_ALERT_WEBHOOK_URL
BACKUP_ALERT_PROVIDER=slack                              # ou generic
```

Sem webhook: log local e retorno seguro. **O alerta nunca mascara o exit code do
trabalho.**

---

## 5. Decisoes de indexabilidade

```bash
pnpm catalog index-decisions --dry-run --json    # mostra o diff
pnpm catalog index-decisions --apply             # grava
```

`page_indexability_decisions` e lida pelo sitemap, pelos loaders publicos e pelo
resolver de SEO — e ate esta entrega **nunca foi escrita por processo nenhum**.
As clausulas `NOT EXISTS (... decision <> 'index')` nunca excluiram uma linha.

A politica geral (licenca -> idioma -> caso tecnico -> index) continua vindo de
`resolvePageSeo`. O motor de catalogo acrescenta os gates por tipo:

| Tipo | Gate |
| --- | --- |
| filme / serie | slug canonico + titulo + traducao |
| temporada / episodio | herda a serie (fail-closed quando o pai e desconhecido) |
| pessoa | credito em obra publicavel |

**Sem churn:** decisao igual a persistida nao grava. Uma execucao sobre catalogo
estavel grava zero. Quando muda, a anterior e despromovida e a nova aponta para
ela via `supersedes_id`, na mesma transacao.

**Nao liga indexacao.** Gravar `decision='index'` registra o que a politica diz;
`CINERIE_PUBLIC_INDEXING_ENABLED` continua `0` e e decisao humana separada.

---

## 6. Diagnostico rapido

| Sintoma | Causa provavel |
| --- | --- |
| fila processa, zero entidades | falta `db:seed` ou taxonomias (FK violation) |
| `sync_details` morre em massa | banco em WIN1252 — payload real tem turco/tailandes/cirilico |
| bootstrap "pequeno" leva horas | serie longa na lista; rode `plan-bootstrap` antes |
| entidades sem rota publica | slug ausente; ver limite do short-circuit de cache no runbook |
| sitemap nao exclui nada | `page_indexability_decisions` vazia; rode `index-decisions --apply` |
