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

`flock -n` no wrapper: dois ciclos simultaneos duplicariam cota TMDB à toa.

**CORRECAO (Prompt 03.2):** a versao anterior deste documento afirmava que **nao
existia** unique parcial em `(entity_type, entity_id, language_code) WHERE
is_current`. **Estava errado.** A migration
`20260715120000_data_governance_hardening` cria
`page_indexability_decisions_current_unique` exatamente com essa definicao, mais
um trigger que exige que `supersedes_id` aponte para o MESMO grupo.

A busca que gerou o erro procurou `UNIQUE` e `is_current` na MESMA linha do SQL —
e o `WHERE is_current = true` esta na linha seguinte. A verificacao correta e
consultar `pg_indexes` num banco migrado, que e o que
`validate-catalog-integrity-real-postgres.ts` faz agora, junto de um teste que
tenta inserir uma segunda decisao vigente e confirma que o **banco recusa**.

Ou seja: a integridade nao depende do `flock`. O lock evita desperdicio de cota;
quem garante uma unica decisao vigente e o PostgreSQL.

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

Se o webhook ESTAVA configurado e a entrega falhou, o ciclo imprime em stderr
(journal da unit):

```
catalog-cycle: ALERTA NAO ENTREGUE (<outcome>): <detail>
catalog-cycle: ALERTA NAO ENTREGUE — o canal de alerta falhou; ninguem foi notificado sobre este ciclo.
```

Ate 2026-08 essa falha era engolida (`(ignorada)`): o canal caia e o operador
nao descobria. O exit code continua sendo o do CICLO, nunca o do alerta — o que
mudou e que a falha do alerta passou a deixar rastro. Contrato completo em
[`OBSERVABILITY.md`](../runbooks/OBSERVABILITY.md) §4.2.

---

## 5. Decisoes de indexabilidade

```bash
pnpm catalog index-decisions --dry-run --json    # mostra o diff e o censo de flips
pnpm catalog index-decisions --apply             # grava (sujeito ao freio abaixo)
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

### Freio de mudanca em massa

Este comando roda **de hora em hora, sem humano nenhum**. Sem freio, alterar a
politica pura em [`packages/seo/src/catalog-indexability.ts`](../../packages/seo/src/catalog-indexability.ts)
aplicaria a mudanca ao catalogo **inteiro** no primeiro ciclo depois do deploy —
a "indexacao em massa" que a **secao 6 do `CLAUDE.md`** manda submeter a revisao
humana.

Antes de gravar, o produtor conta quantas entidades **entram ou saem do
sitemap**. Passando do teto, ele grava **zero linhas**, imprime o censo por razao
e sai com **exit 5**.

**O que conta como flip.** O sitemap exclui com
`NOT EXISTS (... decision <> 'index')` — ou seja, **ausencia de decisao significa
dentro**. Dai:

| Transicao | Flip? | Por que |
| --- | --- | --- |
| `null` -> `index` | nao | ja estava dentro; e o crescimento normal do catalogo |
| `null` -> `noindex`/`draft`/`blocked` | **sim** | a pagina sai do sitemap |
| `index` -> `noindex` | **sim** | sai |
| `noindex` -> `index` | **sim** | entra |
| `noindex` -> `draft` | nao | continua fora; so mudou a razao |
| `index` -> `index` (bump de `policy_version`) | nao | reemissao sem efeito no sitemap |

Consequencia pratica: subir `CATALOG_POLICY_VERSION` **sozinho** passa livre
(reemite tudo com o mesmo veredito); o que o freio pega e o bump **acompanhado de
regra nova**.

**Tetos** (em OU — passar de qualquer um trava): `500` flips absolutos **ou**
`5%` das entidades avaliadas. O absoluto protege catalogo grande, onde 5% ainda
sao milhares de paginas; o proporcional protege catalogo pequeno, onde 500 flips
seriam o acervo inteiro. Ajustaveis por execucao:

```bash
pnpm catalog index-decisions --dry-run --max-flips 50 --max-flip-percent 100
```

**Destravar** e ato humano, fora do timer — leia o censo antes:

```bash
pnpm catalog index-decisions --dry-run --json
pnpm catalog index-decisions --apply --confirm-mass-change
```

Em producao os dois gates valem juntos: `--force` (gate de escrita, secao 3 do
`exit.ts`) **e** `--confirm-mass-change` (freio). Um nao substitui o outro —
`--force` diz "sei que este banco e producao", o freio diz "sei que estou
mudando muitas paginas de lado".

```bash
pnpm catalog index-decisions --apply --confirm-mass-change --force
```

O `--dry-run` tambem sai com **5** quando o freio bloquearia: ele e a
pre-checagem do `--apply`, e sair `0` ali diria "pode aplicar" para a unica
execucao que nao pode.

**No ciclo horario** ([`catalog-cycle-with-alert.sh`](../../scripts/catalog/catalog-cycle-with-alert.sh)),
o exit 5 e tratado **separado de falha**: emite alerta (`severity: warning`,
source `queue`) e o ciclo **segue**. Nao vira vermelho de hora em hora — um ciclo
que falha sempre deixa de ser lido, e a proxima falha real do worker passaria
despercebida. O script **nunca** passa `--confirm-mass-change`; isso e travado
por [`tests/governance/catalog-mass-change-brake.test.ts`](../../tests/governance/catalog-mass-change-brake.test.ts).

---

## 6. Diagnostico rapido

| Sintoma | Causa provavel |
| --- | --- |
| fila processa, zero entidades | falta `db:seed` ou taxonomias (FK violation) |
| `sync_details` morre em massa | banco em WIN1252 — payload real tem turco/tailandes/cirilico |
| bootstrap "pequeno" leva horas | serie longa na lista; rode `plan-bootstrap` antes |
| entidades sem rota publica | slug ausente; ver limite do short-circuit de cache no runbook |
| sitemap nao exclui nada | `page_indexability_decisions` vazia; rode `index-decisions --apply` |
| `index-decisions` sai com 5 e nao grava | freio de mudanca em massa armado; leia o censo com `--dry-run --json` antes de `--confirm-mass-change` |
| ciclo alerta toda hora sobre indexabilidade | idem: o freio segue armado ate um humano confirmar ou a politica voltar atras |

---

## 7. Backfill de finalizacao

```bash
pnpm catalog backfill-finalization --dry-run --json
pnpm catalog backfill-finalization --apply
```

`sync_details` so finaliza quando ha upsert. No short-circuit de cache o
importador faz `touch` e devolve `id: null` — nao ha o que finalizar. Entidade
importada ANTES do wiring de finalizacao, cujo payload nao mudou desde entao,
fica presa sem slug: sem rota publica, sem busca, sem sitemap.

Forcar chamada externa em todo sync consertaria — e seria pior: gastaria cota em
todas as entidades por causa de poucas. O backfill ataca so as presas.

| Garantia | Como |
| --- | --- |
| slug valido nunca alterado | candidatos sao apenas entidades SEM slug canonico |
| traducao existente preservada | so cria a AUSENTE |
| pessoa inelegivel continua sem slug | reusa a regra de elegibilidade |
| nenhuma chamada TMDB | traducao existente -> linha canonica -> dado local |
| sem churn na reexecucao | entidade finalizada sai do conjunto de candidatos |
| retomavel | `checkpoint` devolve o ultimo id por tipo |

Sem dado local suficiente, reporta `missing_title` em vez de gastar cota em
silencio.

---

## 8. Censo de publicabilidade

`catalog audit-database` separa seis estados que **nao sao a mesma coisa**:

existir no banco · ter rota · renderizar · poder publicar · entrar no sitemap ·
ter decisao registrada

Por tipo: com/sem slug, com/sem traducao, com/sem midia, renderizavel,
publicavel, elegivel a sitemap, com decisao, **decisao ausente** e **decisao
divergente** da policy atual — esta ultima e a que revela policy desatualizada
no banco. Mais as razoes das decisoes vigentes, agrupadas.
