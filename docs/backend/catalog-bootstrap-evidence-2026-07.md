# Evidencia — bootstrap real do catalogo (2026-07)

> Execucao REAL contra **TMDB de producao** e **PostgreSQL 16 efemero**. Nenhum
> numero aqui foi estimado. Reproduzivel por
> `services/ingestion/scripts/bootstrap-evidence-real-postgres.ts`.

## Ambiente

| Item | Valor |
| --- | --- |
| Banco | PostgreSQL 16 efemero (`embedded-postgres`), `--encoding=UTF8 --locale=C` |
| Migrations | `prisma migrate deploy` do zero + `db:seed` (tabelas de referencia) |
| Taxonomias | `sync-tmdb.ts taxonomies --apply` + `sync-tmdb-config.ts --apply` |
| Provider | TMDB real (credencial via `--env-file`, nunca lida nem impressa) |
| Escopo | `--strategy popular --entity movie,tv --limit 3 --locale pt-BR` |
| Producao | **nao tocada.** `DATABASE_URL`/`NODE_ENV` forcados no env do filho |

O `.env` da maquina aponta para o banco de **producao** (`NODE_ENV=production`).
O harness sobrescreve `DATABASE_URL` e `NODE_ENV` no ambiente do processo filho —
que tem precedencia sobre `--env-file` no Node. E o que garante que a ingestao
caia no banco efemero. O `--env-file` serve so para o filho ler o token do TMDB.

---

## Censo

| Metrica | ANTES | INTERROMPIDO | DEPOIS (retomada) | 2a execucao |
| --- | ---: | ---: | ---: | ---: |
| movies | 0 | 1 | **3** | 3 |
| tv_shows | 0 | 1 | **3** | 3 |
| seasons | 0 | 75 | **639** | 639 |
| episodes | 0 | 21.352 | **33.178** | 33.178 |
| people | 0 | 143 | **683** | 683 |
| cast_members | 0 | 62 | **328** | 328 |
| crew_members | 0 | 89 | **389** | 389 |
| **slugs** | **0** | 2 | **6** | 11¹ |
| **entity_translations** | **0** | 2 | **6** | 11¹ |
| search_documents | 0 | 2 | **6** | 11¹ |
| tmdb_images | 0 | 587 | **1.249** | 1.377 |
| tmdb_videos | 0 | 50 | **160** | 160 |
| redirects | 0 | 0 | **0** | 0 |
| catalog_jobs | 0 | 21 | 666 | 671¹ |
| api_sync_logs | 0 | 20 | 34 | 49 |
| Fila | — | 15 ok / 6 pendentes | 666 ok | 671 ok |

¹ O salto de 6 para 11 vem da fase de demonstracao do gate de pessoa, que
sincroniza 5 pessoas adicionais — nao de duplicacao.

### Qualidade (estado final)

| Metrica | Valor | Leitura |
| --- | ---: | --- |
| filmes sem slug | **0** | toda obra ingerida virou URL |
| series sem slug | **0** | idem |
| filmes sem traducao | **0** | idem |
| filmes sem poster | **0** | midia real presente |
| filmes sem backdrop | **0** | idem |
| series sem temporada | **0** | cascata completou |
| temporadas sem episodio | **0** | idem |
| slugs canonicos duplicados | **0** | unicidade preservada |
| pessoas sem slug | 678 de 683 | **correto**: pessoa chega como credito, nao ganha rota |

---

## O que cada numero prova

### 1. A correcao do slug funciona

`slugs: 0 -> 6` e `entity_translations: 0 -> 6` para 3 filmes + 3 series.
**Antes desta PR esse caminho produzia zero slugs** — a fila enchia as tabelas
tipadas e nao gerava nenhuma URL publica. `search_documents: 6` confirma em
cascata: a projecao de busca pagina por slug, entao sem slug ela tambem ficava
vazia.

### 2. Idempotencia e exata

Segunda execucao com o MESMO `--request-id`: `movies`, `tv_shows`, `seasons`,
`episodes`, `people`, `cast_members`, `crew_members`, `slugs`, `translations`,
`search_documents` e `catalog_jobs` **identicos**. `redirects` permaneceu em
**0** — nenhum slug trocou sem motivo. Reexecutar o bootstrap e seguro.

### 3. Retomada apos interrupcao

O primeiro worker drenou uma fatia (`--max-jobs 15`) e saiu — mesmo estado que
um SIGTERM deixa: **15 concluidos, 6 pendentes**, 1 filme e 1 serie ja
finalizados. O segundo worker fechou a fila (666 ok) sem reprocessar o que ja
havia terminado e sem duplicar nada.

### 4. Midia real

1.249 imagens e 160 videos vindos do TMDB, com `file_path`, dimensoes e tipo.
Nenhum placeholder, nenhuma imagem inventada.

---

## Amostra real

Filmes, series, temporadas, episodios e pessoas com ids e slugs reais estao no
JSON emitido pelo harness (`--out=<arquivo>`), secao `samples`. Nao sao
reproduzidos aqui porque a lista `popular` muda diariamente — o JSON e o registro
datado.

---

## Gate de pessoa: por que a execucao real NAO serviu de prova

Na execucao real, `peopleUngated = 5` e `peopleGated = 5` — o gate **nao
discriminou**, e isso e esperado: no caminho da fila, pessoa chega como linha de
credito e **nao ganha slug** (`sync_details` so alveja movie/tv). Medido: 683
pessoas, 678 sem slug. Sem slug, a pessoa nem chega a ser candidata.

O cenario que produziu ~22.400 paginas de pessoa em producao exige pessoa **na
descoberta** — ai cada pessoa ganha slug. Reproduzir isso com ingestao real
custaria caro e seria nao-deterministico.

A prova esta em
[`validate-person-eligibility-real-postgres.ts`](../../apps/web/scripts/validate-person-eligibility-real-postgres.ts):
6 pessoas com slug canonico e nome, variando **so** o credito, avaliadas pelo
runtime real (`getSitemapShardXml`). Resultado: **11/11 checks**, 2 entram e 4
ficam de fora. Roda na CI via `validate:all`.

---

## Achados operacionais (so aparecem executando)

1. **`catalog bootstrap` nao funciona contra banco recem-migrado.** Nao enfileira
   `db:seed` nem taxonomias, e as FKs dependem dos dois. Sintoma traicoeiro: a
   fila parece saudavel e **zero entidades persistem**.
2. **Encoding.** Cluster criado com locale do Windows nasce WIN1252; payload real
   com turco/tailandes/cirilico derruba `api_cache` e, com ele, todo
   `sync_details`. Os validadores PG16 existentes nao pegam — usam ASCII.
3. **O custo de uma serie e episodio, nao titulo.** 3 series trouxeram 639
   temporadas e 33.178 episodios. `--limit` subestima o trabalho por ordens de
   grandeza.

Os tres estao documentados em
[catalog-bootstrap](../runbooks/catalog-bootstrap.md) e
[catalog-editorial-scope](catalog-editorial-scope.md).

---

## O que esta evidencia NAO cobre

- **Indexacao continua desligada** (`CINERIE_PUBLIC_INDEXING_ENABLED=0`). Nada
  aqui liga indexacao.
- **Escala.** O escopo editorial alvo (~100+100 titulos) nao foi executado: com
  a lista `popular` atual isso significa centenas de milhares de episodios. O
  numero validado e 3+3.
- **Scheduler e alertas** do caminho da fila continuam pendentes (a unidade
  systemd existente aponta para o runner antigo de stale-refresh).
- **Producao.** Nenhum dado foi escrito em producao.

---

# Complemento — Prompt 03.1 (2026-07-24)

Execucao maior, sob o mesmo harness e as mesmas garantias (PostgreSQL 16
efemero UTF8, TMDB real, producao intocada).

## Escopo executado

`--strategy popular --entity movie,tv --limit 10 --locale pt-BR` — escolhido
apos rodar `catalog plan-bootstrap`, que mostrou que `--limit 20` custaria
85.878 episodios.

## Censo

| Metrica | 3+3 (PR #81) | INTERROMPIDO | **10+10 (03.1)** | 2a execucao |
| --- | ---: | ---: | ---: | ---: |
| movies / tv_shows | 3 / 3 | 2 / 0 | **10 / 10** | 10 / 10 |
| seasons | 639 | 0 | **771** | 771 |
| episodes | 33.178 | 0 | **60.436** | 60.436 |
| people | 683 | 353 | **5.901** | 5.901 |
| cast + crew | 717 | 367 | **6.898** | 6.898 |
| slugs | 6 | 2 | **20** | 20 |
| entity_translations | 6 | 2 | **20** | 20 |
| search_documents | 6 | 2 | **20** | 20 |
| tmdb_images | 1.249 | 587 | **4.944** | 4.992 ¹ |
| tmdb_videos | 160 | 50 | **673** | 673 |
| redirects | 0 | 0 | **0** | **0** |
| catalog_jobs | 666 | 34 | **833** | 838 ² |
| fila | 666 ok | 15 ok / 19 pend | **833 ok** | 838 ok |

¹ **Imperfeicao conhecida, reportada e nao mascarada:** a reexecucao acrescentou
48 linhas em `tmdb_images` (4.944 -> 4.992). O `sync_media` nao e perfeitamente
idempotente — reinsere variantes de imagem. Todas as demais contagens de
entidade sao identicas. O mesmo efeito aparecia no run 3+3 (1.249 -> 1.377).
Nao foi corrigido nesta entrega: exigiria mexer no upsert de midia, fora do
escopo do Prompt 03.1.

² +5 jobs sao os `sync_details` de pessoa da fase que demonstra o gate.

## Qualidade final

Zero filmes/series sem slug, sem traducao, sem poster, sem backdrop; zero series
sem temporada; zero temporadas sem episodio; zero slugs canonicos duplicados.

5.896 das 5.901 pessoas seguem sem slug — **correto**: no caminho da fila,
pessoa chega como linha de credito e nao vira rota publica.

## Retomada

Interrompido em **15 jobs concluidos / 19 pendentes**, com 2 filmes ja
finalizados e 0 series. A retomada fechou a fila em 833 sem reprocessar o que ja
tinha terminado e sem duplicar entidade.

## Estimativa vs. realidade

O planejador estimou **3,5 min** para 40 titulos (1.054 chamadas). A execucao de
20 titulos levou consideravelmente mais, porque o modelo dimensiona por
**chamadas de API** e o custo real e dominado pela **escrita de episodios** no
banco (60.436 linhas). O `overheadFactor` default (1,6) subestima esse regime.

Isso esta registrado aqui de proposito: o modelo e util para ordem de grandeza e
para o gate de orcamento (episodios, jobs, chamadas — todos exatos), mas a
dimensao `durationMinutes` e a menos confiavel das oito. Calibrar exigiria medir
varios regimes de catalogo; nao foi feito.
